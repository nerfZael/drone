import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  requireHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from './hub-database';
import { droneRootPath } from './paths';

const SETTINGS_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'canonical hub settings',
    migrate(connection) {
      // This intentionally does not reuse the legacy hub_settings projection:
      // registry snapshot writes delete and rebuild that table wholesale.
      connection.exec(`
        CREATE TABLE hub_canonical_settings (
          setting_key TEXT NOT NULL PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT,
          version INTEGER NOT NULL CHECK (version > 0)
        );
      `);
    },
  },
];
const migratedDatabases = new WeakSet<HubDatabase>();

function ensureSettingsMigrations(database: HubDatabase): void {
  if (migratedDatabases.has(database)) return;
  database.read((connection) => {
    applyHubDatabaseMigrations(connection, SETTINGS_MIGRATIONS, 'settings');
  });
  migratedDatabases.add(database);
}

type SettingRow = {
  setting_key: string;
  value_json: string;
  updated_at: string | null;
  version: number;
};

type CompatibilitySettingsFile = {
  version: 1;
  settings: Record<string, SettingRow>;
};

type CompatibilityBackend = {
  path: string;
  rows: Map<string, SettingRow>;
  queue: Promise<void>;
};

export type HubSettingRecord<T> = {
  key: string;
  value: T;
  updatedAt: string | null;
  version: number;
};

export type HubSettingWriteOptions = {
  /** Undefined is an unconditional write; null means the row must be absent. */
  expectedVersion?: number | null;
  updatedAt?: string | null;
};

export class HubSettingVersionConflictError<T = unknown> extends Error {
  readonly key: string;
  readonly expectedVersion: number | null;
  readonly current: HubSettingRecord<T> | null;

  constructor(key: string, expectedVersion: number | null, current: HubSettingRecord<T> | null) {
    super(`Hub setting ${JSON.stringify(key)} changed on the server`);
    this.name = 'HubSettingVersionConflictError';
    this.key = key;
    this.expectedVersion = expectedVersion;
    this.current = current;
  }
}

function normalizeKey(keyRaw: string): string {
  const key = String(keyRaw ?? '').trim();
  if (!key) throw new Error('Hub setting key cannot be empty');
  if (key.length > 200) throw new Error('Hub setting key cannot exceed 200 characters');
  return key;
}

function normalizeExpectedVersion(value: number | null | undefined): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Expected Hub setting version must be a positive integer or null');
  return value;
}

function serializeValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Hub setting value must be JSON serializable');
  return serialized;
}

