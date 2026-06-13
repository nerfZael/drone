import crypto from 'node:crypto';
import fs from 'node:fs';
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
  attachments?: unknown;
  automation?: unknown;
  inheritedFromClone?: boolean;
  agentMessageAutoContinue?: unknown;
  agentSuggestion?: unknown;
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

let cached:
  | {
      dbPath: string;
      db: DatabaseInstance;
      store: TranscriptStore;
    }
  | null = null;

let unavailableReason: string | null = null;

function loadDatabaseConstructor(): DatabaseConstructor | null {
  try {
    // Keep this dynamic so Bun-based tests can import the server even when the
    // native Node binding was compiled for Node's ABI.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('better-sqlite3') as DatabaseConstructor;
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
    ...(Array.isArray(raw?.attachments) ? { attachments: raw.attachments } : {}),
    ...(raw?.automation && typeof raw.automation === 'object' ? { automation: raw.automation } : {}),
    ...(raw?.inheritedFromClone === true ? { inheritedFromClone: true } : {}),
    ...(raw?.agentMessageAutoContinue && typeof raw.agentMessageAutoContinue === 'object'
      ? { agentMessageAutoContinue: raw.agentMessageAutoContinue }
      : {}),
    ...(raw?.agentSuggestion && typeof raw.agentSuggestion === 'object' ? { agentSuggestion: raw.agentSuggestion } : {}),
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

class TranscriptStore {
  private replaceChatTx: (droneId: string, chatName: string, sourceHash: string, importedAt: string, turns: StoredTranscriptTurn[]) => void;
  private replaceDroneChatsTx: (droneId: string, chatEntries: Array<{ chatName: string; chatEntry: any; sourceHash: string; importedAt: string }>) => void;

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
        deleteTurns.run(droneId, chatName);
        turns.forEach((turn, idx) => {
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

    const deleteDroneChats = this.db.prepare('DELETE FROM hub_chats WHERE drone_id = ?');
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
        deleteDroneChats.run(droneId);
        for (const item of chatEntries) {
          upsertHubChat.run(
            droneId,
            item.chatName,
            item.sourceHash,
            item.importedAt,
            typeof item.chatEntry?.createdAt === 'string' ? item.chatEntry.createdAt : null,
            stableJson(item.chatEntry && typeof item.chatEntry === 'object' ? item.chatEntry : {}),
          );
        }
      },
    ) as any;
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
    const current = this.db
      .prepare('SELECT source_hash FROM hub_chats WHERE drone_id = ? AND chat_name = ?')
      .get(opts.droneId, opts.chatName) as { source_hash?: string } | undefined;
    if (current?.source_hash === sourceHash) return { available: true, sourceHash };
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
        stableJson(chatEntry),
      );
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
    return { available: true, chat: chat && typeof chat === 'object' ? chat : null, sourceHash: row.source_hash };
  }

  importFromRegistry(opts: { droneId: string; chatName: string; turns: unknown; sourceHash?: string }): TranscriptImportResult {
    const sourceHash = opts.sourceHash ?? transcriptTurnsSourceHash(opts.turns);
    const current = this.meta(opts.droneId, opts.chatName);
    if (current?.source_hash === sourceHash) {
      return { available: true, transcriptVersion: current.transcript_version, sourceHash };
    }
    this.replaceChatTx(opts.droneId, opts.chatName, sourceHash, new Date().toISOString(), sortTranscriptTurns(opts.turns));
    const next = this.meta(opts.droneId, opts.chatName);
    return { available: true, transcriptVersion: next?.transcript_version ?? 1, sourceHash };
  }

  read(opts: { droneId: string; chatName: string; indexes: number[] }): TranscriptStoreReadResult {
    const meta = this.meta(opts.droneId, opts.chatName);
    if (!meta) {
      return { available: true, count: 0, transcriptVersion: 0, sourceHash: '', turns: [] };
    }
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS count FROM transcript_turns WHERE drone_id = ? AND chat_name = ?')
      .get(opts.droneId, opts.chatName) as { count?: number } | undefined;
    const count = Number(countRow?.count ?? 0);
    if (opts.indexes.length === 0) {
      return { available: true, count, transcriptVersion: meta.transcript_version, sourceHash: meta.source_hash, turns: [] };
    }
    const byOrdinal = this.db.prepare(
      'SELECT ordinal, turn_json FROM transcript_turns WHERE drone_id = ? AND chat_name = ? AND ordinal = ?',
    );
    const turns = opts.indexes
      .map((index) => {
        const row = byOrdinal.get(opts.droneId, opts.chatName, index + 1) as TranscriptStoreRow | undefined;
        return row ? { index, turn: jsonParseObject(row.turn_json) } : null;
      })
      .filter((item): item is { index: number; turn: StoredTranscriptTurn } => Boolean(item));
    return { available: true, count, transcriptVersion: meta.transcript_version, sourceHash: meta.source_hash, turns };
  }

  count(opts: { droneId: string; chatName: string }): { count: number; transcriptVersion: number; sourceHash: string } {
    const meta = this.meta(opts.droneId, opts.chatName);
    if (!meta) return { count: 0, transcriptVersion: 0, sourceHash: '' };
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM transcript_turns WHERE drone_id = ? AND chat_name = ?')
      .get(opts.droneId, opts.chatName) as { count?: number } | undefined;
    return { count: Number(row?.count ?? 0), transcriptVersion: meta.transcript_version, sourceHash: meta.source_hash };
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

export function importTranscriptTurnsFromRegistry(opts: {
  droneId: string;
  chatName: string;
  turns: unknown;
  sourceHash?: string;
}): TranscriptImportResult {
  const store = getTranscriptStore();
  if (!store) return { available: false, transcriptVersion: 0, sourceHash: opts.sourceHash ?? transcriptTurnsSourceHash(opts.turns) };
  return store.importFromRegistry(opts);
}

export function readTranscriptTurnsFromStore(opts: {
  droneId: string;
  chatName: string;
  indexes: number[];
}): TranscriptStoreReadResult {
  const store = getTranscriptStore();
  if (!store) {
    return { available: false, count: 0, transcriptVersion: 0, sourceHash: '', turns: [] };
  }
  return store.read(opts);
}

export function countTranscriptTurnsFromStore(opts: {
  droneId: string;
  chatName: string;
}): { available: boolean; count: number; transcriptVersion: number; sourceHash: string } {
  const store = getTranscriptStore();
  if (!store) return { available: false, count: 0, transcriptVersion: 0, sourceHash: '' };
  return { available: true, ...store.count(opts) };
}

export function importDroneChatsFromRegistry(opts: {
  droneId: string;
  chats: unknown;
}): ChatStoreListResult {
  const store = getTranscriptStore();
  if (!store) return { available: false, chats: [] };
  return store.importDroneChatsFromRegistry(opts);
}

export function importChatFromRegistry(opts: {
  droneId: string;
  chatName: string;
  chatEntry: unknown;
  sourceHash?: string;
}): ChatStoreImportResult {
  const store = getTranscriptStore();
  if (!store) return { available: false, sourceHash: opts.sourceHash ?? chatEntrySourceHash(opts.chatEntry) };
  return store.importChatFromRegistry(opts);
}

export function listChatsFromStore(opts: {
  droneId: string;
}): ChatStoreListResult {
  const store = getTranscriptStore();
  if (!store) return { available: false, chats: [] };
  return store.listChats(opts);
}

export function readChatFromStore(opts: {
  droneId: string;
  chatName: string;
}): ChatStoreReadResult {
  const store = getTranscriptStore();
  if (!store) return { available: false, chat: null, sourceHash: '' };
  return store.readChat(opts);
}
