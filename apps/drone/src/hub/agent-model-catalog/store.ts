import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseMigration,
} from '../../host/hub-database';
import type {
  AgentModelCatalogCacheEntry,
  AgentModelCatalogStore,
} from './types';

const MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'agent model catalog cache',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE agent_model_catalog_cache (
          cache_key TEXT NOT NULL PRIMARY KEY,
          agent_id TEXT NOT NULL,
          runtime TEXT NOT NULL,
          models_json TEXT NOT NULL,
          discovered_at TEXT NOT NULL,
          installation_fingerprint TEXT,
          error TEXT
        );
      `);
    },
  },
];

type CatalogRow = {
  cache_key: string;
  agent_id: AgentModelCatalogCacheEntry['agentId'];
  runtime: AgentModelCatalogCacheEntry['runtime'];
  models_json: string;
  discovered_at: string;
  installation_fingerprint: string | null;
  error: string | null;
};

export function createAgentModelCatalogStore(
  database: HubDatabase | null = getHubDatabase(),
): AgentModelCatalogStore | null {
  if (!database) return null;
  database.read((connection) =>
    applyHubDatabaseMigrations(connection, MIGRATIONS, 'agent-model-catalog'),
  );

  return {
    read(key) {
      const row = database.read(
        (connection) =>
          connection
            .prepare('SELECT * FROM agent_model_catalog_cache WHERE cache_key = ?')
            .get(key) as CatalogRow | undefined,
      );
      if (!row) return null;
      try {
        const models = JSON.parse(row.models_json);
        if (!Array.isArray(models)) return null;
        return {
          key: row.cache_key,
          agentId: row.agent_id,
          runtime: row.runtime,
          models,
          discoveredAt: row.discovered_at,
          ...(row.installation_fingerprint
            ? { installationFingerprint: row.installation_fingerprint }
            : {}),
          ...(row.error ? { error: row.error } : {}),
        };
      } catch {
        return null;
      }
    },
    async write(entry) {
      await database.writeTransaction('cache agent model catalog', (connection) => {
        connection
          .prepare(
            `INSERT INTO agent_model_catalog_cache (
              cache_key, agent_id, runtime, models_json, discovered_at,
              installation_fingerprint, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
              agent_id = excluded.agent_id,
              runtime = excluded.runtime,
              models_json = excluded.models_json,
              discovered_at = excluded.discovered_at,
              installation_fingerprint = excluded.installation_fingerprint,
              error = excluded.error`,
          )
          .run(
            entry.key,
            entry.agentId,
            entry.runtime,
            JSON.stringify(entry.models),
            entry.discoveredAt,
            entry.installationFingerprint ?? null,
            entry.error ?? null,
          );
      });
    },
  };
}