function recordFromRow<T>(row: SettingRow | undefined): HubSettingRecord<T> | null {
  if (!row) return null;
  let value: T;
  try {
    value = JSON.parse(row.value_json) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Hub setting ${JSON.stringify(row.setting_key)} contains invalid JSON: ${message}`,
    );
  }
  return {
    key: row.setting_key,
    value,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

function monotonicUpdatedAt(
  updatedAt: string | null,
  current: HubSettingRecord<unknown> | null,
): string | null {
  if (!updatedAt || !current?.updatedAt) return updatedAt;
  const nextMs = Date.parse(updatedAt);
  const currentMs = Date.parse(current.updatedAt);
  if (!Number.isFinite(nextMs) || !Number.isFinite(currentMs) || nextMs > currentMs) return updatedAt;
  return new Date(currentMs + 1).toISOString();
}

function selectSetting<T>(
  connection: HubDatabaseConnection,
  key: string,
): HubSettingRecord<T> | null {
  const row = connection
    .prepare(
      'SELECT setting_key, value_json, updated_at, version FROM hub_canonical_settings WHERE setting_key = ?',
    )
    .get(key) as SettingRow | undefined;
  return recordFromRow<T>(row);
}

function writeSetting<T>(
  connection: HubDatabaseConnection,
  key: string,
  value: T,
  updatedAt: string | null,
  current: HubSettingRecord<T> | null,
): HubSettingRecord<T> {
  const valueJson = serializeValue(value);
  const version = (current?.version ?? 0) + 1;
  const effectiveUpdatedAt = monotonicUpdatedAt(updatedAt, current);
  if (current) {
    connection
      .prepare(
        'UPDATE hub_canonical_settings SET value_json = ?, updated_at = ?, version = ? WHERE setting_key = ?',
      )
      .run(valueJson, effectiveUpdatedAt, version, key);
  } else {
    connection
      .prepare(
        'INSERT INTO hub_canonical_settings (setting_key, value_json, updated_at, version) VALUES (?, ?, ?, ?)',
      )
      .run(key, valueJson, effectiveUpdatedAt, version);
  }
  return { key, value, updatedAt: effectiveUpdatedAt, version };
}

function compatibilityFilePath(): string {
  return droneRootPath('hub-settings.bun.json');
}

function bunCompatibilityAvailable(): boolean {
  return typeof (globalThis as any).Bun !== 'undefined';
}

function readCompatibilityRows(filePath: string): Map<string, SettingRow> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CompatibilitySettingsFile;
    const settings = parsed?.version === 1 && parsed.settings && typeof parsed.settings === 'object'
      ? parsed.settings
      : {};
    return new Map(
      Object.entries(settings).filter((entry): entry is [string, SettingRow] => {
        const row = entry[1];
        return Boolean(
          row &&
            typeof row === 'object' &&
            typeof row.setting_key === 'string' &&
            typeof row.value_json === 'string' &&
            Number.isSafeInteger(row.version) &&
            row.version > 0,
        );
      }),
    );
  } catch (error: any) {
    if (String(error?.code ?? '') === 'ENOENT') return new Map();
    throw error;
  }
}

async function persistCompatibilityRows(backend: CompatibilityBackend): Promise<void> {
  const directory = path.dirname(backend.path);
  await fsp.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.hub-settings.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  const settings = Object.fromEntries(backend.rows);
  try {
    await fsp.writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, settings }, null, 2)}\n`,
      'utf8',
    );
    await fsp.chmod(temporaryPath, 0o600).catch(() => {});
    await fsp.rename(temporaryPath, backend.path);
    await fsp.chmod(backend.path, 0o600).catch(() => {});
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export class HubSettingsRepository {
  private constructor(
    private readonly database: HubDatabase | null,
    private readonly compatibility: CompatibilityBackend | null,
  ) {}

  static async open(database: HubDatabase | null = getHubDatabase()): Promise<HubSettingsRepository> {
    if (!database) {
      if (!bunCompatibilityAvailable()) database = requireHubDatabase();
      else {
        const filePath = compatibilityFilePath();
        return new HubSettingsRepository(null, {
          path: filePath,
          rows: readCompatibilityRows(filePath),
          queue: Promise.resolve(),
        });
      }
    }
    ensureSettingsMigrations(database);
    return new HubSettingsRepository(database, null);
  }

  get<T>(keyRaw: string): HubSettingRecord<T> | null {
    const key = normalizeKey(keyRaw);
    if (this.database) return this.database.read((connection) => selectSetting<T>(connection, key));
    return recordFromRow<T>(this.compatibility?.rows.get(key));
  }

  private compatibilityWrite<T>(
    operation: (rows: Map<string, SettingRow>) => T,
  ): Promise<T> {
    const backend = this.compatibility;
    if (!backend) throw new Error('Hub settings compatibility backend is unavailable');
    const previous = backend.queue;
    const write = previous.catch(() => {}).then(async () => {
      const previousRows = new Map(backend.rows);
      try {
        const result = operation(backend.rows);
        await persistCompatibilityRows(backend);
        return result;
      } catch (error) {
        backend.rows.clear();
        for (const [key, row] of previousRows) backend.rows.set(key, row);
        throw error;
      }
    });
    backend.queue = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  put<T>(
    keyRaw: string,
    value: T,
    options: HubSettingWriteOptions = {},
  ): Promise<HubSettingRecord<T>> {
    const key = normalizeKey(keyRaw);
    const expectedVersion = normalizeExpectedVersion(options.expectedVersion);
    const updatedAt =
      options.updatedAt === undefined ? new Date().toISOString() : options.updatedAt;
    if (!this.database) {
      return this.compatibilityWrite((rows) => {
        const current = recordFromRow<T>(rows.get(key));
        if (expectedVersion !== undefined && expectedVersion !== (current?.version ?? null)) {
          throw new HubSettingVersionConflictError(key, expectedVersion, current);
        }
        const next = {
          key,
          value,
          updatedAt: monotonicUpdatedAt(updatedAt, current),
          version: (current?.version ?? 0) + 1,
        };
        rows.set(key, {
          setting_key: key,
          value_json: serializeValue(value),
          updated_at: next.updatedAt,
          version: next.version,
        });
        return next;
      });
    }
    return this.database.writeTransaction(`write hub setting ${key}`, (connection) => {
      const current = selectSetting<T>(connection, key);
      if (expectedVersion !== undefined && expectedVersion !== (current?.version ?? null)) {
        throw new HubSettingVersionConflictError(key, expectedVersion, current);
      }
      return writeSetting(connection, key, value, updatedAt, current);
    });
  }

  /** Atomically reads, transforms, and versions a setting without a lost-update window. */
  update<T>(
    keyRaw: string,
    transform: (current: HubSettingRecord<T> | null) => T,
    options: Pick<HubSettingWriteOptions, 'updatedAt'> = {},
  ): Promise<HubSettingRecord<T>> {
    const key = normalizeKey(keyRaw);
    const updatedAt =
      options.updatedAt === undefined ? new Date().toISOString() : options.updatedAt;
    if (!this.database) {
      return this.compatibilityWrite((rows) => {
        const current = recordFromRow<T>(rows.get(key));
        const value = transform(current);
        const next = {
          key,
          value,
          updatedAt: monotonicUpdatedAt(updatedAt, current),
          version: (current?.version ?? 0) + 1,
        };
        rows.set(key, {
          setting_key: key,
          value_json: serializeValue(value),
          updated_at: next.updatedAt,
          version: next.version,
        });
        return next;
      });
    }
    return this.database.writeTransaction(`update hub setting ${key}`, (connection) => {
      const current = selectSetting<T>(connection, key);
      return writeSetting(connection, key, transform(current), updatedAt, current);
    });
  }

  /** Inserts legacy state exactly once and returns the winning canonical row. */
  backfillIfAbsent<T>(
    keyRaw: string,
    value: T,
    updatedAt: string | null,
  ): Promise<HubSettingRecord<T>> {
    const key = normalizeKey(keyRaw);
    if (!this.database) {
      return this.compatibilityWrite((rows) => {
        const current = recordFromRow<T>(rows.get(key));
        if (current) return current;
        const next = { key, value, updatedAt, version: 1 };
        rows.set(key, {
          setting_key: key,
          value_json: serializeValue(value),
          updated_at: updatedAt,
          version: 1,
        });
        return next;
      });
    }
    return this.database.writeTransaction(`backfill hub setting ${key}`, (connection) => {
      const current = selectSetting<T>(connection, key);
      if (current) return current;
      return writeSetting(connection, key, value, updatedAt, null);
    });
  }
}

let cachedRepository: { key: HubDatabase | string; repository: Promise<HubSettingsRepository> } | null = null;

export function getHubSettingsRepository(): Promise<HubSettingsRepository> {
  const database = getHubDatabase();
  const key: HubDatabase | string = database ?? compatibilityFilePath();
  if (cachedRepository?.key === key) return cachedRepository.repository;
  const repository = HubSettingsRepository.open(database).catch((error) => {
    if (cachedRepository?.key === key) cachedRepository = null;
    throw error;
  });
  cachedRepository = { key, repository };
  return repository;
}

export function getHubSettingRecordSync<T>(keyRaw: string): HubSettingRecord<T> | null {
  const key = normalizeKey(keyRaw);
  const database = getHubDatabase();
  if (database) {
    ensureSettingsMigrations(database);
    return database.read((connection) => selectSetting<T>(connection, key));
  }
  if (!bunCompatibilityAvailable()) requireHubDatabase();
  return recordFromRow<T>(readCompatibilityRows(compatibilityFilePath()).get(key));
}

export function resetHubSettingsRepositoryForTests(): void {
  cachedRepository = null;
}
