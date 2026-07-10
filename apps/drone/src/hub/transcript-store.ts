import crypto from 'node:crypto';

import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  requireHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from '../host/hub-database';
import { appendHubOutboxEvent, initializeHubOutbox } from '../host/hub-outbox';
import { getPromptQueueRepository } from '../host/prompt-queue-repository';

export type StoredTranscriptTurn = {
  at: string;
  id?: string;
  prompt: string;
  ok: boolean;
  output: string;
  error?: string;
  promptAt?: string;
  completedAt?: string;
  model?: string;
  attachments?: unknown;
  automation?: unknown;
  inheritedFromClone?: boolean;
  agentMessageAutoContinue?: unknown;
  agentSuggestion?: unknown;
  dockerSnapshot?: unknown;
};

export type StoredPendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  model?: string;
  messageId?: string;
  cwd?: string | null;
  attachments?: unknown;
  automation?: unknown;
  blockedByAutomation?: boolean;
  state: string;
  error?: string;
  observability?: unknown;
  blipClones?: unknown;
  updatedAt?: string;
};

export type TranscriptImportResult = { available: boolean; transcriptVersion: number; sourceHash: string };
export type TranscriptStoreReadResult = {
  available: boolean;
  count: number;
  transcriptVersion: number;
  sourceHash: string;
  turns: Array<{ index: number; turn: StoredTranscriptTurn }>;
};
export type ChatStoreImportResult = { available: boolean; sourceHash: string };
export type ChatStoreReadResult = { available: boolean; chat: any | null; sourceHash: string };
export type ChatStoreListResult = { available: boolean; chats: string[] };
export type ChatMetadataPatch = {
  set?: Record<string, unknown>;
  setIfMissing?: Record<string, unknown>;
  unset?: string[];
};
export type ChatMetadataPatchResult = {
  available: boolean;
  changed: boolean;
  metadata: Record<string, unknown> | null;
};
export type TranscriptTurnUpdateResult = {
  available: boolean;
  changed: boolean;
  turn: StoredTranscriptTurn | null;
};
export type TranscriptRollbackResult = {
  available: boolean;
  changed: boolean;
  removedTurns: StoredTranscriptTurn[];
  turn: StoredTranscriptTurn | null;
};

