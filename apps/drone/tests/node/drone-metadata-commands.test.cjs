const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { loadRegistry, saveRegistry, updateRegistry } = require('../../dist/host/registry.js');
const {
  commitDroneMetadataPatch,
  setDroneEnvironmentMetadata,
  setDroneGroupMetadata,
  updateDroneFleetMetadata,
} = require('../../dist/hub/drone-metadata-commands.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useTempDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-metadata-${label}-`));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
}

function entry(overrides = {}) {
  return {
    id: 'drone-1',
    name: 'drone-one',
    runtime: 'container',
    containerName: 'drone-drone-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('drone metadata application commands', () => {
  test('serializes independent patches, preserves canonical precedence, and retains chat projections', async () => {
    useTempDataDir('concurrency');
    await saveRegistry({
      version: 2,
      drones: {
        'drone-1': entry({ chats: { default: { createdAt: '2026-07-01T00:00:00.000Z' } } }),
      },
      pending: {},
      archived: {},
    });
    const repository = await getDroneLifecycleRepository();
    await repository.backfillLegacyInsertOnly(await loadRegistry());

    await Promise.all([
      setDroneEnvironmentMetadata({
        droneId: 'drone-1', state: 'real',
        environment: { vars: { API_URL: 'https://example.test' }, useRepoVars: true, disabledRepoKeys: ['OLD'], updatedAt: '2026-07-02T00:00:00.000Z' },
      }),
      updateDroneFleetMetadata({
        droneId: 'drone-1',
        transform: (fleet) => ({ ...fleet, enabled: true, assigned: ['drone-2'] }),
      }),
      setDroneGroupMetadata({ droneId: 'drone-1', state: 'real', group: 'Review' }),
    ]);

    const canonical = repository.get('drone-1').lifecycle;
    assert.equal(canonical.environment.vars.API_URL, 'https://example.test');
    assert.deepEqual(canonical.fleet.assigned, ['drone-2']);
    assert.equal(canonical.group, 'Review');

    const staleSnapshot = await loadRegistry();
    staleSnapshot.drones['drone-1'].group = 'stale-registry';
    await saveRegistry(staleSnapshot);
    await repository.backfillLegacyInsertOnly(await loadRegistry());
    assert.equal(repository.get('drone-1').lifecycle.group, 'Review');
    assert.deepEqual((await loadRegistry()).drones['drone-1'].chats, {
      default: {
        createdAt: '2026-07-01T00:00:00.000Z',
        turns: [],
        pendingPrompts: [],
      },
    });
  });

  test('rolls back failed commands and commits outbox state before best-effort projector failure', async () => {
    useTempDataDir('rollback-projector');
    const repository = await getDroneLifecycleRepository();
    await repository.upsert('real', 'drone-1', entry());

    await assert.rejects(
      commitDroneMetadataPatch({
        droneId: 'drone-1', state: 'real', eventType: 'drone.metadata.invalid',
        transform: (lifecycle) => ({ ...lifecycle, name: 'must-rollback' }),
        payload: { unsupported: 1n },
      }),
      /JSON serializable/,
    );
    assert.equal(repository.get('drone-1').name, 'drone-one');

    const committed = await setDroneEnvironmentMetadata({
      droneId: 'drone-1', state: 'real',
      environment: { vars: { TOKEN: 'set' }, useRepoVars: false, disabledRepoKeys: [], updatedAt: '2026-07-03T00:00:00.000Z' },
      dependencies: { project: async () => { throw new Error('projector unavailable'); } },
    });
    assert.equal(committed.lifecycle.environment.vars.TOKEN, 'set');
    assert.equal(repository.get('drone-1').lifecycle.environment.vars.TOKEN, 'set');

    const events = requireHubDatabase().read((connection) => connection.prepare(
      "SELECT event_type FROM hub_outbox WHERE topic = 'drone.lifecycle.changes' ORDER BY id",
    ).all());
    assert.deepEqual(events, [{ event_type: 'drone.environment.changed' }]);
  });
});
