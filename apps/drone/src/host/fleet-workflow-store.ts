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
  {
    version: 4,
    name: 'normalize sync set target status',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE workflow_sync_set_targets (
          sync_set_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_kind TEXT NOT NULL CHECK(target_kind IN ('drone','host')),
          state TEXT NOT NULL CHECK(state IN ('idle','synced','error')),
          applied_version_id TEXT,
          applied_at TEXT,
          error TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(sync_set_id,target_id),
          FOREIGN KEY(sync_set_id) REFERENCES workflow_sync_sets(id) ON DELETE CASCADE
        );
        CREATE INDEX workflow_sync_set_targets_target
          ON workflow_sync_set_targets(target_id,sync_set_id);
      `);
      const rows = connection
        .prepare('SELECT id,record_json,updated_at FROM workflow_sync_sets')
        .all() as Array<{ id: string; record_json: string; updated_at: string }>;
      const insert = connection.prepare(`INSERT INTO workflow_sync_set_targets
        (sync_set_id,target_id,target_kind,state,applied_version_id,applied_at,error,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`);
      const update = connection.prepare(
        'UPDATE workflow_sync_sets SET record_json=? WHERE id=?',
      );
      for (const row of rows) {
        const record = parse<Record<string, any>>(row.record_json);
        const statuses =
          record.targetStatus && typeof record.targetStatus === 'object'
            ? record.targetStatus
            : {};
        for (const [targetId, raw] of Object.entries(statuses)) {
          const status = raw as Record<string, unknown>;
          const targetKind = status.targetKind === 'host' ? 'host' : 'drone';
          const state =
            status.state === 'synced' || status.state === 'error' ? status.state : 'idle';
          insert.run(
            row.id,
            targetId,
            targetKind,
            state,
            status.appliedVersionId ?? null,
            status.appliedAt ?? null,
            status.error ?? null,
            row.updated_at,
          );
        }
        record.targetStatus = {};
        update.run(json(record), row.id);
      }
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
export type WorkflowSyncSetTargetStatus = {
  targetKind: 'drone' | 'host';
  state: 'idle' | 'synced' | 'error';
  appliedVersionId: string | null;
  appliedAt: string | null;
  error: string | null;
};
function json(value: unknown): string {
  const out = JSON.stringify(value);
  if (out === undefined) throw new Error('workflow value must be JSON serializable');
  return out;
}
function parse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function splitSyncSetRecord<T extends WorkflowSyncSet>(record: T): {
  definition: T;
  targetStatus: Record<string, WorkflowSyncSetTargetStatus>;
} {
  // Validate the complete caller value before removing the separately stored
  // target map. This preserves the previous rejection of cyclic/non-JSON data.
  json(record);
  const targetStatus =
    record.targetStatus && typeof record.targetStatus === 'object'
      ? (record.targetStatus as Record<string, WorkflowSyncSetTargetStatus>)
      : {};
  return {
    definition: { ...record, targetStatus: {} },
    targetStatus,
  };
}

function readTargetStatuses(
  connection: HubDatabaseConnection,
): Map<string, Record<string, WorkflowSyncSetTargetStatus>> {
  const rows = connection
    .prepare(
      `SELECT sync_set_id,target_id,target_kind,state,applied_version_id,applied_at,error
       FROM workflow_sync_set_targets`,
    )
    .all() as Array<{
    sync_set_id: string;
    target_id: string;
    target_kind: 'drone' | 'host';
    state: 'idle' | 'synced' | 'error';
    applied_version_id: string | null;
    applied_at: string | null;
    error: string | null;
    }>;
  const bySyncSet = new Map<string, Record<string, WorkflowSyncSetTargetStatus>>();
  for (const row of rows) {
    let statuses = bySyncSet.get(row.sync_set_id);
    if (!statuses) {
      statuses = {};
      bySyncSet.set(row.sync_set_id, statuses);
    }
    statuses[row.target_id] = {
      targetKind: row.target_kind,
      state: row.state,
      appliedVersionId: row.applied_version_id,
      appliedAt: row.applied_at,
      error: row.error,
    };
  }
  return bySyncSet;
}

function readTargetStatusForSyncSet(
  connection: HubDatabaseConnection,
  syncSetId: string,
): Record<string, WorkflowSyncSetTargetStatus> {
  const rows = connection
    .prepare(
      `SELECT target_id,target_kind,state,applied_version_id,applied_at,error
       FROM workflow_sync_set_targets WHERE sync_set_id=?`,
    )
    .all(syncSetId) as Array<{
    target_id: string;
    target_kind: 'drone' | 'host';
    state: 'idle' | 'synced' | 'error';
    applied_version_id: string | null;
    applied_at: string | null;
    error: string | null;
  }>;
  return Object.fromEntries(
    rows.map((row) => [
      row.target_id,
      {
        targetKind: row.target_kind,
        state: row.state,
        appliedVersionId: row.applied_version_id,
        appliedAt: row.applied_at,
        error: row.error,
      },
    ]),
  );
}

function replaceTargetStatuses(
  connection: HubDatabaseConnection,
  syncSetId: string,
  statuses: Record<string, WorkflowSyncSetTargetStatus>,
  updatedAt: string,
): void {
  connection.prepare('DELETE FROM workflow_sync_set_targets WHERE sync_set_id=?').run(syncSetId);
  const insert = connection.prepare(`INSERT INTO workflow_sync_set_targets
    (sync_set_id,target_id,target_kind,state,applied_version_id,applied_at,error,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (const [targetId, status] of Object.entries(statuses)) {
    insert.run(
      syncSetId,
      targetId,
      status.targetKind,
      status.state,
      status.appliedVersionId ?? null,
      status.appliedAt ?? null,
      status.error ?? null,
      updatedAt,
    );
  }
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
    return this.database.read((c) => {
      const rows = c
        .prepare(
          'SELECT id,record_json FROM workflow_sync_sets WHERE deleted_at IS NULL ORDER BY created_at,id',
        )
        .all() as Array<{ id: string; record_json: string }>;
      const statuses = readTargetStatuses(c);
      return rows.map((row) => ({
        ...parse<T>(row.record_json),
        targetStatus: statuses.get(row.id) ?? {},
      }));
    });
  }
  listSyncSetDefinitions<T extends WorkflowSyncSet>(): T[] {
    return this.database.read((c) =>
      (
        c
          .prepare(
            'SELECT record_json FROM workflow_sync_sets WHERE deleted_at IS NULL ORDER BY created_at,id',
          )
          .all() as Array<{ record_json: string }>
      ).map((row) => ({ ...parse<T>(row.record_json), targetStatus: {} })),
    );
  }
  backfillSyncSets<T extends WorkflowSyncSet>(records: T[]): Promise<boolean> {
    return this.database.writeTransaction('backfill sync sets', (c) => {
      if (this.backfilled(c, 'sync-sets')) return false;
      const insert = c.prepare(`INSERT OR IGNORE INTO workflow_sync_sets
        (id,label,source_type,source_path,target_path,apply_to_host,record_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const r of records) {
        const { definition, targetStatus } = splitSyncSetRecord(r);
        const inserted = insert.run(
          r.id,
          r.label,
          r.sourceType,
          r.sourcePath ?? null,
          r.targetPath,
          r.applyToHost ? 1 : 0,
          json(definition),
          r.createdAt,
          r.updatedAt,
        );
        if (inserted.changes) replaceTargetStatuses(c, r.id, targetStatus, r.updatedAt);
      }
      this.finishBackfill(c, 'sync-sets');
      return true;
    });
  }
  putSyncSet<T extends WorkflowSyncSet>(record: T): Promise<T> {
    return this.database.writeTransaction('write sync set', (c) => {
      const { definition, targetStatus } = splitSyncSetRecord(record);
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
        json(definition),
        record.createdAt,
        record.updatedAt,
      );
      replaceTargetStatuses(c, record.id, targetStatus, record.updatedAt);
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
      const statuses = readTargetStatusForSyncSet(c, id);
      const next = transform({ ...parse<T>(row.record_json), targetStatus: statuses });
      const { definition, targetStatus } = splitSyncSetRecord(next);
      c.prepare(
        `UPDATE workflow_sync_sets SET label=?,source_type=?,source_path=?,target_path=?,apply_to_host=?,record_json=?,updated_at=?,version=version+1 WHERE id=? AND deleted_at IS NULL`,
      ).run(
        next.label,
        next.sourceType,
        next.sourcePath ?? null,
        next.targetPath,
        next.applyToHost ? 1 : 0,
        json(definition),
        next.updatedAt,
        id,
      );
      replaceTargetStatuses(c, id, targetStatus, next.updatedAt);
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
  updateSyncSetTarget<T extends WorkflowSyncSet>(
    id: string,
    targetId: string,
    transform: (
      current: T,
      previous: WorkflowSyncSetTargetStatus | null,
    ) => { syncSet: T; targetStatus: WorkflowSyncSetTargetStatus },
  ): Promise<boolean> {
    return this.database.writeTransaction('update sync set target', (c) => {
      const normalizedTargetId = String(targetId ?? '').trim();
      if (!normalizedTargetId) throw new Error('sync set target id is required');
      const row = c
        .prepare('SELECT record_json FROM workflow_sync_sets WHERE id=? AND deleted_at IS NULL')
        .get(id) as { record_json: string } | undefined;
      if (!row) return false;
      const previousRow = c
        .prepare(
          `SELECT target_kind,state,applied_version_id,applied_at,error
           FROM workflow_sync_set_targets WHERE sync_set_id=? AND target_id=?`,
        )
        .get(id, normalizedTargetId) as
        | {
            target_kind: 'drone' | 'host';
            state: 'idle' | 'synced' | 'error';
            applied_version_id: string | null;
            applied_at: string | null;
            error: string | null;
          }
        | undefined;
      const previous = previousRow
        ? {
            targetKind: previousRow.target_kind,
            state: previousRow.state,
            appliedVersionId: previousRow.applied_version_id,
            appliedAt: previousRow.applied_at,
            error: previousRow.error,
          }
        : null;
      const current = { ...parse<T>(row.record_json), targetStatus: {} };
      const { syncSet: next, targetStatus } = transform(current, previous);
      const { definition } = splitSyncSetRecord(next);
      c.prepare(
        `UPDATE workflow_sync_sets SET label=?,source_type=?,source_path=?,target_path=?,apply_to_host=?,record_json=?,updated_at=?,version=version+1
         WHERE id=? AND deleted_at IS NULL`,
      ).run(
        next.label,
        next.sourceType,
        next.sourcePath ?? null,
        next.targetPath,
        next.applyToHost ? 1 : 0,
        json(definition),
        next.updatedAt,
        id,
      );
      c.prepare(
        `INSERT INTO workflow_sync_set_targets
         (sync_set_id,target_id,target_kind,state,applied_version_id,applied_at,error,updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(sync_set_id,target_id) DO UPDATE SET
           target_kind=excluded.target_kind,state=excluded.state,
           applied_version_id=excluded.applied_version_id,applied_at=excluded.applied_at,
           error=excluded.error,updated_at=excluded.updated_at`,
      ).run(
        id,
        normalizedTargetId,
        targetStatus.targetKind,
        targetStatus.state,
        targetStatus.appliedVersionId,
        targetStatus.appliedAt,
        targetStatus.error,
        next.updatedAt,
      );
      appendHubOutboxEvent(c, {
        topic: 'fleet.workflows',
        eventType: 'sync-set.updated',
        aggregateType: 'sync-set',
        aggregateId: id,
        payload: { id, updatedAt: next.updatedAt },
      });
      return true;
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
      c.prepare('DELETE FROM workflow_sync_set_targets WHERE sync_set_id=?').run(id);
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