export const CHAT_STORE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'canonical chats and transcript turns',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE canonical_chats (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          created_at TEXT,
          updated_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          transcript_version INTEGER NOT NULL DEFAULT 0 CHECK (transcript_version >= 0),
          turns_source_hash TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (drone_id, chat_name)
        );

        CREATE INDEX idx_canonical_chats_drone_name
          ON canonical_chats (drone_id, chat_name);

        CREATE TABLE canonical_chat_turns (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          at TEXT NOT NULL,
          prompt_at TEXT,
          completed_at TEXT,
          turn_json TEXT NOT NULL,
          PRIMARY KEY (drone_id, chat_name, turn_id),
          FOREIGN KEY (drone_id, chat_name)
            REFERENCES canonical_chats(drone_id, chat_name)
            ON UPDATE CASCADE ON DELETE CASCADE
        );

        CREATE INDEX idx_canonical_chat_turns_order
          ON canonical_chat_turns (drone_id, chat_name, prompt_at, at, completed_at, ordinal);

        CREATE TABLE canonical_chat_tombstones (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          reason TEXT NOT NULL CHECK (reason IN ('deleted', 'renamed')),
          replacement_chat_name TEXT,
          deleted_at TEXT NOT NULL,
          PRIMARY KEY (drone_id, chat_name)
        );
      `);

      const oldChats = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hub_chats'")
        .get();
      if (oldChats) {
        connection.exec(`
          INSERT OR IGNORE INTO canonical_chats (
            drone_id, chat_name, created_at, updated_at, metadata_json,
            source_hash, transcript_version, turns_source_hash
          )
          SELECT drone_id, chat_name, created_at, imported_at, chat_json,
                 source_hash, 0, ''
          FROM hub_chats;
        `);
      }

      const oldTurns = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_turns'")
        .get();
      if (oldTurns) {
        connection.exec(`
          INSERT OR IGNORE INTO canonical_chat_turns (
            drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
          )
          SELECT t.drone_id, t.chat_name, t.prompt_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY t.drone_id, t.chat_name
                   ORDER BY COALESCE(t.prompt_at, t.at), t.completed_at, t.prompt_id
                 ) - 1,
                 t.at, t.prompt_at, t.completed_at, t.turn_json
          FROM chat_turns t
          INNER JOIN canonical_chats c
            ON c.drone_id = t.drone_id AND c.chat_name = t.chat_name;
        `);
      }

      const oldTranscriptTurns = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transcript_turns'")
        .get();
      if (oldTranscriptTurns) {
        connection.exec(`
          INSERT OR IGNORE INTO canonical_chat_turns (
            drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
          )
          SELECT t.drone_id, t.chat_name,
                 COALESCE(NULLIF(json_extract(t.turn_json, '$.id'), ''), t.turn_key),
                 t.ordinal,
                 t.at, t.prompt_at, t.completed_at, t.turn_json
          FROM transcript_turns t
          INNER JOIN canonical_chats c
            ON c.drone_id = t.drone_id AND c.chat_name = t.chat_name;
        `);
      }
    },
  },
];

type ChatRow = {
  chat_name: string;
  metadata_json: string;
  source_hash: string;
  transcript_version: number;
  turns_source_hash: string;
};
type TurnRow = { turn_json: string };

const memoryChats = new Map<string, { metadata: any; sourceHash: string; version: number }>();
const memoryTurns = new Map<string, Map<string, StoredTranscriptTurn>>();
const memoryPrompts = new Map<string, Map<string, StoredPendingPrompt>>();
const memoryCancelledPrompts = new Set<string>();
let cachedRepository: { database: HubDatabase; repository: ChatTranscriptRepository } | null = null;
let unavailableReason: string | null = null;

function key(droneId: string, chatName: string): string {
  return `${droneId}\u0000${chatName}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseIsoMs(raw: unknown): number {
  const ms = Date.parse(typeof raw === 'string' ? raw : '');
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeTurn(raw: any): StoredTranscriptTurn {
  const at = String(raw?.at ?? new Date().toISOString());
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
  return {
    at,
    ...(id ? { id } : {}),
    prompt: String(raw?.prompt ?? ''),
    ok: Boolean(raw?.ok),
    output: raw?.ok ? String(raw?.output ?? '') : '',
    ...(!raw?.ok ? { error: String(raw?.error ?? 'failed') } : {}),
    ...(typeof raw?.promptAt === 'string' && raw.promptAt.trim() ? { promptAt: raw.promptAt.trim() } : {}),
    ...(typeof raw?.completedAt === 'string' && raw.completedAt.trim() ? { completedAt: raw.completedAt.trim() } : {}),
    ...(typeof raw?.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(Array.isArray(raw?.attachments) ? { attachments: raw.attachments } : {}),
    ...(raw?.automation && typeof raw.automation === 'object' ? { automation: raw.automation } : {}),
    ...(raw?.inheritedFromClone === true ? { inheritedFromClone: true } : {}),
    ...(raw?.agentMessageAutoContinue && typeof raw.agentMessageAutoContinue === 'object'
      ? { agentMessageAutoContinue: raw.agentMessageAutoContinue }
      : {}),
    ...(raw?.agentSuggestion && typeof raw.agentSuggestion === 'object' ? { agentSuggestion: raw.agentSuggestion } : {}),
    ...(raw?.dockerSnapshot && typeof raw.dockerSnapshot === 'object' ? { dockerSnapshot: raw.dockerSnapshot } : {}),
  };
}

function sortedTurns(turns: Iterable<StoredTranscriptTurn>): StoredTranscriptTurn[] {
  return [...turns]
    .map((turn, ordinal) => ({ turn: normalizeTurn(turn), ordinal }))
    .sort((a, b) => {
      const delta = parseIsoMs(a.turn.promptAt ?? a.turn.at) - parseIsoMs(b.turn.promptAt ?? b.turn.at);
      if (delta !== 0) return delta;
      const completedDelta = parseIsoMs(a.turn.completedAt) - parseIsoMs(b.turn.completedAt);
      return completedDelta || a.ordinal - b.ordinal;
    })
    .map((item) => item.turn);
}

function turnId(turn: StoredTranscriptTurn): string {
  if (turn.id) return turn.id;
  return `legacy:${crypto.createHash('sha256').update(stableJson(turn)).digest('hex').slice(0, 32)}`;
}

function metadata(chatEntry: any): any {
  const value = chatEntry && typeof chatEntry === 'object' ? { ...chatEntry } : {};
  delete value.turns;
  delete value.pendingPrompts;
  return value;
}

function safeMetadataField(raw: unknown): string | null {
  const field = String(raw ?? '').trim();
  if (!field || field === 'turns' || field === 'pendingPrompts' || field === '__proto__' || field === 'constructor' || field === 'prototype') {
    return null;
  }
  return field;
}

function applyMetadataPatch(currentRaw: unknown, patch?: ChatMetadataPatch): { metadata: Record<string, unknown>; changed: boolean; fields: string[] } {
  const current = currentRaw && typeof currentRaw === 'object' && !Array.isArray(currentRaw)
    ? { ...(currentRaw as Record<string, unknown>) }
    : {};
  const fields = new Set<string>();
  for (const [rawField, value] of Object.entries(patch?.setIfMissing ?? {})) {
    const field = safeMetadataField(rawField);
    if (!field || (typeof current[field] === 'string' ? String(current[field]).trim() : current[field] != null)) continue;
    current[field] = value;
    fields.add(field);
  }
  for (const [rawField, value] of Object.entries(patch?.set ?? {})) {
    const field = safeMetadataField(rawField);
    if (!field || stableJson(current[field]) === stableJson(value)) continue;
    current[field] = value;
    fields.add(field);
  }
  for (const rawField of patch?.unset ?? []) {
    const field = safeMetadataField(rawField);
    if (!field || !Object.prototype.hasOwnProperty.call(current, field)) continue;
    delete current[field];
    fields.add(field);
  }
  return { metadata: current, changed: fields.size > 0, fields: [...fields].sort() };
}

function turnsWithLegacySubmissionTimes(chatEntry: any): StoredTranscriptTurn[] {
  const submittedAtById = new Map<string, string>();
  for (const prompt of Array.isArray(chatEntry?.pendingPrompts) ? chatEntry.pendingPrompts : []) {
    const id = String(prompt?.id ?? '').trim();
    const at = String(prompt?.at ?? '').trim();
    if (id && at) submittedAtById.set(id, at);
  }
  return (Array.isArray(chatEntry?.turns) ? chatEntry.turns : []).map((raw: any) => {
    const turn = normalizeTurn(raw);
    const submittedAt = turn.id ? submittedAtById.get(turn.id) : null;
    return submittedAt ? { ...turn, at: submittedAt, promptAt: submittedAt } : turn;
  });
}

export function transcriptTurnsSourceHash(turnsRaw: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stableJson(Array.isArray(turnsRaw) ? turnsRaw : []))
    .digest('base64url');
}

export function chatEntrySourceHash(chatEntryRaw: unknown): string {
  return crypto.createHash('sha256').update(stableJson(chatEntryRaw)).digest('base64url');
}

function refreshTranscriptMetadata(connection: HubDatabaseConnection, droneId: string, chatName: string): TranscriptImportResult {
  const rows = connection
    .prepare(`SELECT turn_json FROM canonical_chat_turns
              WHERE drone_id = ? AND chat_name = ?
              ORDER BY COALESCE(prompt_at, at), completed_at, ordinal, turn_id`)
    .all(droneId, chatName) as TurnRow[];
  const sourceHash = transcriptTurnsSourceHash(rows.map((row) => normalizeTurn(parseJson(row.turn_json))));
  const current = connection
    .prepare(`SELECT transcript_version, turns_source_hash FROM canonical_chats
              WHERE drone_id = ? AND chat_name = ?`)
    .get(droneId, chatName) as { transcript_version: number; turns_source_hash: string } | undefined;
  if (!current) return { available: true, transcriptVersion: 0, sourceHash };
  const version = current.turns_source_hash === sourceHash
    ? Number(current.transcript_version)
    : Number(current.transcript_version) + 1;
  connection
    .prepare(`UPDATE canonical_chats SET transcript_version = ?, turns_source_hash = ?, updated_at = ?
              WHERE drone_id = ? AND chat_name = ?`)
    .run(version, sourceHash, new Date().toISOString(), droneId, chatName);
  return { available: true, transcriptVersion: version, sourceHash };
}

function appendChatEvent(
  connection: HubDatabaseConnection,
  eventType: string,
  droneId: string,
  chatName: string,
  payload: unknown,
): void {
  appendHubOutboxEvent(connection, {
    topic: 'chat.changes',
    eventType,
    aggregateType: 'chat',
    aggregateId: key(droneId, chatName),
    payload: { droneId, chatName, ...(payload && typeof payload === 'object' ? payload : {}) },
  });
}

export class ChatTranscriptRepository {
  constructor(private readonly database: HubDatabase) {
    database.read((connection) => applyHubDatabaseMigrations(connection, CHAT_STORE_MIGRATIONS, 'chats'));
    initializeHubOutbox(database);
  }

  async backfillDroneChats(opts: { droneId: string; chats: unknown }): Promise<ChatStoreListResult> {
    const chats = opts.chats && typeof opts.chats === 'object' && !Array.isArray(opts.chats)
      ? (opts.chats as Record<string, any>)
      : {};
    return await this.database.writeTransaction('backfill legacy drone chats', (connection) => {
      for (const [chatName, entry] of Object.entries(chats)) this.insertMissingChat(connection, opts.droneId, chatName, entry);
      return this.listChatsWithConnection(connection, opts.droneId);
    });
  }

  async backfillChat(opts: { droneId: string; chatName: string; chatEntry: unknown; sourceHash?: string }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('backfill legacy chat', (connection) => {
      this.insertMissingChat(connection, opts.droneId, opts.chatName, opts.chatEntry, opts.sourceHash);
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      return { available: true, sourceHash: row?.source_hash ?? '' };
    });
  }

  async upsertChat(opts: { droneId: string; chatName: string; chatEntry: unknown }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('upsert canonical chat', (connection) => {
      const now = new Date().toISOString();
      const value = opts.chatEntry && typeof opts.chatEntry === 'object' ? opts.chatEntry : {};
      const sourceHash = chatEntrySourceHash(value);
      const current = this.chatRow(connection, opts.droneId, opts.chatName);
      connection.prepare(`
        INSERT INTO canonical_chats (
          drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
          transcript_version, turns_source_hash
        ) VALUES (?, ?, ?, ?, ?, ?, 0, '')
        ON CONFLICT(drone_id, chat_name) DO UPDATE SET
          updated_at = excluded.updated_at,
          metadata_json = excluded.metadata_json,
          source_hash = excluded.source_hash
      `).run(
        opts.droneId,
        opts.chatName,
        typeof (value as any).createdAt === 'string' ? (value as any).createdAt : null,
        now,
        stableJson(metadata(value)),
        sourceHash,
      );
      connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.chatName);
      this.reconcileTurns(connection, opts.droneId, opts.chatName, turnsWithLegacySubmissionTimes(value), false);
      appendChatEvent(connection, current ? 'chat.updated' : 'chat.created', opts.droneId, opts.chatName, {});
      return { available: true, sourceHash };
    });
  }

  async patchMetadata(opts: { droneId: string; chatName: string; patch: ChatMetadataPatch }): Promise<ChatMetadataPatchResult> {
    return await this.database.writeTransaction('patch canonical chat metadata', (connection) => {
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      if (!row) throw new Error(`unknown chat: ${opts.chatName}`);
      const result = this.patchMetadataWithConnection(connection, opts.droneId, opts.chatName, opts.patch);
      if (result.changed) {
        appendChatEvent(connection, 'chat.metadata.changed', opts.droneId, opts.chatName, { fields: result.fields });
      }
      return { available: true, changed: result.changed, metadata: result.metadata };
    });
  }

  async applyReconciliation(opts: {
    droneId: string;
    chatName: string;
    metadataPatch?: ChatMetadataPatch;
    turns?: StoredTranscriptTurn[];
  }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('apply canonical chat reconciliation', (connection) => {
      if (!this.chatRow(connection, opts.droneId, opts.chatName)) throw new Error(`unknown chat: ${opts.chatName}`);
      const metadataResult = this.patchMetadataWithConnection(connection, opts.droneId, opts.chatName, opts.metadataPatch ?? {});
      const changedTurnIds: string[] = [];
      for (const raw of opts.turns ?? []) {
        const turn = normalizeTurn(raw);
        const id = turnId(turn);
        if (this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, id, turn)) changedTurnIds.push(id);
      }
      const refreshed = changedTurnIds.length > 0
        ? refreshTranscriptMetadata(connection, opts.droneId, opts.chatName)
        : this.transcriptMetadata(connection, opts.droneId, opts.chatName);
      if (metadataResult.changed || changedTurnIds.length > 0) {
        appendChatEvent(connection, 'chat.reconciled', opts.droneId, opts.chatName, {
          metadataFields: metadataResult.fields,
          turnIds: changedTurnIds,
        });
      }
      return { available: true, sourceHash: refreshed.sourceHash };
    });
  }

  async renameChat(opts: { droneId: string; chatName: string; newChatName: string }): Promise<boolean> {
    return await this.database.writeTransaction('rename canonical chat', (connection) => {
      if (this.chatRow(connection, opts.droneId, opts.newChatName)) throw new Error(`chat already exists: ${opts.newChatName}`);
      const info = connection
        .prepare(`UPDATE canonical_chats SET chat_name = ?, updated_at = ? WHERE drone_id = ? AND chat_name = ?`)
        .run(opts.newChatName, new Date().toISOString(), opts.droneId, opts.chatName);
      if (Number(info.changes) === 1) {
        connection.prepare(`INSERT OR REPLACE INTO canonical_chat_tombstones (
          drone_id, chat_name, reason, replacement_chat_name, deleted_at
        ) VALUES (?, ?, 'renamed', ?, ?)`).run(
          opts.droneId,
          opts.chatName,
          opts.newChatName,
          new Date().toISOString(),
        );
        connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
          .run(opts.droneId, opts.newChatName);
        appendChatEvent(connection, 'chat.renamed', opts.droneId, opts.newChatName, { previousChatName: opts.chatName });
        return true;
      }
      return false;
    });
  }

  async deleteChat(opts: { droneId: string; chatName: string }): Promise<boolean> {
    return await this.database.writeTransaction('delete canonical chat', (connection) => {
      const info = connection
        .prepare('DELETE FROM canonical_chats WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.chatName);
      connection.prepare(`INSERT OR REPLACE INTO canonical_chat_tombstones (
        drone_id, chat_name, reason, replacement_chat_name, deleted_at
      ) VALUES (?, ?, 'deleted', NULL, ?)`).run(opts.droneId, opts.chatName, new Date().toISOString());
      if (Number(info.changes) === 1) {
        appendChatEvent(connection, 'chat.deleted', opts.droneId, opts.chatName, {});
      }
      return Number(info.changes) === 1;
    });
  }

  async importTurns(opts: { droneId: string; chatName: string; turns: unknown }): Promise<TranscriptImportResult> {
    return await this.database.writeTransaction('backfill legacy transcript turns', (connection) => {
      if (!this.ensureChat(connection, opts.droneId, opts.chatName, false)) {
        return { available: true, transcriptVersion: 0, sourceHash: transcriptTurnsSourceHash([]) };
      }
      const importedTurnCount = this.reconcileTurns(connection, opts.droneId, opts.chatName, opts.turns, true, false);
      const refreshed = refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
      if (importedTurnCount > 0) {
        appendChatEvent(connection, 'chat.turns.imported', opts.droneId, opts.chatName, {
          source: 'legacy-import',
          importedTurnCount,
        });
      }
      return refreshed;
    });
  }

  async upsertTurn(opts: { droneId: string; chatName: string; turn: StoredTranscriptTurn }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('upsert canonical transcript turn', (connection) => {
      if (!this.ensureChat(connection, opts.droneId, opts.chatName, false)) {
        throw new Error(`cannot write turn for deleted chat: ${opts.chatName}`);
      }
      const turn = normalizeTurn(opts.turn);
      const id = turnId(turn);
      const changed = this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, id, turn);
      const refreshed = refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
      if (changed) appendChatEvent(connection, 'chat.turn.changed', opts.droneId, opts.chatName, { turnId: id });
      return { available: true, sourceHash: refreshed.sourceHash };
    });
  }

  async updateTurn(opts: {
    droneId: string;
    chatName: string;
    turnId: string;
    update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
  }): Promise<TranscriptTurnUpdateResult> {
    return await this.database.writeTransaction('update canonical transcript turn', (connection) => {
      const row = connection.prepare(`SELECT turn_json FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ? AND turn_id = ?`).get(opts.droneId, opts.chatName, opts.turnId) as TurnRow | undefined;
      if (!row) return { available: true, changed: false, turn: null };
      const current = normalizeTurn(parseJson(row.turn_json));
      const next = normalizeTurn(opts.update(current));
      if (turnId(next) !== opts.turnId) throw new Error('targeted transcript update cannot change turn id');
      if (stableJson(current) === stableJson(next)) return { available: true, changed: false, turn: current };
      this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, opts.turnId, next);
      refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
      appendChatEvent(connection, 'chat.turn.changed', opts.droneId, opts.chatName, { turnId: opts.turnId, source: 'targeted-update' });
      return { available: true, changed: true, turn: next };
    });
  }

  async rollbackToTurn(opts: {
    droneId: string;
    chatName: string;
    turnId: string;
    update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
  }): Promise<TranscriptRollbackResult> {
    return await this.database.writeTransaction('rollback canonical transcript turns', (connection) => {
      const rows = connection.prepare(`SELECT turn_id, turn_json FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ?
        ORDER BY COALESCE(prompt_at, at), completed_at, ordinal, turn_id`).all(opts.droneId, opts.chatName) as Array<TurnRow & { turn_id: string }>;
      const index = rows.findIndex((row) => row.turn_id === opts.turnId);
      if (index < 0) return { available: true, changed: false, removedTurns: [], turn: null };
      const current = normalizeTurn(parseJson(rows[index].turn_json));
      const next = normalizeTurn(opts.update(current));
      if (turnId(next) !== opts.turnId) throw new Error('transcript rollback cannot change turn id');
      const removedRows = rows.slice(index + 1);
      const remove = connection.prepare(`DELETE FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ? AND turn_id = ?`);
      for (const row of removedRows) remove.run(opts.droneId, opts.chatName, row.turn_id);
      const targetChanged = stableJson(current) !== stableJson(next);
      if (targetChanged) this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, opts.turnId, next);
      const changed = targetChanged || removedRows.length > 0;
      if (changed) {
        refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
        appendChatEvent(connection, 'chat.turns.rolled-back', opts.droneId, opts.chatName, {
          turnId: opts.turnId,
          removedTurnIds: removedRows.map((row) => row.turn_id),
        });
      }
      return {
        available: true,
        changed,
        removedTurns: removedRows.map((row) => normalizeTurn(parseJson(row.turn_json))),
        turn: next,
      };
    });
  }

  listChats(opts: { droneId: string }): ChatStoreListResult {
    return this.database.read((connection) => this.listChatsWithConnection(connection, opts.droneId));
  }

  readChat(opts: { droneId: string; chatName: string }): ChatStoreReadResult {
    return this.database.read((connection) => {
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      if (!row) return { available: true, chat: null, sourceHash: '' };
      const base = parseJson(row.metadata_json);
      return {
        available: true,
        chat: {
          ...(base && typeof base === 'object' ? base : {}),
          turns: this.projectTurns(connection, opts.droneId, opts.chatName),
          pendingPrompts: getPromptQueueRepository()?.list({ droneId: opts.droneId, chatName: opts.chatName, limit: 60 }) ?? [],
        },
        sourceHash: row.source_hash,
      };
    });
  }

  read(opts: { droneId: string; chatName: string; indexes: number[] }): TranscriptStoreReadResult {
    return this.database.read((connection) => {
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      const turns = this.projectTurns(connection, opts.droneId, opts.chatName);
      return {
        available: true,
        count: turns.length,
        transcriptVersion: Number(row?.transcript_version ?? 0),
        sourceHash: row?.turns_source_hash || transcriptTurnsSourceHash(turns),
        turns: opts.indexes
          .map((index) => turns[index] ? { index, turn: turns[index] } : null)
          .filter((item): item is { index: number; turn: StoredTranscriptTurn } => Boolean(item)),
      };
    });
  }

  async clearAllForTests(): Promise<void> {
    await this.database.writeTransaction('clear canonical chats for tests', (connection) => {
      connection.exec('DELETE FROM canonical_chat_turns; DELETE FROM canonical_chats; DELETE FROM canonical_chat_tombstones;');
    });
  }

  private insertMissingChat(connection: HubDatabaseConnection, droneId: string, chatName: string, raw: unknown, sourceHash?: string): void {
    const tombstone = connection.prepare(`SELECT 1 FROM canonical_chat_tombstones
      WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName);
    if (tombstone) return;
    const value = raw && typeof raw === 'object' ? raw : {};
    const now = new Date().toISOString();
    const info = connection.prepare(`
      INSERT OR IGNORE INTO canonical_chats (
        drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
        transcript_version, turns_source_hash
      ) VALUES (?, ?, ?, ?, ?, ?, 0, '')
    `).run(
      droneId,
      chatName,
      typeof (value as any).createdAt === 'string' ? (value as any).createdAt : null,
      now,
      stableJson(metadata(value)),
      sourceHash ?? chatEntrySourceHash(value),
    );
    const importedTurnCount = this.reconcileTurns(
      connection,
      droneId,
      chatName,
      turnsWithLegacySubmissionTimes(value),
      true,
      false,
    );
    if (Number(info.changes) === 1) {
      appendChatEvent(connection, 'chat.imported', droneId, chatName, { source: 'legacy-import', importedTurnCount });
    } else if (importedTurnCount > 0) {
      appendChatEvent(connection, 'chat.turns.imported', droneId, chatName, { source: 'legacy-import', importedTurnCount });
    }
  }

  private reconcileTurns(
    connection: HubDatabaseConnection,
    droneId: string,
    chatName: string,
    raw: unknown,
    missingOnly: boolean,
    emitEvents = true,
  ): number {
    const turns = sortedTurns(Array.isArray(raw) ? raw.map(normalizeTurn) : []);
    let changed = 0;
    const insert = connection.prepare(`
      INSERT OR IGNORE INTO canonical_chat_turns (
        drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsert = connection.prepare(`
      INSERT INTO canonical_chat_turns (
        drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name, turn_id) DO UPDATE SET
        at = excluded.at, prompt_at = excluded.prompt_at,
        completed_at = excluded.completed_at, turn_json = excluded.turn_json
    `);
    for (const [ordinal, turn] of turns.entries()) {
      const id = turnId(turn);
      const info = (missingOnly ? insert : upsert).run(
        droneId, chatName, id, ordinal, turn.at, turn.promptAt ?? null,
        turn.completedAt ?? null, stableJson(turn),
      );
      changed += Number(info.changes);
      if (emitEvents && Number(info.changes) > 0) {
        appendChatEvent(connection, 'chat.turn.changed', droneId, chatName, {
          turnId: id,
          source: missingOnly ? 'legacy-import' : 'reconcile',
        });
      }
    }
    refreshTranscriptMetadata(connection, droneId, chatName);
    return changed;
  }

  private ensureChat(connection: HubDatabaseConnection, droneId: string, chatName: string, clearTombstone: boolean): boolean {
    if (this.chatRow(connection, droneId, chatName)) return true;
    const tombstone = connection.prepare(`SELECT 1 FROM canonical_chat_tombstones
      WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName);
    if (tombstone && !clearTombstone) return false;
    if (clearTombstone) {
      connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
        .run(droneId, chatName);
    }
    const now = new Date().toISOString();
    connection.prepare(`INSERT INTO canonical_chats (
      drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
      transcript_version, turns_source_hash
    ) VALUES (?, ?, ?, ?, '{}', '', 0, '')`).run(droneId, chatName, now, now);
    appendChatEvent(connection, 'chat.created', droneId, chatName, { source: 'turn-reconciliation' });
    return true;
  }

  private patchMetadataWithConnection(
    connection: HubDatabaseConnection,
    droneId: string,
    chatName: string,
    patch: ChatMetadataPatch,
  ): { metadata: Record<string, unknown>; changed: boolean; fields: string[] } {
    const row = this.chatRow(connection, droneId, chatName);
    if (!row) throw new Error(`unknown chat: ${chatName}`);
    const result = applyMetadataPatch(parseJson(row.metadata_json), patch);
    if (result.changed) {
      connection.prepare(`UPDATE canonical_chats
        SET metadata_json = ?, source_hash = ?, updated_at = ?
        WHERE drone_id = ? AND chat_name = ?`).run(
        stableJson(result.metadata),
        chatEntrySourceHash(result.metadata),
        new Date().toISOString(),
        droneId,
        chatName,
      );
    }
    return result;
  }

  private upsertTurnWithConnection(
    connection: HubDatabaseConnection,
    droneId: string,
    chatName: string,
    id: string,
    turn: StoredTranscriptTurn,
  ): boolean {
    const current = connection.prepare(`SELECT turn_json FROM canonical_chat_turns
      WHERE drone_id = ? AND chat_name = ? AND turn_id = ?`).get(droneId, chatName, id) as TurnRow | undefined;
    if (current && stableJson(normalizeTurn(parseJson(current.turn_json))) === stableJson(turn)) return false;
    const ordinal = this.nextOrdinal(connection, droneId, chatName);
    connection.prepare(`
      INSERT INTO canonical_chat_turns (
        drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name, turn_id) DO UPDATE SET
        at = excluded.at, prompt_at = excluded.prompt_at,
        completed_at = excluded.completed_at, turn_json = excluded.turn_json
    `).run(droneId, chatName, id, ordinal, turn.at, turn.promptAt ?? null, turn.completedAt ?? null, stableJson(turn));
    return true;
  }

  private transcriptMetadata(connection: HubDatabaseConnection, droneId: string, chatName: string): TranscriptImportResult {
    const row = this.chatRow(connection, droneId, chatName);
    return {
      available: true,
      transcriptVersion: Number(row?.transcript_version ?? 0),
      sourceHash: row?.turns_source_hash || transcriptTurnsSourceHash([]),
    };
  }

  private nextOrdinal(connection: HubDatabaseConnection, droneId: string, chatName: string): number {
    const row = connection.prepare(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
      FROM canonical_chat_turns WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName) as { ordinal: number };
    return Number(row.ordinal);
  }

  private chatRow(connection: HubDatabaseConnection, droneId: string, chatName: string): ChatRow | null {
    return (connection.prepare(`SELECT chat_name, metadata_json, source_hash,
      transcript_version, turns_source_hash FROM canonical_chats
      WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName) as ChatRow | undefined) ?? null;
  }

  private listChatsWithConnection(connection: HubDatabaseConnection, droneId: string): ChatStoreListResult {
    const rows = connection.prepare('SELECT chat_name FROM canonical_chats WHERE drone_id = ? ORDER BY chat_name').all(droneId) as Array<{ chat_name: string }>;
    return { available: true, chats: rows.map((row) => row.chat_name) };
  }

  private projectTurns(connection: HubDatabaseConnection, droneId: string, chatName: string): StoredTranscriptTurn[] {
    const rows = connection.prepare(`SELECT turn_json FROM canonical_chat_turns
      WHERE drone_id = ? AND chat_name = ?
      ORDER BY COALESCE(prompt_at, at), completed_at, ordinal, turn_id`).all(droneId, chatName) as TurnRow[];
    return rows.map((row) => normalizeTurn(parseJson(row.turn_json)));
  }
}

