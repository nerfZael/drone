const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach, test } = require('node:test');

const { getCatalogStore } = require('../../dist/host/catalog-store.js');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { HubOutboxRepository } = require('../../dist/host/hub-outbox.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { saveRegistry } = require('../../dist/host/registry.js');
const {
  ensureCanonicalGroup,
  listCanonicalGroups,
  listCanonicalRepositories,
  registerCanonicalRepository,
  removeCanonicalRepository,
  renameCanonicalGroupTree,
  updateCanonicalRepositoryAgents,
  updateCanonicalRepositoryEnvironment,
} = require('../../dist/hub/groups-repositories.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-groups-repos-${label}-`));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
  return { root, dataDir };
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('canonical tombstones beat repeated legacy imports for groups and repositories', async () => {
  useDataDir('precedence');
  const at = '2026-01-01T00:00:00.000Z';
  await saveRegistry({
    version: 2,
    drones: {}, pending: {}, archived: {},
    groups: { legacy: { name: 'legacy', createdAt: at, updatedAt: at } },
    repos: { '/repo': { path: '/repo', addedAt: at, remoteUrl: 'legacy' } },
  });
  assert.equal((await listCanonicalGroups()).length, 1);
  assert.equal((await listCanonicalRepositories()).length, 1);
  const store = await getCatalogStore();
  assert.equal(await store.deleteGroup('legacy', at), true);
  assert.equal(await removeCanonicalRepository('/repo'), true);
  assert.deepEqual(await listCanonicalGroups(), []);
  assert.deepEqual(await listCanonicalRepositories(), []);
});

test('independent environment and agents updates serialize without lost fields and append outbox events', async () => {
  useDataDir('partial-concurrency');
  const at = '2026-01-01T00:00:00.000Z';
  await registerCanonicalRepository({ path: '/repo', addedAt: at, remoteUrl: 'origin' });
  await Promise.all([
    updateCanonicalRepositoryEnvironment('/repo', { vars: { A: '1' }, updatedAt: at }, at),
    updateCanonicalRepositoryAgents('/repo', { mode: 'override', content: 'rules', updatedAt: at }, at),
  ]);
  const [repo] = await listCanonicalRepositories();
  assert.deepEqual(repo.environment, { vars: { A: '1' }, updatedAt: at });
  assert.deepEqual(repo.agents, { mode: 'override', content: 'rules', updatedAt: at });
  assert.equal(repo.environmentVersion, 2);
  assert.equal(repo.agentsVersion, 2);
  const events = new HubOutboxRepository().list({ limit: 20 });
  assert.deepEqual(events.map((event) => event.eventType), [
    'repository.registered',
    'repository.environment.updated',
    'repository.agents.updated',
  ]);
});

test('failed serialization rolls back both repository state and its outbox event', async () => {
  useDataDir('rollback');
  const store = await getCatalogStore();
  await registerCanonicalRepository({ path: '/repo', addedAt: '2026-01-01T00:00:00.000Z' });
  const before = store.getRepository('/repo');
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(store.updateRepositoryEnvironment('/repo', cyclic), /JSON|circular/i);
  assert.deepEqual(store.getRepository('/repo'), before);
  assert.equal(new HubOutboxRepository().list({ limit: 20 }).length, 1);
});

test('group hierarchy commands rename atomically and emit one event per aggregate', async () => {
  useDataDir('rename');
  await ensureCanonicalGroup('team');
  await ensureCanonicalGroup('team/api');
  await assert.rejects(renameCanonicalGroupTree('team', 'team/api'), /own subtree/);
  assert.equal(await renameCanonicalGroupTree('team', 'platform'), 2);
  assert.deepEqual((await listCanonicalGroups()).map((group) => group.name), ['platform', 'platform/api']);
  const events = new HubOutboxRepository().list({ limit: 20 });
  assert.equal(events.filter((event) => event.eventType === 'group.renamed').length, 2);
});

test('CLI repo command registers through the canonical application command', async () => {
  const { root, dataDir } = useDataDir('cli');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  const stdout = execFileSync(process.execPath, [path.resolve(__dirname, '../../dist/cli.js'), '--json', 'repo', repo], {
    env: { ...process.env, DRONE_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(stdout).added, repo);
  await resetHubDatabaseForTests();
  resetDroneRootDirForTests();
  assert.equal((await listCanonicalRepositories()).some((record) => record.path === repo), true);
});
