const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const {
  getDroneLifecycleRepository,
} = require('../../dist/host/drone-lifecycle-repository.js');
const {
  requireHubDatabase,
  resetHubDatabaseForTests,
} = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const tempRoots = [];

function useTempDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-lifecycle-repository-${label}-`));
  tempRoots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
  return dataDir;
}

function realEntry(id, overrides = {}) {
  return {
    id,
    name: id,
    containerName: `drone-${id}`,
    runtime: 'container',
    containerPort: 7777,
    token: `token-${id}`,
    repoPath: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('DroneLifecycleRepository', () => {
  test('applies its scoped migration idempotently and excludes independently owned chat aggregates', async () => {
    useTempDataDir('migration');
    const first = await getDroneLifecycleRepository();
    const second = await getDroneLifecycleRepository();
    assert.ok(first);
    assert.equal(second, first);

    await first.upsert('real', 'drone-a', realEntry('drone-a', {
      chats: { default: { turns: [{ prompt: 'large transcript' }] } },
      archivedChats: { old: { turns: [{ prompt: 'old transcript' }] } },
    }));
    const stored = first.get('drone-a');
    assert.equal(stored.state, 'real');
    assert.equal(Object.hasOwn(stored.lifecycle, 'chats'), false);
    assert.equal(Object.hasOwn(stored.lifecycle, 'archivedChats'), false);

    const database = requireHubDatabase();
    assert.deepEqual(
      database.read((connection) =>
        connection.prepare("SELECT version, name FROM hub_schema_migrations WHERE scope = 'drone-lifecycle'").all(),
      ),
      [{ version: 1, name: 'canonical drone lifecycle tables' }],
    );
  });

  test('incrementally backfills missing legacy identities without overwriting canonical rows', async () => {
    useTempDataDir('backfill');
    const repository = await getDroneLifecycleRepository();
    await repository.backfillLegacyInsertOnly({
      drones: { legacy: realEntry('legacy', { name: 'legacy name' }) },
    });
    await repository.upsert('real', 'legacy', realEntry('legacy', { name: 'canonical name' }));

    await repository.backfillLegacyInsertOnly({
      drones: {
        legacy: realEntry('legacy', { name: 'later legacy overwrite' }),
        later: realEntry('later', { name: 'created by transitional writer' }),
      },
    });

    assert.equal(repository.get('legacy').name, 'canonical name');
    assert.equal(repository.get('later').name, 'created by transitional writer');
    assert.equal(repository.get('later').version, 1);
  });

  test('serializes concurrent patches, rolls failures back, and keeps the queue usable', async () => {
    useTempDataDir('concurrency');
    const repository = await getDroneLifecycleRepository();
    await repository.upsert('real', 'concurrent', realEntry('concurrent', { left: 0, right: 0 }));

    await Promise.all([
      repository.patch('real', 'concurrent', (entry) => ({ ...entry, left: entry.left + 1 })),
      repository.patch('real', 'concurrent', (entry) => ({ ...entry, right: entry.right + 1 })),
    ]);
    assert.equal(repository.get('concurrent').lifecycle.left, 1);
    assert.equal(repository.get('concurrent').lifecycle.right, 1);
    assert.equal(repository.get('concurrent').version, 3);

    await assert.rejects(
      repository.patch('real', 'concurrent', (entry) => {
        entry.left = 99;
        throw new Error('rollback lifecycle patch');
      }),
      /rollback lifecycle patch/,
    );
    await repository.patch('real', 'concurrent', (entry) => ({ ...entry, right: 2 }));
    assert.equal(repository.get('concurrent').lifecycle.left, 1);
    assert.equal(repository.get('concurrent').lifecycle.right, 2);
  });

  test('atomically transitions real, archived, restored, and deleted lifecycle states', async () => {
    useTempDataDir('transitions');
    const repository = await getDroneLifecycleRepository();
    await repository.upsert('real', 'transition', realEntry('transition'));
    await repository.upsert('archived', 'transition', realEntry('transition', {
      archivedAt: '2026-07-02T00:00:00.000Z',
      deleteAt: '2026-07-03T00:00:00.000Z',
      archiveRetention: '1d',
      archiveRuntimePolicy: 'stop',
    }));
    assert.equal(repository.list('real').length, 0);
    assert.equal(repository.get('transition').state, 'archived');

    await repository.upsert('real', 'transition', realEntry('transition', { name: 'restored' }));
    assert.equal(repository.list('archived').length, 0);
    assert.equal(repository.get('transition').name, 'restored');
    const removed = await repository.delete('transition', 'real');
    assert.equal(removed.state, 'real');
    assert.equal(repository.get('transition'), null);
  });

  test('switches repository and connection when DRONE_DATA_DIR changes', async () => {
    const firstDir = useTempDataDir('dir-a');
    const first = await getDroneLifecycleRepository();
    await first.upsert('real', 'only-a', realEntry('only-a'));

    const secondDir = useTempDataDir('dir-b');
    const second = await getDroneLifecycleRepository();
    assert.notEqual(second, first);
    assert.equal(second.get('only-a'), null);
    await second.upsert('pending', 'only-b', {
      id: 'only-b', name: 'only-b', runtime: 'host', phase: 'starting', createdAt: new Date().toISOString(),
    });
    assert.equal(second.get('only-b').state, 'pending');
    assert.equal(fs.existsSync(path.join(firstDir, 'hub.sqlite')), true);
    assert.equal(fs.existsSync(path.join(secondDir, 'hub.sqlite')), true);
  });
});
