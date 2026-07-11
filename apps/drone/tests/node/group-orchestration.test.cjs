const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { saveRegistry } = require('../../dist/host/registry.js');
const { setDroneGroupMetadataBatch } = require('../../dist/hub/drone-metadata-commands.js');
const { upsertCanonicalDroneLifecycle } = require('../../dist/hub/drone-lifecycle-service.js');
const {
  deleteCanonicalGroupArtifacts,
  renameCanonicalGroupOrchestration,
} = require('../../dist/hub/group-orchestration.js');
const { ensureCanonicalGroup, listCanonicalGroups } = require('../../dist/hub/groups-repositories.js');
const {
  resolveKanbanBoardSettingsResponse,
  upsertStoredKanbanBoardSettings,
} = require('../../dist/hub/hub-settings.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useTempDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-group-orchestration-${label}-`));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
  resetDroneRootDirForTests();
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('group rename uses canonical precedence across catalog, lifecycle memberships, and Kanban', async () => {
  useTempDataDir('precedence');
  const at = '2026-07-01T00:00:00.000Z';
  await ensureCanonicalGroup('team', at);
  await ensureCanonicalGroup('team/api', at);
  await upsertCanonicalDroneLifecycle('real', 'drone-1', {
    id: 'drone-1', name: 'worker-one', runtime: 'container', group: 'team', createdAt: at,
  });
  await upsertCanonicalDroneLifecycle('pending', 'drone-2', {
    id: 'drone-2', name: 'worker-two', runtime: 'host', phase: 'starting', group: 'team/api', createdAt: at,
  });
  await upsertStoredKanbanBoardSettings({
    taskTypes: [{ id: 'task', label: 'Task', active: true }],
    lanes: [{
      id: 'todo', title: 'Todo', cards: [
        {
          id: 'card-1', title: 'Team task', description: '', typeId: 'task',
          scopeType: 'group', scopeValue: 'team', createdAt: at, updatedAt: at,
        },
        {
          id: 'card-2', title: 'API task', description: '', typeId: 'task',
          scopeType: 'group', scopeValue: 'team/api', createdAt: at, updatedAt: at,
        },
      ],
    }],
  });

  await saveRegistry({
    version: 2,
    drones: { 'drone-1': { id: 'drone-1', name: 'stale', runtime: 'container', group: 'stale-group' } },
    pending: {}, archived: {}, groups: {}, settings: {},
  });

  assert.deepEqual(await renameCanonicalGroupOrchestration('team', 'platform', at), {
    ok: true,
    movedDrones: 1,
    movedPending: 1,
  });
  assert.deepEqual((await listCanonicalGroups()).map((group) => group.name), ['platform', 'platform/api']);
  const lifecycle = await getDroneLifecycleRepository();
  assert.equal(lifecycle.get('drone-1').lifecycle.group, 'platform');
  assert.equal(lifecycle.get('drone-2').lifecycle.group, 'platform/api');
  const board = (await resolveKanbanBoardSettingsResponse()).kanbanBoard;
  assert.deepEqual(board.lanes.flatMap((lane) => lane.cards).map((card) => card.scopeValue), ['platform', 'platform/api']);
});

test('group collision validation and lifecycle membership batches leave prior canonical state intact', async () => {
  useTempDataDir('atomicity');
  await ensureCanonicalGroup('source');
  await ensureCanonicalGroup('target');
  await upsertCanonicalDroneLifecycle('real', 'drone-1', {
    id: 'drone-1', name: 'worker-one', runtime: 'container', group: 'source',
  });

  assert.deepEqual(await renameCanonicalGroupOrchestration('source', 'target'), {
    ok: false,
    status: 409,
    error: 'group already exists: target',
  });
  assert.deepEqual((await listCanonicalGroups()).map((group) => group.name), ['source', 'target']);
  const lifecycle = await getDroneLifecycleRepository();
  assert.equal(lifecycle.get('drone-1').lifecycle.group, 'source');

  await assert.rejects(setDroneGroupMetadataBatch([
    { state: 'real', droneId: 'drone-1', group: 'next' },
    { state: 'pending', droneId: 'missing', group: 'next' },
  ]), /unknown pending drone/);
  assert.equal(lifecycle.get('drone-1').lifecycle.group, 'source');
});

test('group artifact deletion tombstones the complete subtree and removes its Kanban scopes', async () => {
  useTempDataDir('delete');
  const at = '2026-07-01T00:00:00.000Z';
  await ensureCanonicalGroup('team', at);
  await ensureCanonicalGroup('team/api', at);
  await upsertStoredKanbanBoardSettings({
    taskTypes: [{ id: 'task', label: 'Task', active: true }],
    lanes: [{ id: 'todo', title: 'Todo', cards: [
      { id: 'root', title: 'Root', description: '', typeId: 'task', scopeType: 'group', scopeValue: 'team', createdAt: at, updatedAt: at },
      { id: 'child', title: 'Child', description: '', typeId: 'task', scopeType: 'group', scopeValue: 'team/api', createdAt: at, updatedAt: at },
      { id: 'keep', title: 'Keep', description: '', typeId: 'task', scopeType: 'global', createdAt: at, updatedAt: at },
    ] }],
  });

  assert.deepEqual(await deleteCanonicalGroupArtifacts('team'), ['team', 'team/api']);
  assert.deepEqual(await listCanonicalGroups(), []);
  const cards = (await resolveKanbanBoardSettingsResponse()).kanbanBoard.lanes.flatMap((lane) => lane.cards);
  assert.deepEqual(cards.map((card) => card.id), ['keep']);
});
