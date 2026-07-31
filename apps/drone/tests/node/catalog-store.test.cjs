const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { afterEach, test } = require('node:test');

const { getCatalogStore } = require('../../dist/host/catalog-store.js');
const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { loadRegistryRawSnapshot, saveRegistry, updateRegistry } = require('../../dist/host/registry.js');
const { createSkill, deleteSkillRecord, listSkills, updateSkillRecord } = require('../../dist/hub/skills.js');
const { createMcpServer, listMcpServers } = require('../../dist/hub/mcp-servers.js');
const {
  authenticateMcpBearerToken,
  createMcpAccessToken,
  ensureDroneMcpAccessToken,
  listMcpAccessTokens,
  revokeMcpAccessToken,
} = require('../../dist/hub/mcp-tokens.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-catalog-${label}-`));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
  return dataDir;
}

function skill(id, slug, name = slug) {
  return {
    id,
    slug,
    name,
    description: `${name} description`,
    markdownBody: '',
    files: [],
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: '2026-07-10T09:00:00.000Z',
  };
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('opens with the production binding and applies a scoped normalized schema', async () => {
  useDataDir('binding');
  const store = await getCatalogStore();
  assert.ok(store);
  const database = requireHubDatabase();
  const migration = database.read((connection) =>
    connection.prepare("SELECT scope, version, name FROM hub_schema_migrations WHERE scope='catalog' ORDER BY version DESC LIMIT 1").get(),
  );
  assert.deepEqual(migration, {
    scope: 'catalog',
    version: 5,
    name: 'repository scoped group identities',
  });
  const tables = database.read((connection) =>
    connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'catalog_%' ORDER BY name").all(),
  );
  assert.deepEqual(tables.map((row) => row.name), [
    'catalog_backfills',
    'catalog_groups',
    'catalog_mcp_servers',
    'catalog_mcp_tokens',
    'catalog_repositories',
    'catalog_skills',
  ]);
});

test('upgrades name-keyed groups with stable ids and explicit parent links', async () => {
  const dataDir = useDataDir('group-id-migration');
  const db = new Database(path.join(dataDir, 'hub.sqlite'));
  db.exec(`
    CREATE TABLE hub_schema_migrations (
      scope TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (scope, version),
      UNIQUE (scope, name)
    );
    INSERT INTO hub_schema_migrations (scope,version,name,applied_at) VALUES
      ('catalog',1,'canonical configuration catalogs','2026-01-01T00:00:00.000Z'),
      ('catalog',2,'versioned group and repository commands','2026-01-01T00:00:00.000Z'),
      ('catalog',3,'remove retired playbook catalog','2026-01-01T00:00:00.000Z');
    CREATE TABLE catalog_groups (
      name TEXT NOT NULL PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    );
    INSERT INTO catalog_groups (name,created_at,updated_at,version,deleted_at) VALUES
      ('team','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1,NULL),
      ('team/api','2026-01-02T00:00:00.000Z','2026-01-02T00:00:00.000Z',1,NULL);
  `);
  db.close();

  const store = await getCatalogStore();
  const groups = store.listGroups();
  const team = groups.find((group) => group.name === 'team');
  const api = groups.find((group) => group.name === 'team/api');
  assert.match(team.id, /^grp_/);
  assert.match(api.id, /^grp_/);
  assert.notEqual(team.id, api.id);
  assert.equal(team.parentId, null);
  assert.equal(api.parentId, team.id);
  assert.equal(api.label, 'api');
  const foreignKeyViolations = requireHubDatabase().read((connection) =>
    connection.prepare('PRAGMA foreign_key_check(catalog_groups)').all(),
  );
  assert.deepEqual(foreignKeyViolations, []);
});

test('splits a formerly global group into independent repository identities', async () => {
  const dataDir = useDataDir('group-repo-scope-migration');
  const db = new Database(path.join(dataDir, 'hub.sqlite'));
  db.exec(`
    CREATE TABLE hub_schema_migrations (
      scope TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (scope, version),
      UNIQUE (scope, name)
    );
    INSERT INTO hub_schema_migrations (scope,version,name,applied_at) VALUES
      ('catalog',1,'canonical configuration catalogs','2026-01-01T00:00:00.000Z'),
      ('catalog',2,'versioned group and repository commands','2026-01-01T00:00:00.000Z'),
      ('catalog',3,'remove retired playbook catalog','2026-01-01T00:00:00.000Z'),
      ('catalog',4,'stable group identities','2026-01-01T00:00:00.000Z');
    CREATE TABLE catalog_groups (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    );
    INSERT INTO catalog_groups VALUES
      ('grp_shared','shared',NULL,'shared','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1,NULL);
    CREATE TABLE hub_canonical_drones (
      drone_id TEXT PRIMARY KEY,
      lifecycle_json TEXT NOT NULL
    );
    INSERT INTO hub_canonical_drones VALUES
      ('drone-a','{"id":"drone-a","group":"shared","groupId":"grp_shared","repoPath":"/repo/a"}'),
      ('drone-b','{"id":"drone-b","group":"shared","groupId":"grp_shared","repoPath":"/repo/b"}');
  `);
  db.close();

  const store = await getCatalogStore();
  const groups = store.listGroups();
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.repoPath), ['/repo/a', '/repo/b']);
  assert.notEqual(groups[0].id, groups[1].id);
  const lifecycleRows = requireHubDatabase().read((connection) =>
    connection.prepare('SELECT lifecycle_json FROM hub_canonical_drones ORDER BY drone_id').all(),
  );
  const lifecycles = lifecycleRows.map((row) => JSON.parse(row.lifecycle_json));
  assert.equal(lifecycles[0].groupId, groups.find((group) => group.repoPath === '/repo/a').id);
  assert.equal(lifecycles[1].groupId, groups.find((group) => group.repoPath === '/repo/b').id);
});

