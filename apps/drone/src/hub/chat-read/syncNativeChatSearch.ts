import type { HubDatabase } from '../../host/hub-database';
import { readNativeHistoryChanges } from '../native-chat-messages';

type Scope = { droneIds?: readonly string[]; droneId?: string; chatName?: string };
type IndexedChat = {
  drone_id: string;
  chat_name: string;
  thread_id: string;
  session_id: string | null;
  sequence: number | null;
  entry_count: number | null;
};

/** Refresh authorized active chats before querying the shared FTS index. No background worker or dual write. */
export async function syncNativeChatSearch(database: HubDatabase, scope: Scope): Promise<void> {
  // Reading the cursor and source inside the queued operation serializes concurrent searches.
  await database.writeTransaction('refresh native chat search', (db) => {
    const chats = db
      .prepare(
        `
      SELECT c.drone_id, c.chat_name, json_extract(c.metadata_json, '$.id') AS thread_id,
        cursor.session_id, cursor.sequence, cursor.entry_count
      FROM canonical_chats c LEFT JOIN native_chat_search_cursors cursor
        ON cursor.drone_id = c.drone_id AND cursor.chat_name = c.chat_name
      WHERE json_extract(c.metadata_json, '$.agent.kind') = 'native'
        AND (? = '' OR c.drone_id = ?)
        AND (? IS NULL OR c.drone_id IN (SELECT value FROM json_each(?)))
        AND (? = '' OR c.chat_name = ?)
    `,
      )
      .all(
        scope.droneId ?? '',
        scope.droneId ?? '',
        scope.droneIds ? JSON.stringify(scope.droneIds) : null,
        scope.droneIds ? JSON.stringify(scope.droneIds) : null,
        scope.chatName ?? '',
        scope.chatName ?? '',
      ) as IndexedChat[];
    const insert = db.prepare(`INSERT INTO active_chat_message_search
      (drone_id, chat_name, turn_id, role, timestamp, content, source) VALUES (?, ?, ?, ?, ?, ?, 'native')`);
    const save = db.prepare(`INSERT INTO native_chat_search_cursors
      (drone_id, chat_name, thread_id, session_id, sequence, entry_count) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name) DO UPDATE SET thread_id=excluded.thread_id,
        session_id=excluded.session_id, sequence=excluded.sequence, entry_count=excluded.entry_count`);
    for (const chat of chats) {
      if (!chat.thread_id) continue;
      const cursor =
        chat.session_id === null
          ? undefined
          : {
              sessionId: chat.session_id,
              sequence: Number(chat.sequence),
              count: Number(chat.entry_count),
            };
      const changes = readNativeHistoryChanges(chat.thread_id, cursor);
      if (changes.replace) {
        db.prepare(
          `DELETE FROM active_chat_message_search WHERE drone_id = ? AND chat_name = ? AND source = 'native'`,
        ).run(chat.drone_id, chat.chat_name);
      }
      for (const row of changes.rows)
        insert.run(chat.drone_id, chat.chat_name, row.id, row.role, row.timestamp, row.text);
      if (
        changes.replace ||
        changes.sequence !== cursor?.sequence ||
        changes.count !== cursor?.count
      ) {
        save.run(
          chat.drone_id,
          chat.chat_name,
          chat.thread_id,
          changes.sessionId,
          changes.sequence,
          changes.count,
        );
      }
    }
  });
}
