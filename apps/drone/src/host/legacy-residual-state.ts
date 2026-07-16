import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseMigration,
} from './hub-database';
import type { DroneRegistry } from './registry';

export type LegacyResidualState = Record<string, any> & { version: 2 };

const CANONICAL_TOP_LEVEL = new Set([
  'drones', 'pending', 'archived', 'skills', 'mcpServers', 'mcpTokens',
  'playbooks', 'repos', 'groups', 'playbookRunQueue',
]);
const CANONICAL_SETTINGS = new Set([
  'openai', 'gemini', 'groq', 'exa', 'llm', 'deleteAction', 'filesystem',
  'agentMessageAutoContinue', 'agentSuggestion',
  'uiPreferences', 'backups', 'agents',
  'nonRepoEnvironment', 'syncSets',
]);

export class CanonicalRegistryMutationError extends Error {
  readonly paths: string[];

  constructor(paths: string[]) {
    super(`updateRegistry cannot mutate canonical-owned state: ${paths.join(', ')}`);
    this.name = 'CanonicalRegistryMutationError';
    this.paths = paths;
  }
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function changedCanonicalPaths(beforeRaw: unknown, afterRaw: unknown): string[] {
  const before = objectRecord(beforeRaw);
  const after = objectRecord(afterRaw);
  const changed: string[] = [];
  for (const key of CANONICAL_TOP_LEVEL) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  const beforeSettings = objectRecord(before.settings);
  const afterSettings = objectRecord(after.settings);
  for (const key of CANONICAL_SETTINGS) {
    if (JSON.stringify(beforeSettings[key]) !== JSON.stringify(afterSettings[key])) changed.push(`settings.${key}`);
  }
  return changed;
}

/** Removes every namespace now owned by a canonical repository. */
export function stripCanonicalOwnedRegistryState(registry: DroneRegistry | Record<string, any>): LegacyResidualState {
  const source = objectRecord(clone(registry));
  const residual: Record<string, any> = { version: 2 };
  for (const [key, value] of Object.entries(source)) {
    if (key === 'version' || key === 'settings' || key === 'fleet' || CANONICAL_TOP_LEVEL.has(key)) continue;
    residual[key] = value;
  }
  const settings = Object.fromEntries(
    Object.entries(objectRecord(source.settings)).filter(([key]) => !CANONICAL_SETTINGS.has(key)),
  );
  if (Object.keys(settings).length > 0) residual.settings = settings;
  return residual as LegacyResidualState;
}

/** Replaces residual-owned namespaces while retaining canonical projection fields. */
export function mergeRegistryResidualState(
  canonicalBase: DroneRegistry | Record<string, any>,
  residualRaw: LegacyResidualState | Record<string, any>,
): DroneRegistry {
  const base = objectRecord(clone(canonicalBase));
  const residual = objectRecord(clone(residualRaw));
  for (const key of Object.keys(base)) {
    if (key === 'version' || key === 'settings' || CANONICAL_TOP_LEVEL.has(key)) continue;
    delete base[key];
  }
  for (const [key, value] of Object.entries(residual)) {
    if (key === 'version' || key === 'settings' || key === 'fleet') continue;
    base[key] = value;
  }
  const canonicalSettings = Object.fromEntries(
    Object.entries(objectRecord(base.settings)).filter(([key]) => CANONICAL_SETTINGS.has(key)),
  );
  base.settings = { ...canonicalSettings, ...objectRecord(residual.settings) };
  base.version = 2;
  return base as DroneRegistry;
}

const MIGRATIONS: readonly HubDatabaseMigration[] = [{
  version: 1,
  name: 'legacy residual compatibility state',
  migrate(connection) {
    connection.exec(`
      CREATE TABLE legacy_residual_state (
        id TEXT NOT NULL PRIMARY KEY CHECK (id = 'current'),
        state_json TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        updated_at TEXT NOT NULL
      );
    `);
  },
}];

type ResidualRow = { state_json: string; version: number; updated_at: string };

function parseState(row: ResidualRow | undefined): LegacyResidualState | null {
  if (!row) return null;
  const parsed = JSON.parse(row.state_json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('legacy residual state is invalid');
  }
  return parsed as LegacyResidualState;
}

function serializeState(state: LegacyResidualState): string {
  const serialized = JSON.stringify(state);
  if (!serialized) throw new Error('legacy residual state is not JSON serializable');
  return serialized;
}

export class LegacyResidualStateRepository {
  constructor(private readonly database: HubDatabase) {
    database.read((connection) => applyHubDatabaseMigrations(connection, MIGRATIONS, 'legacy-residual'));
  }

  read(): LegacyResidualState | null {
    return this.database.read((connection) => parseState(
      connection.prepare("SELECT state_json,version,updated_at FROM legacy_residual_state WHERE id='current'").get() as
        | ResidualRow
        | undefined,
    ));
  }

  async seedIfAbsent(seed: DroneRegistry): Promise<LegacyResidualState> {
    return await this.database.writeTransaction('seed legacy residual state', (connection) => {
      connection.prepare(`
        INSERT OR IGNORE INTO legacy_residual_state (id,state_json,version,updated_at)
        VALUES ('current',?,1,?)
      `).run(serializeState(stripCanonicalOwnedRegistryState(seed)), new Date().toISOString());
      return parseState(connection.prepare(
        "SELECT state_json,version,updated_at FROM legacy_residual_state WHERE id='current'",
      ).get() as ResidualRow)!;
    });
  }

  /** Atomically transforms compatibility-only state in the shared SQLite FIFO. */
  async update<T>(compatibilityBase: DroneRegistry, mutator: (state: DroneRegistry) => T): Promise<{ result: T; state: DroneRegistry }> {
    return await this.database.writeTransaction('update legacy residual state', (connection) => {
      connection.prepare(`
        INSERT OR IGNORE INTO legacy_residual_state (id,state_json,version,updated_at)
        VALUES ('current',?,1,?)
      `).run(serializeState(stripCanonicalOwnedRegistryState(compatibilityBase)), new Date().toISOString());
      const row = connection.prepare(
        "SELECT state_json,version,updated_at FROM legacy_residual_state WHERE id='current'",
      ).get() as ResidualRow;
      const current = parseState(row)!;
      const state = mergeRegistryResidualState(compatibilityBase, current);
      const canonicalBefore = clone(state);
      const result = mutator(state);
      if (result && (typeof result === 'object' || typeof result === 'function') && typeof (result as any).then === 'function') {
        throw new TypeError('legacy residual state mutators must be synchronous');
      }
      const changedPaths = changedCanonicalPaths(canonicalBefore, state);
      if (changedPaths.length > 0) throw new CanonicalRegistryMutationError(changedPaths);
      connection.prepare(`
        UPDATE legacy_residual_state
        SET state_json=?,version=version+1,updated_at=?
        WHERE id='current'
      `).run(serializeState(stripCanonicalOwnedRegistryState(state)), new Date().toISOString());
      return { result, state };
    });
  }
}

let cached: { database: HubDatabase; repository: LegacyResidualStateRepository } | null = null;

export function getLegacyResidualStateRepository(): LegacyResidualStateRepository | null {
  const database = getHubDatabase();
  if (!database) return null;
  if (cached?.database === database) return cached.repository;
  const repository = new LegacyResidualStateRepository(database);
  cached = { database, repository };
  return repository;
}
