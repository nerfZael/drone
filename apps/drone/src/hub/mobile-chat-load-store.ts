import { normalizeMobileChatLoad } from '@drone/device-protocol';
import { applyHubDatabaseMigrations, getHubDatabase, type HubDatabase } from '../host/hub-database';

export class MobileChatLoadStore {
  constructor(private readonly database: HubDatabase) {
    database.read((connection) =>
      applyHubDatabaseMigrations(
        connection,
        [
          {
            version: 1,
            name: 'mobile chat load diagnostics',
            migrate(db) {
              db.exec(`CREATE TABLE mobile_chat_loads (
          source_device_id TEXT NOT NULL, navigation_id TEXT NOT NULL,
          target_device_id TEXT NOT NULL, drone_id TEXT NOT NULL, chat_name TEXT NOT NULL,
          started_at TEXT NOT NULL, received_at TEXT NOT NULL, payload_json TEXT NOT NULL,
          PRIMARY KEY (source_device_id, navigation_id));
          CREATE INDEX mobile_chat_loads_recent ON mobile_chat_loads(started_at DESC);
          CREATE INDEX mobile_chat_loads_device ON mobile_chat_loads(source_device_id, started_at DESC);`);
            },
          },
        ],
        'mobile-chat-loads',
      ),
    );
  }
  async upload(sourceDeviceId: string, raw: unknown) {
    if (!Array.isArray(raw) || raw.length > 10)
      throw new Error('Expected at most 10 chat load records');
    const records = raw.map(normalizeMobileChatLoad);
    if (records.some((r) => !r)) throw new Error('Invalid chat load record');
    await this.database.writeTransaction('mobile chat load diagnostics', (db) => {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO mobile_chat_loads VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of records)
        if (r)
          insert.run(
            sourceDeviceId,
            r.navigationId,
            r.targetDeviceId,
            r.droneId,
            r.chatName,
            r.startedAt,
            new Date().toISOString(),
            JSON.stringify(r),
          );
      db.prepare(`DELETE FROM mobile_chat_loads WHERE received_at < ?`).run(
        new Date(Date.now() - 30 * 86_400_000).toISOString(),
      );
      db.prepare(
        `DELETE FROM mobile_chat_loads WHERE rowid IN (SELECT rowid FROM mobile_chat_loads WHERE source_device_id = ? ORDER BY received_at DESC, rowid DESC LIMIT -1 OFFSET 2000)`,
      ).run(sourceDeviceId);
      db.prepare(
        `DELETE FROM mobile_chat_loads WHERE rowid IN (SELECT rowid FROM mobile_chat_loads ORDER BY received_at DESC, rowid DESC LIMIT -1 OFFSET 10000)`,
      ).run();
    });
    return { accepted: records.map((r) => r!.navigationId) };
  }
  list(filters: {
    deviceId?: string;
    droneId?: string;
    chatName?: string;
    requestId?: string;
    since?: string;
    limit?: number;
  }) {
    const limit = Math.max(1, Math.min(200, Math.floor(Number(filters.limit) || 20)));
    const since = filters.since ? new Date(filters.since).toISOString() : '';
    return this.database.read((db) => {
      const rows = db
        .prepare(
          `SELECT source_device_id, received_at, payload_json FROM mobile_chat_loads
        WHERE (? = '' OR source_device_id = ?) AND (? = '' OR drone_id = ?) AND (? = '' OR chat_name = ?)
        AND (? = '' OR started_at >= ?)
        AND (? = '' OR EXISTS (SELECT 1 FROM json_each(payload_json, '$.requests') WHERE json_extract(value, '$.requestId') = ? OR json_extract(value, '$.serverRequestId') = ?))
        ORDER BY started_at DESC LIMIT ?`,
        )
        .all(
          filters.deviceId ?? '',
          filters.deviceId ?? '',
          filters.droneId ?? '',
          filters.droneId ?? '',
          filters.chatName ?? '',
          filters.chatName ?? '',
          since,
          since,
          filters.requestId ?? '',
          filters.requestId ?? '',
          filters.requestId ?? '',
          limit,
        ) as any[];
      return rows.map((r) => ({
        ...JSON.parse(r.payload_json),
        sourceDeviceId: r.source_device_id,
        receivedAt: r.received_at,
      }));
    });
  }
}
const stores = new WeakMap<HubDatabase, MobileChatLoadStore>();
export function mobileChatLoadStore(): MobileChatLoadStore {
  const db = getHubDatabase();
  if (!db) throw new Error('Hub database unavailable');
  let store = stores.get(db);
  if (!store) {
    store = new MobileChatLoadStore(db);
    stores.set(db, store);
  }
  return store;
}
