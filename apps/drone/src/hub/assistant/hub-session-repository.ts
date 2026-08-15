import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  BlipRuntimeEvent,
  BlipSessionState,
  BlipToolSuspension,
  BlipToolSuspensionStatus,
  CreateSessionInput,
  ForkSessionInput,
  SessionRepository,
  TranscriptEntry,
} from '@blip/core';
import type { BlipContextUsage, BlipHistoryPage } from '@blip/protocol';

import { droneRootPath } from '../../host/paths';

function nowIso(): string {
  return new Date().toISOString();
}

function nonnegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readContextUsage(value: unknown): BlipContextUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const tokens = nonnegativeFiniteNumber(raw.tokens);
  const contextWindow = nonnegativeFiniteNumber(raw.contextWindow);
  if (tokens === undefined || contextWindow === undefined || contextWindow === 0) return undefined;
  const rawBreakdown = raw.breakdown;
  let breakdown: BlipContextUsage['breakdown'];
  if (rawBreakdown && typeof rawBreakdown === 'object' && !Array.isArray(rawBreakdown)) {
    const candidate = rawBreakdown as Record<string, unknown>;
    const values = [
      candidate.systemPrompt,
      candidate.messages,
      candidate.toolDefinitions,
      candidate.images,
      candidate.providerOverhead,
    ].map(nonnegativeFiniteNumber);
    if (values.every((part) => part !== undefined)) {
      breakdown = {
        systemPrompt: values[0]!,
        messages: values[1]!,
        toolDefinitions: values[2]!,
        images: values[3]!,
        providerOverhead: values[4]!,
      };
    }
  }
  return {
    tokens,
    contextWindow,
    percent: (tokens / contextWindow) * 100,
    ...(raw.confidence === 'heuristic' ? { confidence: 'heuristic' as const } : {}),
    ...(breakdown ? { breakdown } : {}),
  };
}

function lastToolResultIndex(entries: TranscriptEntry[], callId: string): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.type === 'message' &&
      entry.message.role === 'toolResult' &&
      entry.message.toolCallId === callId
    ) {
      return index;
    }
  }
  return -1;
}

function toolSuspensionsFromTranscript(entries: TranscriptEntry[]): BlipToolSuspension[] {
  const latest = new Map<string, BlipToolSuspension>();
  for (const entry of entries) {
    if (entry.type === 'tool_suspension') latest.set(entry.suspension.id, entry.suspension);
  }
  return [...latest.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function modelMessagesFromTranscript(entries: TranscriptEntry[]): AgentMessage[] {
  let compactionIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === 'compaction') {
      compactionIndex = index;
      break;
    }
  }
  if (compactionIndex < 0) {
    return entries.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
  }
  const compaction = entries[compactionIndex] as Extract<TranscriptEntry, { type: 'compaction' }>;
  const messages: AgentMessage[] = [
    {
      role: 'user',
      content: `Summary of earlier conversation:\n${compaction.summary}`,
      timestamp: Date.parse(compaction.createdAt) || Date.now(),
    },
  ];
  if (!compaction.firstKeptEntryId) {
    return [
      ...messages,
      ...entries
        .slice(compactionIndex + 1)
        .flatMap((entry) => (entry.type === 'message' ? [entry.message] : [])),
    ];
  }
  const boundary = entries.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  if (boundary < 0 || boundary >= compactionIndex) {
    return entries.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
  }
  return [
    ...messages,
    ...entries
      .slice(boundary, compactionIndex)
      .flatMap((entry) => (entry.type === 'message' ? [entry.message] : [])),
    ...entries
      .slice(compactionIndex + 1)
      .flatMap((entry) => (entry.type === 'message' ? [entry.message] : [])),
  ];
}

type Statement = {
  run: (...params: any[]) => { changes?: number };
  get: (...params: any[]) => unknown;
  all: (...params: any[]) => unknown[];
};
type DatabaseLike = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => Statement;
  pragma?: (sql: string) => unknown;
  transaction?: (fn: () => void) => () => void;
  close: () => void;
};

