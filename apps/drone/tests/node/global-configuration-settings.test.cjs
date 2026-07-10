const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const {
  getHubSettingsRepository,
  resetHubSettingsRepositoryForTests,
} = require('../../dist/host/hub-settings-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { readRegistryJsonFromSqlite } = require('../../dist/host/sqlite-registry-store.js');
const { saveRegistry, updateRegistry } = require('../../dist/host/registry.js');
const {
  resolveCanonicalDefaultAgentsConfig,
  upsertCanonicalDefaultAgentsConfig,
} = require('../../dist/hub/agents-config.js');
const {
  resolveCanonicalNonRepoEnvironmentConfig,
  upsertCanonicalNonRepoEnvironmentConfig,
} = require('../../dist/hub/environment-config.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-global-config-${label}-`));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  resetHubSettingsRepositoryForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('default AGENTS and non-repository environment backfill once, then remain canonical', async () => {
  useRoot('precedence');
  await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, settings: {
    agents: {
      content: 'legacy instructions\r\n',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    nonRepoEnvironment: {
      vars: { LEGACY: 'one', 'bad-key': 'ignored' },
      autoApplyToNewContainerDrones: true,
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  } });

  assert.deepEqual(await resolveCanonicalDefaultAgentsConfig(), {
    content: 'legacy instructions\n',
    enabled: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(await resolveCanonicalNonRepoEnvironmentConfig(), {
    vars: { LEGACY: 'one' },
    autoApplyToNewContainerDrones: true,
    updatedAt: '2026-01-02T00:00:00.000Z',
  });

  await assert.rejects(
    updateRegistry((registry) => {
      registry.settings.agents = {
        content: 'stale replacement',
        updatedAt: '2027-01-01T00:00:00.000Z',
      };
      registry.settings.nonRepoEnvironment = {
        vars: { STALE: 'two' },
        autoApplyToNewContainerDrones: false,
        updatedAt: '2027-01-02T00:00:00.000Z',
      };
    }),
    /cannot mutate canonical-owned state: settings\.agents, settings\.nonRepoEnvironment/,
  );

  assert.equal((await resolveCanonicalDefaultAgentsConfig()).content, 'legacy instructions\n');
  assert.deepEqual((await resolveCanonicalNonRepoEnvironmentConfig()).vars, { LEGACY: 'one' });
});

test('canonical writes and clears do not rewrite or resurrect the registry snapshot', async () => {
  useRoot('writes');
  await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, settings: {
    agents: { content: 'stale', updatedAt: '2026-01-01T00:00:00.000Z' },
    nonRepoEnvironment: {
      vars: { STALE: 'value' },
      autoApplyToNewContainerDrones: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  } });
  const registryBefore = readRegistryJsonFromSqlite();

  await upsertCanonicalDefaultAgentsConfig('canonical\r\ncontent');
  await upsertCanonicalNonRepoEnvironmentConfig({
    vars: { SAFE_NAME: 'value', 'not-valid': 'drop me' },
    autoApplyToNewContainerDrones: false,
  });
  assert.equal(readRegistryJsonFromSqlite(), registryBefore);
  assert.equal((await resolveCanonicalDefaultAgentsConfig()).content, 'canonical\ncontent');
  assert.deepEqual((await resolveCanonicalNonRepoEnvironmentConfig()).vars, { SAFE_NAME: 'value' });

  await upsertCanonicalDefaultAgentsConfig('');
  await upsertCanonicalNonRepoEnvironmentConfig({ vars: {}, autoApplyToNewContainerDrones: false });
  await resetHubDatabaseForTests();
  resetHubSettingsRepositoryForTests();

  assert.deepEqual(await resolveCanonicalDefaultAgentsConfig(), {
    content: '',
    enabled: false,
    updatedAt: (await getHubSettingsRepository()).get('agents.default').updatedAt,
  });
  assert.deepEqual((await resolveCanonicalNonRepoEnvironmentConfig()).vars, {});
  assert.equal(readRegistryJsonFromSqlite(), registryBefore);
});
