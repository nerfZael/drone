import fs from 'node:fs';
import { createRequire } from 'node:module';
import { droneRootPath } from '../host/paths';
import type { ChatVisibleMessage } from './chat-read/helpers/chat-read-model';

type ReadDatabase = {
  prepare(sql: string): { all(...params: unknown[]): any[] };
  exec(sql: string): void;
  close(): void;
};

export type NativeHistoryCursor = { sessionId: string; sequence: number; count: number };
export type NativeHistorySearchRow = { id: string; role: string; timestamp: string; text: string };

export function readNativeChatMessages(threadId: string, limit: number, maxChars: number) {
  const boundedLimit = Math.max(1, Math.min(40, Math.floor(limit) || 20));
  const boundedChars = Math.max(1, Math.min(8000, Math.floor(maxChars) || 4000));
  return withNativeHistory(
    {
      messages: [] as ChatVisibleMessage[],
      hasOlder: false,
    },
    (db) => {
      const rows = db
        .prepare(
          `WITH visible AS (${visibleMessages})
      SELECT id, role, timestamp, substr(text, 1, ?) AS text, length(text) AS original_length
      FROM visible WHERE thread_id = ? AND trim(text) != ''
      ORDER BY sequence DESC LIMIT ?
    `,
        )
        .all(boundedChars, threadId, boundedLimit + 1);
      return {
        messages: rows
          .slice(0, boundedLimit)
          .reverse()
          .map((row) => ({
            id: String(row.id),
            role: String(row.role) as ChatVisibleMessage['role'],
            status: row.role === 'error' ? ('failed' as const) : ('completed' as const),
            at: String(row.timestamp),
            text: String(row.text),
            textOriginalLength: Number(row.original_length),
            textTruncated: Number(row.original_length) > boundedChars,
          })),
        hasOlder: rows.length > boundedLimit,
      };
    },
  );
}

/** A persisted-history snapshot: append incrementally, rebuild after rollback, deletion or rebinding. */
export function readNativeHistoryChanges(threadId: string, cursor?: NativeHistoryCursor) {
  const empty = {
    sessionId: '',
    sequence: 0,
    count: 0,
    replace: true,
    rows: [] as NativeHistorySearchRow[],
  };
  return withNativeHistory(empty, (db) => {
    db.exec('BEGIN');
    try {
      const binding = db
        .prepare('SELECT session_id FROM assistant_blip_thread_bindings WHERE thread_id = ?')
        .all(threadId)[0];
      if (!binding) return empty;
      const sessionId = String(binding.session_id);
      const stat = db
        .prepare(
          `SELECT count(*) AS count, COALESCE(max(sequence), 0) AS sequence,
        COALESCE(sum(sequence > ?), 0) AS appended FROM assistant_blip_entries WHERE session_id = ?`,
        )
        .all(cursor?.sequence ?? 0, sessionId)[0];
      // Deletes can occur in the middle of history; a high-water mark alone would retain stale answers.
      const replace =
        !cursor ||
        cursor.sessionId !== sessionId ||
        Number(stat.count) - cursor.count !== Number(stat.appended) ||
        Number(stat.sequence) < cursor.sequence;
      const after = replace ? 0 : cursor.sequence;
      const rows = db
        .prepare(
          `WITH visible AS (${visibleMessages})
        SELECT id, role, timestamp, text FROM visible WHERE thread_id = ? AND sequence > ? AND trim(text) != ''
        ORDER BY sequence`,
        )
        .all(threadId, after) as NativeHistorySearchRow[];
      return {
        sessionId,
        sequence: Number(stat.sequence),
        count: Number(stat.count),
        replace,
        rows,
      };
    } finally {
      db.exec('ROLLBACK');
    }
  });
}

function withNativeHistory<T>(empty: T, read: (db: ReadDatabase) => T): T {
  const filename = droneRootPath('assistant-blip.sqlite');
  if (!fs.existsSync(filename)) return empty;
  const require = createRequire(__filename);
  const db: ReadDatabase = (globalThis as any).Bun
    ? new (require('bun:sqlite').Database)(filename, { readonly: true })
    : new (require('better-sqlite3'))(filename, { readonly: true, fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

// Project only visible messages, never tool results, reasoning, images, or
// compaction summaries. Read persisted history, not the compacted model context.
const visibleMessages = `
  SELECT entries.sequence, COALESCE(json_extract(entries.entry_json, '$.timestamp'), entries.created_at) AS timestamp,
    json_extract(entries.entry_json, '$.id') AS id,
    CASE WHEN json_extract(entries.entry_json, '$.message.stopReason') = 'error'
      THEN 'error' ELSE json_extract(entries.entry_json, '$.message.role') END AS role,
    COALESCE(CASE json_type(entries.entry_json, '$.message.content')
      WHEN 'text' THEN json_extract(entries.entry_json, '$.message.content')
      WHEN 'array' THEN (
        SELECT group_concat(json_extract(part.value, '$.text'), char(10))
        FROM json_each(entries.entry_json, '$.message.content') AS part
        WHERE json_extract(part.value, '$.type') = 'text'
      ) END, '') ||
    CASE WHEN json_extract(entries.entry_json, '$.message.stopReason') = 'error'
      THEN COALESCE(json_extract(entries.entry_json, '$.message.errorMessage'), '')
      ELSE '' END AS text,
    bindings.thread_id
  FROM assistant_blip_thread_bindings AS bindings
  JOIN assistant_blip_entries AS entries ON entries.session_id = bindings.session_id
  WHERE json_extract(entries.entry_json, '$.type') = 'message'
    AND json_extract(entries.entry_json, '$.message.role') IN ('user', 'assistant')
`;
