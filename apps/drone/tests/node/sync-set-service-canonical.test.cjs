const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { saveRegistry } = require('../../dist/host/registry.js');
const { createSyncSetService } = require('../../dist/hub/sync-set-service.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-sync-service-canonical-'));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();
}

function syncSet(id, label) {
  return {
    id,
    label,
    sourceType: 'hub-managed',
    sourcePath: null,
    targetPath: '/tmp/target',
    applyToHost: false,
    scope: { type: 'all' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastAppliedVersionId: null,
    lastAppliedAt: null,
    targetStatus: {},
  };
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('Node sync-set commands seed from raw migration state and never use registry write fallback', async () => {
  useRoot();
  const legacy = syncSet('legacy', 'Legacy');
  await saveRegistry({
    version: 2,
    drones: {}, pending: {}, archived: {},
    settings: { syncSets: { items: [legacy], updatedAt: legacy.updatedAt } },
  });
  let compatibilityReads = 0;
  let compatibilityWrites = 0;
  const service = createSyncSetService({
    loadRegistry: async () => {
      compatibilityReads += 1;
      throw new Error('canonical sync-set command read the projected registry');
    },
    updateRegistry: async () => {
      compatibilityWrites += 1;
      throw new Error('canonical sync-set command used registry fallback');
    },
    normalizeDroneIdentity: (value) => String(value ?? '').trim(),
    droneRuntime: () => 'container',
    withLockedDroneContainer: async (_opts, fn) => await fn({ containerName: 'unused' }),
    nowIso: () => '2026-01-01T00:00:01.000Z',
    logWarn: () => {},
  });

  assert.deepEqual((await service.storedSyncSets()).map((record) => record.id), ['legacy']);
  await service.createSyncSet(syncSet('created', 'Created'));
  await service.updateSyncSet({ ...syncSet('created', 'Updated'), updatedAt: '2026-01-01T00:00:02.000Z' });
  assert.equal(await service.deleteSyncSet('legacy'), true);
  assert.deepEqual((await service.storedSyncSets()).map((record) => record.label), ['Updated']);
  assert.equal(compatibilityReads, 0);
  assert.equal(compatibilityWrites, 0);
});
