const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  patchCanonicalDroneLifecycle,
  setDroneHubMetaByIdentity,
  upsertCanonicalDroneLifecycle,
  upsertCanonicalDroneLifecycleBatch,
} = require('../../dist/hub/drone-lifecycle-service.js');
const { pruneMissingRegistryDrones } = require('../../dist/hub/stale-registry-prune.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useTempDataDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-lifecycle-callers-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('lifecycle callers commit canonical state and outbox before stale pruning', async () => {
  useTempDataDir();
  await upsertCanonicalDroneLifecycle('real', 'drone-1', {
    id: 'drone-1',
    name: 'worker',
    runtime: 'container',
    containerName: 'drone-drone-1',
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  await patchCanonicalDroneLifecycle('real', 'drone-1', (lifecycle) => ({ ...lifecycle, phase: 'ready' }));
  await setDroneHubMetaByIdentity({ droneId: 'drone-1', hub: { phase: 'seeding', message: 'Seeding' } });

  const repository = await getDroneLifecycleRepository();
  assert.equal(repository.get('drone-1').lifecycle.phase, 'ready');
  assert.equal(repository.get('drone-1').lifecycle.hub.phase, 'seeding');

  const removed = await pruneMissingRegistryDrones({ listContainerNames: async () => [] });
  assert.deepEqual(removed, [{ id: 'drone-1', name: 'worker', containerName: 'drone-drone-1' }]);
  assert.equal(repository.get('drone-1'), null);

  const events = requireHubDatabase().read((connection) => connection.prepare(
    "SELECT event_type FROM hub_outbox WHERE topic = 'drone.lifecycle.changes' ORDER BY id",
  ).all().map((row) => row.event_type));
  assert.deepEqual(events, [
    'drone.lifecycle.real.upserted',
    'drone.lifecycle.patched',
    'drone.hub-metadata.changed',
    'drone.lifecycle.deleted',
  ]);
});

test('batch lifecycle creation is atomic and emits one outbox event per drone', async () => {
  useTempDataDir();
  await upsertCanonicalDroneLifecycleBatch([
    {
      state: 'pending',
      droneId: 'drone-1',
      entry: { id: 'drone-1', name: 'worker-one', runtime: 'container', phase: 'starting' },
    },
    {
      state: 'pending',
      droneId: 'drone-2',
      entry: { id: 'drone-2', name: 'worker-two', runtime: 'host', phase: 'draft', draft: true },
    },
  ]);

  const repository = await getDroneLifecycleRepository();
  assert.equal(repository.get('drone-1').state, 'pending');
  assert.equal(repository.get('drone-2').lifecycle.draft, true);
  assert.deepEqual(requireHubDatabase().read((connection) => connection.prepare(
    "SELECT event_type,aggregate_id FROM hub_outbox WHERE topic = 'drone.lifecycle.changes' ORDER BY id",
  ).all()), [
    { event_type: 'drone.lifecycle.pending.upserted', aggregate_id: 'drone-1' },
    { event_type: 'drone.lifecycle.pending.upserted', aggregate_id: 'drone-2' },
  ]);

  await assert.rejects(
    upsertCanonicalDroneLifecycleBatch([
      {
        state: 'pending',
        droneId: 'drone-3',
        entry: { id: 'drone-3', name: 'worker-three', runtime: 'container', phase: 'starting' },
      },
      {
        state: 'pending',
        droneId: 'drone-4',
        entry: { id: 'drone-4', name: 'worker-two', runtime: 'container', phase: 'starting' },
      },
    ]),
    /display name already exists/,
  );
  assert.equal(repository.get('drone-3'), null);
  assert.equal(repository.get('drone-4'), null);
});