function repository(): ChatTranscriptRepository | null {
  let database = getHubDatabase();
  if (!database) {
    unavailableReason = 'Hub database is unavailable';
    if ((globalThis as any).Bun) return null;
    database = requireHubDatabase();
  }
  if (cachedRepository?.database === database) return cachedRepository.repository;
  const value = new ChatTranscriptRepository(database);
  cachedRepository = { database, repository: value };
  unavailableReason = null;
  return value;
}

function memoryTurnMap(droneId: string, chatName: string): Map<string, StoredTranscriptTurn> {
  const k = key(droneId, chatName);
  let value = memoryTurns.get(k);
  if (!value) memoryTurns.set(k, (value = new Map()));
  return value;
}

function memoryPromptMap(droneId: string, chatName: string): Map<string, StoredPendingPrompt> {
  const k = key(droneId, chatName);
  let value = memoryPrompts.get(k);
  if (!value) memoryPrompts.set(k, (value = new Map()));
  return value;
}

function memoryReadChat(droneId: string, chatName: string): ChatStoreReadResult {
  const row = memoryChats.get(key(droneId, chatName));
  if (!row) return { available: true, chat: null, sourceHash: '' };
  return { available: true, chat: { ...row.metadata, turns: sortedTurns(memoryTurnMap(droneId, chatName).values()), pendingPrompts: [...memoryPromptMap(droneId, chatName).values()] }, sourceHash: row.sourceHash };
}

