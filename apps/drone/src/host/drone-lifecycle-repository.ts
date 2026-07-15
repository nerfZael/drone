import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from './hub-database';
import { appendHubOutboxEvent, initializeHubOutbox, type AppendHubOutboxEvent } from './hub-outbox';

export type CanonicalDroneLifecycleState = 'real' | 'pending' | 'archived';

export type CanonicalDroneLifecycleRecord = {
  state: CanonicalDroneLifecycleState;
  id: string;
  name: string;
  containerName: string | null;
  runtimeKind: string;
  phase: string | null;
  archivedAt: string | null;
  deleteAt: string | null;
  archiveRetention: string | null;
  archiveRuntimePolicy: string | null;
  lifecycle: Record<string, any>;
  version: number;
  updatedAt: string;
};

export type CanonicalDroneLifecycleUpsert = {
  state: CanonicalDroneLifecycleState;
  id: string;
  entry: unknown;
  event: Omit<AppendHubOutboxEvent, 'aggregateType' | 'aggregateId'>;
};

export type CanonicalDroneLifecyclePatch = {
  state: CanonicalDroneLifecycleState;
  id: string;
  transform: (lifecycle: Record<string, any>) => Record<string, any>;
  event: Omit<AppendHubOutboxEvent, 'aggregateType' | 'aggregateId'>;
};

export type CanonicalDroneLifecycleDelete = {
  state: CanonicalDroneLifecycleState;
  id: string;
  event: Omit<AppendHubOutboxEvent, 'aggregateType' | 'aggregateId'>;
};

type LifecycleRow = {
  drone_id: string;
  name: string;
  container_name: string | null;
  runtime_kind: string;
  phase: string | null;
  archived_at?: string | null;
  delete_at?: string | null;
  archive_retention?: string | null;
  archive_runtime_policy?: string | null;
  lifecycle_json: string;
  version: number;
  updated_at: string;
};

