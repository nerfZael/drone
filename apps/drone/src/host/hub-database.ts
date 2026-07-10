import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { droneRootPath } from './paths';

export type HubDatabaseConnection = import('better-sqlite3').Database;
type DatabaseConstructor = typeof import('better-sqlite3');

export type HubDatabaseFailureKind = 'native-binding' | 'open' | 'configuration';

export type HubDatabaseMigration = {
  version: number;
  name: string;
  migrate: (connection: HubDatabaseConnection) => void;
};

export type HubDatabaseDiagnostics = {
  available: boolean;
  path: string;
  failureKind: HubDatabaseFailureKind | null;
  unavailableReason: string | null;
  openedAt: string | null;
  schemaVersion: number | null;
  appliedMigrationCount: number | null;
  journalMode: string | null;
  synchronous: number | null;
  busyTimeoutMs: number | null;
  foreignKeys: boolean | null;
  queuedWrites: number;
  activeWrite: string | null;
};

type MigrationRow = {
  version: number;
  name: string;
};

type ScalarPragmaRow = Record<string, string | number>;

type UnavailableState = {
  path: string;
  kind: HubDatabaseFailureKind;
  reason: string;
};

const BUSY_TIMEOUT_MS = 10_000;
const requireForHubDatabase = createRequire(__filename);

const HUB_DATABASE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'hub database foundation',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE hub_database_metadata (
          key TEXT NOT NULL PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
];

let cached: { path: string; database: SharedHubDatabase } | null = null;
let unavailable: UnavailableState | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeNativeBindingFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('node_module_version') ||
    message.includes('napi_register_module') ||
    message.includes('native module') ||
    message.includes('could not locate the bindings file') ||
    message.includes('invalid elf header') ||
    message.includes('dlopen')
  );
}

function loadDatabaseConstructor(): DatabaseConstructor {
  return requireForHubDatabase('better-sqlite3') as DatabaseConstructor;
}

function pragmaScalar(connection: HubDatabaseConnection, pragma: string): string | number | null {
  const rows = connection.pragma(pragma, { simple: false }) as ScalarPragmaRow[];
  const row = rows[0];
  if (!row) return null;
  const value = Object.values(row)[0];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function assertSynchronousResult(value: unknown, context: string): void {
  if (
    value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as any).then === 'function'
  ) {
    throw new TypeError(
      `${context} must return synchronously; asynchronous work cannot run inside a SQLite transaction`,
    );
  }
}

function validateMigrations(migrations: readonly HubDatabaseMigration[]): void {
  let previousVersion = 0;
  const names = new Set<string>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid hub database migration version: ${migration.version}`);
    }
    if (migration.version <= previousVersion) {
      throw new Error('Hub database migrations must have unique, increasing versions');
    }
    const name = migration.name.trim();
    if (!name) throw new Error(`Hub database migration ${migration.version} has no name`);
    if (names.has(name)) throw new Error(`Duplicate hub database migration name: ${name}`);
    previousVersion = migration.version;
    names.add(name);
  }
}

/**
 * Applies all pending migrations atomically. Existing versions are verified by
 * name so changing an already-shipped migration fails loudly instead of
 * silently changing the meaning of the schema history.
 */
export function applyHubDatabaseMigrations(
  connection: HubDatabaseConnection,
  migrations: readonly HubDatabaseMigration[] = HUB_DATABASE_MIGRATIONS,
): void {
  validateMigrations(migrations);

  connection
    .transaction(() => {
      connection.exec(`
      CREATE TABLE IF NOT EXISTS hub_schema_migrations (
        version INTEGER NOT NULL PRIMARY KEY CHECK (version > 0),
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);

      const applied = connection
        .prepare('SELECT version, name FROM hub_schema_migrations ORDER BY version')
        .all() as MigrationRow[];
      const appliedByVersion = new Map(applied.map((row) => [row.version, row.name]));
      const knownVersions = new Set(migrations.map((migration) => migration.version));
      for (const row of applied) {
        if (!knownVersions.has(row.version)) {
          throw new Error(
            `Hub database contains unknown migration version ${row.version} (${row.name})`,
          );
        }
      }

      const recordMigration = connection.prepare(
        'INSERT INTO hub_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      );
      for (const migration of migrations) {
        const appliedName = appliedByVersion.get(migration.version);
        if (appliedName !== undefined) {
          if (appliedName !== migration.name) {
            throw new Error(
              `Hub database migration ${migration.version} was applied as ${JSON.stringify(appliedName)}, not ${JSON.stringify(migration.name)}`,
            );
          }
          continue;
        }
        migration.migrate(connection);
        recordMigration.run(migration.version, migration.name, new Date().toISOString());
      }
    })
    .immediate();
}

export function hubDatabasePath(): string {
  return droneRootPath('hub.sqlite');
}

export interface HubDatabase {
  readonly path: string;
  readonly openedAt: string;

  read<T>(operation: (connection: HubDatabaseConnection) => T): T;
  writeTransaction<T>(
    label: string,
    operation: (connection: HubDatabaseConnection) => T,
  ): Promise<T>;
  diagnostics(): HubDatabaseDiagnostics;
}

class SharedHubDatabase implements HubDatabase {
  readonly openedAt = new Date().toISOString();