async function memoryBackfillChat(droneId: string, chatName: string, raw: unknown): Promise<ChatStoreImportResult> {
  const k = key(droneId, chatName);
  const value = raw && typeof raw === 'object' ? raw : {};
  if (!memoryChats.has(k)) {
    memoryChats.set(k, { metadata: metadata(value), sourceHash: chatEntrySourceHash(value), version: 0 });
  }
  const turns = memoryTurnMap(droneId, chatName);
  for (const turn of sortedTurns(turnsWithLegacySubmissionTimes(value))) {
    const id = turnId(turn);
    if (!turns.has(id)) turns.set(id, turn);
  }
  const prompts = memoryPromptMap(droneId, chatName);
  for (const prompt of Array.isArray((value as any).pendingPrompts) ? (value as any).pendingPrompts : []) {
    const id = String(prompt?.id ?? '').trim();
    const cancelledKey = `${k}\u0000${id}`;
    if (id && !memoryCancelledPrompts.has(cancelledKey) && !prompts.has(id)) prompts.set(id, prompt);
  }
  return { available: true, sourceHash: memoryChats.get(k)?.sourceHash ?? '' };
}

export function getTranscriptStoreUnavailableReason(): string | null { return unavailableReason; }
export function getTranscriptStore(): ChatTranscriptRepository | null { return repository(); }

