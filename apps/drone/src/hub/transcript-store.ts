import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { hubSqlitePath } from '../host/sqlite-registry-store';

type DatabaseConstructor = typeof import('better-sqlite3');
type DatabaseInstance = import('better-sqlite3').Database;

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

type TranscriptStoreRow = {
  ordinal: number;
  turn_json: string;
};

type TranscriptMetaRow = {
  transcript_version: number;
  source_hash: string;
};

type ChatStoreRow = {
  chat_name: string;
  chat_json: string;
  source_hash: string;
};

export type TranscriptImportResult = {
  available: boolean;
  transcriptVersion: number;
  sourceHash: string;
};

export type TranscriptStoreReadResult = {
  available: boolean;
  count: number;
  transcriptVersion: number;
  sourceHash: string;
  turns: Array<{ index: number; turn: StoredTranscriptTurn }>;
};

export type ChatStoreImportResult = {
  available: boolean;
  sourceHash: string;
};

export type ChatStoreReadResult = {
  available: boolean;
  chat: any | null;
  sourceHash: string;
};

export type ChatStoreListResult = {
  available: boolean;
  chats: string[];
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
  observability?: {
    state: 'status-unavailable';
    message: string;
    lastCheckedAt: string;
    lastError?: string;
  };
  blipClones?: {
    status: 'running';
    count: number;
    tasks: string[];
  };
  updatedAt?: string;
};

let cached:
  | {
      dbPath: string;
      db: DatabaseInstance;
      store: TranscriptStore;
    }
  | null = null;

let unavailableReason: string | null = null;
const requireForTranscriptStore = createRequire(__filename);

type MemoryChatRow = {
  chatName: string;
  chatEntry: any;
  sourceHash: string;
};

const memoryChats = new Map<string, MemoryChatRow>();
const memoryPrompts = new Map<string, Map<string, StoredPendingPrompt>>();
const memoryTurns = new Map<string, Map<string, StoredTranscriptTurn>>();
const memoryCancelledPrompts = new Set<string>();

function chatStoreKey(droneId: string, chatName: string): string {
  return `${droneId}\u0000${chatName}`;
}

function memoryPromptKey(droneId: string, chatName: string, promptId: string): string {
  return `${chatStoreKey(droneId, chatName)}\u0000${promptId}`;
}

function memoryPromptMap(droneId: string, chatName: string): Map<string, StoredPendingPrompt> {
  const key = chatStoreKey(droneId, chatName);
  let map = memoryPrompts.get(key);
  if (!map) {
    map = new Map<string, StoredPendingPrompt>();
    memoryPrompts.set(key, map);
  }
  return map;
}

function memoryTurnMap(droneId: string, chatName: string): Map<string, StoredTranscriptTurn> {
  const key = chatStoreKey(droneId, chatName);
  let map = memoryTurns.get(key);
  if (!map) {
    map = new Map<string, StoredTranscriptTurn>();
    memoryTurns.set(key, map);
  }
  return map;
}

function loadDatabaseConstructor(): DatabaseConstructor | null {
  try {
    // Keep this dynamic so Bun-based tests can import the server even when the
    // native Node binding was compiled for Node's ABI.
    return requireForTranscriptStore('better-sqlite3') as DatabaseConstructor;
  } catch (error: any) {
    unavailableReason = error?.message ?? String(error);
    return null;
  }
}

function transcriptStorePath(): string {
  return hubSqlitePath();
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined) return null;
  return stableJson(value);
}

export function transcriptTurnsSourceHash(turnsRaw: unknown): string {
  const turns = Array.isArray(turnsRaw) ? turnsRaw : [];
  return crypto.createHash('sha256').update(stableJson(turns), 'utf8').digest('base64url');
}

export function chatEntrySourceHash(chatEntryRaw: unknown): string {
  return crypto.createHash('sha256').update(stableJson(chatEntryRaw), 'utf8').digest('base64url');
}

function jsonParseObject(raw: string): StoredTranscriptTurn {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredTranscriptTurn) : ({ at: '', prompt: '', ok: false, output: '' });
  } catch {
    return { at: '', prompt: '', ok: false, output: '' };
  }
}

