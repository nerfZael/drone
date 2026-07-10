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
export type WorkflowQueueItem = {
  id: string;
  playbookId: string;
  repoPath: string;
  requestedCount: number;
  launchedCount: number;
  inFlightCount: number;
  createdAt: string;
  updatedAt: string;
  state?: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  [key: string]: unknown;
};
export type FleetAuditRecord = {
  id: string;
  at: string;
  actor: string;
  actorName: string;
  action: string;
  target?: string | null;
  targetName?: string | null;
  status: string;
  reason?: string | null;
  meta?: Record<string, unknown>;
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
    await database.writeTransaction('recover interrupted playbook queue', (connection) => {
      connection
        .prepare(
          `UPDATE workflow_playbook_queue SET state='queued',in_flight_count=0,
        payload_json=json_set(payload_json,'$.inFlightCount',0,'$.state','queued'),
        updated_at=?,version=version+1 WHERE state='running'`,
        )
        .run(new Date().toISOString());
    });
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

  listQueue<T extends WorkflowQueueItem>(includeTerminal = false): T[] {
    return this.database.read((c) => {
      const rows = c
        .prepare(
          `SELECT payload_json,state FROM workflow_playbook_queue WHERE deleted_at IS NULL ${includeTerminal ? '' : "AND state IN ('queued','running')"} ORDER BY created_at,id`,
        )
        .all() as any[];
      return rows.map((r) => ({ ...parse<T>(r.payload_json), state: r.state }));
    });
  }
  backfillQueue<T extends WorkflowQueueItem>(records: T[]): Promise<boolean> {
    return this.database.writeTransaction('backfill playbook queue', (c) => {
      if (this.backfilled(c, 'playbook-queue')) return false;
      const s = c.prepare(
        `INSERT OR IGNORE INTO workflow_playbook_queue(id,playbook_id,repo_path,state,requested_count,launched_count,in_flight_count,payload_json,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const r of records)
        s.run(
          r.id,
          r.playbookId,
          r.repoPath,
          this.queueState(r),
          r.requestedCount,
          r.launchedCount,
          r.inFlightCount,
          json(r),
          r.createdAt,
          r.updatedAt,
        );
      this.finishBackfill(c, 'playbook-queue');
      return true;
    });
  }
  enqueue<T extends WorkflowQueueItem>(item: T): Promise<T> {
    return this.database.writeTransaction('enqueue playbook run', (c) => {
      const state = this.queueState(item);
      const info = c
        .prepare(
          `INSERT OR IGNORE INTO workflow_playbook_queue(id,playbook_id,repo_path,state,requested_count,launched_count,in_flight_count,payload_json,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          item.id,
          item.playbookId,
          item.repoPath,
          state,
          item.requestedCount,
          item.launchedCount,
          item.inFlightCount,
          json({ ...item, state }),
          item.createdAt,
          item.updatedAt,
        );
      const row = c
        .prepare('SELECT payload_json,state FROM workflow_playbook_queue WHERE id=?')
        .get(item.id) as any;
      if (!row) throw new Error('failed to enqueue playbook run');
      if (Number(info.changes ?? 0) === 1)
        appendHubOutboxEvent(c, {
          topic: 'fleet.workflows',
          eventType: 'playbook-run.queued',
          aggregateType: 'playbook-run-queue',
          aggregateId: item.id,
          payload: { id: item.id, playbookId: item.playbookId },
        });
      return { ...parse<T>(row.payload_json), state: row.state };
    });
  }
  updateQueue<T extends WorkflowQueueItem>(
    id: string,
    transform: (current: T) => T,
  ): Promise<T | null> {
    return this.database.writeTransaction('update playbook queue', (c) => {
      const row = c
        .prepare(
          'SELECT payload_json FROM workflow_playbook_queue WHERE id=? AND deleted_at IS NULL',
        )
        .get(id) as any;
      if (!row) return null;
      const next = transform(parse<T>(row.payload_json));
      const state = this.queueState(next);
      c.prepare(
        `UPDATE workflow_playbook_queue SET state=?,requested_count=?,launched_count=?,in_flight_count=?,payload_json=?,updated_at=?,version=version+1 WHERE id=?`,
      ).run(
        state,
        next.requestedCount,
        next.launchedCount,
        next.inFlightCount,
        json({ ...next, state }),
        next.updatedAt,
        id,
      );
      appendHubOutboxEvent(c, {
        topic: 'fleet.workflows',
        eventType: `playbook-run.${state}`,
        aggregateType: 'playbook-run-queue',
        aggregateId: id,
        payload: { id, state },
      });
      return { ...next, state };
    });
  }
  cancelQueue(id: string, at = new Date().toISOString()): Promise<boolean> {
    return this.database.writeTransaction('cancel playbook queue', (c) => {
      const row = c
        .prepare(
          'SELECT payload_json FROM workflow_playbook_queue WHERE id=? AND deleted_at IS NULL',
        )
        .get(id) as any;
      if (!row) return false;
      const current = parse<any>(row.payload_json);
      const next = {
        ...current,
        requestedCount: Math.min(
          current.requestedCount,
          current.launchedCount + current.inFlightCount,
        ),
        updatedAt: at,
      };
      c.prepare(
        `UPDATE workflow_playbook_queue SET state='cancelled',requested_count=?,payload_json=?,updated_at=?,version=version+1 WHERE id=?`,
      ).run(next.requestedCount, json(next), at, id);
      appendHubOutboxEvent(c, {
        topic: 'fleet.workflows',
        eventType: 'playbook-run.cancelled',
        aggregateType: 'playbook-run-queue',
        aggregateId: id,
        payload: { id },
      });
      return true;
    });
  }
  clearQueue(
    filter: { playbookId?: string; repoPath?: string },
    at = new Date().toISOString(),
  ): Promise<number> {
    return this.database.writeTransaction('clear playbook queue', (c) => {
      const rows = c
        .prepare(
          `SELECT id FROM workflow_playbook_queue WHERE deleted_at IS NULL AND state IN ('queued','running') AND (?='' OR playbook_id=?) AND (?='' OR repo_path=?)`,
        )
        .all(
          filter.playbookId ?? '',
          filter.playbookId ?? '',
          filter.repoPath ?? '',
          filter.repoPath ?? '',
        ) as any[];
      for (const r of rows) {
        c.prepare(
          `UPDATE workflow_playbook_queue SET state='cancelled',updated_at=?,version=version+1 WHERE id=?`,
        ).run(at, r.id);
        appendHubOutboxEvent(c, {
          topic: 'fleet.workflows',
          eventType: 'playbook-run.cancelled',
          aggregateType: 'playbook-run-queue',
          aggregateId: r.id,
          payload: { id: r.id },
        });
      }
      return rows.length;
    });
  }

  backfillAudit(records: FleetAuditRecord[]): Promise<boolean> {
    return this.database.writeTransaction('backfill fleet audit', (c) => {
      if (this.backfilled(c, 'fleet-audit')) return false;
      for (const r of records) this.insertAudit(c, r);
      this.finishBackfill(c, 'fleet-audit');
      return true;
    });
  }
  appendAudit(record: FleetAuditRecord): Promise<void> {
    return this.database.writeTransaction('append fleet audit', (c) => {
      this.insertAudit(c, record);
    });
  }
  listAudit(
    opts: {
      actor?: string;
      target?: string;
      action?: string;
      status?: string;
      limit?: number;
      since?: string;
    } = {},
  ): FleetAuditRecord[] {
    return this.database.read((c) => {
      const limit = Math.max(1, Math.min(1000, opts.limit ?? 100));
      const rows = c
        .prepare(
          `SELECT * FROM workflow_fleet_audit WHERE (?='' OR actor=? OR actor_name=?) AND (?='' OR target=? OR target_name=?) AND (?='' OR action=?) AND (?='' OR status=?) AND (?='' OR at>=?) ORDER BY at DESC,sequence DESC LIMIT ?`,
        )
        .all(
          opts.actor ?? '',
          opts.actor ?? '',
          opts.actor ?? '',
          opts.target ?? '',
          opts.target ?? '',
          opts.target ?? '',
          opts.action ?? '',
          opts.action ?? '',
          opts.status ?? '',
          opts.status ?? '',
          opts.since ?? '',
          opts.since ?? '',
          limit,
        ) as any[];
      return rows.map(this.auditFromRow);
    });
  }

  private queueState(
    r: WorkflowQueueItem,
  ): 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' {
    if (r.state === 'cancelled' || r.state === 'failed') return r.state;
    if ((r as any).error) return 'failed';
    if (r.inFlightCount > 0) return 'running';
    return r.launchedCount >= r.requestedCount ? 'completed' : 'queued';
  }
  private insertAudit(c: HubDatabaseConnection, r: FleetAuditRecord) {
    c.prepare(
      `INSERT OR IGNORE INTO workflow_fleet_audit(event_id,at,actor,actor_name,action,target,target_name,status,reason,meta_json)VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      r.id,
      r.at,
      r.actor,
      r.actorName,
      r.action,
      r.target ?? null,
      r.targetName ?? null,
      r.status,
      r.reason ?? null,
      json(r.meta ?? {}),
    );
  }
  private auditFromRow = (r: any): FleetAuditRecord => ({
    id: r.event_id,
    at: r.at,
    actor: r.actor,
    actorName: r.actor_name,
    action: r.action,
    target: r.target,
    targetName: r.target_name,
    status: r.status,
    reason: r.reason,
    meta: parse(r.meta_json),
  });
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
