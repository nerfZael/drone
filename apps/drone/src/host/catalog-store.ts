import crypto from 'node:crypto';

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
  {
    version: 3,
    name: 'remove retired playbook catalog',
    migrate(connection) {
      connection.exec('DROP TABLE IF EXISTS catalog_playbooks;');
      connection.prepare("DELETE FROM catalog_backfills WHERE domain = 'playbooks'").run();
    },
  },
  {
    version: 4,
    name: 'stable group identities',
    migrate(connection) {
      const activeRows = connection.prepare(
        'SELECT name,created_at,updated_at,version,deleted_at FROM catalog_groups WHERE deleted_at IS NULL',
      ).all() as Array<{ name: string; created_at: string; updated_at: string; version: number; deleted_at: string | null }>;
      const knownNames = new Set(
        (connection.prepare('SELECT name FROM catalog_groups').all() as Array<{ name: string }>).map((row) => row.name),
      );
      const insertAncestor = connection.prepare(
        'INSERT INTO catalog_groups (name,created_at,updated_at,version,deleted_at) VALUES (?,?,?,1,NULL)',
      );
      for (const row of activeRows) {
        const parts = String(row.name ?? '').split('/').filter(Boolean);
        for (let index = 1; index < parts.length; index += 1) {
          const ancestor = parts.slice(0, index).join('/');
          if (knownNames.has(ancestor)) continue;
          insertAncestor.run(ancestor, row.created_at, row.updated_at);
          knownNames.add(ancestor);
        }
      }

      const rows = connection.prepare(
        'SELECT name,created_at,updated_at,version,deleted_at FROM catalog_groups ORDER BY length(name), name',
      ).all() as Array<{ name: string; created_at: string; updated_at: string; version: number; deleted_at: string | null }>;
      const idByName = new Map<string, string>();
      connection.exec(`
        CREATE TABLE catalog_groups_v4 (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          parent_id TEXT,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          deleted_at TEXT,
          FOREIGN KEY (parent_id) REFERENCES catalog_groups_v4(id)
        );
      `);
      const insert = connection.prepare(`INSERT INTO catalog_groups_v4
        (id,name,parent_id,label,created_at,updated_at,version,deleted_at) VALUES (?,?,?,?,?,?,?,?)`);
      for (const row of rows) {
        const name = String(row.name ?? '').trim();
        const parentName = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
        const id = `grp_${crypto.randomUUID()}`;
        idByName.set(name, id);
        insert.run(id, name, idByName.get(parentName) ?? null, name.slice(name.lastIndexOf('/') + 1), row.created_at,
          row.updated_at, Number(row.version ?? 1), row.deleted_at);
      }
      connection.exec(`
        DROP TABLE catalog_groups;
        ALTER TABLE catalog_groups_v4 RENAME TO catalog_groups;
        CREATE UNIQUE INDEX catalog_groups_active_name_unique ON catalog_groups (name) WHERE deleted_at IS NULL;
        CREATE INDEX catalog_groups_parent_id ON catalog_groups (parent_id);
      `);
    },
  },
  {
    version: 5,
    name: 'repository scoped group identities',
    migrate(connection) {
      const groupRows = connection.prepare(
        'SELECT * FROM catalog_groups ORDER BY deleted_at IS NOT NULL, length(name), name, created_at',
      ).all() as any[];
      const activeById = new Map(groupRows.filter((row) => row.deleted_at == null).map((row) => [String(row.id), row]));
      const activeByName = new Map(groupRows.filter((row) => row.deleted_at == null).map((row) => [String(row.name), row]));
      const scopesById = new Map<string, Set<string>>();
      const lifecycleRows: Array<{
        table: string;
        jsonColumn: string;
        droneId: string;
        groupName: string;
        lifecycle: Record<string, any>;
      }> = [];
      const tableExists = connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
      const lifecycleSources = [
        { table: 'hub_canonical_drones', jsonColumn: 'lifecycle_json' },
        { table: 'hub_canonical_pending_drones', jsonColumn: 'lifecycle_json' },
        { table: 'hub_canonical_archived_drones', jsonColumn: 'lifecycle_json' },
        { table: 'hub_drones', jsonColumn: 'drone_json' },
        { table: 'hub_pending_drones', jsonColumn: 'pending_json' },
        { table: 'hub_archived_drones', jsonColumn: 'archived_json' },
      ];
      for (const { table, jsonColumn } of lifecycleSources) {
        if (!tableExists.get(table)) continue;
        const rows = connection.prepare(`SELECT drone_id,${jsonColumn} AS lifecycle_json FROM ${table}`).all() as Array<{
          drone_id: string;
          lifecycle_json: string;
        }>;
        for (const row of rows) {
          let lifecycle: Record<string, any>;
          try {
            lifecycle = JSON.parse(row.lifecycle_json);
          } catch {
            continue;
          }
          const groupId = String(lifecycle.groupId ?? '').trim();
          const groupName = String(lifecycle.group ?? '').trim();
          const group = activeById.get(groupId) ?? activeByName.get(groupName);
          lifecycleRows.push({
            table,
            jsonColumn,
            droneId: row.drone_id,
            groupName: String(group?.name ?? groupName),
            lifecycle,
          });
          if (!group) continue;
          const repoPath = String(lifecycle.repoPath ?? '').trim();
          const scopes = scopesById.get(String(group.id)) ?? new Set<string>();
          scopes.add(repoPath);
          scopesById.set(String(group.id), scopes);
        }
      }
      for (const row of groupRows.filter((group) => group.deleted_at == null)) {
        const scopes = scopesById.get(String(row.id));
        if (!scopes || scopes.size === 0) continue;
        let parentName = String(row.name);
        while (parentName.includes('/')) {
          parentName = parentName.slice(0, parentName.lastIndexOf('/'));
          const parent = activeByName.get(parentName);
          if (!parent) continue;
          const parentScopes = scopesById.get(String(parent.id)) ?? new Set<string>();
          for (const scope of scopes) parentScopes.add(scope);
          scopesById.set(String(parent.id), parentScopes);
        }
      }

      connection.exec(`
        CREATE TABLE catalog_groups_v5 (
          id TEXT NOT NULL PRIMARY KEY,
          repo_path TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          parent_id TEXT,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          deleted_at TEXT,
          FOREIGN KEY (parent_id) REFERENCES catalog_groups_v5(id)
        );
      `);
      const insert = connection.prepare(`INSERT INTO catalog_groups_v5
        (id,repo_path,name,parent_id,label,created_at,updated_at,version,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      const idByScopeAndName = new Map<string, string>();
      for (const row of groupRows) {
        const scopes = row.deleted_at == null
          ? [...(scopesById.get(String(row.id)) ?? new Set<string>(['']))].sort()
          : [''];
        const effectiveScopes = scopes.length > 0 ? scopes : [''];
        for (const [index, repoPath] of effectiveScopes.entries()) {
          const name = String(row.name);
          const parentName = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
          const id = index === 0 ? String(row.id) : `grp_${crypto.randomUUID()}`;
          const parentId = parentName ? idByScopeAndName.get(`${repoPath}\0${parentName}`) ?? null : null;
          insert.run(id, repoPath, name, parentId, row.label, row.created_at, row.updated_at,
            Number(row.version ?? 1), row.deleted_at ?? null);
          if (row.deleted_at == null) idByScopeAndName.set(`${repoPath}\0${name}`, id);
        }
      }
      connection.exec(`
        DROP TABLE catalog_groups;
        ALTER TABLE catalog_groups_v5 RENAME TO catalog_groups;
        CREATE UNIQUE INDEX catalog_groups_active_scope_name_unique
          ON catalog_groups (repo_path, name) WHERE deleted_at IS NULL;
        CREATE INDEX catalog_groups_scope_parent_id ON catalog_groups (repo_path, parent_id);
      `);
      for (const row of lifecycleRows) {
        const repoPath = String(row.lifecycle.repoPath ?? '').trim();
        const groupId = idByScopeAndName.get(`${repoPath}\0${row.groupName}`);
        if (!groupId || row.lifecycle.groupId === groupId) continue;
        row.lifecycle.groupId = groupId;
        connection.prepare(`UPDATE ${row.table} SET ${row.jsonColumn}=? WHERE drone_id=?`)
          .run(JSON.stringify(row.lifecycle), row.droneId);
      }
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

export type CatalogGroupRecord = {
  id: string;
  repoPath: string;
  name: string;
  label: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  version?: number;
};

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

  isBackfillComplete(domain: 'skills' | 'mcp-servers' | 'mcp-tokens'): boolean {
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

  listGroups(repoPath?: string): CatalogGroupRecord[] {
    return this.database.read((connection) => {
      const rows = repoPath === undefined
        ? connection.prepare('SELECT * FROM catalog_groups WHERE deleted_at IS NULL ORDER BY repo_path,name').all()
        : connection.prepare(
          'SELECT * FROM catalog_groups WHERE repo_path=? AND deleted_at IS NULL ORDER BY name',
        ).all(repoPath);
      return (rows as any[]).map(this.groupFromRow);
    });
  }

  backfillGroups(records: CatalogGroupRecord[]): Promise<boolean> {
    return this.database.writeTransaction('backfill group catalog', (connection) => {
      const insert = connection.prepare(
        'INSERT INTO catalog_groups (id,repo_path,name,parent_id,label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      );
      const exists = connection.prepare('SELECT 1 FROM catalog_groups WHERE repo_path=? AND name=? LIMIT 1');
      const existsInAnyScope = connection.prepare('SELECT 1 FROM catalog_groups WHERE name=? LIMIT 1');
      const alignHierarchy = connection.prepare(
        'UPDATE catalog_groups SET parent_id=?,label=? WHERE repo_path=? AND name=? AND deleted_at IS NULL',
      );
      const activeIdByName = connection.prepare(
        'SELECT id FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
      );
      let inserted = 0;
      for (const record of records) {
        const parentName = record.name.includes('/') ? record.name.slice(0, record.name.lastIndexOf('/')) : '';
        const parent = parentName
          ? activeIdByName.get(record.repoPath, parentName) as { id?: string } | undefined
          : undefined;
        const parentId = parent?.id ?? null;
        const shouldPreserveMigratedScope = record.repoPath === '' && existsInAnyScope.get(record.name);
        if (!exists.get(record.repoPath, record.name) && !shouldPreserveMigratedScope) {
          inserted += Number(
            insert.run(record.id, record.repoPath, record.name, parentId, record.label,
              record.createdAt, record.updatedAt).changes ?? 0,
          );
        } else {
          alignHierarchy.run(parentId, record.label, record.repoPath, record.name);
        }
      }
      return inserted > 0;
    });
  }

  putGroup(record: CatalogGroupRecord, insertOnly = false): Promise<CatalogGroupRecord> {
    return this.database.writeTransaction('write group catalog', (connection) => {
      const current = connection.prepare(
        'SELECT * FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
      ).get(record.repoPath, record.name) as any;
      if (insertOnly) {
        const historical = connection.prepare(
          'SELECT 1 FROM catalog_groups WHERE repo_path=? AND name=? LIMIT 1',
        ).get(record.repoPath, record.name);
        if (!historical) {
          connection.prepare(
            'INSERT INTO catalog_groups (id,repo_path,name,parent_id,label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
          ).run(record.id, record.repoPath, record.name, record.parentId, record.label,
            record.createdAt, record.updatedAt);
        }
      } else if (current) {
        connection.prepare(`UPDATE catalog_groups SET parent_id=?,label=?,updated_at=?,version=version+1
          WHERE id=? AND deleted_at IS NULL`).run(record.parentId, record.label, record.updatedAt, current.id);
      } else {
        connection.prepare(`INSERT INTO catalog_groups
          (id,repo_path,name,parent_id,label,created_at,updated_at,version,deleted_at) VALUES (?,?,?,?,?,?,?,1,NULL)`)
          .run(record.id, record.repoPath, record.name, record.parentId, record.label,
            record.createdAt, record.updatedAt);
      }
      if (!insertOnly) appendHubOutboxEvent(connection, {
        topic: 'catalog.groups', eventType: current ? 'group.updated' : 'group.created',
        aggregateType: 'group', aggregateId: current?.id ?? record.id,
        payload: { id: current?.id ?? record.id, repoPath: record.repoPath,
          name: record.name, updatedAt: record.updatedAt },
      });
      const row = connection.prepare(
        'SELECT * FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
      ).get(record.repoPath, record.name) as any ?? connection.prepare(
        'SELECT * FROM catalog_groups WHERE repo_path=? AND name=? ORDER BY updated_at DESC LIMIT 1',
      ).get(record.repoPath, record.name) as any;
      return this.groupFromRow(row);
    });
  }

  deleteGroup(repoPath: string, name: string, at = new Date().toISOString()): Promise<boolean> {
    return this.database.writeTransaction('delete group', (connection) => {
      const group = connection.prepare(
        'SELECT id FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
      ).get(repoPath, name) as { id?: string } | undefined;
      const info = connection.prepare(`UPDATE catalog_groups SET deleted_at=?,updated_at=?,version=version+1
        WHERE repo_path=? AND name=? AND deleted_at IS NULL`).run(at, at, repoPath, name);
      if (Number(info.changes ?? 0) !== 1) return false;
      appendHubOutboxEvent(connection, { topic: 'catalog.groups', eventType: 'group.deleted',
        aggregateType: 'group', aggregateId: group?.id ?? name,
        payload: { id: group?.id ?? null, repoPath, name, deletedAt: at } });
      return true;
    });
  }

  deleteGroups(repoPath: string, names: string[], at = new Date().toISOString()): Promise<string[]> {
    return this.database.writeTransaction('delete group hierarchy', (connection) => {
      const deleted: string[] = [];
      for (const name of [...new Set(names)]) {
        const group = connection.prepare(
          'SELECT id FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
        ).get(repoPath, name) as { id?: string } | undefined;
        const info = connection.prepare(`UPDATE catalog_groups SET deleted_at=?,updated_at=?,version=version+1
          WHERE repo_path=? AND name=? AND deleted_at IS NULL`).run(at, at, repoPath, name);
        if (Number(info.changes ?? 0) !== 1) continue;
        appendHubOutboxEvent(connection, { topic: 'catalog.groups', eventType: 'group.deleted',
          aggregateType: 'group', aggregateId: group?.id ?? name,
          payload: { id: group?.id ?? null, repoPath, name, deletedAt: at } });
        deleted.push(name);
      }
      return deleted;
    });
  }

  renameGroups(
    repoPath: string,
    rewrites: Array<{ id?: string; from: string; to: string }>,
    at = new Date().toISOString(),
  ): Promise<number> {
    return this.database.writeTransaction('rename group hierarchy', (connection) => {
      const sources = new Set(rewrites.map((item) => item.from));
      const sourceRows = new Map<string, any>();
      for (const item of rewrites) {
        const row = item.id
          ? connection.prepare('SELECT * FROM catalog_groups WHERE id=? AND deleted_at IS NULL').get(item.id) as any
          : connection.prepare(
            'SELECT * FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
          ).get(repoPath, item.from) as any;
        if (row) sourceRows.set(item.from, row);
      }
      for (const item of rewrites) {
        const collision = connection.prepare(
          'SELECT 1 FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
        ).get(repoPath, item.to);
        if (collision && !sources.has(item.to)) throw new Error(`group already exists: ${item.to}`);
      }
      let renamed = 0;
      for (const item of rewrites) {
        const source = sourceRows.get(item.from);
        if (!source) continue;
        const label = item.to.slice(item.to.lastIndexOf('/') + 1);
        const parentName = item.to.includes('/') ? item.to.slice(0, item.to.lastIndexOf('/')) : '';
        const parent = parentName
          ? connection.prepare(
            'SELECT id FROM catalog_groups WHERE repo_path=? AND name=? AND deleted_at IS NULL',
          ).get(repoPath, parentName) as { id?: string } | undefined
          : undefined;
        connection.prepare(`UPDATE catalog_groups SET name=?,parent_id=?,label=?,updated_at=?,version=version+1
          WHERE id=? AND deleted_at IS NULL`).run(item.to, parent?.id ?? null, label, at, source.id);
        appendHubOutboxEvent(connection, { topic: 'catalog.groups', eventType: 'group.renamed', aggregateType: 'group',
          aggregateId: source.id, payload: { id: source.id, repoPath,
            oldName: item.from, newName: item.to, updatedAt: at } });
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
    id: row.id,
    repoPath: row.repo_path ?? '',
    name: row.name,
    label: row.label ?? String(row.name ?? '').slice(String(row.name ?? '').lastIndexOf('/') + 1),
    parentId: row.parent_id ?? null,
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
    const allowed = new Set(['catalog_skills', 'catalog_mcp_servers', 'catalog_groups']);
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