const LIFECYCLE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'canonical drone lifecycle tables',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE hub_canonical_drones (
          drone_id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          container_name TEXT,
          runtime_kind TEXT NOT NULL,
          phase TEXT,
          lifecycle_json TEXT NOT NULL,
          version INTEGER NOT NULL CHECK (version > 0),
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_hub_canonical_drones_name ON hub_canonical_drones (name);

        CREATE TABLE hub_canonical_pending_drones (
          drone_id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          container_name TEXT,
          runtime_kind TEXT NOT NULL,
          phase TEXT NOT NULL,
          lifecycle_json TEXT NOT NULL,
          version INTEGER NOT NULL CHECK (version > 0),
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_hub_canonical_pending_drones_name ON hub_canonical_pending_drones (name);

        CREATE TABLE hub_canonical_archived_drones (
          drone_id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          container_name TEXT,
          runtime_kind TEXT NOT NULL,
          phase TEXT,
          archived_at TEXT NOT NULL,
          delete_at TEXT NOT NULL,
          archive_retention TEXT NOT NULL,
          archive_runtime_policy TEXT,
          lifecycle_json TEXT NOT NULL,
          version INTEGER NOT NULL CHECK (version > 0),
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_hub_canonical_archived_drones_delete_at
          ON hub_canonical_archived_drones (delete_at);

        CREATE TABLE hub_drone_lifecycle_backfill (
          id TEXT NOT NULL PRIMARY KEY CHECK (id = 'legacy-registry'),
          completed_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'deleted drone lifecycle tombstones',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE hub_drone_lifecycle_tombstones (
          drone_id TEXT NOT NULL PRIMARY KEY,
          prior_state TEXT NOT NULL CHECK (prior_state IN ('real', 'pending', 'archived')),
          deleted_at TEXT NOT NULL,
          reason TEXT NOT NULL
        );
      `);
    },
  },
];

const TABLES: Record<CanonicalDroneLifecycleState, string> = {
  real: 'hub_canonical_drones',
  pending: 'hub_canonical_pending_drones',
  archived: 'hub_canonical_archived_drones',
};

function normalizeId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || id.length > 128) throw new Error(`Invalid drone identity: ${String(raw ?? '')}`);
  return id;
}

function cloneLifecyclePayload(raw: unknown): Record<string, any> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const payload = { ...source };
  // Chat, transcript, prompt, and archived-chat state have independent owners.
  // Lifecycle writes must never pull those aggregates back into a large row.
  delete payload.chats;
  delete payload.archivedChats;
  return JSON.parse(JSON.stringify(payload));
}

function lifecycleFields(idRaw: string, entryRaw: unknown, now: string) {
  const id = normalizeId(idRaw);
  const lifecycle = cloneLifecyclePayload(entryRaw);
  lifecycle.id = id;
  const name = String(lifecycle.name ?? id).trim() || id;
  const containerName = String(lifecycle.containerName ?? '').trim() || null;
  const runtimeRaw = lifecycle.runtime;
  const runtimeKind = String(
    runtimeRaw && typeof runtimeRaw === 'object' ? runtimeRaw.kind : runtimeRaw ?? 'container',
  ).trim() || 'container';
  const phase = String(lifecycle.phase ?? lifecycle.hub?.phase ?? '').trim() || null;
  return { id, name, containerName, runtimeKind, phase, lifecycle, updatedAt: now };
}

function rowToRecord(state: CanonicalDroneLifecycleState, row: LifecycleRow | undefined): CanonicalDroneLifecycleRecord | null {
  if (!row) return null;
  let lifecycle: Record<string, any>;
  try {
    lifecycle = JSON.parse(row.lifecycle_json);
  } catch (error) {
    throw new Error(`Invalid lifecycle JSON for drone ${row.drone_id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    state,
    id: row.drone_id,
    name: row.name,
    containerName: row.container_name,
    runtimeKind: row.runtime_kind,
    phase: row.phase,
    archivedAt: row.archived_at ?? null,
    deleteAt: row.delete_at ?? null,
    archiveRetention: row.archive_retention ?? null,
    archiveRuntimePolicy: row.archive_runtime_policy ?? null,
    lifecycle,
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
}

function selectById(
  connection: HubDatabaseConnection,
  state: CanonicalDroneLifecycleState,
  id: string,
): CanonicalDroneLifecycleRecord | null {
  const row = connection.prepare(`SELECT * FROM ${TABLES[state]} WHERE drone_id = ?`).get(id) as LifecycleRow | undefined;
  return rowToRecord(state, row);
}

function selectAnyById(connection: HubDatabaseConnection, id: string): CanonicalDroneLifecycleRecord | null {
  return selectById(connection, 'real', id) ?? selectById(connection, 'pending', id) ?? selectById(connection, 'archived', id);
}

function hasLifecycleTombstone(connection: HubDatabaseConnection, id: string): boolean {
  return Boolean(connection.prepare(
    'SELECT 1 FROM hub_drone_lifecycle_tombstones WHERE drone_id = ?',
  ).get(id));
}

function writeLifecycleTombstone(
  connection: HubDatabaseConnection,
  record: CanonicalDroneLifecycleRecord,
  reason: string,
): void {
  connection.prepare(`
    INSERT INTO hub_drone_lifecycle_tombstones (drone_id, prior_state, deleted_at, reason)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(drone_id) DO UPDATE SET
      prior_state = excluded.prior_state,
      deleted_at = excluded.deleted_at,
      reason = excluded.reason
  `).run(record.id, record.state, new Date().toISOString(), reason);
}

function nextVersion(connection: HubDatabaseConnection, id: string): number {
  const versions = (Object.keys(TABLES) as CanonicalDroneLifecycleState[])
    .map((state) => selectById(connection, state, id)?.version ?? 0);
  return Math.max(0, ...versions) + 1;
}

function deleteOtherStates(connection: HubDatabaseConnection, id: string, keep: CanonicalDroneLifecycleState): void {
  for (const state of Object.keys(TABLES) as CanonicalDroneLifecycleState[]) {
    if (state !== keep) connection.prepare(`DELETE FROM ${TABLES[state]} WHERE drone_id = ?`).run(id);
  }
}

function assertActiveNameAvailable(
  connection: HubDatabaseConnection,
  state: CanonicalDroneLifecycleState,
  id: string,
  name: string,
): void {
  if (state === 'archived') return;
  const conflict = connection.prepare(`
    SELECT drone_id FROM hub_canonical_drones WHERE name = ? AND drone_id != ?
    UNION ALL
    SELECT drone_id FROM hub_canonical_pending_drones WHERE name = ? AND drone_id != ?
    LIMIT 1
  `).get(name, id, name, id) as { drone_id: string } | undefined;
  if (conflict) throw new Error(`drone display name already exists: ${name}`);
}

function writeRecord(
  connection: HubDatabaseConnection,
  state: CanonicalDroneLifecycleState,
  idRaw: string,
  entryRaw: unknown,
  now: string,
  version = nextVersion(connection, normalizeId(idRaw)),
): CanonicalDroneLifecycleRecord {
  const fields = lifecycleFields(idRaw, entryRaw, now);
  assertActiveNameAvailable(connection, state, fields.id, fields.name);
  deleteOtherStates(connection, fields.id, state);
  if (state === 'archived') {
    const archivedAt = String(fields.lifecycle.archivedAt ?? '').trim();
    const deleteAt = String(fields.lifecycle.deleteAt ?? '').trim();
    const archiveRetention = String(fields.lifecycle.archiveRetention ?? '').trim();
    if (!archivedAt || !deleteAt || !archiveRetention) throw new Error(`Archived drone ${fields.id} is missing archive metadata`);
    const archiveRuntimePolicy = String(fields.lifecycle.archiveRuntimePolicy ?? '').trim() || null;
    connection.prepare(`
      INSERT INTO ${TABLES.archived} (
        drone_id, name, container_name, runtime_kind, phase, archived_at, delete_at,
        archive_retention, archive_runtime_policy, lifecycle_json, version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id) DO UPDATE SET
        name = excluded.name, container_name = excluded.container_name,
        runtime_kind = excluded.runtime_kind, phase = excluded.phase,
        archived_at = excluded.archived_at, delete_at = excluded.delete_at,
        archive_retention = excluded.archive_retention,
        archive_runtime_policy = excluded.archive_runtime_policy,
        lifecycle_json = excluded.lifecycle_json, version = excluded.version, updated_at = excluded.updated_at
    `).run(
      fields.id, fields.name, fields.containerName, fields.runtimeKind, fields.phase,
      archivedAt, deleteAt, archiveRetention, archiveRuntimePolicy,
      JSON.stringify(fields.lifecycle), version, now,
    );
  } else {
    const phase = state === 'pending' ? fields.phase ?? 'starting' : fields.phase;
    connection.prepare(`
      INSERT INTO ${TABLES[state]} (
        drone_id, name, container_name, runtime_kind, phase, lifecycle_json, version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id) DO UPDATE SET
        name = excluded.name, container_name = excluded.container_name,
        runtime_kind = excluded.runtime_kind, phase = excluded.phase,
        lifecycle_json = excluded.lifecycle_json, version = excluded.version, updated_at = excluded.updated_at
    `).run(
      fields.id, fields.name, fields.containerName, fields.runtimeKind, phase,
      JSON.stringify(fields.lifecycle), version, now,
    );
  }
  return selectById(connection, state, fields.id)!;
}

export class DroneLifecycleRepository {
  private constructor(private readonly database: HubDatabase) {}

  static async open(database: HubDatabase): Promise<DroneLifecycleRepository> {
    database.read((connection) => {
      applyHubDatabaseMigrations(connection, LIFECYCLE_MIGRATIONS, 'drone-lifecycle');
    });
    initializeHubOutbox(database);
    return new DroneLifecycleRepository(database);
  }

  isLegacyBackfillComplete(): boolean {
    return this.database.read((connection) => Boolean(
      connection.prepare("SELECT 1 FROM hub_drone_lifecycle_backfill WHERE id = 'legacy-registry'").get(),
    ));
  }

  backfillLegacyInsertOnly(registryRaw: any): Promise<boolean> {
    return this.database.writeTransaction('backfill canonical drone lifecycle', (connection) => {
      const now = new Date().toISOString();
      let inserted = false;
      for (const [key, entry] of Object.entries(registryRaw?.drones ?? {}) as Array<[string, any]>) {
        const id = normalizeId(String(entry?.id ?? key));
        if (!selectAnyById(connection, id) && !hasLifecycleTombstone(connection, id)) {
          writeRecord(connection, 'real', id, entry, now, 1);
          inserted = true;
        }
      }
      for (const [key, entry] of Object.entries(registryRaw?.pending ?? {}) as Array<[string, any]>) {
        const id = normalizeId(String(entry?.id ?? key));
        if (!selectAnyById(connection, id) && !hasLifecycleTombstone(connection, id)) {
          writeRecord(connection, 'pending', id, entry, now, 1);
          inserted = true;
        }
      }
      for (const [key, entry] of Object.entries(registryRaw?.archived ?? {}) as Array<[string, any]>) {
        const id = normalizeId(String(entry?.id ?? key));
        if (!selectAnyById(connection, id) && !hasLifecycleTombstone(connection, id)) {
          writeRecord(connection, 'archived', id, entry, now, 1);
          inserted = true;
        }
      }
      connection.prepare('INSERT OR IGNORE INTO hub_drone_lifecycle_backfill (id, completed_at) VALUES (?, ?)').run('legacy-registry', now);
      return inserted;
    });
  }

  get(idRaw: string): CanonicalDroneLifecycleRecord | null {
    const id = normalizeId(idRaw);
    return this.database.read((connection) => selectAnyById(connection, id));
  }

  resolveActiveRef(refRaw: string): CanonicalDroneLifecycleRecord | null {
    const ref = String(refRaw ?? '').trim();
    if (!ref) return null;
    return this.database.read((connection) => {
      if (ref.length <= 128) {
        const exact = selectById(connection, 'real', ref) ?? selectById(connection, 'pending', ref);
        if (exact) return exact;
      }
      for (const state of ['real', 'pending'] as const) {
        const row = connection.prepare(`SELECT * FROM ${TABLES[state]} WHERE name = ? ORDER BY updated_at DESC LIMIT 1`).get(ref) as LifecycleRow | undefined;
        const record = rowToRecord(state, row);
        if (record) return record;
      }
      return null;
    });
  }

  list(state: CanonicalDroneLifecycleState): CanonicalDroneLifecycleRecord[] {
    return this.database.read((connection) =>
      (connection.prepare(`SELECT * FROM ${TABLES[state]} ORDER BY name, drone_id`).all() as LifecycleRow[])
        .map((row) => rowToRecord(state, row)!),
    );
  }

  upsert(state: CanonicalDroneLifecycleState, idRaw: string, entry: unknown): Promise<CanonicalDroneLifecycleRecord> {
    const id = normalizeId(idRaw);
    return this.database.writeTransaction(`upsert ${state} drone ${id}`, (connection) =>
      writeRecord(connection, state, id, entry, new Date().toISOString()),
    );
  }

  patch(
    state: CanonicalDroneLifecycleState,
    idRaw: string,
    transform: (lifecycle: Record<string, any>) => Record<string, any>,
  ): Promise<CanonicalDroneLifecycleRecord | null> {
    const id = normalizeId(idRaw);
    return this.database.writeTransaction(`patch ${state} drone ${id}`, (connection) => {
      const current = selectById(connection, state, id);
      if (!current) return null;
      return writeRecord(connection, state, id, transform(cloneLifecyclePayload(current.lifecycle)), new Date().toISOString());
    });
  }

  delete(idRaw: string, state?: CanonicalDroneLifecycleState): Promise<CanonicalDroneLifecycleRecord | null> {
    const id = normalizeId(idRaw);
    return this.database.writeTransaction(`delete canonical drone ${id}`, (connection) => {
      const current = state ? selectById(connection, state, id) : selectAnyById(connection, id);
      if (!current) return null;
      writeLifecycleTombstone(connection, current, 'deleted');
      if (state) connection.prepare(`DELETE FROM ${TABLES[state]} WHERE drone_id = ?`).run(id);
      else for (const table of Object.values(TABLES)) connection.prepare(`DELETE FROM ${table} WHERE drone_id = ?`).run(id);
      return current;
    });
  }

  commitUpsert(
    state: CanonicalDroneLifecycleState,
    idRaw: string,
    entry: unknown,
    event: Omit<AppendHubOutboxEvent, 'aggregateType' | 'aggregateId'>,
  ): Promise<CanonicalDroneLifecycleRecord> {
    const id = normalizeId(idRaw);
    return this.database.writeTransaction(`commit ${event.eventType} for drone ${id}`, (connection) => {
      const record = writeRecord(connection, state, id, entry, new Date().toISOString());
      appendHubOutboxEvent(connection, {
        ...event,
        aggregateType: 'drone',
        aggregateId: id,
        payload: event.payload ?? { id, state, version: record.version },
      });
      return record;
    });
  }

  commitUpsertBatch(items: CanonicalDroneLifecycleUpsert[]): Promise<CanonicalDroneLifecycleRecord[]> {
    return this.database.writeTransaction('commit canonical drone lifecycle batch', (connection) => {
      const records: CanonicalDroneLifecycleRecord[] = [];
      for (const item of items) {
        const id = normalizeId(item.id);
        const record = writeRecord(connection, item.state, id, item.entry, new Date().toISOString());
        appendHubOutboxEvent(connection, {
          ...item.event,
          aggregateType: 'drone',
          aggregateId: id,
          payload: item.event.payload ?? { id, state: item.state, version: record.version },
        });
        records.push(record);
      }
      return records;
    });
  }

  commitPatch(
    state: CanonicalDroneLifecycleState,
    idRaw: string,
    transform: (lifecycle: Record<string, any>) => Record<string, any>,
    event: Omit<AppendHubOutboxEvent, 'aggregateType' | 'aggregateId'>,
  ): Promise<CanonicalDroneLifecycleRecord | null> {
    const id = normalizeId(idRaw);
    return this.database.writeTransaction(`commit ${event.eventType} for drone ${id}`, (connection) => {
      const current = selectById(connection, state, id);
      if (!current) return null;
      const record = writeRecord(
        connection,
        state,
        id,
        transform(cloneLifecyclePayload(current.lifecycle)),
        new Date().toISOString(),
      );
      appendHubOutboxEvent(connection, {
        ...event,
        aggregateType: 'drone',
        aggregateId: id,
        payload: event.payload ?? { id, state, version: record.version },
      });
      return record;
    });
  }

  commitPatchBatch(items: CanonicalDroneLifecyclePatch[]): Promise<CanonicalDroneLifecycleRecord[]> {
    return this.database.writeTransaction('commit canonical drone lifecycle patch batch', (connection) => {
      const records: CanonicalDroneLifecycleRecord[] = [];
      for (const item of items) {
        const id = normalizeId(item.id);
        const current = selectById(connection, item.state, id);
        if (!current) throw new Error(`unknown ${item.state} drone: ${id}`);
        const record = writeRecord(
          connection,
          item.state,
          id,
          item.transform(cloneLifecyclePayload(current.lifecycle)),
          new Date().toISOString(),
        );
        appendHubOutboxEvent(connection, {
          ...item.event,
          aggregateType: 'drone',
          aggregateId: id,
          payload: item.event.payload ?? { id, state: item.state, version: record.version },
        });
        records.push(record);
      }
      return records;
    });
  }

  commitDelete(
    idRaw: string,
    state: CanonicalDroneLifecycleState | undefined,
    event: Omit<AppendHubOutboxEvent, 'aggregateType' | 'aggregateId'>,
  ): Promise<CanonicalDroneLifecycleRecord | null> {
    const id = normalizeId(idRaw);
    return this.database.writeTransaction(`commit ${event.eventType} for drone ${id}`, (connection) => {
      const current = state ? selectById(connection, state, id) : selectAnyById(connection, id);
      if (!current) return null;
      writeLifecycleTombstone(connection, current, event.eventType);
      if (state) connection.prepare(`DELETE FROM ${TABLES[state]} WHERE drone_id = ?`).run(id);
      else for (const table of Object.values(TABLES)) connection.prepare(`DELETE FROM ${table} WHERE drone_id = ?`).run(id);
      appendHubOutboxEvent(connection, {
        ...event,
        aggregateType: 'drone',
        aggregateId: id,
        payload: event.payload ?? { id, priorState: current.state, version: current.version },
      });
      return current;
    });
  }

  commitDeleteBatch(
    items: CanonicalDroneLifecycleDelete[],
    options: { ignoreMissing?: boolean } = {},
  ): Promise<CanonicalDroneLifecycleRecord[]> {
    return this.database.writeTransaction('commit canonical drone lifecycle delete batch', (connection) => {
      const records: CanonicalDroneLifecycleRecord[] = [];
      for (const item of items) {
        const id = normalizeId(item.id);
        const current = selectById(connection, item.state, id);
        if (!current) {
          if (options.ignoreMissing) continue;
          throw new Error(`unknown ${item.state} drone: ${id}`);
        }
        writeLifecycleTombstone(connection, current, item.event.eventType);
        connection.prepare(`DELETE FROM ${TABLES[item.state]} WHERE drone_id = ?`).run(id);
        appendHubOutboxEvent(connection, {
          ...item.event,
          aggregateType: 'drone',
          aggregateId: id,
          payload: item.event.payload ?? { id, priorState: item.state, version: current.version },
        });
        records.push(current);
      }
      return records;
    });
  }
}

let cached: { database: HubDatabase; repository: Promise<DroneLifecycleRepository> } | null = null;

export function getDroneLifecycleRepository(): Promise<DroneLifecycleRepository | null> {
  const database = getHubDatabase();
  if (!database) return Promise.resolve(null);
  if (cached?.database === database) return cached.repository;
  const repository = DroneLifecycleRepository.open(database).catch((error) => {
    if (cached?.database === database) cached = null;
    throw error;
  });
  cached = { database, repository };
  return repository;
}