export async function importDroneChatsFromRegistry(opts: { droneId: string; chats: unknown }): Promise<ChatStoreListResult> {
  const store = repository();
  if (store) return await store.backfillDroneChats(opts);
  const chats = opts.chats && typeof opts.chats === 'object' && !Array.isArray(opts.chats) ? opts.chats as Record<string, unknown> : {};
  for (const [chatName, chatEntry] of Object.entries(chats)) await memoryBackfillChat(opts.droneId, chatName, chatEntry);
  return listChatsFromStore({ droneId: opts.droneId });
}

export async function importChatFromRegistry(opts: { droneId: string; chatName: string; chatEntry: unknown; sourceHash?: string }): Promise<ChatStoreImportResult> {
  const store = repository();
  return store ? await store.backfillChat(opts) : await memoryBackfillChat(opts.droneId, opts.chatName, opts.chatEntry);
}

export async function upsertChatInStore(opts: { droneId: string; chatName: string; chatEntry: unknown }): Promise<ChatStoreImportResult> {
  const store = repository();
  if (store) return await store.upsertChat(opts);
  const value = opts.chatEntry && typeof opts.chatEntry === 'object' ? opts.chatEntry : {};
  memoryChats.set(key(opts.droneId, opts.chatName), { metadata: metadata(value), sourceHash: chatEntrySourceHash(value), version: 0 });
  return { available: true, sourceHash: chatEntrySourceHash(value) };
}

