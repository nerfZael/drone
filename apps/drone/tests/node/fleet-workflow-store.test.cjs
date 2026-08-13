const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { afterEach, test } = require('node:test');
const { getFleetWorkflowStore } = require('../../dist/host/fleet-workflow-store.js');
const {
  getHubDatabase,
  resetHubDatabaseForTests,
} = require('../../dist/host/hub-database.js');
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
test('schema migration preserves legacy embedded target statuses', async () => {
  use('target-migration');
  const databasePath = path.join(process.env.DRONE_DATA_DIR, 'hub.sqlite');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE hub_schema_migrations (
      scope TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL,
      PRIMARY KEY(scope,version), UNIQUE(scope,name)
    );
    CREATE TABLE workflow_sync_sets (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, source_type TEXT NOT NULL,
      source_path TEXT, target_path TEXT NOT NULL, apply_to_host INTEGER NOT NULL,
      record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
    );
    CREATE TABLE workflow_backfills (domain TEXT PRIMARY KEY, completed_at TEXT NOT NULL);
  `);
  const appliedAt = '2026-01-01T00:00:00.000Z';
  const migration = database.prepare(
    'INSERT INTO hub_schema_migrations(scope,version,name,applied_at) VALUES (?,?,?,?)',
  );
  migration.run('fleet-workflows', 1, 'canonical fleet workflows', appliedAt);
  migration.run('fleet-workflows', 2, 'remove obsolete orchestration audit', appliedAt);
  migration.run('fleet-workflows', 3, 'remove retired playbook workflow', appliedAt);
  const legacy = {
    ...sync(),
    targetStatus: {
      old: {
        targetKind: 'drone',
        state: 'synced',
        appliedVersionId: 'legacy-v1',
        appliedAt,
        error: null,
      },
    },
  };
  database
    .prepare(`INSERT INTO workflow_sync_sets
      (id,label,source_type,source_path,target_path,apply_to_host,record_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(
      legacy.id,
      legacy.label,
      legacy.sourceType,
      legacy.sourcePath,
      legacy.targetPath,
      0,
      JSON.stringify(legacy),
      legacy.createdAt,
      legacy.updatedAt,
    );
  database.close();

  const s = await getFleetWorkflowStore();
  assert.equal(s.listSyncSets()[0].targetStatus.old.appliedVersionId, 'legacy-v1');
  assert.deepEqual(s.listSyncSetDefinitions()[0].targetStatus, {});
  const migrated = getHubDatabase().read((connection) => ({
    definition: JSON.parse(
      connection.prepare('SELECT record_json FROM workflow_sync_sets WHERE id=?').get('sync')
        .record_json,
    ),
    targets: connection
      .prepare('SELECT COUNT(*) count FROM workflow_sync_set_targets WHERE sync_set_id=?')
      .get('sync').count,
  }));
  assert.deepEqual(migrated.definition.targetStatus, {});
  assert.equal(migrated.targets, 1);
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
test('sync-set target statuses are normalized and update one target atomically', async () => {
  use('normalized-targets');
  const s = await getFleetWorkflowStore();
  const firstStatus = {
    targetKind: 'drone',
    state: 'synced',
    appliedVersionId: 'v1',
    appliedAt: '2026-01-01T00:00:01.000Z',
    error: null,
  };
  await s.putSyncSet({
    ...sync(),
    targetStatus: {
      first: firstStatus,
      second: { ...firstStatus, appliedVersionId: 'v2' },
    },
  });

  assert.deepEqual(s.listSyncSetDefinitions()[0].targetStatus, {});
  assert.deepEqual(s.listSyncSets()[0].targetStatus, {
    first: firstStatus,
    second: { ...firstStatus, appliedVersionId: 'v2' },
  });
  const database = getHubDatabase();
  const stored = database.read((connection) => ({
    record: connection
      .prepare('SELECT record_json FROM workflow_sync_sets WHERE id=?')
      .get('sync').record_json,
    targetCount: connection
      .prepare('SELECT COUNT(*) count FROM workflow_sync_set_targets WHERE sync_set_id=?')
      .get('sync').count,
  }));
  assert.deepEqual(JSON.parse(stored.record).targetStatus, {});
  assert.equal(stored.targetCount, 2);

  await s.updateSyncSetTarget('sync', 'first', (record, previous) => {
    assert.deepEqual(record.targetStatus, {});
    assert.deepEqual(previous, firstStatus);
    return {
      syncSet: { ...record, updatedAt: '2026-01-01T00:00:03.000Z' },
      targetStatus: { ...firstStatus, state: 'error', error: 'failed' },
    };
  });
  assert.deepEqual(s.listSyncSets()[0].targetStatus, {
    first: { ...firstStatus, state: 'error', error: 'failed' },
    second: { ...firstStatus, appliedVersionId: 'v2' },
  });

  assert.equal(await s.deleteSyncSet('sync'), true);
  const remainingTargets = database.read(
    (connection) =>
      connection
        .prepare('SELECT COUNT(*) count FROM workflow_sync_set_targets WHERE sync_set_id=?')
        .get('sync').count,
  );
  assert.equal(remainingTargets, 0);
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
