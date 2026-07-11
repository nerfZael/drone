const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
    connection.prepare("SELECT scope, version, name FROM hub_schema_migrations WHERE scope='catalog'").get(),
  );
  assert.deepEqual(migration, {
    scope: 'catalog',
    version: 1,
    name: 'canonical configuration catalogs',
  });
  const tables = database.read((connection) =>
    connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'catalog_%' ORDER BY name").all(),
  );
  assert.deepEqual(tables.map((row) => row.name), [
    'catalog_backfills',
    'catalog_groups',
    'catalog_mcp_servers',
    'catalog_mcp_tokens',
    'catalog_playbooks',
    'catalog_repositories',
    'catalog_skills',
  ]);
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
  await first.putGroup({ name: 'first', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
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
  assert.equal(await store.backfillGroups([{ name: 'legacy', createdAt: at, updatedAt: at }]), true);
  assert.equal(await store.deleteGroup('legacy'), true);
  assert.equal(await store.backfillGroups([{ name: 'legacy', createdAt: at, updatedAt: at }]), false);
  assert.deepEqual(store.listGroups(), []);

  await store.putRepository({ path: '/repo', addedAt: at, remoteUrl: 'canonical' });
  assert.equal(await store.backfillRepositories([{ path: '/repo', addedAt: at, remoteUrl: 'legacy' }]), false);
  assert.equal(store.listRepositories()[0].remoteUrl, 'canonical');
  assert.equal(await store.backfillRepositories([{ path: '/later', addedAt: at, remoteUrl: 'legacy-later' }]), true);
  assert.equal(store.listRepositories().some((record) => record.path === '/later'), true);

  const playbook = {
    id: 'playbook', label: 'Legacy', agent: { kind: 'builtin', id: 'cursor' }, messages: ['one'],
    artifacts: [], actions: [], createdAt: at, updatedAt: at,
  };
  assert.equal(await store.backfillPlaybooks([playbook]), true);
  await store.putPlaybook({ ...playbook, label: 'Canonical' });
  assert.equal(await store.backfillPlaybooks([{ ...playbook, label: 'Stale' }]), false);
  assert.equal(store.listPlaybooks()[0].label, 'Canonical');
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
