import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  BlipRuntimeEvent,
  BlipSessionState,
  CreateSessionInput,
  ForkSessionInput,
  SessionRepository,
  TranscriptEntry,
} from '@blip/core';

import { droneRootPath } from '../../host/paths';

function nowIso(): string { return new Date().toISOString(); }

type Statement = { run: (...params: any[]) => { changes?: number }; get: (...params: any[]) => unknown; all: (...params: any[]) => unknown[] };
type DatabaseLike = { exec: (sql: string) => unknown; prepare: (sql: string) => Statement; pragma?: (sql: string) => unknown; transaction?: (fn: () => void) => () => void; close: () => void };

function openDatabase(databasePath: string): DatabaseLike {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const runtimeRequire = createRequire(__filename);
  if (typeof (globalThis as any).Bun !== 'undefined') {
    const BunDatabase = runtimeRequire('bun:sqlite').Database;
    return new BunDatabase(databasePath, { create: true }) as DatabaseLike;
  }
  const NodeDatabase = runtimeRequire('better-sqlite3');
  return new NodeDatabase(databasePath) as DatabaseLike;
}

export class HubSessionRepository implements SessionRepository {
  private readonly db: DatabaseLike;

  constructor(databasePath = droneRootPath('assistant-blip.sqlite')) {
    this.db = openDatabase(path.resolve(databasePath));
    this.db.pragma?.('journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_blip_sessions (
        id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assistant_blip_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES assistant_blip_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS assistant_blip_entries_session_sequence
        ON assistant_blip_entries(session_id, sequence);
      CREATE TABLE IF NOT EXISTS assistant_blip_thread_bindings (
        thread_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES assistant_blip_sessions(id) ON DELETE CASCADE
      );
    `);
  }

  async create(input: CreateSessionInput): Promise<BlipSessionState> {
    const id = `hub_${crypto.randomUUID()}`;
    const at = nowIso();
    const session: BlipSessionState = {
      id,
      workspaceRoot: 'drone-hub',
      modelProvider: input.provider,
      modelId: input.model,
      permissionMode: input.permissionMode,
      toolProfile: input.toolProfile,
      loadedSkills: [],
      transcriptPath: `sqlite:assistant-blip:${id}`,
      changedFiles: [],
      readFiles: [],
      createdAt: at,
      updatedAt: at,
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.forkedFromEntryId ? { forkedFromEntryId: input.forkedFromEntryId } : {}),
    };
    const createRows = () => {
      this.db.prepare('INSERT INTO assistant_blip_sessions (id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, JSON.stringify(session), at, at);
      const insert = this.db.prepare('INSERT INTO assistant_blip_entries (session_id, entry_json, created_at) VALUES (?, ?, ?)');
      for (const entry of input.transcriptSeed ?? []) insert.run(id, JSON.stringify(entry), at);
    };
    if (this.db.transaction) this.db.transaction(createRows)();
    else createRows();
    return session;
  }

  async save(session: BlipSessionState): Promise<void> {
    session.updatedAt = nowIso();
    const result = this.db.prepare('UPDATE assistant_blip_sessions SET metadata_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(session), session.updatedAt, session.id);
    if (result.changes === 0) throw new Error(`unknown Hub Blip session: ${session.id}`);
  }

  async delete(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM assistant_blip_sessions WHERE id = ?').run(sessionId);
  }

  async load(sessionId: string): Promise<BlipSessionState> {
    const row = this.db.prepare('SELECT metadata_json FROM assistant_blip_sessions WHERE id = ?').get(sessionId) as { metadata_json?: string } | undefined;
    if (!row?.metadata_json) throw new Error(`unknown Hub Blip session: ${sessionId}`);
    return JSON.parse(row.metadata_json);
  }

  async list(): Promise<BlipSessionState[]> {
    const rows = this.db.prepare('SELECT metadata_json FROM assistant_blip_sessions ORDER BY updated_at DESC').all() as Array<{ metadata_json: string }>;
    return rows.flatMap((row) => {
      try { return [JSON.parse(row.metadata_json) as BlipSessionState]; } catch { return []; }
    });
  }

  async latest(): Promise<BlipSessionState | undefined> { return (await this.list())[0]; }

  async appendEntry(session: BlipSessionState, entry: TranscriptEntry): Promise<void> {
    this.db.prepare('INSERT INTO assistant_blip_entries (session_id, entry_json, created_at) VALUES (?, ?, ?)')
      .run(session.id, JSON.stringify(entry), nowIso());
  }

  appendMessage(session: BlipSessionState, message: AgentMessage): Promise<void> {
    return this.appendEntry(session, { type: 'message', id: crypto.randomUUID(), timestamp: nowIso(), message });
  }

  appendRuntimeEvent(session: BlipSessionState, event: BlipRuntimeEvent): Promise<void> {
    return this.appendEntry(session, { type: 'runtime_event', id: crypto.randomUUID(), timestamp: nowIso(), event });
  }

  async readTranscript(session: BlipSessionState): Promise<TranscriptEntry[]> {
    const rows = this.db.prepare('SELECT entry_json FROM assistant_blip_entries WHERE session_id = ? ORDER BY sequence').all(session.id) as Array<{ entry_json: string }>;
    return rows.map((row) => JSON.parse(row.entry_json));
  }

  async readMessages(session: BlipSessionState): Promise<AgentMessage[]> {
    return (await this.readTranscript(session)).filter((entry): entry is Extract<TranscriptEntry, { type: 'message' }> => entry.type === 'message').map((entry) => entry.message);
  }

  async readModelMessages(session: BlipSessionState): Promise<AgentMessage[]> {
    const entries = await this.readTranscript(session);
    let compactionIndex = -1;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index]?.type !== 'compaction') continue;
      compactionIndex = index;
      break;
    }
    if (compactionIndex < 0) return entries.filter((entry): entry is Extract<TranscriptEntry, { type: 'message' }> => entry.type === 'message').map((entry) => entry.message);
    const compaction = entries[compactionIndex] as Extract<TranscriptEntry, { type: 'compaction' }>;
    const boundary = entries.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
    if (boundary < 0 || boundary >= compactionIndex) return this.readMessages(session);
    return [
      { role: 'user', content: `Summary of earlier conversation:\n${compaction.summary}`, timestamp: Date.parse(compaction.createdAt) || Date.now() },
      ...entries.slice(boundary, compactionIndex).filter((entry): entry is Extract<TranscriptEntry, { type: 'message' }> => entry.type === 'message').map((entry) => entry.message),
      ...entries.slice(compactionIndex + 1).filter((entry): entry is Extract<TranscriptEntry, { type: 'message' }> => entry.type === 'message').map((entry) => entry.message),
    ];
  }

  async fork(source: BlipSessionState, input: ForkSessionInput): Promise<BlipSessionState> {
    return this.create({ ...input, parentSessionId: source.id, transcriptSeed: await this.readTranscript(source) });
  }

  async sessionIdForThread(threadId: string): Promise<string | undefined> {
    const row = this.db.prepare('SELECT session_id FROM assistant_blip_thread_bindings WHERE thread_id = ?').get(threadId) as { session_id?: string } | undefined;
    return row?.session_id;
  }

  async bindThread(threadId: string, sessionId: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO assistant_blip_thread_bindings (thread_id, session_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET session_id = excluded.session_id
    `).run(threadId, sessionId, nowIso());
  }

  close(): void { this.db.close(); }
}