export async function patchChatMetadataInStore(opts: {
  droneId: string;
  chatName: string;
  patch: ChatMetadataPatch;
}): Promise<ChatMetadataPatchResult> {
  const store = repository();
  if (store) return await store.patchMetadata(opts);
  const row = memoryChats.get(key(opts.droneId, opts.chatName));
  if (!row) throw new Error(`unknown chat: ${opts.chatName}`);
  const result = applyMetadataPatch(row.metadata, opts.patch);
  if (result.changed) {
    row.metadata = result.metadata;
    row.sourceHash = chatEntrySourceHash(result.metadata);
  }
  return { available: true, changed: result.changed, metadata: result.metadata };
}

export async function applyChatReconciliationInStore(opts: {
  droneId: string;
  chatName: string;
  metadataPatch?: ChatMetadataPatch;
  turns?: StoredTranscriptTurn[];
}): Promise<ChatStoreImportResult> {
  const store = repository();
  if (store) return await store.applyReconciliation(opts);
  const row = memoryChats.get(key(opts.droneId, opts.chatName));
  if (!row) throw new Error(`unknown chat: ${opts.chatName}`);
  const metadataResult = applyMetadataPatch(row.metadata, opts.metadataPatch);
  if (metadataResult.changed) {
    row.metadata = metadataResult.metadata;
    row.sourceHash = chatEntrySourceHash(metadataResult.metadata);
  }
  const turns = memoryTurnMap(opts.droneId, opts.chatName);
  for (const raw of opts.turns ?? []) {
    const turn = normalizeTurn(raw);
    turns.set(turnId(turn), turn);
  }
  return { available: true, sourceHash: transcriptTurnsSourceHash(sortedTurns(turns.values())) };
}

