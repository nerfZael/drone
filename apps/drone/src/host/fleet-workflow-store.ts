import {
  applyHubDatabaseMigrations,
  requireHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from './hub-database';
import { appendHubOutboxEvent, initializeHubOutbox } from './hub-outbox';

const MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'canonical fleet workflows',
    migrate(connection) {
      connection.exec(`
      CREATE TABLE workflow_sync_sets (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, source_type TEXT NOT NULL,
        source_path TEXT, target_path TEXT NOT NULL, apply_to_host INTEGER NOT NULL,
        record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
      );
      CREATE TABLE workflow_playbook_queue (
        id TEXT PRIMARY KEY, playbook_id TEXT NOT NULL, repo_path TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','running','completed','cancelled','failed')),
        requested_count INTEGER NOT NULL, launched_count INTEGER NOT NULL, in_flight_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
      );
      CREATE INDEX workflow_playbook_queue_dispatch ON workflow_playbook_queue(state,created_at,id);
      CREATE TABLE workflow_fleet_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
        at TEXT NOT NULL, actor TEXT NOT NULL, actor_name TEXT NOT NULL,
        action TEXT NOT NULL, target TEXT, target_name TEXT, status TEXT NOT NULL,
        reason TEXT, meta_json TEXT NOT NULL
      );
      CREATE INDEX workflow_fleet_audit_actor_time ON workflow_fleet_audit(actor,at DESC,sequence DESC);
      CREATE TABLE workflow_backfills (domain TEXT PRIMARY KEY, completed_at TEXT NOT NULL);
    `);
    },
  },
  {
    version: 2,
    name: 'remove obsolete orchestration audit',
    legacyNames: ['remove obsolete fleet audit'],
    migrate(connection) {
      connection.exec(`
        DROP INDEX IF EXISTS workflow_fleet_audit_actor_time;
        DROP TABLE IF EXISTS workflow_fleet_audit;
      `);
    },
  },
  {
    version: 3,
    name: 'remove retired playbook workflow',
    migrate(connection) {
      connection.exec(`
        DROP INDEX IF EXISTS workflow_playbook_queue_dispatch;
        DROP TABLE IF EXISTS workflow_playbook_queue;
      `);
      connection.prepare("DELETE FROM workflow_backfills WHERE domain = 'playbook-queue'").run();
    },
  },
];

export type WorkflowSyncSet = {
  id: string;
  label: string;
  sourceType: string;
  sourcePath?: string | null;
  targetPath: string;
  applyToHost: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};
