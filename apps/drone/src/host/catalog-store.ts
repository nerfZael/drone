import {
  applyHubDatabaseMigrations,
  requireHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from './hub-database';
import { appendHubOutboxEvent, initializeHubOutbox } from './hub-outbox';

const CATALOG_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'canonical configuration catalogs',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE catalog_skills (
          id TEXT NOT NULL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          record_json TEXT NOT NULL
        );

        CREATE TABLE catalog_mcp_servers (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          record_json TEXT NOT NULL
        );

        CREATE TABLE catalog_mcp_tokens (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('host', 'drone')),
          drone_id TEXT,
          secret_seed TEXT NOT NULL,
          token_preview TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_used_at TEXT,
          revoked_at TEXT,
          CHECK ((kind = 'drone' AND drone_id IS NOT NULL) OR (kind = 'host' AND drone_id IS NULL))
        );

        CREATE UNIQUE INDEX catalog_active_host_token_name
          ON catalog_mcp_tokens (name) WHERE kind = 'host' AND revoked_at IS NULL;
        CREATE UNIQUE INDEX catalog_active_drone_token
          ON catalog_mcp_tokens (drone_id) WHERE kind = 'drone' AND revoked_at IS NULL;

        CREATE TABLE catalog_groups (
          name TEXT NOT NULL PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE catalog_repositories (
          path TEXT NOT NULL PRIMARY KEY,
          added_at TEXT NOT NULL,
          remote_url TEXT,
          github_owner TEXT,
          github_repo TEXT,
          environment_json TEXT,
          agents_json TEXT
        );

        CREATE TABLE catalog_playbooks (
          id TEXT NOT NULL PRIMARY KEY,
          label TEXT NOT NULL,
          agent_json TEXT NOT NULL,
          model TEXT,
          messages_json TEXT NOT NULL,
          artifacts_json TEXT NOT NULL,
          actions_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE catalog_backfills (
          domain TEXT NOT NULL PRIMARY KEY,
          completed_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'versioned group and repository commands',
    migrate(connection) {
      connection.exec(`
        ALTER TABLE catalog_groups ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
        ALTER TABLE catalog_groups ADD COLUMN deleted_at TEXT;
        ALTER TABLE catalog_repositories ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
        ALTER TABLE catalog_repositories ADD COLUMN environment_version INTEGER NOT NULL DEFAULT 1 CHECK (environment_version > 0);
        ALTER TABLE catalog_repositories ADD COLUMN agents_version INTEGER NOT NULL DEFAULT 1 CHECK (agents_version > 0);
        ALTER TABLE catalog_repositories ADD COLUMN updated_at TEXT;
        ALTER TABLE catalog_repositories ADD COLUMN deleted_at TEXT;
      `);
    },
  },
];

export type CatalogSkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type CatalogMcpServerRecord = {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type CatalogMcpTokenRecord = {
  id: string;
  name: string;
  kind: 'host' | 'drone';
  droneId?: string;
  secretSeed: string;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type CatalogGroupRecord = { name: string; createdAt: string; updatedAt: string; version?: number };

export type CatalogRepositoryRecord = {
  path: string;
  addedAt: string;
  remoteUrl?: string;
  github?: { owner: string; repo: string };
  environment?: unknown;
  agents?: unknown;
  updatedAt?: string;
  version?: number;
  environmentVersion?: number;
  agentsVersion?: number;
};

export type CatalogPlaybookRecord = {
  id: string;
  label: string;
  agent: unknown;
  model?: string;
  messages: unknown[];
  artifacts: unknown[];
  actions: unknown[];
  createdAt: string;
  updatedAt: string;
};

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Catalog value must be JSON serializable');
  return serialized;
}

function parse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function optionalJson(raw: string | null): unknown | undefined {
  return raw == null ? undefined : parse(raw);
}

export class CatalogStore {
  private constructor(private readonly database: HubDatabase) {}

  static async open(database: HubDatabase = requireHubDatabase()): Promise<CatalogStore> {
    initializeHubOutbox(database);
    database.read((connection) => {
      applyHubDatabaseMigrations(connection, CATALOG_MIGRATIONS, 'catalog');
    });
    return new CatalogStore(database);
  }

  isBackfillComplete(domain: 'skills' | 'mcp-servers' | 'mcp-tokens' | 'playbooks'): boolean {
    return this.database.read((connection) => this.backfillComplete(connection, domain));
  }

  listSkills<T extends CatalogSkillRecord>(): T[] {
    return this.database.read((connection) =>
      (connection.prepare('SELECT record_json FROM catalog_skills ORDER BY slug').all() as Array<{ record_json: string }>).map(
        (row) => parse<T>(row.record_json),
      ),
    );
  }

  backfillSkills<T extends CatalogSkillRecord>(records: T[]): Promise<boolean> {
    return this.database.writeTransaction('backfill skill catalog', (connection) => {
      if (this.backfillComplete(connection, 'skills')) return false;
      const insert = connection.prepare(`INSERT OR IGNORE INTO catalog_skills
        (id,slug,name,description,created_at,updated_at,record_json) VALUES (?,?,?,?,?,?,?)`);
      for (const record of records) insert.run(record.id, record.slug, record.name, record.description,
        record.createdAt, record.updatedAt, json(record));
      this.completeBackfill(connection, 'skills');
      return true;
    });
  }

  getSkill<T extends CatalogSkillRecord>(id: string): T | null {
    return this.database.read((connection) => {
      const row = connection.prepare('SELECT record_json FROM catalog_skills WHERE id = ?').get(id) as
        | { record_json: string }
        | undefined;
      return row ? parse<T>(row.record_json) : null;
    });
  }

  putSkill<T extends CatalogSkillRecord>(record: T, insertOnly = false): Promise<T> {
    return this.database.writeTransaction('write skill catalog', (connection) => {
      if (insertOnly) {
        connection
          .prepare(`INSERT OR IGNORE INTO catalog_skills
            (id, slug, name, description, created_at, updated_at, record_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(record.id, record.slug, record.name, record.description, record.createdAt, record.updatedAt, json(record));
      } else {
        connection
          .prepare(`INSERT INTO catalog_skills
            (id, slug, name, description, created_at, updated_at, record_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name,
              description=excluded.description, updated_at=excluded.updated_at, record_json=excluded.record_json`)
          .run(record.id, record.slug, record.name, record.description, record.createdAt, record.updatedAt, json(record));
      }
      const stored = this.selectSkill<T>(connection, record.id) ?? this.selectSkillBySlug<T>(connection, record.slug);
      if (!stored) throw new Error(`Failed to persist skill ${record.id}`);
      return stored;
    });
  }

  deleteSkill(id: string): Promise<boolean> {
    return this.deleteById('catalog_skills', id, 'delete skill');
  }

  listMcpServers<T extends CatalogMcpServerRecord>(): T[] {
    return this.database.read((connection) =>
      (connection.prepare('SELECT record_json FROM catalog_mcp_servers ORDER BY name').all() as Array<{ record_json: string }>).map(
        (row) => parse<T>(row.record_json),
      ),
    );
  }

  backfillMcpServers<T extends CatalogMcpServerRecord>(records: T[]): Promise<boolean> {
    return this.database.writeTransaction('backfill MCP server catalog', (connection) => {
      if (this.backfillComplete(connection, 'mcp-servers')) return false;
      const insert = connection.prepare(`INSERT OR IGNORE INTO catalog_mcp_servers
        (id,name,enabled,transport,created_at,updated_at,record_json) VALUES (?,?,?,?,?,?,?)`);
      for (const record of records) insert.run(record.id, record.name, record.enabled ? 1 : 0, record.transport,
        record.createdAt, record.updatedAt, json(record));
      this.completeBackfill(connection, 'mcp-servers');
      return true;
    });
  }

  getMcpServer<T extends CatalogMcpServerRecord>(id: string): T | null {
    return this.database.read((connection) => this.selectMcpServer<T>(connection, id));
  }

  putMcpServer<T extends CatalogMcpServerRecord>(record: T, insertOnly = false): Promise<T> {
    return this.database.writeTransaction('write MCP server catalog', (connection) => {
      const values = [record.id, record.name, record.enabled ? 1 : 0, record.transport, record.createdAt, record.updatedAt, json(record)];
      if (insertOnly) {
        connection.prepare(`INSERT OR IGNORE INTO catalog_mcp_servers
          (id, name, enabled, transport, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(...values);
      } else {
        connection.prepare(`INSERT INTO catalog_mcp_servers
          (id, name, enabled, transport, created_at, updated_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, enabled=excluded.enabled,
            transport=excluded.transport, updated_at=excluded.updated_at, record_json=excluded.record_json`)
          .run(...values);
      }
      const stored = this.selectMcpServer<T>(connection, record.id) ?? this.selectMcpServerByName<T>(connection, record.name);
      if (!stored) throw new Error(`Failed to persist MCP server ${record.id}`);
      return stored;
    });
  }

  deleteMcpServer(id: string): Promise<boolean> {
    return this.deleteById('catalog_mcp_servers', id, 'delete MCP server');
  }

  listMcpTokens(): CatalogMcpTokenRecord[] {
    return this.database.read((connection) =>
      (connection.prepare('SELECT * FROM catalog_mcp_tokens ORDER BY kind, name').all() as any[]).map(this.tokenFromRow),
    );
  }

  backfillMcpTokens(records: CatalogMcpTokenRecord[]): Promise<boolean> {
    return this.database.writeTransaction('backfill MCP token catalog', (connection) => {
      if (this.backfillComplete(connection, 'mcp-tokens')) return false;
      const insert = connection.prepare(`INSERT OR IGNORE INTO catalog_mcp_tokens
        (id,name,kind,drone_id,secret_seed,token_preview,created_at,updated_at,last_used_at,revoked_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const record of records) insert.run(record.id, record.name, record.kind, record.droneId ?? null,
        record.secretSeed, record.tokenPreview, record.createdAt, record.updatedAt,
        record.lastUsedAt ?? null, record.revokedAt ?? null);
      this.completeBackfill(connection, 'mcp-tokens');
      return true;
    });
  }

  getMcpToken(id: string): CatalogMcpTokenRecord | null {
    return this.database.read((connection) => {
      const row = connection.prepare('SELECT * FROM catalog_mcp_tokens WHERE id = ?').get(id) as any;
      return row ? this.tokenFromRow(row) : null;
    });
  }

  putMcpToken(record: CatalogMcpTokenRecord, insertOnly = false): Promise<CatalogMcpTokenRecord> {
    return this.database.writeTransaction('write MCP token catalog', (connection) => {
      const values = [record.id, record.name, record.kind, record.droneId ?? null, record.secretSeed,
        record.tokenPreview, record.createdAt, record.updatedAt, record.lastUsedAt ?? null, record.revokedAt ?? null];
      if (insertOnly) {
        connection.prepare(`INSERT OR IGNORE INTO catalog_mcp_tokens
          (id,name,kind,drone_id,secret_seed,token_preview,created_at,updated_at,last_used_at,revoked_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(...values);
      } else {
        connection.prepare(`INSERT INTO catalog_mcp_tokens
          (id,name,kind,drone_id,secret_seed,token_preview,created_at,updated_at,last_used_at,revoked_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, drone_id=excluded.drone_id,
            secret_seed=excluded.secret_seed, token_preview=excluded.token_preview, updated_at=excluded.updated_at,
            last_used_at=excluded.last_used_at, revoked_at=excluded.revoked_at`).run(...values);
      }
      const row = connection.prepare(`SELECT * FROM catalog_mcp_tokens WHERE id = ? OR
        (kind='host' AND ?='host' AND name=? AND revoked_at IS NULL) OR
        (kind='drone' AND ?='drone' AND drone_id=? AND revoked_at IS NULL)
        ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`)
        .get(record.id, record.kind, record.name, record.kind, record.droneId ?? null, record.id) as any;
      if (!row) throw new Error(`Failed to persist MCP token ${record.id}`);
      return this.tokenFromRow(row);
    });
  }

  updateMcpToken(id: string, transform: (record: CatalogMcpTokenRecord) => CatalogMcpTokenRecord): Promise<CatalogMcpTokenRecord | null> {
    return this.database.writeTransaction('update MCP token catalog', (connection) => {
      const row = connection.prepare('SELECT * FROM catalog_mcp_tokens WHERE id = ?').get(id) as any;
      if (!row) return null;
      const next = transform(this.tokenFromRow(row));
      connection.prepare(`UPDATE catalog_mcp_tokens SET name=?, kind=?, drone_id=?, secret_seed=?, token_preview=?,
        updated_at=?, last_used_at=?, revoked_at=? WHERE id=?`).run(next.name, next.kind, next.droneId ?? null,
        next.secretSeed, next.tokenPreview, next.updatedAt, next.lastUsedAt ?? null, next.revokedAt ?? null, id);
      return next;
    });
  }

  revokeMcpTokensForDrone(droneId: string, at: string): Promise<CatalogMcpTokenRecord[]> {
    return this.database.writeTransaction('revoke drone MCP tokens', (connection) => {
      connection.prepare(`UPDATE catalog_mcp_tokens SET revoked_at=?, updated_at=?
        WHERE kind='drone' AND drone_id=? AND revoked_at IS NULL`).run(at, at, droneId);
      return (connection.prepare(`SELECT * FROM catalog_mcp_tokens WHERE kind='drone' AND drone_id=? AND revoked_at=?`)
        .all(droneId, at) as any[]).map(this.tokenFromRow);
    });
  }

  listGroups(): CatalogGroupRecord[] {
    return this.database.read((connection) => (connection.prepare(
      'SELECT * FROM catalog_groups WHERE deleted_at IS NULL ORDER BY name').all() as any[]).map(this.groupFromRow));
  }

  backfillGroups(records: CatalogGroupRecord[]): Promise<boolean> {
    return this.database.writeTransaction('backfill group catalog', (connection) => {
      const insert = connection.prepare('INSERT OR IGNORE INTO catalog_groups (name,created_at,updated_at) VALUES (?,?,?)');
      let inserted = 0;
      for (const record of records) inserted += Number(insert.run(record.name, record.createdAt, record.updatedAt).changes ?? 0);
      return inserted > 0;
    });
  }

  putGroup(record: CatalogGroupRecord, insertOnly = false): Promise<CatalogGroupRecord> {
    return this.database.writeTransaction('write group catalog', (connection) => {
      if (insertOnly) {
        connection.prepare('INSERT OR IGNORE INTO catalog_groups (name,created_at,updated_at) VALUES (?,?,?)')
          .run(record.name, record.createdAt, record.updatedAt);
      } else {
        const current = connection.prepare('SELECT * FROM catalog_groups WHERE name=?').get(record.name) as any;
        connection.prepare(`INSERT INTO catalog_groups (name,created_at,updated_at,version,deleted_at) VALUES (?,?,?,1,NULL)
          ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at, version=catalog_groups.version+1, deleted_at=NULL`)
          .run(record.name, record.createdAt, record.updatedAt);
        appendHubOutboxEvent(connection, {
          topic: 'catalog.groups', eventType: current?.deleted_at == null && current ? 'group.updated' : 'group.created',
          aggregateType: 'group', aggregateId: record.name,
          payload: { name: record.name, updatedAt: record.updatedAt },
        });
      }
      const row = connection.prepare('SELECT * FROM catalog_groups WHERE name=?').get(record.name) as any;
      return this.groupFromRow(row);
    });
  }

  deleteGroup(name: string, at = new Date().toISOString()): Promise<boolean> {
    return this.database.writeTransaction('delete group', (connection) => {
      const info = connection.prepare(`UPDATE catalog_groups SET deleted_at=?,updated_at=?,version=version+1
        WHERE name=? AND deleted_at IS NULL`).run(at, at, name);
      if (Number(info.changes ?? 0) !== 1) return false;
      appendHubOutboxEvent(connection, { topic: 'catalog.groups', eventType: 'group.deleted',
        aggregateType: 'group', aggregateId: name, payload: { name, deletedAt: at } });
      return true;
    });
  }

  renameGroups(rewrites: Array<{ from: string; to: string }>, at = new Date().toISOString()): Promise<number> {
    return this.database.writeTransaction('rename group hierarchy', (connection) => {
      const sources = new Set(rewrites.map((item) => item.from));
      const sourceRows = new Map<string, any>();
      for (const item of rewrites) {
        const row = connection.prepare('SELECT * FROM catalog_groups WHERE name=? AND deleted_at IS NULL').get(item.from) as any;
        if (row) sourceRows.set(item.from, row);
      }
      for (const item of rewrites) {
        const collision = connection.prepare('SELECT 1 FROM catalog_groups WHERE name=? AND deleted_at IS NULL').get(item.to);
        if (collision && !sources.has(item.to)) throw new Error(`group already exists: ${item.to}`);
      }
      let renamed = 0;
      for (const item of rewrites) {
        const source = sourceRows.get(item.from);
        if (!source) continue;
        connection.prepare(`INSERT INTO catalog_groups (name,created_at,updated_at,version,deleted_at) VALUES (?,?,?,?,NULL)
          ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at,version=catalog_groups.version+1,deleted_at=NULL`)
          .run(item.to, source.created_at, at, Number(source.version ?? 1) + 1);
        connection.prepare('UPDATE catalog_groups SET deleted_at=?,updated_at=?,version=version+1 WHERE name=?')
          .run(at, at, item.from);
        appendHubOutboxEvent(connection, { topic: 'catalog.groups', eventType: 'group.renamed', aggregateType: 'group',
          aggregateId: item.to, payload: { oldName: item.from, newName: item.to, updatedAt: at } });
        renamed += 1;
      }
      return renamed;
    });
  }

  listRepositories(): CatalogRepositoryRecord[] {
    return this.database.read((connection) => (connection.prepare(
      'SELECT * FROM catalog_repositories WHERE deleted_at IS NULL ORDER BY path').all() as any[]).map(this.repositoryFromRow));
  }

  getRepository(path: string): CatalogRepositoryRecord | null {
    return this.database.read((connection) => {
      const row = connection.prepare('SELECT * FROM catalog_repositories WHERE path=? AND deleted_at IS NULL').get(path) as any;
      return row ? this.repositoryFromRow(row) : null;
    });
  }

  backfillRepositories(records: CatalogRepositoryRecord[]): Promise<boolean> {
    return this.database.writeTransaction('backfill repository catalog', (connection) => {
      const insert = connection.prepare(`INSERT OR IGNORE INTO catalog_repositories
        (path,added_at,remote_url,github_owner,github_repo,environment_json,agents_json) VALUES (?,?,?,?,?,?,?)`);
      let inserted = 0;
      for (const record of records) inserted += Number(insert.run(record.path, record.addedAt, record.remoteUrl ?? null,
        record.github?.owner ?? null, record.github?.repo ?? null,
        record.environment === undefined ? null : json(record.environment), record.agents === undefined ? null : json(record.agents)).changes ?? 0);
      return inserted > 0;
    });
  }

  putRepository(record: CatalogRepositoryRecord, insertOnly = false): Promise<void> {
    return this.database.writeTransaction('write repository catalog', (connection) => {
      if (insertOnly) {
        connection.prepare(`INSERT OR IGNORE INTO catalog_repositories
          (path,added_at,remote_url,github_owner,github_repo,environment_json,agents_json,updated_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(record.path, record.addedAt, record.remoteUrl ?? null,
          record.github?.owner ?? null, record.github?.repo ?? null,
          record.environment === undefined ? null : json(record.environment),
          record.agents === undefined ? null : json(record.agents), record.updatedAt ?? record.addedAt);
        return;
      }
      const current = connection.prepare('SELECT * FROM catalog_repositories WHERE path=?').get(record.path) as any;
      const environmentJson = record.environment === undefined ? current?.environment_json ?? null : json(record.environment);
      const agentsJson = record.agents === undefined ? current?.agents_json ?? null : json(record.agents);
      const updatedAt = record.updatedAt ?? new Date().toISOString();
      connection.prepare(`INSERT INTO catalog_repositories
        (path,added_at,remote_url,github_owner,github_repo,environment_json,agents_json,updated_at,version,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,1,NULL)
        ON CONFLICT(path) DO UPDATE SET remote_url=excluded.remote_url,github_owner=excluded.github_owner,
          github_repo=excluded.github_repo,environment_json=excluded.environment_json,agents_json=excluded.agents_json,
          updated_at=excluded.updated_at,version=catalog_repositories.version+1,deleted_at=NULL`)
        .run(record.path, current?.added_at ?? record.addedAt, record.remoteUrl ?? current?.remote_url ?? null,
          record.github?.owner ?? current?.github_owner ?? null, record.github?.repo ?? current?.github_repo ?? null,
          environmentJson, agentsJson, updatedAt);
      appendHubOutboxEvent(connection, { topic: 'catalog.repositories',
        eventType: current?.deleted_at == null && current ? 'repository.updated' : 'repository.registered',
        aggregateType: 'repository', aggregateId: record.path,
        payload: { path: record.path, updatedAt } });
    });
  }

  updateRepositoryEnvironment(path: string, environment: unknown, at = new Date().toISOString()): Promise<CatalogRepositoryRecord> {
    return this.updateRepositoryPart(path, 'environment', environment, at);
  }

  updateRepositoryAgents(path: string, agents: unknown, at = new Date().toISOString()): Promise<CatalogRepositoryRecord> {
    return this.updateRepositoryPart(path, 'agents', agents, at);
  }

  deleteRepository(path: string, at = new Date().toISOString()): Promise<boolean> {
    return this.database.writeTransaction('delete repository catalog', (connection) => {
      const info = connection.prepare(`UPDATE catalog_repositories SET deleted_at=?,updated_at=?,version=version+1
        WHERE path=? AND deleted_at IS NULL`).run(at, at, path);
      if (Number(info.changes ?? 0) !== 1) return false;
      appendHubOutboxEvent(connection, { topic: 'catalog.repositories', eventType: 'repository.removed',
        aggregateType: 'repository', aggregateId: path, payload: { path, deletedAt: at } });
      return true;
    });
  }

  listPlaybooks(): CatalogPlaybookRecord[] {
    return this.database.read((connection) => (connection.prepare('SELECT * FROM catalog_playbooks ORDER BY label,id').all() as any[])
      .map((row) => ({ id: row.id, label: row.label, agent: parse(row.agent_json),
        ...(row.model ? { model: row.model } : {}), messages: parse(row.messages_json), artifacts: parse(row.artifacts_json),
        actions: parse(row.actions_json), createdAt: row.created_at, updatedAt: row.updated_at })));
  }

  backfillPlaybooks(records: CatalogPlaybookRecord[]): Promise<boolean> {
    return this.database.writeTransaction('backfill playbook catalog', (connection) => {
      if (this.backfillComplete(connection, 'playbooks')) return false;
      const insert = connection.prepare(`INSERT OR IGNORE INTO catalog_playbooks
        (id,label,agent_json,model,messages_json,artifacts_json,actions_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const record of records) insert.run(record.id, record.label, json(record.agent), record.model ?? null,
        json(record.messages), json(record.artifacts), json(record.actions), record.createdAt, record.updatedAt);
      this.completeBackfill(connection, 'playbooks');
      return true;
    });
  }

  putPlaybook(record: CatalogPlaybookRecord, insertOnly = false): Promise<void> {
    return this.database.writeTransaction('write playbook catalog', (connection) => {
      const values = [record.id, record.label, json(record.agent), record.model ?? null, json(record.messages),
        json(record.artifacts), json(record.actions), record.createdAt, record.updatedAt];
      const sql = insertOnly ? `INSERT OR IGNORE INTO catalog_playbooks
        (id,label,agent_json,model,messages_json,artifacts_json,actions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
        : `INSERT INTO catalog_playbooks
        (id,label,agent_json,model,messages_json,artifacts_json,actions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET label=excluded.label,agent_json=excluded.agent_json,model=excluded.model,
          messages_json=excluded.messages_json,artifacts_json=excluded.artifacts_json,actions_json=excluded.actions_json,
          updated_at=excluded.updated_at`;
      connection.prepare(sql).run(...values);
    });
  }

  deletePlaybook(id: string): Promise<boolean> { return this.deleteById('catalog_playbooks', id, 'delete playbook'); }

  clearPlaybooks(): Promise<number> {
    return this.database.writeTransaction('clear playbook catalog', (connection) =>
      Number(connection.prepare('DELETE FROM catalog_playbooks').run().changes ?? 0));
  }

  private selectSkill<T extends CatalogSkillRecord>(connection: HubDatabaseConnection, id: string): T | null {
    const row = connection.prepare('SELECT record_json FROM catalog_skills WHERE id=?').get(id) as any;
    return row ? parse<T>(row.record_json) : null;
  }

  private selectSkillBySlug<T extends CatalogSkillRecord>(connection: HubDatabaseConnection, slug: string): T | null {
    const row = connection.prepare('SELECT record_json FROM catalog_skills WHERE slug=?').get(slug) as any;
    return row ? parse<T>(row.record_json) : null;
  }

  private selectMcpServer<T extends CatalogMcpServerRecord>(connection: HubDatabaseConnection, id: string): T | null {
    const row = connection.prepare('SELECT record_json FROM catalog_mcp_servers WHERE id=?').get(id) as any;
    return row ? parse<T>(row.record_json) : null;
  }

  private selectMcpServerByName<T extends CatalogMcpServerRecord>(connection: HubDatabaseConnection, name: string): T | null {
    const row = connection.prepare('SELECT record_json FROM catalog_mcp_servers WHERE name=?').get(name) as any;
    return row ? parse<T>(row.record_json) : null;
  }

  private tokenFromRow = (row: any): CatalogMcpTokenRecord => ({
    id: row.id, name: row.name, kind: row.kind,
    ...(row.drone_id ? { droneId: row.drone_id } : {}), secretSeed: row.secret_seed,
    tokenPreview: row.token_preview, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  });

  private groupFromRow = (row: any): CatalogGroupRecord => ({
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version ?? 1),
  });

  private repositoryFromRow = (row: any): CatalogRepositoryRecord => ({
    path: row.path,
    addedAt: row.added_at,
    ...(row.remote_url ? { remoteUrl: row.remote_url } : {}),
    ...(row.github_owner && row.github_repo ? { github: { owner: row.github_owner, repo: row.github_repo } } : {}),
    ...(row.environment_json ? { environment: optionalJson(row.environment_json) } : {}),
    ...(row.agents_json ? { agents: optionalJson(row.agents_json) } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    version: Number(row.version ?? 1),
    environmentVersion: Number(row.environment_version ?? 1),
    agentsVersion: Number(row.agents_version ?? 1),
  });

  private updateRepositoryPart(path: string, part: 'environment' | 'agents', value: unknown, at: string): Promise<CatalogRepositoryRecord> {
    return this.database.writeTransaction(`update repository ${part}`, (connection) => {
      const current = connection.prepare('SELECT * FROM catalog_repositories WHERE path=? AND deleted_at IS NULL').get(path) as any;
      if (!current) {
        connection.prepare(`INSERT INTO catalog_repositories
          (path,added_at,environment_json,agents_json,updated_at,version,environment_version,agents_version,deleted_at)
          VALUES (?,?,?,?,?,1,1,1,NULL)`).run(path, at, part === 'environment' ? json(value) : null,
          part === 'agents' ? json(value) : null, at);
      } else if (part === 'environment') {
        connection.prepare(`UPDATE catalog_repositories SET environment_json=?,environment_version=environment_version+1,
          version=version+1,updated_at=? WHERE path=? AND deleted_at IS NULL`).run(json(value), at, path);
      } else {
        connection.prepare(`UPDATE catalog_repositories SET agents_json=?,agents_version=agents_version+1,
          version=version+1,updated_at=? WHERE path=? AND deleted_at IS NULL`).run(json(value), at, path);
      }
      appendHubOutboxEvent(connection, { topic: 'catalog.repositories', eventType: `repository.${part}.updated`,
        aggregateType: 'repository', aggregateId: path, payload: { path, updatedAt: at } });
      const row = connection.prepare('SELECT * FROM catalog_repositories WHERE path=?').get(path) as any;
      return this.repositoryFromRow(row);
    });
  }

  private deleteById(table: string, value: string, label: string, column = 'id'): Promise<boolean> {
    const allowed = new Set(['catalog_skills', 'catalog_mcp_servers', 'catalog_groups', 'catalog_playbooks']);
    if (!allowed.has(table)) throw new Error(`Unsupported catalog table: ${table}`);
    return this.database.writeTransaction(label, (connection) =>
      Number(connection.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(value).changes ?? 0) === 1);
  }

  private backfillComplete(connection: HubDatabaseConnection, domain: string): boolean {
    return Boolean(connection.prepare('SELECT 1 FROM catalog_backfills WHERE domain=?').get(domain));
  }

  private completeBackfill(connection: HubDatabaseConnection, domain: string): void {
    connection.prepare('INSERT INTO catalog_backfills (domain,completed_at) VALUES (?,?)')
      .run(domain, new Date().toISOString());
  }
}

let cached: { database: HubDatabase; store: Promise<CatalogStore> } | null = null;

export function getCatalogStore(): Promise<CatalogStore> {
  const database = requireHubDatabase();
  if (cached?.database === database) return cached.store;
  const store = CatalogStore.open(database).catch((error) => {
    if (cached?.database === database) cached = null;
    throw error;
  });
  cached = { database, store };
  return store;
}
