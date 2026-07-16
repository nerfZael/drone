const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { loadRegistry, saveRegistry } = require('../../dist/host/registry.js');
const {
  getPromptQueueRepository,
  resetPromptQueueRepositoryForTests,
} = require('../../dist/host/prompt-queue-repository.js');
const { permanentlyDeleteCanonicalDrone } = require('../../dist/hub/drone-deletion-service.js');
const {
  deleteCanonicalDroneLifecycle,
  getCanonicalDroneLifecycle,
  upsertCanonicalDroneLifecycle,
} = require('../../dist/hub/drone-lifecycle-service.js');
const {
  archiveChatInStore,
  deleteArchivedChatFromStore,
  deleteChatFromStore,
  importArchivedChatsFromRegistry,
  importDroneChatsFromRegistry,
  listArchivedChatsFromStore,
  listChatsFromStore,
  resetTranscriptStoreForTests,
  upsertChatInStore,
} = require('../../dist/hub/transcript-store.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function tempDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-deletion-${label}-`));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
  resetDroneRootDirForTests();
  resetPromptQueueRepositoryForTests();
}

function chat(title, turns = []) {
  return {
    createdAt: '2026-07-10T09:00:00.000Z',
    title,
    agent: { kind: 'builtin', id: 'codex' },
    turns,
    pendingPrompts: [],
  };
}

function prompt(id) {
  const at = '2026-07-10T09:01:00.000Z';
  return { id, at, prompt: id, state: 'queued', updatedAt: at };
}

async function seedLifecycle(state, droneId) {
  const archived = state === 'archived'
    ? {
        archivedAt: '2026-07-10T09:00:00.000Z',
        deleteAt: '2026-07-11T09:00:00.000Z',
        archiveRetention: '1d',
        archiveRuntimePolicy: 'delete',
      }
    : {};
  await upsertCanonicalDroneLifecycle(state, droneId, {
    id: droneId,
    name: droneId,
    runtime: 'container',
    containerName: `${droneId}-container`,
    ...archived,
  });
}