function jsonParseAny(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function jsonParseNullable(raw: string | null | undefined): any {
  if (typeof raw !== 'string') return undefined;
  return jsonParseAny(raw);
}

function parseIsoMs(raw: unknown): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return 0;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeTurn(raw: any): StoredTranscriptTurn {
  const at = String(raw?.at ?? new Date().toISOString());
  const id = typeof raw?.id === 'string' && raw.id.trim() ? String(raw.id).trim() : undefined;
  const promptAt = typeof raw?.promptAt === 'string' && raw.promptAt.trim() ? String(raw.promptAt).trim() : undefined;
  const completedAt = typeof raw?.completedAt === 'string' && raw.completedAt.trim() ? String(raw.completedAt).trim() : undefined;
  const model = typeof raw?.model === 'string' && raw.model.trim() ? String(raw.model).trim() : undefined;
  const error = raw?.ok ? undefined : String(raw?.error ?? 'failed');
  return {
    at,
    ...(id ? { id } : {}),
    prompt: String(raw?.prompt ?? ''),
    ok: Boolean(raw?.ok),
    output: raw?.ok ? String(raw?.output ?? '') : '',
    ...(error ? { error } : {}),
    ...(promptAt ? { promptAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(model ? { model } : {}),
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

function sortTranscriptTurns(turnsRaw: unknown): StoredTranscriptTurn[] {
  const rawList = Array.isArray(turnsRaw) ? turnsRaw : [];
  return rawList
    .map((t, idx) => ({ t: normalizeTurn(t), idx }))
    .sort((a, b) => {
      const aa = parseIsoMs((a.t as any).promptAt ?? (a.t as any).at);
      const bb = parseIsoMs((b.t as any).promptAt ?? (b.t as any).at);
      if (aa !== bb) return aa - bb;
      return a.idx - b.idx;
    })
    .map((item) => item.t);
}

function metadataHashForTurn(turn: StoredTranscriptTurn, ordinal: number): string {
  return crypto
    .createHash('sha256')
    .update(`${ordinal}\n${turn.id ?? ''}\n${turn.at}\n${turn.promptAt ?? ''}\n${turn.completedAt ?? ''}\n${turn.prompt}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function turnKey(turn: StoredTranscriptTurn, ordinal: number): string {
  return turn.id ? `id:${turn.id}` : `ordinal:${ordinal}:${metadataHashForTurn(turn, ordinal)}`;
}

function normalizePendingPrompt(raw: any): StoredPendingPrompt | null {
  const id = typeof raw?.id === 'string' && raw.id.trim() ? String(raw.id).trim() : '';
  const prompt = String(raw?.prompt ?? '');
  if (!id || !prompt.trim()) return null;
  const at = typeof raw?.at === 'string' && raw.at.trim() ? String(raw.at).trim() : new Date().toISOString();
  const updatedAt = typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? String(raw.updatedAt).trim() : at;
  const stateRaw = String(raw?.state ?? '').trim();
  const state = stateRaw === 'queued' || stateRaw === 'sending' || stateRaw === 'sent' || stateRaw === 'failed' ? stateRaw : 'sending';
  const blipClones = normalizeStoredBlipClones(raw?.blipClones);
  const observability = normalizeStoredObservability(raw?.observability);
  return {
    id,
    at,
    prompt,
    ...(typeof raw?.model === 'string' && raw.model.trim() ? { model: String(raw.model).trim() } : {}),
    ...(typeof raw?.messageId === 'string' && raw.messageId.trim() ? { messageId: String(raw.messageId).trim() } : {}),
    ...(typeof raw?.cwd === 'string' ? { cwd: String(raw.cwd) } : raw?.cwd === null ? { cwd: null } : {}),
    ...(Array.isArray(raw?.attachments) ? { attachments: raw.attachments } : {}),
    ...(raw?.automation && typeof raw.automation === 'object' ? { automation: raw.automation } : {}),
    ...(raw?.blockedByAutomation === true ? { blockedByAutomation: true } : {}),
    state,
    ...(typeof raw?.error === 'string' ? { error: raw.error } : {}),
    ...(observability ? { observability } : {}),
    ...(blipClones ? { blipClones } : {}),
    updatedAt,
  };
}

function normalizeStoredObservability(raw: any): StoredPendingPrompt['observability'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (String(raw.state ?? '').trim() !== 'status-unavailable') return undefined;
  const lastCheckedAt = String(raw.lastCheckedAt ?? '').trim();
  const message = String(raw.message ?? '').trim() || 'Prompt status is temporarily unavailable.';
  return {
    state: 'status-unavailable',
    message,
    lastCheckedAt: lastCheckedAt || new Date().toISOString(),
    ...(typeof raw.lastError === 'string' && String(raw.lastError).trim() ? { lastError: String(raw.lastError).trim() } : {}),
  };
}

function normalizeStoredBlipClones(raw: any): StoredPendingPrompt['blipClones'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (String(raw.status ?? '').trim() !== 'running') return undefined;
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map((task: any) => String(task ?? '').trim()).filter(Boolean).slice(0, 8) : [];
  if (tasks.length === 0) return undefined;
  const countRaw = Number(raw.count);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : tasks.length;
  return { status: 'running', count: Math.max(1, count), tasks };
}

function promptFromRow(row: any): StoredPendingPrompt | null {
  if (!row) return null;
  const parsed = jsonParseNullable(row.prompt_json);
  const base = parsed && typeof parsed === 'object' ? parsed : {};
  return normalizePendingPrompt({
    ...base,
    id: row.prompt_id,
    at: row.created_at,
    prompt: row.prompt,
    messageId: row.message_id ?? base.messageId,
    cwd: row.cwd ?? base.cwd,
    attachments: jsonParseNullable(row.attachments_json) ?? base.attachments,
    automation: jsonParseNullable(row.automation_json) ?? base.automation,
    blockedByAutomation: Number(row.blocked_by_automation ?? 0) === 1,
    state: row.state,
    error: row.error ?? base.error,
    observability: base.observability,
    updatedAt: row.updated_at,
  });
}

function normalizeChatEntryForStorage(raw: unknown): any {
  return raw && typeof raw === 'object' ? raw : {};
}

function chatMetadataForStorage(chatEntryRaw: unknown): any {
  const chatEntry = normalizeChatEntryForStorage(chatEntryRaw);
  const out = { ...chatEntry };
  delete out.turns;
  delete out.pendingPrompts;
  return out;
}

function sortPendingPrompts(prompts: StoredPendingPrompt[]): StoredPendingPrompt[] {
  return prompts
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => {
      const aa = parseIsoMs(a.p.at);
      const bb = parseIsoMs(b.p.at);
      if (aa !== bb) return aa - bb;
      return a.idx - b.idx;
    })
    .map((item) => item.p);
}

class TranscriptStore {
  private replaceChatTx: (droneId: string, chatName: string, sourceHash: string, importedAt: string, turns: StoredTranscriptTurn[]) => void;
  private replaceDroneChatsTx: (droneId: string, chatEntries: Array<{ chatName: string; chatEntry: any; sourceHash: string; importedAt: string }>) => void;
  private upsertPromptStmt!: import('better-sqlite3').Statement;
  private updatePromptStmt!: import('better-sqlite3').Statement;
  private claimPromptStmt!: import('better-sqlite3').Statement;
  private deleteQueuedPromptStmt!: import('better-sqlite3').Statement;
  private upsertTurnStmt!: import('better-sqlite3').Statement;

  constructor(private readonly db: DatabaseInstance) {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcript_chats (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        transcript_version INTEGER NOT NULL DEFAULT 0,
        source_hash TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name)
      );

      CREATE TABLE IF NOT EXISTS transcript_turns (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        turn_key TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        at TEXT NOT NULL,
        prompt_at TEXT,
        completed_at TEXT,
        prompt TEXT NOT NULL,
        ok INTEGER NOT NULL,
        output TEXT NOT NULL,
        error TEXT,
        inherited_from_clone INTEGER NOT NULL DEFAULT 0,
        turn_json TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name, turn_key)
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_turns_chat_ordinal
        ON transcript_turns (drone_id, chat_name, ordinal);

      CREATE TABLE IF NOT EXISTS hub_chats (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        source_hash TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL,
        created_at TEXT,
        chat_json TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name)
      );

      CREATE INDEX IF NOT EXISTS idx_hub_chats_drone_name
        ON hub_chats (drone_id, chat_name);

      CREATE TABLE IF NOT EXISTS chat_prompts (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        prompt_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state TEXT NOT NULL,
        prompt TEXT NOT NULL,
        message_id TEXT,
        cwd TEXT,
        attachments_json TEXT,
        automation_json TEXT,
        blocked_by_automation INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        prompt_json TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name, prompt_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_prompts_chat_created
        ON chat_prompts (drone_id, chat_name, created_at);

      CREATE INDEX IF NOT EXISTS idx_chat_prompts_chat_state
        ON chat_prompts (drone_id, chat_name, state, updated_at);

      CREATE TABLE IF NOT EXISTS chat_turns (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        prompt_id TEXT NOT NULL,
        at TEXT NOT NULL,
        prompt_at TEXT,
        completed_at TEXT,
        prompt TEXT NOT NULL,
        ok INTEGER NOT NULL,
        output TEXT NOT NULL,
        error TEXT,
        turn_json TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name, prompt_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_turns_chat_prompt_at
        ON chat_turns (drone_id, chat_name, prompt_at, at);
    `);

    this.upsertPromptStmt = this.db.prepare(`
      INSERT INTO chat_prompts (
        drone_id,
        chat_name,
        prompt_id,
        created_at,
        updated_at,
        state,
        prompt,
        message_id,
        cwd,
        attachments_json,
        automation_json,
        blocked_by_automation,
        error,
        prompt_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name, prompt_id) DO UPDATE SET
        created_at = CASE
          WHEN chat_prompts.created_at IS NULL OR chat_prompts.created_at = '' THEN excluded.created_at
          ELSE chat_prompts.created_at
        END,
        updated_at = excluded.updated_at,
        state = excluded.state,
        prompt = CASE WHEN excluded.prompt != '' THEN excluded.prompt ELSE chat_prompts.prompt END,
        message_id = COALESCE(excluded.message_id, chat_prompts.message_id),
        cwd = COALESCE(excluded.cwd, chat_prompts.cwd),
        attachments_json = COALESCE(excluded.attachments_json, chat_prompts.attachments_json),
        automation_json = COALESCE(excluded.automation_json, chat_prompts.automation_json),
        blocked_by_automation = CASE
          WHEN excluded.blocked_by_automation = 1 THEN 1
          ELSE chat_prompts.blocked_by_automation
        END,
        error = excluded.error,
        prompt_json = excluded.prompt_json
    `);

    this.updatePromptStmt = this.db.prepare(`
      UPDATE chat_prompts
      SET
        updated_at = ?,
        state = COALESCE(?, state),
        error = ?,
        prompt_json = ?
      WHERE drone_id = ? AND chat_name = ? AND prompt_id = ?
    `);

    this.claimPromptStmt = this.db.prepare(`
      UPDATE chat_prompts
      SET
        state = 'sending',
        error = NULL,
        updated_at = ?,
        prompt_json = ?
      WHERE drone_id = ? AND chat_name = ? AND prompt_id = ? AND state = 'queued'
    `);

    this.deleteQueuedPromptStmt = this.db.prepare(`
      DELETE FROM chat_prompts
      WHERE drone_id = ? AND chat_name = ? AND prompt_id = ? AND state = 'queued'
    `);

    this.upsertTurnStmt = this.db.prepare(`
      INSERT INTO chat_turns (
        drone_id,
        chat_name,
        prompt_id,
        at,
        prompt_at,
        completed_at,
        prompt,
        ok,
        output,
        error,
        turn_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name, prompt_id) DO UPDATE SET
        at = excluded.at,
        prompt_at = excluded.prompt_at,
        completed_at = excluded.completed_at,
        prompt = excluded.prompt,
        ok = excluded.ok,
        output = excluded.output,
        error = excluded.error,
        turn_json = excluded.turn_json
    `);

    const deleteTurns = this.db.prepare('DELETE FROM transcript_turns WHERE drone_id = ? AND chat_name = ?');
    const upsertChat = this.db.prepare(`
      INSERT INTO transcript_chats (drone_id, chat_name, transcript_version, source_hash, imported_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(drone_id, chat_name) DO UPDATE SET
        transcript_version = CASE
          WHEN transcript_chats.source_hash = excluded.source_hash THEN transcript_chats.transcript_version
          ELSE transcript_chats.transcript_version + 1
        END,
        source_hash = excluded.source_hash,
        imported_at = excluded.imported_at
    `);
    const insertTurn = this.db.prepare(`
      INSERT INTO transcript_turns (
        drone_id,
        chat_name,
        turn_key,
        ordinal,
        at,
        prompt_at,
        completed_at,
        prompt,
        ok,
        output,
        error,
        inherited_from_clone,
        turn_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.replaceChatTx = this.db.transaction(
      (droneId: string, chatName: string, sourceHash: string, importedAt: string, turns: StoredTranscriptTurn[]) => {
        upsertChat.run(droneId, chatName, sourceHash, importedAt);
        for (const turn of turns) this.upsertTurn(droneId, chatName, turn);
        const projectedTurns = this.projectTurns(droneId, chatName);
        deleteTurns.run(droneId, chatName);
        projectedTurns.forEach((turn, idx) => {
          const ordinal = idx + 1;
          insertTurn.run(
            droneId,
            chatName,
            turnKey(turn, ordinal),
            ordinal,
            turn.at,
            turn.promptAt ?? null,
            turn.completedAt ?? null,
            turn.prompt,
            turn.ok ? 1 : 0,
            turn.output,
            turn.error ?? null,
            turn.inheritedFromClone === true ? 1 : 0,
            stableJson(turn),
          );
        });
      },
    ) as any;

    const listDroneChats = this.db.prepare('SELECT chat_name FROM hub_chats WHERE drone_id = ?');
    const deleteDroneChats = this.db.prepare('DELETE FROM hub_chats WHERE drone_id = ?');
    const deleteChatPrompts = this.db.prepare('DELETE FROM chat_prompts WHERE drone_id = ? AND chat_name = ?');
    const deleteChatTurns = this.db.prepare('DELETE FROM chat_turns WHERE drone_id = ? AND chat_name = ?');
    const deleteTranscriptChat = this.db.prepare('DELETE FROM transcript_chats WHERE drone_id = ? AND chat_name = ?');
    const upsertHubChat = this.db.prepare(`
      INSERT INTO hub_chats (drone_id, chat_name, source_hash, imported_at, created_at, chat_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name) DO UPDATE SET
        source_hash = excluded.source_hash,
        imported_at = excluded.imported_at,
        created_at = excluded.created_at,
        chat_json = excluded.chat_json
    `);
    this.replaceDroneChatsTx = this.db.transaction(
      (droneId: string, chatEntries: Array<{ chatName: string; chatEntry: any; sourceHash: string; importedAt: string }>) => {
        const incomingChatNames = new Set(chatEntries.map((entry) => entry.chatName));
        const existingRows = listDroneChats.all(droneId) as Array<{ chat_name?: string }>;
        for (const row of existingRows) {
          const existingChatName = String(row.chat_name ?? '').trim();
          if (!existingChatName || incomingChatNames.has(existingChatName)) continue;
          deleteChatPrompts.run(droneId, existingChatName);
          deleteChatTurns.run(droneId, existingChatName);
          deleteTurns.run(droneId, existingChatName);
          deleteTranscriptChat.run(droneId, existingChatName);
        }
        deleteDroneChats.run(droneId);
        for (const item of chatEntries) {
          upsertHubChat.run(
            droneId,
            item.chatName,
            item.sourceHash,
            item.importedAt,
            typeof item.chatEntry?.createdAt === 'string' ? item.chatEntry.createdAt : null,
            stableJson(chatMetadataForStorage(item.chatEntry)),
          );
          this.importPromptRows(item.chatName, droneId, item.chatEntry);
          this.importTurnRows(item.chatName, droneId, item.chatEntry);
        }
      },
    ) as any;

    this.migrateHubChatJsonRowsToNormalizedTables();
  }

  importDroneChatsFromRegistry(opts: { droneId: string; chats: unknown }): ChatStoreListResult {
    const chats = opts.chats && typeof opts.chats === 'object' && !Array.isArray(opts.chats) ? (opts.chats as Record<string, any>) : {};
    const importedAt = new Date().toISOString();
    const entries = Object.entries(chats).map(([chatName, chatEntry]) => ({
      chatName,
      chatEntry,
      sourceHash: chatEntrySourceHash(chatEntry),
      importedAt,
    }));
    this.replaceDroneChatsTx(opts.droneId, entries);
    return { available: true, chats: entries.map((entry) => entry.chatName) };
  }

  importChatFromRegistry(opts: { droneId: string; chatName: string; chatEntry: unknown; sourceHash?: string }): ChatStoreImportResult {
    const sourceHash = opts.sourceHash ?? chatEntrySourceHash(opts.chatEntry);
    const chatEntry = opts.chatEntry && typeof opts.chatEntry === 'object' ? opts.chatEntry : {};
    this.db
      .prepare(
        `
          INSERT INTO hub_chats (drone_id, chat_name, source_hash, imported_at, created_at, chat_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(drone_id, chat_name) DO UPDATE SET
            source_hash = excluded.source_hash,
            imported_at = excluded.imported_at,
            created_at = excluded.created_at,
            chat_json = excluded.chat_json
        `,
      )
      .run(
        opts.droneId,
        opts.chatName,
        sourceHash,
        new Date().toISOString(),
        typeof (chatEntry as any)?.createdAt === 'string' ? (chatEntry as any).createdAt : null,
        stableJson(chatMetadataForStorage(chatEntry)),
      );
    this.importPromptRows(opts.chatName, opts.droneId, chatEntry);
    this.importTurnRows(opts.chatName, opts.droneId, chatEntry);
    return { available: true, sourceHash };
  }

  listChats(opts: { droneId: string }): ChatStoreListResult {
    const rows = this.db
      .prepare('SELECT chat_name FROM hub_chats WHERE drone_id = ? ORDER BY chat_name ASC')
      .all(opts.droneId) as Array<{ chat_name?: string }>;
    return { available: true, chats: rows.map((row) => String(row.chat_name ?? '')).filter(Boolean) };
  }

  readChat(opts: { droneId: string; chatName: string }): ChatStoreReadResult {
    const row = this.db
      .prepare('SELECT chat_name, chat_json, source_hash FROM hub_chats WHERE drone_id = ? AND chat_name = ?')
      .get(opts.droneId, opts.chatName) as ChatStoreRow | undefined;
    if (!row) return { available: true, chat: null, sourceHash: '' };
    const chat = jsonParseAny(row.chat_json);
    const base = chat && typeof chat === 'object' ? chat : {};
    return {
      available: true,
      chat: {
        ...base,
        turns: this.projectTurns(opts.droneId, opts.chatName),
        pendingPrompts: this.projectPendingPrompts(opts.droneId, opts.chatName),
      },
      sourceHash: row.source_hash,
    };
  }

  importFromRegistry(opts: { droneId: string; chatName: string; turns: unknown; sourceHash?: string }): TranscriptImportResult {
    for (const turn of sortTranscriptTurns(opts.turns)) this.upsertTurn(opts.droneId, opts.chatName, turn);
    return this.refreshTranscriptProjection(opts.droneId, opts.chatName);
  }

  private refreshTranscriptProjection(droneId: string, chatName: string): TranscriptImportResult {
    const projectedTurns = this.projectTurns(droneId, chatName);
    const sourceHash = transcriptTurnsSourceHash(projectedTurns);
    const current = this.meta(droneId, chatName);
    if (current?.source_hash === sourceHash) {
      return { available: true, transcriptVersion: current.transcript_version, sourceHash };
    }
    this.replaceChatTx(droneId, chatName, sourceHash, new Date().toISOString(), projectedTurns);
    const next = this.meta(droneId, chatName);
    return { available: true, transcriptVersion: next?.transcript_version ?? 1, sourceHash };
  }

  read(opts: { droneId: string; chatName: string; indexes: number[] }): TranscriptStoreReadResult {
    const meta = this.meta(opts.droneId, opts.chatName);
    const projectedTurns = this.projectTurns(opts.droneId, opts.chatName);
    const count = projectedTurns.length;
    if (opts.indexes.length === 0) {
      return {
        available: true,
        count,
        transcriptVersion: meta?.transcript_version ?? 0,
        sourceHash: meta?.source_hash ?? transcriptTurnsSourceHash(projectedTurns),
        turns: [],
      };
    }
    const turns = opts.indexes
      .map((index) => {
        const turn = projectedTurns[index];
        return turn ? { index, turn } : null;
      })
      .filter((item): item is { index: number; turn: StoredTranscriptTurn } => Boolean(item));
    return {
      available: true,
      count,
      transcriptVersion: meta?.transcript_version ?? 0,
      sourceHash: meta?.source_hash ?? transcriptTurnsSourceHash(projectedTurns),
      turns,
    };
  }

  count(opts: { droneId: string; chatName: string }): { count: number; transcriptVersion: number; sourceHash: string } {
    const meta = this.meta(opts.droneId, opts.chatName);
    const turns = this.projectTurns(opts.droneId, opts.chatName);
    return {
      count: turns.length,
      transcriptVersion: meta?.transcript_version ?? 0,
      sourceHash: meta?.source_hash ?? transcriptTurnsSourceHash(turns),
    };
  }

  upsertPendingPrompt(opts: { droneId: string; chatName: string; pending: StoredPendingPrompt }): ChatStoreImportResult {
    const pending = normalizePendingPrompt(opts.pending);
    if (!pending) return { available: true, sourceHash: '' };
    this.upsertPrompt(opts.droneId, opts.chatName, pending);
    return { available: true, sourceHash: '' };
  }

  updatePendingPrompt(opts: {
    droneId: string;
    chatName: string;
    id: string;
    patch: Partial<Pick<StoredPendingPrompt, 'state' | 'error' | 'observability' | 'blipClones' | 'updatedAt'>>;
  }): { updated: boolean } {
    const current = this.readPendingPrompt(opts.droneId, opts.chatName, opts.id);
    if (!current) return { updated: false };
    const next = normalizePendingPrompt({
      ...current,
      ...opts.patch,
      updatedAt: opts.patch.updatedAt ?? new Date().toISOString(),
    });
    if (!next) return { updated: false };
    const info = this.updatePromptStmt.run(
      next.updatedAt ?? new Date().toISOString(),
      next.state,
      next.error ?? null,
      stableJson(next),
      opts.droneId,
      opts.chatName,
      opts.id,
    );
    return { updated: Number(info.changes ?? 0) > 0 };
  }

  claimQueuedPendingPrompt(opts: { droneId: string; chatName: string; id: string }): { claimed: boolean; state: string | null } {
    const current = this.readPendingPrompt(opts.droneId, opts.chatName, opts.id);
    if (!current) return { claimed: false, state: null };
    if (current.state !== 'queued') return { claimed: false, state: current.state };
    const next = normalizePendingPrompt({ ...current, state: 'sending', error: undefined, updatedAt: new Date().toISOString() });
    if (!next) return { claimed: false, state: current.state };
    const info = this.claimPromptStmt.run(
      next.updatedAt ?? new Date().toISOString(),
      stableJson(next),
      opts.droneId,
      opts.chatName,
      opts.id,
    );
    return { claimed: Number(info.changes ?? 0) > 0, state: Number(info.changes ?? 0) > 0 ? 'sending' : current.state };
  }

  cancelQueuedPendingPrompt(opts: { droneId: string; chatName: string; id: string }): { cancelled: boolean; state: string | null } {
    const current = this.readPendingPrompt(opts.droneId, opts.chatName, opts.id);
    if (!current) return { cancelled: false, state: null };
    if (current.state !== 'queued') return { cancelled: false, state: current.state };
    const info = this.deleteQueuedPromptStmt.run(opts.droneId, opts.chatName, opts.id);
    return { cancelled: Number(info.changes ?? 0) > 0, state: 'queued' };
  }

  upsertTranscriptTurn(opts: { droneId: string; chatName: string; turn: StoredTranscriptTurn }): ChatStoreImportResult {
    this.upsertTurn(opts.droneId, opts.chatName, normalizeTurn(opts.turn));
    const refreshed = this.refreshTranscriptProjection(opts.droneId, opts.chatName);
    return { available: true, sourceHash: refreshed.sourceHash };
  }

  clearAllForTests(): void {
    this.db.exec(`
      DELETE FROM chat_prompts;
      DELETE FROM chat_turns;
      DELETE FROM transcript_turns;
      DELETE FROM transcript_chats;
      DELETE FROM hub_chats;
    `);
  }

  private importPromptRows(chatName: string, droneId: string, chatEntry: any) {
    const pending = Array.isArray(chatEntry?.pendingPrompts) ? chatEntry.pendingPrompts : [];
    for (const item of pending) {
      const p = normalizePendingPrompt(item);
      if (p) this.upsertPrompt(droneId, chatName, p);
    }
    const turns = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
    for (const item of turns) {
      const turn = normalizeTurn(item);
      if (!turn.id) continue;
      const existing = this.readPendingPrompt(droneId, chatName, turn.id);
      if (existing) continue;
      const p = normalizePendingPrompt({
        id: turn.id,
        at: turn.promptAt ?? turn.at,
        prompt: turn.prompt,
        attachments: turn.attachments,
        automation: turn.automation,
        state: 'sent',
        updatedAt: turn.completedAt ?? turn.at,
      });
      if (p) this.upsertPrompt(droneId, chatName, p);
    }
  }

  private importTurnRows(chatName: string, droneId: string, chatEntry: any) {
    const turns = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
    for (const item of sortTranscriptTurns(turns)) this.upsertTurn(droneId, chatName, item);
  }

  private upsertPrompt(droneId: string, chatName: string, pending: StoredPendingPrompt) {
    this.upsertPromptStmt.run(
      droneId,
      chatName,
      pending.id,
      pending.at,
      pending.updatedAt ?? pending.at,
      pending.state,
      pending.prompt,
      pending.messageId ?? null,
      pending.cwd ?? null,
      jsonOrNull(pending.attachments),
      jsonOrNull(pending.automation),
      pending.blockedByAutomation === true ? 1 : 0,
      pending.error ?? null,
      stableJson(pending),
    );
  }

  private upsertTurn(droneId: string, chatName: string, turn: StoredTranscriptTurn) {
    const id = turn.id ? String(turn.id).trim() : '';
    if (!id) return;
    const existing = this.readPendingPrompt(droneId, chatName, id);
    const submittedAt = typeof existing?.at === 'string' && existing.at.trim() ? existing.at.trim() : '';
    const storedTurn = submittedAt ? { ...turn, at: submittedAt, promptAt: submittedAt } : turn;
    this.upsertTurnStmt.run(
      droneId,
      chatName,
      id,
      storedTurn.at,
      storedTurn.promptAt ?? null,
      storedTurn.completedAt ?? null,
      storedTurn.prompt,
      storedTurn.ok ? 1 : 0,
      storedTurn.output,
      storedTurn.error ?? null,
      stableJson(storedTurn),
    );
    if (!existing) {
      const p = normalizePendingPrompt({
        id,
        at: storedTurn.promptAt ?? storedTurn.at,
        prompt: storedTurn.prompt,
        attachments: storedTurn.attachments,
        automation: storedTurn.automation,
        state: storedTurn.ok ? 'sent' : 'failed',
        error: storedTurn.ok ? undefined : storedTurn.error,
        updatedAt: storedTurn.completedAt ?? storedTurn.at,
      });
      if (p) this.upsertPrompt(droneId, chatName, p);
    } else if (existing.state !== 'sent' && storedTurn.ok) {
      this.updatePendingPrompt({
        droneId,
        chatName,
        id,
        patch: { state: 'sent', error: undefined, updatedAt: storedTurn.completedAt ?? storedTurn.at },
      });
    }
  }

  private readPendingPrompt(droneId: string, chatName: string, promptId: string): StoredPendingPrompt | null {
    const row = this.db
      .prepare('SELECT * FROM chat_prompts WHERE drone_id = ? AND chat_name = ? AND prompt_id = ?')
      .get(droneId, chatName, promptId);
    return promptFromRow(row);
  }

  private projectPendingPrompts(droneId: string, chatName: string): StoredPendingPrompt[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_prompts WHERE drone_id = ? AND chat_name = ? ORDER BY created_at ASC')
      .all(droneId, chatName);
    return sortPendingPrompts(rows.map((row) => promptFromRow(row)).filter((p): p is StoredPendingPrompt => Boolean(p))).slice(-60);
  }

  private projectTurns(droneId: string, chatName: string): StoredTranscriptTurn[] {
    const rows = this.db
      .prepare(
        `
          SELECT turn_json
          FROM chat_turns
          WHERE drone_id = ? AND chat_name = ?
          ORDER BY COALESCE(prompt_at, at) ASC, completed_at ASC, prompt_id ASC
        `,
      )
      .all(droneId, chatName) as Array<{ turn_json: string }>;
    return rows.map((row) => jsonParseObject(row.turn_json));
  }

  private migrateHubChatJsonRowsToNormalizedTables() {
    const rows = this.db
      .prepare('SELECT drone_id, chat_name, chat_json FROM hub_chats')
      .all() as Array<{ drone_id?: string; chat_name?: string; chat_json?: string }>;
    for (const row of rows) {
      const droneId = String(row.drone_id ?? '').trim();
      const chatName = String(row.chat_name ?? '').trim();
      if (!droneId || !chatName) continue;
      const chatEntry = jsonParseAny(String(row.chat_json ?? '{}'));
      if (!chatEntry || typeof chatEntry !== 'object') continue;
      this.importPromptRows(chatName, droneId, chatEntry);
      this.importTurnRows(chatName, droneId, chatEntry);
    }
  }

  private meta(droneId: string, chatName: string): TranscriptMetaRow | null {
    const row = this.db
      .prepare('SELECT transcript_version, source_hash FROM transcript_chats WHERE drone_id = ? AND chat_name = ?')
      .get(droneId, chatName) as TranscriptMetaRow | undefined;
    return row ?? null;
  }
}

export function getTranscriptStoreUnavailableReason(): string | null {
  return unavailableReason;
}

export function getTranscriptStore(): TranscriptStore | null {
  const Database = loadDatabaseConstructor();
  if (!Database) return null;
  const dbPath = transcriptStorePath();
  if (cached?.dbPath === dbPath) return cached.store;
  if (cached) {
    try {
      cached.db.close();
    } catch {
      // ignore stale close errors
    }
    cached = null;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  try {
    const db = new Database(dbPath);
    const store = new TranscriptStore(db);
    cached = { dbPath, db, store };
    unavailableReason = null;
    return store;
  } catch (error: any) {
    unavailableReason = error?.message ?? String(error);
    return null;
  }
}

function memoryImportTurn(droneId: string, chatName: string, turnRaw: unknown) {
  const turn = normalizeTurn(turnRaw);
  const id = turn.id ? String(turn.id).trim() : '';
  if (!id) return;
  memoryTurnMap(droneId, chatName).set(id, turn);
  const prompts = memoryPromptMap(droneId, chatName);
  if (!prompts.has(id) && !memoryCancelledPrompts.has(memoryPromptKey(droneId, chatName, id))) {
    const pending = normalizePendingPrompt({
      id,
      at: turn.promptAt ?? turn.at,
      prompt: turn.prompt,
      attachments: turn.attachments,
      automation: turn.automation,
      state: turn.ok ? 'sent' : 'failed',
      error: turn.ok ? undefined : turn.error,
      updatedAt: turn.completedAt ?? turn.at,
    });
    if (pending) prompts.set(id, pending);
  }
}

function memoryProjectTurns(droneId: string, chatName: string): StoredTranscriptTurn[] {
  return sortTranscriptTurns([...memoryTurnMap(droneId, chatName).values()]);
}

function memoryProjectPending(droneId: string, chatName: string): StoredPendingPrompt[] {
  return sortPendingPrompts([...memoryPromptMap(droneId, chatName).values()]).slice(-60);
}

function memoryImportChat(opts: { droneId: string; chatName: string; chatEntry: unknown; sourceHash?: string }): ChatStoreImportResult {
  const chatEntry = normalizeChatEntryForStorage(opts.chatEntry);
  const sourceHash = opts.sourceHash ?? chatEntrySourceHash(opts.chatEntry);
  memoryChats.set(chatStoreKey(opts.droneId, opts.chatName), {
    chatName: opts.chatName,
    chatEntry: chatMetadataForStorage(chatEntry),
    sourceHash,
  });
  const pending = Array.isArray((chatEntry as any)?.pendingPrompts) ? (chatEntry as any).pendingPrompts : [];
  for (const item of pending) {
    const p = normalizePendingPrompt(item);
    if (p && !memoryCancelledPrompts.has(memoryPromptKey(opts.droneId, opts.chatName, p.id))) {
      memoryPromptMap(opts.droneId, opts.chatName).set(p.id, p);
    }
  }
  const turns = Array.isArray((chatEntry as any)?.turns) ? (chatEntry as any).turns : [];
  for (const turn of turns) memoryImportTurn(opts.droneId, opts.chatName, turn);
  return { available: true, sourceHash };
}

function memoryReadChat(opts: { droneId: string; chatName: string }): ChatStoreReadResult {
  const row = memoryChats.get(chatStoreKey(opts.droneId, opts.chatName));
  if (!row) return { available: true, chat: null, sourceHash: '' };
  return {
    available: true,
    chat: {
      ...row.chatEntry,
      turns: memoryProjectTurns(opts.droneId, opts.chatName),
      pendingPrompts: memoryProjectPending(opts.droneId, opts.chatName),
    },
    sourceHash: row.sourceHash,
  };
}

function memoryImportTranscript(opts: {
  droneId: string;
  chatName: string;
  turns: unknown;
  sourceHash?: string;
}): TranscriptImportResult {
  const turns = sortTranscriptTurns(opts.turns);
  for (const turn of turns) memoryImportTurn(opts.droneId, opts.chatName, turn);
  const projected = memoryProjectTurns(opts.droneId, opts.chatName);
  const sourceHash = transcriptTurnsSourceHash(projected);
  return { available: true, transcriptVersion: projected.length, sourceHash };
}

function memoryReadTranscript(opts: { droneId: string; chatName: string; indexes: number[] }): TranscriptStoreReadResult {
  const turns = memoryProjectTurns(opts.droneId, opts.chatName);
  return {
    available: true,
    count: turns.length,
    transcriptVersion: turns.length,
    sourceHash: transcriptTurnsSourceHash(turns),
    turns: opts.indexes
      .map((index) => {
        const turn = turns[index];
        return turn ? { index, turn } : null;
      })
      .filter((item): item is { index: number; turn: StoredTranscriptTurn } => Boolean(item)),
  };
}

function memoryResetForTests(): void {
  memoryChats.clear();
  memoryPrompts.clear();
  memoryTurns.clear();
  memoryCancelledPrompts.clear();
}

export function importTranscriptTurnsFromRegistry(opts: {
  droneId: string;
  chatName: string;
  turns: unknown;
  sourceHash?: string;
}): TranscriptImportResult {
  const store = getTranscriptStore();
  if (!store) return memoryImportTranscript(opts);
  return store.importFromRegistry(opts);
}

export function readTranscriptTurnsFromStore(opts: {
  droneId: string;
  chatName: string;
  indexes: number[];
}): TranscriptStoreReadResult {
  const store = getTranscriptStore();
  if (!store) {
    return memoryReadTranscript(opts);
  }
  return store.read(opts);
}

export function countTranscriptTurnsFromStore(opts: {
  droneId: string;
  chatName: string;
}): { available: boolean; count: number; transcriptVersion: number; sourceHash: string } {
  const store = getTranscriptStore();
  if (!store) {
    const turns = memoryProjectTurns(opts.droneId, opts.chatName);
    return { available: true, count: turns.length, transcriptVersion: turns.length, sourceHash: transcriptTurnsSourceHash(turns) };
  }
  return { available: true, ...store.count(opts) };
}

export function importDroneChatsFromRegistry(opts: {
  droneId: string;
  chats: unknown;
}): ChatStoreListResult {
  const store = getTranscriptStore();
  if (!store) {
    const chats = opts.chats && typeof opts.chats === 'object' && !Array.isArray(opts.chats) ? (opts.chats as Record<string, any>) : {};
    const prefix = `${opts.droneId}\u0000`;
    for (const key of [...memoryChats.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const chatName = key.slice(prefix.length);
      if (Object.prototype.hasOwnProperty.call(chats, chatName)) continue;
      memoryChats.delete(key);
      memoryPrompts.delete(key);
      memoryTurns.delete(key);
    }
    for (const [chatName, chatEntry] of Object.entries(chats)) {
      memoryImportChat({ droneId: opts.droneId, chatName, chatEntry });
    }
    return { available: true, chats: Object.keys(chats) };
  }
  return store.importDroneChatsFromRegistry(opts);
}

export function importChatFromRegistry(opts: {
  droneId: string;
  chatName: string;
  chatEntry: unknown;
  sourceHash?: string;
}): ChatStoreImportResult {
  const store = getTranscriptStore();
  if (!store) return memoryImportChat(opts);
  return store.importChatFromRegistry(opts);
}

export function listChatsFromStore(opts: {
  droneId: string;
}): ChatStoreListResult {
  const store = getTranscriptStore();
  if (!store) {
    const prefix = `${opts.droneId}\u0000`;
    return {
      available: true,
      chats: [...memoryChats.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .sort(),
    };
  }
  return store.listChats(opts);
}

export function readChatFromStore(opts: {
  droneId: string;
  chatName: string;
}): ChatStoreReadResult {
  const store = getTranscriptStore();
  if (!store) return memoryReadChat(opts);
  return store.readChat(opts);
}

export function upsertPendingPromptInStore(opts: {
  droneId: string;
  chatName: string;
  pending: StoredPendingPrompt;
}): ChatStoreImportResult {
  const store = getTranscriptStore();
  if (!store) {
    const pending = normalizePendingPrompt(opts.pending);
    if (pending) {
      memoryCancelledPrompts.delete(memoryPromptKey(opts.droneId, opts.chatName, pending.id));
      memoryPromptMap(opts.droneId, opts.chatName).set(pending.id, pending);
    }
    return { available: true, sourceHash: '' };
  }
  return store.upsertPendingPrompt(opts);
}

export function updatePendingPromptInStore(opts: {
  droneId: string;
  chatName: string;
  id: string;
  patch: Partial<Pick<StoredPendingPrompt, 'state' | 'error' | 'observability' | 'blipClones' | 'updatedAt'>>;
}): { available: boolean; updated: boolean } {
  const store = getTranscriptStore();
  if (!store) {
    const map = memoryPromptMap(opts.droneId, opts.chatName);
    const current = map.get(opts.id);
    if (!current) return { available: true, updated: false };
    const next = normalizePendingPrompt({ ...current, ...opts.patch, updatedAt: opts.patch.updatedAt ?? new Date().toISOString() });
    if (!next) return { available: true, updated: false };
    map.set(opts.id, next);
    return { available: true, updated: true };
  }
  return { available: true, ...store.updatePendingPrompt(opts) };
}

export function claimQueuedPendingPromptInStore(opts: {
  droneId: string;
  chatName: string;
  id: string;
}): { available: boolean; claimed: boolean; state: string | null } {
  const store = getTranscriptStore();
  if (!store) {
    const map = memoryPromptMap(opts.droneId, opts.chatName);
    const current = map.get(opts.id);
    if (!current) return { available: true, claimed: false, state: null };
    if (current.state !== 'queued') return { available: true, claimed: false, state: current.state };
    const next = normalizePendingPrompt({ ...current, state: 'sending', error: undefined, updatedAt: new Date().toISOString() });
    if (!next) return { available: true, claimed: false, state: current.state };
    map.set(opts.id, next);
    return { available: true, claimed: true, state: 'sending' };
  }
  return { available: true, ...store.claimQueuedPendingPrompt(opts) };
}

export function cancelQueuedPendingPromptInStore(opts: {
  droneId: string;
  chatName: string;
  id: string;
}): { available: boolean; cancelled: boolean; state: string | null } {
  const store = getTranscriptStore();
  if (!store) {
    const map = memoryPromptMap(opts.droneId, opts.chatName);
    const current = map.get(opts.id);
    if (!current) return { available: true, cancelled: false, state: null };
    if (current.state !== 'queued') return { available: true, cancelled: false, state: current.state };
    memoryCancelledPrompts.add(memoryPromptKey(opts.droneId, opts.chatName, opts.id));
    map.delete(opts.id);
    return { available: true, cancelled: true, state: 'queued' };
  }
  return { available: true, ...store.cancelQueuedPendingPrompt(opts) };
}

export function upsertTranscriptTurnInStore(opts: {
  droneId: string;
  chatName: string;
  turn: StoredTranscriptTurn;
}): ChatStoreImportResult {
  const store = getTranscriptStore();
  if (!store) {
    memoryImportTurn(opts.droneId, opts.chatName, opts.turn);
    return { available: true, sourceHash: '' };
  }
  return store.upsertTranscriptTurn(opts);
}

export function resetTranscriptStoreForTests(): void {
  const store = getTranscriptStore();
  if (!store) {
    memoryResetForTests();
    return;
  }
  store.clearAllForTests();
  memoryResetForTests();
}
