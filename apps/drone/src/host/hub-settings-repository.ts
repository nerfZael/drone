import {
  applyHubDatabaseMigrations,
  requireHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from './hub-database';

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

type SettingRow = {
  setting_key: string;
  value_json: string;
  updated_at: string | null;
  version: number;
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
  if (current) {
    connection
      .prepare(
        'UPDATE hub_canonical_settings SET value_json = ?, updated_at = ?, version = ? WHERE setting_key = ?',
      )
      .run(valueJson, updatedAt, version, key);
  } else {
    connection
      .prepare(
        'INSERT INTO hub_canonical_settings (setting_key, value_json, updated_at, version) VALUES (?, ?, ?, ?)',
      )
      .run(key, valueJson, updatedAt, version);
  }
  return { key, value, updatedAt, version };
}

export class HubSettingsRepository {
  private constructor(private readonly database: HubDatabase) {}

  static async open(database: HubDatabase = requireHubDatabase()): Promise<HubSettingsRepository> {
    await database.writeTransaction('migrate canonical hub settings', (connection) => {
      applyHubDatabaseMigrations(connection, SETTINGS_MIGRATIONS, 'settings');
    });
    return new HubSettingsRepository(database);
  }

  get<T>(keyRaw: string): HubSettingRecord<T> | null {
    const key = normalizeKey(keyRaw);
    return this.database.read((connection) => selectSetting<T>(connection, key));
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
    return this.database.writeTransaction(`backfill hub setting ${key}`, (connection) => {
      const current = selectSetting<T>(connection, key);
      if (current) return current;
      return writeSetting(connection, key, value, updatedAt, null);
    });
  }
}

let cachedRepository: { database: HubDatabase; repository: Promise<HubSettingsRepository> } | null =
  null;

export function getHubSettingsRepository(): Promise<HubSettingsRepository> {
  const database = requireHubDatabase();
  if (cachedRepository?.database === database) return cachedRepository.repository;
  const repository = HubSettingsRepository.open(database).catch((error) => {
    if (cachedRepository?.database === database) cachedRepository = null;
    throw error;
  });
  cachedRepository = { database, repository };
  return repository;
}