  private queueTail: Promise<void> = Promise.resolve();
  private queuedWriteCount = 0;
  private activeWriteLabel: string | null = null;
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    readonly path: string,
    private readonly connection: HubDatabaseConnection,
  ) {}

  /** Runs a synchronous, read-only operation against the current connection. */
  read<T>(operation: (connection: HubDatabaseConnection) => T): T {
    if (this.closed) throw new Error(`Hub database is closed: ${this.path}`);
    const result = operation(this.connection);
    assertSynchronousResult(result, 'Hub database read callback');
    return result;
  }

  /**
   * Enqueues a short transaction. Transactions start in call order and a failed
   * transaction is rolled back without blocking later work in the queue.
   */
  writeTransaction<T>(
    label: string,
    operation: (connection: HubDatabaseConnection) => T,
  ): Promise<T> {
    if (this.closing || this.closed)
      return Promise.reject(new Error(`Hub database is closing: ${this.path}`));
    const normalizedLabel = label.trim() || 'unnamed write';
    const previous = this.queueTail;
    this.queuedWriteCount += 1;

    const work = previous.then(() => {
      this.queuedWriteCount -= 1;
      if (this.closed) throw new Error(`Hub database is closed: ${this.path}`);
      this.activeWriteLabel = normalizedLabel;
      try {
        return this.connection
          .transaction(() => {
            const result = operation(this.connection);
            assertSynchronousResult(
              result,
              `Hub database transaction ${JSON.stringify(normalizedLabel)}`,
            );
            return result;
          })
          .immediate();
      } finally {
        this.activeWriteLabel = null;
      }
    });

    this.queueTail = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }

  diagnostics(): HubDatabaseDiagnostics {
    const migrationSummary = this.read(
      (connection) =>
        connection
          .prepare(
            'SELECT COALESCE(MAX(version), 0) AS schema_version, COUNT(*) AS migration_count FROM hub_schema_migrations',
          )
          .get() as { schema_version: number; migration_count: number },
    );
    const journalMode = pragmaScalar(this.connection, 'journal_mode');
    const synchronous = pragmaScalar(this.connection, 'synchronous');
    const busyTimeout = pragmaScalar(this.connection, 'busy_timeout');
    const foreignKeys = pragmaScalar(this.connection, 'foreign_keys');
    return {
      available: true,
      path: this.path,
      failureKind: null,
      unavailableReason: null,
      openedAt: this.openedAt,
      schemaVersion: Number(migrationSummary.schema_version),
      appliedMigrationCount: Number(migrationSummary.migration_count),
      journalMode: journalMode == null ? null : String(journalMode),
      synchronous: synchronous == null ? null : Number(synchronous),
      busyTimeoutMs: busyTimeout == null ? null : Number(busyTimeout),
      foreignKeys: foreignKeys == null ? null : Number(foreignKeys) === 1,
      queuedWrites: this.queuedWriteCount,
      activeWrite: this.activeWriteLabel,
    };
  }

  /** Stops accepting writes, drains the FIFO, then closes the native handle. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.queueTail.then(() => {
      if (this.closed) return;
      this.connection.close();
      this.closed = true;
    });
    return this.closePromise;
  }
}

function retireCachedDatabase(): void {
  if (!cached) return;
  const retired = cached.database;
  cached = null;
  void retired.close().catch(() => {
    // The handle is no longer discoverable. A later open reports its own
    // availability independently from best-effort retirement of the old path.
  });
}

/** Returns the shared database, or null when SQLite cannot be loaded/opened. */
export function getHubDatabase(): HubDatabase | null {
  const dbPath = hubDatabasePath();
  if (cached?.path === dbPath) return cached.database;
  if (cached) retireCachedDatabase();
  unavailable = null;

  let Database: DatabaseConstructor;
  try {
    Database = loadDatabaseConstructor();
  } catch (error) {
    unavailable = { path: dbPath, kind: 'native-binding', reason: errorMessage(error) };
    return null;
  }

  let isNewFile: boolean;
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    isNewFile = !fs.existsSync(dbPath);
  } catch (error) {
    unavailable = { path: dbPath, kind: 'open', reason: errorMessage(error) };
    return null;
  }
  let connection: HubDatabaseConnection;
  try {
    connection = new Database(dbPath);
  } catch (error) {
    unavailable = {
      path: dbPath,
      kind: looksLikeNativeBindingFailure(error) ? 'native-binding' : 'open',
      reason: errorMessage(error),
    };
    return null;
  }

  try {
    connection.pragma('journal_mode = WAL');
    connection.pragma('synchronous = NORMAL');
    connection.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    connection.pragma('foreign_keys = ON');
    applyHubDatabaseMigrations(connection);
    if (isNewFile) fs.chmodSync(dbPath, 0o600);
  } catch (error) {
    try {
      connection.close();
    } catch {
      // Preserve the configuration error that made the database unavailable.
    }
    unavailable = { path: dbPath, kind: 'configuration', reason: errorMessage(error) };
    return null;
  }

  const database = new SharedHubDatabase(dbPath, connection);
  cached = { path: dbPath, database };
  return database;
}

export function requireHubDatabase(): HubDatabase {
  const database = getHubDatabase();
  if (database) return database;
  const detail = unavailable?.reason ? `: ${unavailable.reason}` : '';
  throw new Error(`Hub database is unavailable${detail}`);
}

export function getHubDatabaseDiagnostics(): HubDatabaseDiagnostics {
  const dbPath = hubDatabasePath();
  const database = getHubDatabase();
  if (database) return database.diagnostics();
  return {
    available: false,
    path: dbPath,
    failureKind: unavailable?.kind ?? null,
    unavailableReason: unavailable?.reason ?? 'Hub database is unavailable',
    openedAt: null,
    schemaVersion: null,
    appliedMigrationCount: null,
    journalMode: null,
    synchronous: null,
    busyTimeoutMs: null,
    foreignKeys: null,
    queuedWrites: 0,
    activeWrite: null,
  };
}

export async function closeHubDatabase(): Promise<void> {
  const current = cached;
  cached = null;
  if (current) await current.database.close();
}

export async function resetHubDatabaseForTests(): Promise<void> {
  await closeHubDatabase();
  unavailable = null;
}
