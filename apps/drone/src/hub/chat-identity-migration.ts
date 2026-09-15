import crypto from 'node:crypto';
import type { HubDatabaseConnection } from '../host/hub-database';

function hasTable(connection: HubDatabaseConnection, name: string): boolean {
  return Boolean(
    connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

/** Repair only known ownership relationships; an ID alone cannot disambiguate a clone. */
export function repairDuplicateChatIdentities(connection: HubDatabaseConnection): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS canonical_chat_identity_repairs (
      drone_id TEXT NOT NULL,
      original_chat_name TEXT NOT NULL,
      old_chat_id TEXT NOT NULL,
      new_chat_id TEXT NOT NULL,
      repaired_at TEXT NOT NULL,
      PRIMARY KEY (drone_id, original_chat_name, old_chat_id)
    );
  `);
  const droneJoin = hasTable(connection, 'hub_canonical_drones')
    ? 'LEFT JOIN hub_canonical_drones d ON d.drone_id = c.drone_id'
    : '';
  // Chat creation timestamps are themselves cloned. Prefer the original drone's timestamp.
  const createdAt = droneJoin
    ? "COALESCE(json_extract(d.lifecycle_json, '$.createdAt'), c.created_at, c.updated_at)"
    : 'COALESCE(c.created_at, c.updated_at)';
  const rows = connection
    .prepare(
      `
    SELECT c.drone_id, c.chat_name, c.metadata_json
    FROM canonical_chats c ${droneJoin}
    ORDER BY ${createdAt}, c.drone_id, c.chat_name
  `,
    )
    .all() as Array<{ drone_id: string; chat_name: string; metadata_json: string }>;
  const seen = new Set<string>();
  const now = new Date().toISOString();
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata_json);
    const oldId = typeof metadata.id === 'string' ? metadata.id.trim() : '';
    if (oldId && !seen.has(oldId)) {
      seen.add(oldId);
      continue;
    }
    const newId = crypto.randomUUID();
    seen.add(newId);
    connection
      .prepare(
        `UPDATE canonical_chats
      SET metadata_json = json_set(metadata_json, '$.id', ?), source_hash = '', updated_at = ?
      WHERE drone_id = ? AND chat_name = ?`,
      )
      .run(newId, now, row.drone_id, row.chat_name);
    connection
      .prepare(
        `INSERT INTO canonical_chat_identity_repairs
      (drone_id, original_chat_name, old_chat_id, new_chat_id, repaired_at)
      VALUES (?, ?, ?, ?, ?)`,
      )
      .run(row.drone_id, row.chat_name, oldId, newId, now);
    if (!oldId) continue;

    for (const table of ['resource_subscriptions', 'subscription_batches']) {
      if (!hasTable(connection, table)) continue;
      connection
        .prepare(
          `UPDATE ${table} SET subscriber_chat_id = ?
        WHERE subscriber_drone_id = ? AND subscriber_chat_name = ? AND subscriber_chat_id = ?`,
        )
        .run(newId, row.drone_id, row.chat_name, oldId);
    }
    for (const table of ['chat_question_requests', 'change_requests']) {
      if (!hasTable(connection, table)) continue;
      connection
        .prepare(
          `UPDATE ${table} SET chat_id = ?
        WHERE drone_id = ? AND chat_name = ? AND chat_id = ?`,
        )
        .run(newId, row.drone_id, row.chat_name, oldId);
    }
    if (hasTable(connection, 'drone_workflow_invocations')) {
      const columns = connection
        .prepare('PRAGMA table_info(drone_workflow_invocations)')
        .all() as Array<{ name: string }>;
      const owner = columns.some((column) => column.name === 'execution_drone_id')
        ? 'COALESCE(execution_drone_id, drone_id)'
        : 'drone_id';
      connection
        .prepare(
          `UPDATE drone_workflow_invocations SET chat_id = ?
        WHERE ${owner} = ? AND last_chat_name = ? AND chat_id = ?`,
        )
        .run(newId, row.drone_id, row.chat_name, oldId);
    }
    if (hasTable(connection, 'resource_subscriptions')) {
      connection
        .prepare(
          `UPDATE resource_subscriptions SET resource_id = ?
        WHERE provider = 'drone-hub' AND resource_type = 'chat' AND resource_id = ?
          AND json_extract(cursor_json, '$.targetDroneId') = ?
          AND json_extract(cursor_json, '$.targetChatName') = ?`,
        )
        .run(newId, oldId, row.drone_id, row.chat_name);
    }
  }
  connection.exec(`CREATE UNIQUE INDEX idx_canonical_chats_unique_id
    ON canonical_chats (trim(json_extract(metadata_json, '$.id')));
    CREATE TRIGGER canonical_chats_require_id_insert
    BEFORE INSERT ON canonical_chats
    WHEN json_type(NEW.metadata_json, '$.id') IS NOT 'text'
      OR trim(json_extract(NEW.metadata_json, '$.id')) = ''
    BEGIN SELECT RAISE(ABORT, 'canonical chat requires an identity'); END;
    CREATE TRIGGER canonical_chats_require_id_update
    BEFORE UPDATE OF metadata_json ON canonical_chats
    WHEN json_type(NEW.metadata_json, '$.id') IS NOT 'text'
      OR trim(json_extract(NEW.metadata_json, '$.id')) = ''
    BEGIN SELECT RAISE(ABORT, 'canonical chat requires an identity'); END;
  `);
}

/** Signed pre-repair credentials remain scoped to their original drone and chat. */
export function resolveRepairedChatIdentity(
  connection: HubDatabaseConnection,
  droneId: string,
  chatName: string,
  oldId: string,
): string {
  if (!hasTable(connection, 'canonical_chat_identity_repairs')) return oldId;
  const row = connection
    .prepare(
      `SELECT new_chat_id FROM canonical_chat_identity_repairs
    WHERE drone_id = ? AND original_chat_name = ? AND old_chat_id = ?`,
    )
    .get(droneId, chatName, oldId) as { new_chat_id: string } | undefined;
  return row?.new_chat_id ?? oldId;
}