export async function renameChatInStore(opts: { droneId: string; chatName: string; newChatName: string }): Promise<boolean> {
  const store = repository();
  if (store) return await store.renameChat(opts);
  const oldKey = key(opts.droneId, opts.chatName);
  const nextKey = key(opts.droneId, opts.newChatName);
  const row = memoryChats.get(oldKey);
  if (!row) return false;
  memoryChats.set(nextKey, row); memoryChats.delete(oldKey);
  const turns = memoryTurns.get(oldKey); if (turns) { memoryTurns.set(nextKey, turns); memoryTurns.delete(oldKey); }
  return true;
}

export async function deleteChatFromStore(opts: { droneId: string; chatName: string }): Promise<boolean> {
  const store = repository();
  if (store) return await store.deleteChat(opts);
  memoryTurns.delete(key(opts.droneId, opts.chatName));
  memoryPrompts.delete(key(opts.droneId, opts.chatName));
  return memoryChats.delete(key(opts.droneId, opts.chatName));
}

export function listChatsFromStore(opts: { droneId: string }): ChatStoreListResult {
  const store = repository();
  if (store) return store.listChats(opts);
  const prefix = `${opts.droneId}\u0000`;
  return { available: true, chats: [...memoryChats.keys()].filter((item) => item.startsWith(prefix)).map((item) => item.slice(prefix.length)).sort() };
}

export function readChatFromStore(opts: { droneId: string; chatName: string }): ChatStoreReadResult {
  const store = repository();
  return store ? store.readChat(opts) : memoryReadChat(opts.droneId, opts.chatName);
}

export async function importTranscriptTurnsFromRegistry(opts: { droneId: string; chatName: string; turns: unknown; sourceHash?: string }): Promise<TranscriptImportResult> {
  const store = repository();
  if (store) return await store.importTurns(opts);
  await memoryBackfillChat(opts.droneId, opts.chatName, {});
  for (const turn of sortedTurns(Array.isArray(opts.turns) ? opts.turns : [])) if (!memoryTurnMap(opts.droneId, opts.chatName).has(turnId(turn))) memoryTurnMap(opts.droneId, opts.chatName).set(turnId(turn), turn);
  const turns = sortedTurns(memoryTurnMap(opts.droneId, opts.chatName).values());
  return { available: true, transcriptVersion: turns.length, sourceHash: transcriptTurnsSourceHash(turns) };
}

