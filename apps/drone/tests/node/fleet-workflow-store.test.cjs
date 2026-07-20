const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { getFleetWorkflowStore } = require('../../dist/host/fleet-workflow-store.js');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { HubOutboxRepository } = require('../../dist/host/hub-outbox.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const original = process.env.DRONE_DATA_DIR,
  roots = [];
function use(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-workflows-${label}-`));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
  resetDroneRootDirForTests();
  return root;
}
afterEach(async () => {
  await resetHubDatabaseForTests();
  if (original == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = original;
  resetDroneRootDirForTests();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
function sync(id = 'sync') {
  return {
    id,
    label: id,
    sourceType: 'host-path',
    sourcePath: '/source',
    targetPath: '/target',
    applyToHost: false,
    scope: { kind: 'all' },
    targetStatus: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
test('legacy sync-set backfill is one-time and canonical delete wins', async () => {
  use('backfill');
  const s = await getFleetWorkflowStore();
  assert.equal(await s.backfillSyncSets([sync()]), true);
  await s.putSyncSet({ ...sync(), label: 'canonical' });
  assert.equal(await s.backfillSyncSets([{ ...sync(), label: 'stale' }]), false);
  assert.equal(s.listSyncSets()[0].label, 'canonical');
  assert.equal(await s.deleteSyncSet('sync'), true);
  assert.deepEqual(s.listSyncSets(), []);
});
test('concurrent sync-set transforms serialize and rollback includes outbox', async () => {
  use('sync-concurrency');
  const s = await getFleetWorkflowStore();
  await s.putSyncSet(sync());
  await Promise.all([
    s.updateSyncSet('sync', (r) => ({
      ...r,
      label: 'left',
      updatedAt: '2026-01-01T00:00:01.000Z',
    })),
    s.updateSyncSet('sync', (r) => ({
      ...r,
      targetPath: '/right',
      updatedAt: '2026-01-01T00:00:02.000Z',
    })),
  ]);
  const row = s.listSyncSets()[0];
  assert.equal(row.label, 'left');
  assert.equal(row.targetPath, '/right');
  const cyclic = {};
  cyclic.self = cyclic;
  const before = new HubOutboxRepository().list().length;
  await assert.rejects(
    s.updateSyncSet('sync', (r) => ({ ...r, targetStatus: cyclic })),
    /circular/i,
  );
  assert.equal(new HubOutboxRepository().list().length, before);
});
test('workflow cache follows data-dir switching', async () => {
  use('one');
  let s = await getFleetWorkflowStore();
  await s.putSyncSet(sync());
  await resetHubDatabaseForTests();
  use('two');
  s = await getFleetWorkflowStore();
  assert.deepEqual(s.listSyncSets(), []);
});