function json(value: unknown): string {
  const out = JSON.stringify(value);
  if (out === undefined) throw new Error('workflow value must be JSON serializable');
  return out;
}
function parse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export class FleetWorkflowStore {
  private constructor(private readonly database: HubDatabase) {}
  static async open(database: HubDatabase = requireHubDatabase()): Promise<FleetWorkflowStore> {
    initializeHubOutbox(database);
    database.read((connection) =>
      applyHubDatabaseMigrations(connection, MIGRATIONS, 'fleet-workflows'),
    );
    return new FleetWorkflowStore(database);
  }

  listSyncSets<T extends WorkflowSyncSet>(): T[] {
    return this.database.read((c) =>
      (
        c
          .prepare(
            'SELECT record_json FROM workflow_sync_sets WHERE deleted_at IS NULL ORDER BY created_at,id',
          )
          .all() as any[]
      ).map((r) => parse<T>(r.record_json)),
    );
  }
  backfillSyncSets<T extends WorkflowSyncSet>(records: T[]): Promise<boolean> {
    return this.database.writeTransaction('backfill sync sets', (c) => {
      if (this.backfilled(c, 'sync-sets')) return false;
      const insert = c.prepare(`INSERT OR IGNORE INTO workflow_sync_sets
        (id,label,source_type,source_path,target_path,apply_to_host,record_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const r of records)
        insert.run(
          r.id,
          r.label,
          r.sourceType,
          r.sourcePath ?? null,
          r.targetPath,
          r.applyToHost ? 1 : 0,
          json(r),
          r.createdAt,
          r.updatedAt,
        );
      this.finishBackfill(c, 'sync-sets');
      return true;
    });
  }
  putSyncSet<T extends WorkflowSyncSet>(record: T): Promise<T> {
    return this.database.writeTransaction('write sync set', (c) => {
      const current = c
        .prepare('SELECT 1 FROM workflow_sync_sets WHERE id=? AND deleted_at IS NULL')
        .get(record.id);
      c.prepare(
        `INSERT INTO workflow_sync_sets
        (id,label,source_type,source_path,target_path,apply_to_host,record_json,created_at,updated_at,version,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,1,NULL)
        ON CONFLICT(id) DO UPDATE SET label=excluded.label,source_type=excluded.source_type,source_path=excluded.source_path,
        target_path=excluded.target_path,apply_to_host=excluded.apply_to_host,record_json=excluded.record_json,
        updated_at=excluded.updated_at,version=workflow_sync_sets.version+1,deleted_at=NULL`,
      ).run(
        record.id,
        record.label,
        record.sourceType,
        record.sourcePath ?? null,
        record.targetPath,
        record.applyToHost ? 1 : 0,
        json(record),
        record.createdAt,
        record.updatedAt,
      );
      appendHubOutboxEvent(c, {
        topic: 'fleet.workflows',
        eventType: current ? 'sync-set.updated' : 'sync-set.created',
        aggregateType: 'sync-set',
        aggregateId: record.id,
        payload: { id: record.id, updatedAt: record.updatedAt },
      });
      return record;
    });
  }
  updateSyncSet<T extends WorkflowSyncSet>(
    id: string,
    transform: (current: T) => T,
  ): Promise<T | null> {
    return this.database.writeTransaction('update sync set', (c) => {
      const row = c
        .prepare('SELECT record_json FROM workflow_sync_sets WHERE id=? AND deleted_at IS NULL')
        .get(id) as any;
      if (!row) return null;
      const next = transform(parse<T>(row.record_json));
      c.prepare(
        `UPDATE workflow_sync_sets SET label=?,source_type=?,source_path=?,target_path=?,apply_to_host=?,record_json=?,updated_at=?,version=version+1 WHERE id=? AND deleted_at IS NULL`,
      ).run(
        next.label,
        next.sourceType,
        next.sourcePath ?? null,
        next.targetPath,
        next.applyToHost ? 1 : 0,
        json(next),
        next.updatedAt,
        id,
      );
      appendHubOutboxEvent(c, {
        topic: 'fleet.workflows',
        eventType: 'sync-set.updated',
        aggregateType: 'sync-set',
        aggregateId: id,
        payload: { id, updatedAt: next.updatedAt },
      });
      return next;
    });
  }
  deleteSyncSet(id: string, at = new Date().toISOString()): Promise<boolean> {
    return this.database.writeTransaction('delete sync set', (c) => {
      const info = c
        .prepare(
          'UPDATE workflow_sync_sets SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND deleted_at IS NULL',
        )
        .run(at, at, id);
      if (!info.changes) return false;
      appendHubOutboxEvent(c, {
        topic: 'fleet.workflows',
        eventType: 'sync-set.deleted',
        aggregateType: 'sync-set',
        aggregateId: id,
        payload: { id, deletedAt: at },
      });
      return true;
    });
  }

  private backfilled(c: HubDatabaseConnection, d: string) {
    return Boolean(c.prepare('SELECT 1 FROM workflow_backfills WHERE domain=?').get(d));
  }
  private finishBackfill(c: HubDatabaseConnection, d: string) {
    c.prepare('INSERT INTO workflow_backfills(domain,completed_at)VALUES(?,?)').run(
      d,
      new Date().toISOString(),
    );
  }
}

let cached: { database: HubDatabase; store: Promise<FleetWorkflowStore> } | null = null;
export function getFleetWorkflowStore(): Promise<FleetWorkflowStore> {
  const database = requireHubDatabase();
  if (cached?.database === database) return cached.store;
  const store = FleetWorkflowStore.open(database).catch((e) => {
    if (cached?.database === database) cached = null;
    throw e;
  });
  cached = { database, store };
  return store;
}