export function readTranscriptTurnsFromStore(opts: { droneId: string; chatName: string; indexes: number[] }): TranscriptStoreReadResult {
  const store = repository();
  if (store) return store.read(opts);
  const turns = sortedTurns(memoryTurnMap(opts.droneId, opts.chatName).values());
  return { available: true, count: turns.length, transcriptVersion: turns.length, sourceHash: transcriptTurnsSourceHash(turns), turns: opts.indexes.map((index) => turns[index] ? { index, turn: turns[index] } : null).filter((item): item is { index: number; turn: StoredTranscriptTurn } => Boolean(item)) };
}

export function countTranscriptTurnsFromStore(opts: { droneId: string; chatName: string }): { available: boolean; count: number; transcriptVersion: number; sourceHash: string } {
  const read = readTranscriptTurnsFromStore({ ...opts, indexes: [] });
  return { available: true, count: read.count, transcriptVersion: read.transcriptVersion, sourceHash: read.sourceHash };
}

export async function upsertTranscriptTurnInStore(opts: { droneId: string; chatName: string; turn: StoredTranscriptTurn }): Promise<ChatStoreImportResult> {
  const store = repository();
  if (store) return await store.upsertTurn(opts);
  await memoryBackfillChat(opts.droneId, opts.chatName, {});
  const turn = normalizeTurn(opts.turn); memoryTurnMap(opts.droneId, opts.chatName).set(turnId(turn), turn);
  return { available: true, sourceHash: transcriptTurnsSourceHash(sortedTurns(memoryTurnMap(opts.droneId, opts.chatName).values())) };
}

export async function updateTranscriptTurnInStore(opts: {
  droneId: string;
  chatName: string;
  turnId: string;
  update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
}): Promise<TranscriptTurnUpdateResult> {
  const store = repository();
  if (store) return await store.updateTurn(opts);
  const turns = memoryTurnMap(opts.droneId, opts.chatName);
  const current = turns.get(opts.turnId);
  if (!current) return { available: true, changed: false, turn: null };
  const next = normalizeTurn(opts.update(current));
  if (turnId(next) !== opts.turnId) throw new Error('targeted transcript update cannot change turn id');
  const changed = stableJson(current) !== stableJson(next);
  if (changed) turns.set(opts.turnId, next);
  return { available: true, changed, turn: next };
}

export async function rollbackTranscriptToTurnInStore(opts: {
  droneId: string;
  chatName: string;
  turnId: string;
  update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
}): Promise<TranscriptRollbackResult> {
  const store = repository();
  if (store) return await store.rollbackToTurn(opts);
  const turns = memoryTurnMap(opts.droneId, opts.chatName);
  const ordered = sortedTurns(turns.values());
  const index = ordered.findIndex((turn) => turnId(turn) === opts.turnId);
  if (index < 0) return { available: true, changed: false, removedTurns: [], turn: null };
  const current = ordered[index];
  const next = normalizeTurn(opts.update(current));
  if (turnId(next) !== opts.turnId) throw new Error('transcript rollback cannot change turn id');
  const removedTurns = ordered.slice(index + 1);
  for (const removed of removedTurns) turns.delete(turnId(removed));
  const targetChanged = stableJson(current) !== stableJson(next);
  if (targetChanged) turns.set(opts.turnId, next);
  return { available: true, changed: targetChanged || removedTurns.length > 0, removedTurns, turn: next };
}

// Prompt compatibility exists only for Bun tests. Production callers use PromptQueueRepository.
export function upsertPendingPromptInStore(opts: { droneId: string; chatName: string; pending: StoredPendingPrompt }): ChatStoreImportResult {
  if (!(globalThis as any).Bun) throw new Error('pending prompts are owned by PromptQueueRepository');
  memoryCancelledPrompts.delete(`${key(opts.droneId, opts.chatName)}\u0000${opts.pending.id}`);
  memoryPromptMap(opts.droneId, opts.chatName).set(opts.pending.id, opts.pending);
  return { available: true, sourceHash: '' };
}
export function updatePendingPromptInStore(opts: { droneId: string; chatName: string; id: string; patch: Partial<StoredPendingPrompt> }): { available: boolean; updated: boolean } {
  if (!(globalThis as any).Bun) throw new Error('pending prompts are owned by PromptQueueRepository');
  const map = memoryPromptMap(opts.droneId, opts.chatName); const current = map.get(opts.id);
  if (!current) return { available: true, updated: false };
  map.set(opts.id, { ...current, ...opts.patch, updatedAt: opts.patch.updatedAt ?? new Date().toISOString() });
  return { available: true, updated: true };
}
export function claimQueuedPendingPromptInStore(opts: { droneId: string; chatName: string; id: string }): { available: boolean; claimed: boolean; state: string | null } {
  const map = memoryPromptMap(opts.droneId, opts.chatName); const current = map.get(opts.id);
  if (!current) return { available: true, claimed: false, state: null };
  if (current.state !== 'queued') return { available: true, claimed: false, state: current.state };
  map.set(opts.id, { ...current, state: 'sending', updatedAt: new Date().toISOString() });
  return { available: true, claimed: true, state: 'sending' };
}
export function cancelQueuedPendingPromptInStore(opts: { droneId: string; chatName: string; id: string }): { available: boolean; cancelled: boolean; state: string | null } {
  const map = memoryPromptMap(opts.droneId, opts.chatName); const current = map.get(opts.id);
  if (!current) return { available: true, cancelled: false, state: null };
  if (current.state !== 'queued') return { available: true, cancelled: false, state: current.state };
  map.delete(opts.id);
  memoryCancelledPrompts.add(`${key(opts.droneId, opts.chatName)}\u0000${opts.id}`);
  return { available: true, cancelled: true, state: 'queued' };
}

export async function resetTranscriptStoreForTests(): Promise<void> {
  const store = repository();
  if (store) await store.clearAllForTests();
  memoryChats.clear(); memoryTurns.clear(); memoryPrompts.clear(); memoryCancelledPrompts.clear();
}
