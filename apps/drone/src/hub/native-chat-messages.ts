import fs from 'node:fs';
import { createRequire } from 'node:module';
import { droneRootPath } from '../host/paths';
import { getHubDatabase } from '../host/hub-database';
import type { ActiveChatSearchResult } from './transcript-store';
import type { ChatSubscriptionStatus } from './subscriptions/resource-subscription-service';

type ReadDatabase = {
  prepare(sql: string): { all(...params: unknown[]): any[] };
  close(): void;
};

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

export function readNativeChatMessages(threadId: string, limit: number, maxChars: number) {
  const boundedLimit = Math.max(1, Math.min(40, Math.floor(limit) || 20));
  const boundedChars = Math.max(1, Math.min(8000, Math.floor(maxChars) || 4000));
  return withNativeHistory(
    {
      messages: [] as Array<{
        id: string;
        role: string;
        at: string;
        text: string;
        textOriginalLength: number;
        textTruncated: boolean;
      }>,
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
            role: String(row.role),
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

export function readNativeChatSubscriptionStatus(
  threadId: string,
  busy: boolean,
  canonical: ChatSubscriptionStatus,
): ChatSubscriptionStatus {
  if (busy) return { ...canonical, idle: false, reason: 'active_user_messages' };
  // A prompt may fail before a native session writes a message.
  if (canonical.reason === 'latest_user_failed') return canonical;
  const latest = readNativeChatMessages(threadId, 1, 8000).messages[0];
  return {
    idle: true,
    reason:
      latest?.role === 'error'
        ? 'latest_user_failed'
        : latest?.role === 'assistant'
          ? 'latest_agent_message'
          : latest
            ? 'latest_user_message'
            : 'no_messages',
    latest: latest
      ? {
          id: latest.id,
          at: latest.at,
          text: latest.text,
          role: latest.role === 'assistant' ? 'agent' : 'user',
          status: latest.role === 'error' ? 'failed' : 'completed',
        }
      : null,
  };
}

export function searchNativeChatMessages(opts: {
  query: string;
  droneId?: string;
  droneIds?: readonly string[];
  chatName?: string;
  limit: number;
}): ActiveChatSearchResult[] {
  const terms = opts.query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 20) ?? [];
  if (!terms.length || opts.droneIds?.length === 0) return [];
  const hub = getHubDatabase();
  if (!hub) return [];
  // Use current chat ownership, so archived/deleted chats and old agent bindings
  // cannot leak into search. The caller's authorized drone set applies first.
  const chats = hub.read((db) =>
    db
      .prepare(
        `
    SELECT drone_id AS droneId, chat_name AS chatName, json_extract(metadata_json, '$.id') AS threadId
    FROM canonical_chats
    WHERE json_extract(metadata_json, '$.agent.kind') = 'native'
      AND (? = '' OR drone_id = ?)
      AND (? IS NULL OR drone_id IN (SELECT value FROM json_each(?)))
      AND (? = '' OR chat_name = ?)
  `,
      )
      .all(
        opts.droneId ?? '',
        opts.droneId ?? '',
        opts.droneIds ? JSON.stringify(opts.droneIds) : null,
        opts.droneIds ? JSON.stringify(opts.droneIds) : null,
        opts.chatName ?? '',
        opts.chatName ?? '',
      ),
  );
  if (!chats.length) return [];
  return withNativeHistory([], (db) =>
    db
      .prepare(
        `
    WITH allowed AS (
      SELECT json_extract(value, '$.threadId') AS thread_id,
        json_extract(value, '$.droneId') AS drone_id, json_extract(value, '$.chatName') AS chat_name
      FROM json_each(?)
    ), visible AS (${visibleMessages})
    SELECT allowed.drone_id, allowed.chat_name, visible.id, visible.role, visible.timestamp,
      substr(text, max(1, instr(lower(text), lower(?)) - 80), 300) AS snippet
    FROM allowed JOIN visible ON visible.thread_id = allowed.thread_id
    WHERE ${terms.map(() => 'instr(lower(text), lower(?)) > 0').join(' AND ')}
    ORDER BY visible.timestamp DESC, visible.id LIMIT ?
  `,
      )
      .all(JSON.stringify(chats), terms[0], ...terms, opts.limit)
      .map((row) => ({
        droneId: String(row.drone_id),
        chatName: String(row.chat_name),
        turnId: String(row.id),
        role: row.role,
        timestamp: String(row.timestamp),
        snippet: String(row.snippet),
        rank: 0,
      })),
  );
}
