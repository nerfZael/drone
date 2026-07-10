const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { getPromptQueueRepository } = require('../../dist/host/prompt-queue-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  readCanonicalActiveDroneModel,
  readCanonicalDroneLifecycleModel,
} = require('../../dist/hub/canonical-drone-read-model.js');
const { upsertChatInStore, upsertTranscriptTurnInStore } = require('../../dist/hub/transcript-store.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useTempDataDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-drone-read-model-'));
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

test('canonical active drone read model assembles summaries without writes or compatibility projection', async () => {
  useTempDataDir();
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.upsert('real', 'drone-a', {
    id: 'drone-a',
    name: 'alpha',
    runtime: 'container',
    containerName: 'drone-alpha',
    createdAt: '2026-07-10T10:00:00.000Z',
  });
  await lifecycle.upsert('pending', 'drone-b', {
    id: 'drone-b',
    name: 'beta',
    runtime: 'host',
    phase: 'starting',
    createdAt: '2026-07-10T10:01:00.000Z',
  });
  await upsertChatInStore({
    droneId: 'drone-a',
    chatName: 'default',
    chatEntry: { createdAt: '2026-07-10T10:02:00.000Z', agent: { kind: 'builtin', id: 'codex' } },
  });
  await upsertTranscriptTurnInStore({
    droneId: 'drone-a',
    chatName: 'default',
    turn: { id: 'turn-1', at: '2026-07-10T10:03:00.000Z', prompt: 'hello', ok: true, output: 'world' },
  });
  await getPromptQueueRepository().enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    prompt: { id: 'prompt-1', at: '2026-07-10T10:04:00.000Z', prompt: 'next', state: 'queued' },
  });

  const database = requireHubDatabase();
  const changesBefore = database.read((connection) => connection.prepare('SELECT total_changes() AS count').get().count);
  const model = readCanonicalActiveDroneModel();
  const changesAfter = database.read((connection) => connection.prepare('SELECT total_changes() AS count').get().count);

  assert.equal(changesAfter, changesBefore);
  assert.equal(model.drones['drone-a'].name, 'alpha');
  assert.equal(model.drones['drone-a'].chats.default.turns[0].output, 'world');
  assert.equal(model.drones['drone-a'].chats.default.pendingPrompts[0].id, 'prompt-1');
  assert.equal(model.pending['drone-b'].phase, 'starting');
  assert.equal(readCanonicalDroneLifecycleModel().drones['drone-a'].chats, undefined);
});

test('canonical active drone read model bounds history while retaining active playbook gate turns', async () => {
  useTempDataDir();
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.upsert('real', 'drone-a', {
    id: 'drone-a',
    name: 'alpha',
    runtime: 'container',
    createdAt: '2026-07-10T10:00:00.000Z',
    playbookQueueGate: {
      queueItemId: 'queue-1',
      playbookId: 'playbook-1',
      chatName: 'default',
      initialPromptIds: ['turn-0'],
    },
  });
  await upsertChatInStore({
    droneId: 'drone-a',
    chatName: 'default',
    chatEntry: { createdAt: '2026-07-10T10:00:00.000Z' },
  });
  for (let index = 0; index < 65; index += 1) {
    await upsertTranscriptTurnInStore({
      droneId: 'drone-a',
      chatName: 'default',
      turn: {
        id: `turn-${index}`,
        at: new Date(Date.parse('2026-07-10T10:00:00.000Z') + index * 1_000).toISOString(),
        prompt: `prompt ${index}`,
        ok: true,
        output: `output ${index}`,
      },
    });
  }

  const turns = readCanonicalActiveDroneModel().drones['drone-a'].chats.default.turns;
  assert.equal(turns.length, 61);
  assert.equal(turns[0].id, 'turn-0');
  assert.equal(turns.some((turn) => turn.id === 'turn-1'), false);
  assert.equal(turns.at(-1).id, 'turn-64');
});