test('insert-only backfill is idempotent and canonical rows retain precedence', async () => {
  useDataDir('precedence');
  const store = await getCatalogStore();
  const canonical = { ...skill('skill-1', 'alpha'), description: 'canonical' };
  await store.putSkill(canonical);
  assert.deepEqual(
    await store.putSkill({ ...skill('skill-1', 'alpha'), description: 'stale registry' }, true),
    canonical,
  );
  assert.deepEqual(
    await store.putSkill(skill('legacy-other-id', 'alpha', 'conflicting registry row'), true),
    canonical,
  );
  assert.deepEqual(store.listSkills(), [canonical]);
});

test('unique conflicts roll back cleanly and concurrent writers cannot create duplicate slugs', async () => {
  useDataDir('rollback');
  const store = await getCatalogStore();
  await store.putSkill(skill('one', 'one'));
  await store.putSkill(skill('two', 'two'));
  await assert.rejects(store.putSkill({ ...skill('two', 'one'), name: 'collision' }), /UNIQUE/);
  assert.equal(store.getSkill('two').slug, 'two');

  const results = await Promise.allSettled([
    store.putSkill(skill('race-a', 'shared')),
    store.putSkill(skill('race-b', 'shared')),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(store.listSkills().filter((record) => record.slug === 'shared').length, 1);
});

test('cached store follows DRONE_DATA_DIR switching instead of leaking rows', async () => {
  useDataDir('switch-a');
  const first = await getCatalogStore();
  await first.putGroup({ id: 'grp_first', repoPath: '', name: 'first', label: 'first', parentId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  await resetHubDatabaseForTests();

  useDataDir('switch-b');
  const second = await getCatalogStore();
  assert.notEqual(first, second);
  assert.deepEqual(second.listGroups(), []);
  await second.putRepository({
    path: '/tmp/repo',
    addedAt: '2026-01-01T00:00:00.000Z',
    github: { owner: 'drone', repo: 'catalog' },
    environment: { vars: { A: '1' } },
  });
  assert.deepEqual(second.listRepositories().map(({ updatedAt: _updatedAt, version: _version, environmentVersion: _environmentVersion, agentsVersion: _agentsVersion, ...repo }) => repo), [{
    path: '/tmp/repo',
    addedAt: '2026-01-01T00:00:00.000Z',
    github: { owner: 'drone', repo: 'catalog' },
    environment: { vars: { A: '1' } },
  }]);
});

test('group tombstones prevent resurrection while repository backfill remains incremental', async () => {
  useDataDir('secondary-domains');
  const store = await getCatalogStore();
  const at = '2026-01-01T00:00:00.000Z';
  const legacyGroup = { id: 'grp_legacy', repoPath: '', name: 'legacy', label: 'legacy', parentId: null, createdAt: at, updatedAt: at };
  assert.equal(await store.backfillGroups([legacyGroup]), true);
  assert.equal(await store.deleteGroup('', 'legacy'), true);
  assert.equal(await store.backfillGroups([legacyGroup]), false);
  assert.deepEqual(store.listGroups(), []);

  await store.putRepository({ path: '/repo', addedAt: at, remoteUrl: 'canonical' });
  assert.equal(await store.backfillRepositories([{ path: '/repo', addedAt: at, remoteUrl: 'legacy' }]), false);
  assert.equal(store.listRepositories()[0].remoteUrl, 'canonical');
  assert.equal(await store.backfillRepositories([{ path: '/later', addedAt: at, remoteUrl: 'legacy-later' }]), true);
  assert.equal(store.listRepositories().some((record) => record.path === '/later'), true);

});

test('skill and MCP server modules backfill once then stop rewriting registry state', async () => {
  useDataDir('domains');
  const legacySkill = skill('legacy', 'legacy');
  await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, skills: { legacy: legacySkill }, mcpServers: {
    old: {
      id: 'old', name: 'old-server', enabled: true, transport: 'stdio', command: 'old', agents: ['codex'],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  } });
  assert.equal((await listSkills())[0].description, 'legacy description');
  await updateSkillRecord('legacy', { description: 'canonical update' });
  await assert.rejects(
    updateRegistry((registry) => { registry.skills.legacy.description = 'stale rewrite'; }),
    /cannot mutate canonical-owned state: skills/,
  );
  assert.equal((await listSkills())[0].description, 'canonical update');
  assert.equal(await deleteSkillRecord('legacy'), true);
  assert.equal((await listSkills()).some((record) => record.id === 'legacy'), false, 'legacy row must not resurrect after canonical delete');

  const createdSkill = await createSkill({ name: 'New Skill', description: 'new', markdownBody: '' });
  const createdServer = await createMcpServer({ name: 'new-server', transport: 'stdio', command: 'new', agents: ['codex'] });
  const registry = await loadRegistryRawSnapshot();
  assert.equal(registry.skills[createdSkill.id], undefined);
  assert.equal(registry.mcpServers[createdServer.id], undefined);
  assert.deepEqual((await listMcpServers()).map((record) => record.name), ['new-server', 'old-server']);
});

test('MCP token create/authenticate/revoke lifecycle is canonical and leaves legacy registry untouched', async () => {
  useDataDir('tokens');
  await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, mcpTokens: {} });
  const signingSecret = 'test-signing-secret';
  const created = await createMcpAccessToken({ name: 'host', signingSecret });
  assert.equal((await loadRegistryRawSnapshot()).mcpTokens?.[created.token.id], undefined);
  assert.deepEqual(await authenticateMcpBearerToken(created.tokenValue, signingSecret), {
    kind: 'host',
    tokenId: created.token.id,
    name: 'host',
  });
  assert.equal((await listMcpAccessTokens()).length, 1);
  assert.ok(await revokeMcpAccessToken(created.token.id));
  assert.equal(await authenticateMcpBearerToken(created.tokenValue, signingSecret), null);
});

test('concurrent token ensure calls converge on one active drone credential', async () => {
  useDataDir('token-concurrency');
  const options = { droneId: 'drone-1', droneName: 'Drone One', signingSecret: 'secret' };
  const [left, right] = await Promise.all([
    ensureDroneMcpAccessToken(options),
    ensureDroneMcpAccessToken(options),
  ]);
  assert.equal(left.token.id, right.token.id);
  assert.equal(left.tokenValue, right.tokenValue);
  assert.equal((await listMcpAccessTokens()).filter((token) => !token.revokedAt).length, 1);
});