function openDatabase(databasePath: string): DatabaseLike {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  }
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

  constructor(databasePathOrOptions: string | { inMemory: true } = droneRootPath('assistant-blip.sqlite')) {
    const inMemory = typeof databasePathOrOptions !== 'string';
    const databasePath = inMemory ? ':memory:' : path.resolve(databasePathOrOptions);
    this.db = openDatabase(databasePath);
    if (!inMemory) this.db.pragma?.('journal_mode = WAL');
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
      this.db
        .prepare(
          'INSERT INTO assistant_blip_sessions (id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
        )
        .run(id, JSON.stringify(session), at, at);
      const insert = this.db.prepare(
        'INSERT INTO assistant_blip_entries (session_id, entry_json, created_at) VALUES (?, ?, ?)',
      );
      for (const entry of input.transcriptSeed ?? []) insert.run(id, JSON.stringify(entry), at);
    };
    if (this.db.transaction) this.db.transaction(createRows)();
    else createRows();
    return session;
  }

  async save(session: BlipSessionState): Promise<void> {
    session.updatedAt = nowIso();
    const result = this.db
      .prepare('UPDATE assistant_blip_sessions SET metadata_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(session), session.updatedAt, session.id);
    if (result.changes === 0) throw new Error(`unknown Hub Blip session: ${session.id}`);
  }

  async delete(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM assistant_blip_sessions WHERE id = ?').run(sessionId);
  }

  async load(sessionId: string): Promise<BlipSessionState> {
    const row = this.db
      .prepare('SELECT metadata_json FROM assistant_blip_sessions WHERE id = ?')
      .get(sessionId) as { metadata_json?: string } | undefined;
    if (!row?.metadata_json) throw new Error(`unknown Hub Blip session: ${sessionId}`);
    return JSON.parse(row.metadata_json);
  }

  async list(): Promise<BlipSessionState[]> {
    const rows = this.db
      .prepare('SELECT metadata_json FROM assistant_blip_sessions ORDER BY updated_at DESC')
      .all() as Array<{ metadata_json: string }>;
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.metadata_json) as BlipSessionState];
      } catch {
        return [];
      }
    });
  }

  async latest(): Promise<BlipSessionState | undefined> {
    return (await this.list())[0];
  }

  async appendEntry(session: BlipSessionState, entry: TranscriptEntry): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO assistant_blip_entries (session_id, entry_json, created_at) VALUES (?, ?, ?)',
      )
      .run(session.id, JSON.stringify(entry), nowIso());
  }

  appendMessage(session: BlipSessionState, message: AgentMessage): Promise<void> {
    return this.appendEntry(session, {
      type: 'message',
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      message,
    });
  }

  appendRuntimeEvent(session: BlipSessionState, event: BlipRuntimeEvent): Promise<void> {
    // Native chats publish only durable assistant messages. Persisting every token delta creates a
    // large volume of SQLite rows without contributing to history or the final transcript.
    if (event.type === 'assistant_delta') return Promise.resolve();
    return this.appendEntry(session, {
      type: 'runtime_event',
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      event,
    });
  }

  appendToolSuspension(session: BlipSessionState, suspension: BlipToolSuspension): Promise<void> {
    return this.appendEntry(session, {
      type: 'tool_suspension',
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      suspension,
    });
  }

  async transitionToolSuspension(
    session: BlipSessionState,
    suspension: BlipToolSuspension,
    expectedStatuses: BlipToolSuspensionStatus[],
  ): Promise<boolean> {
    let transitioned = false;
    const transition = () => {
      const row = this.db
        .prepare(
          `
        SELECT entry_json
        FROM assistant_blip_entries
        WHERE session_id = ?
          AND json_extract(entry_json, '$.type') = 'tool_suspension'
          AND json_extract(entry_json, '$.suspension.id') = ?
        ORDER BY sequence DESC
        LIMIT 1
      `,
        )
        .get(session.id, suspension.id) as { entry_json?: string } | undefined;
      if (!row?.entry_json) return;
      const latest = JSON.parse(row.entry_json) as Extract<
        TranscriptEntry,
        { type: 'tool_suspension' }
      >;
      if (!expectedStatuses.includes(latest.suspension.status)) return;
      this.db
        .prepare(
          'INSERT INTO assistant_blip_entries (session_id, entry_json, created_at) VALUES (?, ?, ?)',
        )
        .run(
          session.id,
          JSON.stringify({
            type: 'tool_suspension',
            id: crypto.randomUUID(),
            timestamp: nowIso(),
            suspension,
          } satisfies TranscriptEntry),
          nowIso(),
        );
      transitioned = true;
    };
    if (this.db.transaction) this.db.transaction(transition)();
    else transition();
    return transitioned;
  }

  async readToolSuspensions(session: BlipSessionState): Promise<BlipToolSuspension[]> {
    return toolSuspensionsFromTranscript(await this.readTranscript(session));
  }

  async recoverToolSuspensionsByThread(): Promise<
    Array<{ threadId: string; suspension: BlipToolSuspension }>
  > {
    const bindings = this.db
      .prepare('SELECT thread_id, session_id FROM assistant_blip_thread_bindings')
      .all() as Array<{ thread_id: string; session_id: string }>;
    const unresolved: Array<{ threadId: string; suspension: BlipToolSuspension }> = [];
    for (const binding of bindings) {
      const session = await this.load(binding.session_id);
      const transcript = await this.readTranscript(session);
      const results = new Map(
        transcript.flatMap((entry) =>
          entry.type === 'message' && entry.message.role === 'toolResult'
            ? [[entry.message.toolCallId, entry.message] as const]
            : [],
        ),
      );
      const suspensions = toolSuspensionsFromTranscript(transcript);
      for (const suspension of suspensions) {
        let current = suspension;
        if (suspension.status === 'approved' || suspension.status === 'executing') {
          const at = nowIso();
          const result = results.get(suspension.toolCallId);
          current = result
            ? {
                ...suspension,
                status: result.isError ? 'failed' : 'completed',
                result,
                completedAt: at,
                updatedAt: at,
              }
            : {
                ...suspension,
                status: 'interrupted',
                updatedAt: at,
                error:
                  suspension.status === 'executing'
                    ? 'Execution may have started before the process stopped. Confirm before retrying.'
                    : 'Approval was recorded before the process stopped. Confirm before executing.',
              };
          const changed = await this.transitionToolSuspension(session, current, [
            suspension.status,
          ]);
          if (!changed) {
            current =
              (await this.readToolSuspensions(session)).find(
                (candidate) => candidate.id === suspension.id,
              ) ?? current;
          }
        }
        if (current.status === 'pending' || current.status === 'interrupted') {
          unresolved.push({ threadId: binding.thread_id, suspension: current });
        }
      }
    }
    return unresolved;
  }

  async threadIdsRequiringToolContinuation(): Promise<string[]> {
    const bindings = this.db
      .prepare('SELECT thread_id, session_id FROM assistant_blip_thread_bindings')
      .all() as Array<{ thread_id: string; session_id: string }>;
    const threadIds: string[] = [];
    for (const binding of bindings) {
      const session = await this.load(binding.session_id);
      const transcript = await this.readTranscript(session);
      const terminal = toolSuspensionsFromTranscript(transcript)
        .filter(
          (suspension) =>
            (suspension.status === 'completed' ||
              suspension.status === 'failed' ||
              suspension.status === 'denied') &&
            suspension.result,
        )
        .at(-1);
      if (!terminal) continue;
      const resultIndex = lastToolResultIndex(transcript, terminal.toolCallId);
      const hasAssistantAfter =
        resultIndex >= 0 &&
        transcript
          .slice(resultIndex + 1)
          .some((entry) => entry.type === 'message' && entry.message.role === 'assistant');
      if (!hasAssistantAfter) threadIds.push(binding.thread_id);
    }
    return threadIds;
  }

  async readTranscript(session: BlipSessionState): Promise<TranscriptEntry[]> {
    const rows = this.db
      .prepare(
        'SELECT entry_json FROM assistant_blip_entries WHERE session_id = ? ORDER BY sequence',
      )
      .all(session.id) as Array<{ entry_json: string }>;
    return rows.map((row) => JSON.parse(row.entry_json));
  }

  async readMessages(session: BlipSessionState): Promise<AgentMessage[]> {
    return (await this.readTranscript(session))
      .filter(
        (entry): entry is Extract<TranscriptEntry, { type: 'message' }> => entry.type === 'message',
      )
      .map((entry) => entry.message);
  }

  async readModelMessages(session: BlipSessionState): Promise<AgentMessage[]> {
    return modelMessagesFromTranscript(await this.readTranscript(session));
  }

  async fork(source: BlipSessionState, input: ForkSessionInput): Promise<BlipSessionState> {
    return this.create({
      ...input,
      parentSessionId: source.id,
      transcriptSeed: await this.readTranscript(source),
    });
  }

  async sessionIdForThread(threadId: string): Promise<string | undefined> {
    const row = this.db
      .prepare('SELECT session_id FROM assistant_blip_thread_bindings WHERE thread_id = ?')
      .get(threadId) as { session_id?: string } | undefined;
    return row?.session_id;
  }

  async readThreadHistoryPage(
    threadId: string,
    input?: { before?: number; limit?: number },
  ): Promise<BlipHistoryPage> {
    const sessionId = await this.sessionIdForThread(threadId);
    const limit = Number.isFinite(input?.limit)
      ? Math.max(1, Math.min(200, Math.floor(input!.limit!)))
      : 80;
    if (!sessionId) {
      return {
        version: 1,
        threadId,
        sessionId: null,
        entries: [],
        page: { limit, beforeCursor: null, hasOlder: false },
      };
    }
    const before =
      Number.isFinite(input?.before) && Number(input?.before) > 0
        ? Math.floor(Number(input?.before))
        : null;
    const rows = this.db
      .prepare(
        `
      SELECT sequence, entry_json
      FROM assistant_blip_entries
      WHERE session_id = ?
        AND (
          json_extract(entry_json, '$.type') = 'message'
          OR json_extract(entry_json, '$.type') = 'compaction'
          OR (
            json_extract(entry_json, '$.type') = 'runtime_event'
            AND json_extract(entry_json, '$.event.type') = 'session_finished'
            AND json_extract(entry_json, '$.event.status') != 'suspended'
            AND COALESCE(json_extract(entry_json, '$.event.fileChanges.counts.changed'), 0) > 0
          )
        )
        AND (? IS NULL OR sequence < ?)
      ORDER BY sequence DESC
      LIMIT ?
    `,
      )
      .all(sessionId, before, before, limit + 1) as Array<{ sequence: number; entry_json: string }>;
    const hasOlder = rows.length > limit;
    const selected = (hasOlder ? rows.slice(0, limit) : rows).reverse();
    const previousUserSequence = this.db.prepare(`
      SELECT MAX(sequence) AS sequence
      FROM assistant_blip_entries
      WHERE session_id = ?
        AND sequence < ?
        AND json_extract(entry_json, '$.type') = 'message'
        AND json_extract(entry_json, '$.message.role') = 'user'
    `);
    const nextConversationBoundary = this.db.prepare(`
      SELECT sequence, entry_json
      FROM assistant_blip_entries
      WHERE session_id = ?
        AND sequence > ?
        AND (
          (
            json_extract(entry_json, '$.type') = 'message'
            AND json_extract(entry_json, '$.message.role') IN ('user', 'assistant')
          )
          OR (
            json_extract(entry_json, '$.type') = 'runtime_event'
            AND json_extract(entry_json, '$.event.type') = 'session_finished'
          )
        )
      ORDER BY sequence
      LIMIT 1
    `);
    const requestDurationThrough = this.db.prepare(`
      SELECT COALESCE(SUM(json_extract(entry_json, '$.event.durationMs')), 0) AS duration_ms
      FROM assistant_blip_entries
      WHERE session_id = ?
        AND sequence > ?
        AND sequence <= ?
        AND json_extract(entry_json, '$.type') = 'runtime_event'
        AND json_extract(entry_json, '$.event.type') = 'session_finished'
    `);
    const durationThrough = (sequence: number): number | undefined => {
      const previous = previousUserSequence.get(sessionId, sequence) as
        | { sequence?: number }
        | undefined;
      const result = requestDurationThrough.get(
        sessionId,
        Math.max(0, Number(previous?.sequence) || 0),
        sequence,
      ) as { duration_ms?: number } | undefined;
      const durationMs = Number(result?.duration_ms);
      return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined;
    };
    const entries = selected.flatMap<BlipHistoryPage['entries'][number]>((row) => {
      try {
        const entry = JSON.parse(row.entry_json) as TranscriptEntry;
        if (entry.type === 'message') {
          let message = entry.message;
          if (message.role === 'assistant') {
            const next = nextConversationBoundary.get(sessionId, row.sequence) as
              | { sequence: number; entry_json?: string }
              | undefined;
            if (next?.entry_json) {
              const boundary = JSON.parse(next.entry_json) as TranscriptEntry;
              if (boundary.type === 'runtime_event' && boundary.event.type === 'session_finished') {
                const durationMs = durationThrough(next.sequence);
                if (durationMs !== undefined) {
                  const messageDetails = (message as any).details;
                  const details =
                    messageDetails &&
                    typeof messageDetails === 'object' &&
                    !Array.isArray(messageDetails)
                      ? messageDetails
                      : {};
                  message = {
                    ...message,
                    details: { ...details, runDurationMs: durationMs },
                  } as typeof message;
                }
              }
            }
          }
          return [
            {
              sequence: Number(row.sequence),
              id: entry.id,
              timestamp: entry.timestamp,
              message,
            },
          ];
        }
        if (entry.type === 'compaction') {
          return [
            {
              sequence: Number(row.sequence),
              id: entry.id,
              timestamp: entry.createdAt,
              message: {
                role: 'compaction',
                content: '',
                details: {
                  summaryId: entry.id,
                  trigger: entry.trigger,
                  tokensBefore: entry.tokensBefore,
                  tokensAfter: entry.tokensAfterEstimate ?? null,
                  ...(entry.fallbackUsed ? { fallbackUsed: true } : {}),
                  ...(entry.fallbackReason ? { fallbackReason: entry.fallbackReason } : {}),
                },
              },
            },
          ];
        }
        if (entry.type === 'runtime_event' && entry.event.type === 'session_finished') {
          const durationMs = durationThrough(row.sequence) ?? entry.event.durationMs;
          return [
            {
              sequence: Number(row.sequence),
              id: entry.id,
              timestamp: entry.timestamp,
              message: {
                role: 'runSummary',
                content: '',
                details: {
                  turnId: entry.event.turnId,
                  status: entry.event.status,
                  durationMs,
                  ...(entry.event.fileChanges ? { fileChanges: entry.event.fileChanges } : {}),
                },
              },
            },
          ];
        }
        return [];
      } catch {
        return [];
      }
    });
    const contextUsageRow = this.db
      .prepare(
        `
      SELECT sequence, entry_json
      FROM assistant_blip_entries
      WHERE session_id = ?
        AND json_extract(entry_json, '$.type') = 'runtime_event'
        AND json_extract(entry_json, '$.event.type') = 'session_finished'
        AND json_type(entry_json, '$.event.contextUsage') = 'object'
      ORDER BY sequence DESC
      LIMIT 1
    `,
      )
      .get(sessionId) as { sequence: number; entry_json?: string } | undefined;
    let contextUsage: BlipContextUsage | undefined;
    if (contextUsageRow?.entry_json) {
      try {
        const entry = JSON.parse(contextUsageRow.entry_json) as TranscriptEntry;
        if (entry.type === 'runtime_event' && entry.event.type === 'session_finished') {
          contextUsage = readContextUsage(entry.event.contextUsage);
        }
      } catch {
        // Ignore malformed optional usage metadata without hiding valid chat history.
      }
    }
    const contextUsageSequence = contextUsageRow?.sequence;
    if (contextUsage && contextUsageSequence !== undefined) {
      const latestCompactionRow = this.db
        .prepare(
          `
        SELECT sequence, entry_json
        FROM assistant_blip_entries
        WHERE session_id = ?
          AND json_extract(entry_json, '$.type') = 'compaction'
          AND json_type(entry_json, '$.tokensAfterEstimate') IN ('integer', 'real')
        ORDER BY sequence DESC
        LIMIT 1
      `,
        )
        .get(sessionId) as { sequence: number; entry_json?: string } | undefined;
      if (latestCompactionRow?.entry_json && latestCompactionRow.sequence > contextUsageSequence) {
        try {
          const entry = JSON.parse(latestCompactionRow.entry_json) as TranscriptEntry;
          const tokensAfter =
            entry.type === 'compaction'
              ? nonnegativeFiniteNumber(entry.tokensAfterEstimate)
              : undefined;
          if (tokensAfter !== undefined) {
            contextUsage = {
              tokens: tokensAfter,
              contextWindow: contextUsage.contextWindow,
              percent: (tokensAfter / contextUsage.contextWindow) * 100,
              confidence: 'heuristic',
            };
          }
        } catch {
          // The last completed run still provides a safe fallback for malformed compaction data.
        }
      }
    }
    return {
      version: 1,
      threadId,
      sessionId,
      entries,
      ...(contextUsage ? { contextUsage } : {}),
      page: {
        limit,
        beforeCursor: hasOlder && entries.length > 0 ? entries[0].sequence : null,
        hasOlder,
      },
    };
  }

  async latestThreadMessageTimestamps(threadIds: string[]): Promise<Map<string, string>> {
    const uniqueThreadIds = [...new Set(threadIds.map((id) => String(id).trim()).filter(Boolean))];
    const timestamps = new Map<string, string>();
    const chunkSize = 500;
    for (let offset = 0; offset < uniqueThreadIds.length; offset += chunkSize) {
      const chunk = uniqueThreadIds.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `
        SELECT bindings.thread_id, entries.entry_json
        FROM assistant_blip_thread_bindings AS bindings
        JOIN assistant_blip_entries AS entries
          ON entries.session_id = bindings.session_id
          AND entries.sequence = (
            SELECT latest.sequence
            FROM assistant_blip_entries AS latest
            WHERE latest.session_id = bindings.session_id
              AND json_extract(latest.entry_json, '$.type') = 'message'
            ORDER BY latest.sequence DESC
            LIMIT 1
          )
        WHERE bindings.thread_id IN (${placeholders})
      `,
        )
        .all(...chunk) as Array<{ thread_id: string; entry_json: string }>;
      for (const row of rows) {
        try {
          const entry = JSON.parse(row.entry_json) as { timestamp?: unknown };
          const timestamp = String(entry.timestamp ?? '').trim();
          if (Number.isFinite(Date.parse(timestamp))) timestamps.set(row.thread_id, timestamp);
        } catch {
          // Ignore a malformed historical entry instead of breaking the drone list.
        }
      }
    }
    return timestamps;
  }

  async readThreadMessage(threadId: string, entryId: string): Promise<Record<string, unknown>> {
    const sessionId = await this.sessionIdForThread(threadId);
    if (!sessionId) throw new Error(`unknown Hub assistant session for thread: ${threadId}`);
    const row = this.db
      .prepare(
        `
      SELECT sequence, entry_json
      FROM assistant_blip_entries
      WHERE session_id = ?
        AND json_extract(entry_json, '$.type') = 'message'
        AND json_extract(entry_json, '$.id') = ?
    `,
      )
      .get(sessionId, entryId) as { sequence?: number; entry_json?: string } | undefined;
    if (!row?.entry_json) throw new Error(`unknown assistant message: ${entryId}`);
    const entry = JSON.parse(row.entry_json) as Extract<TranscriptEntry, { type: 'message' }>;
    return {
      sequence: Number(row.sequence),
      id: entry.id,
      timestamp: entry.timestamp,
      message: entry.message,
    };
  }

  async deleteThreadMessage(
    threadId: string,
    entryId: string,
    deleteFollowing: boolean,
  ): Promise<void> {
    const sessionId = await this.sessionIdForThread(threadId);
    if (!sessionId) throw new Error(`unknown Hub assistant session for thread: ${threadId}`);
    const target = this.db
      .prepare(
        `
      SELECT sequence, entry_json
      FROM assistant_blip_entries
      WHERE session_id = ?
        AND json_extract(entry_json, '$.type') = 'message'
        AND json_extract(entry_json, '$.id') = ?
    `,
      )
      .get(sessionId, entryId) as { sequence?: number; entry_json?: string } | undefined;
    const sequence = Number(target?.sequence);
    if (!Number.isSafeInteger(sequence)) throw new Error(`unknown assistant message: ${entryId}`);
    let dependentToolCallIds = new Set<string>();
    try {
      const selected = JSON.parse(String(target?.entry_json ?? ''))?.message;
      if (selected?.role === 'assistant' && Array.isArray(selected.content)) {
        dependentToolCallIds = new Set(
          selected.content
            .filter((part: any) => part?.type === 'toolCall')
            .map((part: any) => String(part.id ?? '').trim())
            .filter(Boolean),
        );
      } else if (selected?.role === 'toolResult') {
        const toolCallId = String(selected.toolCallId ?? '').trim();
        if (toolCallId) dependentToolCallIds.add(toolCallId);
      }
    } catch {
      // The target row itself is still safe to delete if its optional tool metadata is malformed.
    }

    const remove = () => {
      if (deleteFollowing) {
        this.db
          .prepare('DELETE FROM assistant_blip_entries WHERE session_id = ? AND sequence >= ?')
          .run(sessionId, sequence);
      } else {
        this.db
          .prepare('DELETE FROM assistant_blip_entries WHERE session_id = ? AND sequence = ?')
          .run(sessionId, sequence);
        if (dependentToolCallIds.size > 0) {
          const laterMessages = this.db
            .prepare(
              `
            SELECT sequence, entry_json
            FROM assistant_blip_entries
            WHERE session_id = ?
              AND sequence > ?
              AND json_extract(entry_json, '$.type') = 'message'
          `,
            )
            .all(sessionId, sequence) as Array<{ sequence: number; entry_json: string }>;
          const removeEntry = this.db.prepare(
            'DELETE FROM assistant_blip_entries WHERE session_id = ? AND sequence = ?',
          );
          for (const row of laterMessages) {
            try {
              const message = JSON.parse(row.entry_json)?.message;
              if (
                message?.role === 'toolResult' &&
                dependentToolCallIds.has(String(message.toolCallId ?? '').trim())
              ) {
                removeEntry.run(sessionId, row.sequence);
              }
            } catch {
              // Leave unrelated malformed history untouched.
            }
          }
        }
        // A later compaction may summarize the removed message. Drop only affected compactions so
        // deleted content cannot survive invisibly in model context.
        this.db
          .prepare(
            `
          DELETE FROM assistant_blip_entries
          WHERE session_id = ?
            AND sequence > ?
            AND json_extract(entry_json, '$.type') = 'compaction'
        `,
          )
          .run(sessionId, sequence);
      }
      if (dependentToolCallIds.size > 0) {
        const suspensionRows = this.db
          .prepare(
            `
          SELECT sequence, entry_json
          FROM assistant_blip_entries
          WHERE session_id = ?
            AND json_extract(entry_json, '$.type') = 'tool_suspension'
        `,
          )
          .all(sessionId) as Array<{ sequence: number; entry_json: string }>;
        const removeEntry = this.db.prepare(
          'DELETE FROM assistant_blip_entries WHERE session_id = ? AND sequence = ?',
        );
        for (const row of suspensionRows) {
          try {
            const toolCallId = String(
              JSON.parse(row.entry_json)?.suspension?.toolCallId ?? '',
            ).trim();
            if (dependentToolCallIds.has(toolCallId)) removeEntry.run(sessionId, row.sequence);
          } catch {
            // Leave unrelated malformed durable records untouched.
          }
        }
      }

      const row = this.db
        .prepare('SELECT metadata_json FROM assistant_blip_sessions WHERE id = ?')
        .get(sessionId) as { metadata_json?: string } | undefined;
      if (!row?.metadata_json) return;
      const state = JSON.parse(row.metadata_json) as BlipSessionState;
      const latestCompaction = this.db
        .prepare(
          `
        SELECT entry_json
        FROM assistant_blip_entries
        WHERE session_id = ? AND json_extract(entry_json, '$.type') = 'compaction'
        ORDER BY sequence DESC
        LIMIT 1
      `,
        )
        .get(sessionId) as { entry_json?: string } | undefined;
      if (latestCompaction?.entry_json) {
        state.compactedSummary = String(JSON.parse(latestCompaction.entry_json)?.summary ?? '');
      } else {
        delete state.compactedSummary;
      }
      state.updatedAt = nowIso();
      this.db
        .prepare(
          'UPDATE assistant_blip_sessions SET metadata_json = ?, updated_at = ? WHERE id = ?',
        )
        .run(JSON.stringify(state), state.updatedAt, sessionId);
    };
    if (this.db.transaction) this.db.transaction(remove)();
    else remove();
  }

  async bindThread(threadId: string, sessionId: string): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO assistant_blip_thread_bindings (thread_id, session_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET session_id = excluded.session_id
    `,
      )
      .run(threadId, sessionId, nowIso());
  }

  close(): void {
    this.db.close();
  }
}