function countRows(table, droneId) {
  return Number(requireHubDatabase().read((connection) =>
    connection.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE drone_id = ?`).get(droneId).count));
}

function countEvents(eventType, droneId) {
  return Number(requireHubDatabase().read((connection) => connection.prepare(`
    SELECT COUNT(*) AS count FROM hub_outbox
    WHERE event_type = ? AND aggregate_id = ?
  `).get(eventType, droneId).count));
}

afterEach(async () => {
  await resetTranscriptStoreForTests();
  resetPromptQueueRepositoryForTests();
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('deleting a pending draft prevents its stale startup prompt from resurrecting the drone', async () => {
  tempDataDir('pending-draft');
  const droneId = 'delete-pending-draft';
  const at = '2026-07-10T09:00:00.000Z';
  await saveRegistry({
    version: 2,
    drones: {},
    pending: {
      [droneId]: {
        id: droneId,
        name: 'stale-draft',
        runtime: 'container',
        phase: 'draft',
        draft: true,
        startupQueuedPrompts: [{ id: 'startup-1', chatName: 'default', at, prompt: 'start', state: 'queued' }],
      },
    },
  });
  assert.equal((await getCanonicalDroneLifecycle(droneId))?.state, 'pending');

  const deleted = await deleteCanonicalDroneLifecycle(droneId, 'pending');
  assert.equal(deleted?.state, 'pending');
  assert.equal(countRows('hub_drone_lifecycle_tombstones', droneId), 1);
  assert.equal((await loadRegistry()).pending?.[droneId], undefined);
  assert.equal(await getCanonicalDroneLifecycle(droneId), null);
  assert.equal(countEvents('drone.lifecycle.deleted', droneId), 1);
});

test('permanent deletion atomically clears every chat aggregate and blocks stale legacy resurrection', async () => {
  tempDataDir('complete');
  const droneId = 'delete-complete';
  await saveRegistry({
    version: 2,
    drones: {
      [droneId]: {
        id: droneId,
        name: droneId,
        runtime: 'container',
        containerName: `${droneId}-container`,
        chats: { default: chat('stale registry chat') },
      },
    },
    pending: {},
  });
  assert.equal((await getCanonicalDroneLifecycle(droneId))?.state, 'real');

  await upsertChatInStore({
    droneId,
    chatName: 'default',
    chatEntry: chat('active', [
      { id: 'turn-1', at: '2026-07-10T09:00:01.000Z', prompt: 'inspect', ok: true, output: 'done' },
    ]),
  });
  await upsertChatInStore({ droneId, chatName: 'old-active', chatEntry: chat('old active') });
  await deleteChatFromStore({ droneId, chatName: 'old-active' });

  await upsertChatInStore({ droneId, chatName: 'review', chatEntry: chat('archived review') });
  await archiveChatInStore({
    droneId,
    chatName: 'review',
    archivedAt: '2026-07-10T09:02:00.000Z',
    deleteAt: '2026-07-11T09:02:00.000Z',
    archiveRetention: '1d',
  });
  await upsertChatInStore({ droneId, chatName: 'old-archive', chatEntry: chat('old archive') });
  await archiveChatInStore({
    droneId,
    chatName: 'old-archive',
    archivedAt: '2026-07-10T09:03:00.000Z',
    deleteAt: '2026-07-11T09:03:00.000Z',
    archiveRetention: '1d',
  });
  await deleteArchivedChatFromStore({ droneId, archivedChatName: 'old-archive' });

  const queue = getPromptQueueRepository();
  assert.ok(queue);
  await queue.enqueue({ droneId, chatName: 'default', prompt: prompt('prompt-1') });

  const result = await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'real' });
  assert.equal(result.removedLifecycle, true);
  assert.equal(result.alreadyDeleted, false);
  assert.equal(result.activeChatsDeleted, 1);
  assert.equal(result.turnsDeleted, 1);
  assert.equal(result.archivedChatsDeleted, 1);
  assert.ok(result.chatTombstonesDeleted >= 1);
  assert.equal(result.archivedChatTombstonesDeleted, 1);
  assert.equal(result.promptsDeleted, 1);

  for (const table of [
    'canonical_chats',
    'canonical_chat_turns',
    'canonical_archived_chats',
    'canonical_chat_tombstones',
    'canonical_archived_chat_tombstones',
    'prompts',
  ]) assert.equal(countRows(table, droneId), 0, `${table} should be empty`);
  assert.equal(countRows('canonical_drone_chat_tombstones', droneId), 1);
  assert.equal(countRows('hub_drone_lifecycle_tombstones', droneId), 1);
  assert.equal((await loadRegistry()).drones?.[droneId], undefined);
  assert.equal(await getCanonicalDroneLifecycle(droneId), null);
  assert.equal(countEvents('drone.chats.deleted', droneId), 1);
  assert.equal(countEvents('drone.lifecycle.deleted', droneId), 1);

  assert.deepEqual(
    requireHubDatabase().read((connection) => connection.prepare(`
      SELECT scope, version FROM hub_schema_migrations
      WHERE scope IN ('chats', 'prompts') ORDER BY scope, version
    `).all()),
    [
      { scope: 'chats', version: 1 },
      { scope: 'chats', version: 2 },
      { scope: 'chats', version: 3 },
      { scope: 'chats', version: 4 },
      { scope: 'prompts', version: 1 },
      { scope: 'prompts', version: 2 },
    ],
  );

  const duplicate = await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'real' });
  assert.equal(duplicate.removedLifecycle, false);
  assert.equal(duplicate.alreadyDeleted, true);
  assert.equal(countEvents('drone.chats.deleted', droneId), 1);
  assert.equal(countEvents('drone.lifecycle.deleted', droneId), 1);

  await importDroneChatsFromRegistry({ droneId, chats: { default: chat('stale active') } });
  await importArchivedChatsFromRegistry({
    droneId,
    archivedChats: {
      review: {
        ...chat('stale archive'),
        archivedAt: '2026-07-10T09:02:00.000Z',
        deleteAt: '2026-07-11T09:02:00.000Z',
        archiveRetention: '1d',
      },
    },
  });
  assert.deepEqual(listChatsFromStore({ droneId }).chats, []);
  assert.deepEqual(listArchivedChatsFromStore({ droneId }).archivedChats, []);
  assert.equal(await queue.backfillLegacy({ droneId, chatName: 'default', prompts: [prompt('stale-prompt')] }), 0);
  await assert.rejects(
    upsertChatInStore({ droneId, chatName: 'default', chatEntry: chat('explicit stale write') }),
    /permanently deleted drone/,
  );
  await assert.rejects(
    queue.enqueue({ droneId, chatName: 'default', prompt: prompt('new-prompt') }),
    /permanently deleted drone/,
  );
});

test('a cleanup failure rolls back lifecycle, chats, prompts, tombstone, and outbox together', async () => {
  tempDataDir('rollback');
  const droneId = 'delete-rollback';
  await seedLifecycle('real', droneId);
  await upsertChatInStore({ droneId, chatName: 'default', chatEntry: chat('active') });
  const queue = getPromptQueueRepository();
  assert.ok(queue);
  await queue.enqueue({ droneId, chatName: 'default', prompt: prompt('prompt-rollback') });

  const eventsBefore = requireHubDatabase().read((connection) =>
    Number(connection.prepare('SELECT COUNT(*) AS count FROM hub_outbox').get().count));
  requireHubDatabase().read((connection) => connection.exec(`
    CREATE TRIGGER block_drone_prompt_cleanup
    BEFORE DELETE ON prompts
    WHEN OLD.drone_id = 'delete-rollback'
    BEGIN
      SELECT RAISE(ABORT, 'blocked cleanup');
    END;
  `));

  await assert.rejects(
    permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'real' }),
    /blocked cleanup/,
  );
  assert.equal((await getCanonicalDroneLifecycle(droneId))?.state, 'real');
  assert.equal(countRows('canonical_chats', droneId), 1);
  assert.equal(countRows('prompts', droneId), 1);
  assert.equal(countRows('canonical_drone_chat_tombstones', droneId), 0);
  assert.equal(countRows('hub_drone_lifecycle_tombstones', droneId), 0);
  assert.equal(
    requireHubDatabase().read((connection) =>
      Number(connection.prepare('SELECT COUNT(*) AS count FROM hub_outbox').get().count)),
    eventsBefore,
  );
});

test('permanent archived-drone deletion uses the same canonical cleanup boundary', async () => {
  tempDataDir('archived');
  const droneId = 'delete-archived';
  await seedLifecycle('archived', droneId);
  await upsertChatInStore({ droneId, chatName: 'default', chatEntry: chat('active') });
  await upsertChatInStore({ droneId, chatName: 'review', chatEntry: chat('review') });
  await archiveChatInStore({
    droneId,
    chatName: 'review',
    archivedAt: '2026-07-10T09:02:00.000Z',
    deleteAt: '2026-07-11T09:02:00.000Z',
    archiveRetention: '1d',
  });
  const queue = getPromptQueueRepository();
  assert.ok(queue);
  await queue.enqueue({ droneId, chatName: 'default', prompt: prompt('prompt-archived') });

  const result = await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'archived' });
  assert.equal(result.removedLifecycle, true);
  assert.equal(result.activeChatsDeleted, 1);
  assert.equal(result.archivedChatsDeleted, 1);
  assert.equal(result.promptsDeleted, 1);
  assert.equal(await getCanonicalDroneLifecycle(droneId), null);
  assert.deepEqual(listChatsFromStore({ droneId }).chats, []);
  assert.deepEqual(listArchivedChatsFromStore({ droneId }).archivedChats, []);
  assert.equal(countRows('canonical_drone_chat_tombstones', droneId), 1);
  assert.equal(countRows('hub_drone_lifecycle_tombstones', droneId), 1);
});
