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
  readCanonicalChatActivityModel,
  readCanonicalDroneLifecycleModel,
  readCanonicalDroneSummaryModel,
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
    turn: {
      id: 'turn-1',
      at: '2026-07-10T10:03:00.000Z',
      prompt: 'hello',
      ok: true,
      output: 'world',
      activity: {
        version: 1,
        source: 'codex',
        updatedAt: '2026-07-10T10:03:30.000Z',
        messages: [{ id: 'activity-1', role: 'assistant', content: 'large live activity' }],
      },
      dockerSnapshot: { status: 'creating', imageRef: 'benchmark-image' },
    },
  });
  await getPromptQueueRepository().enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    prompt: {
      id: 'prompt-1',
      at: '2026-07-10T10:04:00.000Z',
      prompt: 'next',
      state: 'queued',
      activity: {
        version: 1,
        source: 'codex',
        updatedAt: '2026-07-10T10:04:30.000Z',
        messages: [{ id: 'activity-2', role: 'assistant', content: 'large queued activity' }],
      },
      action: { type: 'send-in-new-chat', chatName: 'review' },
      approvals: [{ id: 'approval-1', status: 'pending' }],
    },
  });
  await getPromptQueueRepository().enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    prompt: {
      id: 'turn-1',
      at: '2026-07-10T10:03:00.000Z',
      prompt: 'already represented by the transcript turn',
      state: 'sent',
    },
  });

  const database = requireHubDatabase();
  const storedProjections = database.read((connection) => ({
    turn: connection.prepare(`
      SELECT turns.turn_json AS full_json, projection.turn_json AS active_json
      FROM canonical_chat_turns AS turns
      JOIN canonical_chat_turn_active_projections AS projection
        USING (drone_id, chat_name, turn_id)
      WHERE turns.turn_id = 'turn-1'
    `).get(),
    prompt: connection.prepare(`
      SELECT prompts.payload_json AS full_json, projection.payload_json AS active_json
      FROM prompts
      JOIN prompt_active_projections AS projection
        USING (drone_id, chat_name, prompt_id)
      WHERE prompts.prompt_id = 'prompt-1'
    `).get(),
  }));
  assert.equal(JSON.parse(storedProjections.turn.full_json).activity.messages.length, 1);
  assert.deepEqual(JSON.parse(storedProjections.turn.active_json).activity, {
    updatedAt: '2026-07-10T10:03:30.000Z',
  });
  assert.equal(JSON.parse(storedProjections.prompt.full_json).activity.messages.length, 1);
  assert.deepEqual(JSON.parse(storedProjections.prompt.active_json).activity, {
    updatedAt: '2026-07-10T10:04:30.000Z',
  });
  const changesBefore = database.read((connection) => connection.prepare('SELECT total_changes() AS count').get().count);
  const model = readCanonicalActiveDroneModel();
  const changesAfter = database.read((connection) => connection.prepare('SELECT total_changes() AS count').get().count);

  assert.equal(changesAfter, changesBefore);
  assert.equal(model.drones['drone-a'].name, 'alpha');
  assert.equal(model.drones['drone-a'].chats.default.turns[0].output, 'world');
  assert.deepEqual(model.drones['drone-a'].chats.default.turns[0].activity, {
    updatedAt: '2026-07-10T10:03:30.000Z',
  });
  assert.equal(model.drones['drone-a'].chats.default.pendingPrompts[0].id, 'prompt-1');
  assert.deepEqual(model.drones['drone-a'].chats.default.pendingPrompts[0].activity, {
    updatedAt: '2026-07-10T10:04:30.000Z',
  });
  assert.deepEqual(
    model.drones['drone-a'].chats.default.pendingPrompts.map((prompt) => prompt.id),
    ['prompt-1'],
  );
  assert.equal(model.pending['drone-b'].phase, 'starting');
  assert.equal(readCanonicalDroneLifecycleModel().drones['drone-a'].chats, undefined);

  const chatActivity = readCanonicalChatActivityModel('drone-a', 'default');
  assert.deepEqual(Object.keys(chatActivity.drones), ['drone-a']);
  assert.deepEqual(Object.keys(chatActivity.drones['drone-a'].chats), ['default']);
  assert.equal(chatActivity.drones['drone-a'].chats.default.turns[0].output, 'world');
  assert.deepEqual(chatActivity.drones['drone-a'].chats.default.turns[0].activity, {
    updatedAt: '2026-07-10T10:03:30.000Z',
  });
  assert.deepEqual(
    chatActivity.drones['drone-a'].chats.default.pendingPrompts.map((prompt) => prompt.id),
    ['prompt-1'],
  );
  assert.deepEqual(chatActivity.pending, {});

  const summaryPhases = [];
  const summary = readCanonicalDroneSummaryModel((phase) => summaryPhases.push(phase));
  const summaryChat = summary.drones['drone-a'].chats.default;
  assert.equal(summaryChat.turns.length, 1);
  assert.equal(summaryChat.turns[0].at, '2026-07-10T10:03:00.000Z');
  assert.deepEqual(summaryChat.turns[0].dockerSnapshot, { status: 'creating' });
  assert.equal(summaryChat.turns[0].output, undefined);
  assert.deepEqual(summaryChat.pendingPrompts[0].activity, {
    updatedAt: '2026-07-10T10:04:30.000Z',
  });
  assert.deepEqual(summaryChat.pendingPrompts[0].action, {
    type: 'send-in-new-chat',
    chatName: 'review',
  });
  assert.deepEqual(summaryChat.pendingPrompts[0].approvals, [
    { id: 'approval-1', status: 'pending' },
  ]);
  assert.ok(summaryPhases.some((phase) => phase.name === 'turns' && phase.rowCount === 1));
  assert.ok(summaryPhases.some((phase) => phase.name === 'prompts' && phase.rowCount === 1));

  await database.writeTransaction('preserve non-object activity fixture', (connection) => {
    connection.prepare(`UPDATE canonical_chat_turns
      SET turn_json = json_set(turn_json, '$.activity', json('null'))
      WHERE drone_id = 'drone-a' AND chat_name = 'default' AND turn_id = 'turn-1'`).run();
  });
  const nullActivityProjection = database.read((connection) => connection.prepare(`
    SELECT turn_json FROM canonical_chat_turn_active_projections
    WHERE drone_id = 'drone-a' AND chat_name = 'default' AND turn_id = 'turn-1'
  `).get());
  assert.equal(JSON.parse(nullActivityProjection.turn_json).activity, null);
  assert.equal(
    readCanonicalActiveDroneModel().drones['drone-a'].chats.default.turns[0].activity,
    null,
  );
});

test('canonical summary read model keeps a large fleet plus startup and draft drones', async () => {
  useTempDataDir();
  const lifecycle = await getDroneLifecycleRepository();
  for (let index = 0; index < 144; index += 1) {
    await lifecycle.upsert('real', `drone-${index}`, {
      id: `drone-${index}`,
      name: `Drone ${index}`,
      runtime: 'host',
      createdAt: new Date(index * 1_000).toISOString(),
    });
  }
  await lifecycle.upsert('pending', 'starting-drone', {
    id: 'starting-drone',
    name: 'Starting Drone',
    runtime: 'container',
    phase: 'starting',
  });
  await lifecycle.upsert('pending', 'draft-drone', {
    id: 'draft-drone',
    name: 'Draft Drone',
    runtime: 'container',
    phase: 'draft',
    draft: true,
  });

  const model = readCanonicalDroneSummaryModel();

  assert.equal(Object.keys(model.drones).length, 144);
  assert.equal(model.pending['starting-drone'].phase, 'starting');
  assert.equal(model.pending['draft-drone'].phase, 'draft');
  assert.equal(model.pending['draft-drone'].draft, true);
});

test('canonical summary keeps only the newest unresolved sent prompt unless an older prompt has approvals', async () => {
  useTempDataDir();
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.upsert('real', 'drone-a', {
    id: 'drone-a',
    name: 'alpha',
    runtime: 'host',
  });
  await upsertChatInStore({ droneId: 'drone-a', chatName: 'default', chatEntry: {} });
  const prompts = getPromptQueueRepository();
  await prompts.enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    prompt: {
      id: 'sent-old',
      at: '2026-07-10T10:00:00.000Z',
      prompt: 'old delivered prompt',
      state: 'sent',
    },
  });
  await prompts.enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    prompt: {
      id: 'sent-with-approval',
      at: '2026-07-10T10:01:00.000Z',
      prompt: 'delivered prompt awaiting approval',
      state: 'sent',
      approvals: [{ id: 'approval-1', status: 'pending' }],
    },
  });
  await prompts.enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    prompt: {
      id: 'sent-new',
      at: '2026-07-10T10:02:00.000Z',
      prompt: 'newest delivered prompt',
      state: 'sent',
    },
  });
  await prompts.enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    prompt: {
      id: 'queued',
      at: '2026-07-10T10:03:00.000Z',
      prompt: 'queued prompt',
      state: 'queued',
    },
  });

  const summaryIds = readCanonicalDroneSummaryModel().drones[
    'drone-a'
  ].chats.default.pendingPrompts.map((prompt) => prompt.id);
  const activeIds = readCanonicalActiveDroneModel().drones[
    'drone-a'
  ].chats.default.pendingPrompts.map((prompt) => prompt.id);

  assert.deepEqual(summaryIds, ['sent-with-approval', 'sent-new', 'queued']);
  assert.deepEqual(activeIds, ['sent-old', 'sent-with-approval', 'sent-new', 'queued']);
});

test('canonical summary read model compares offset timestamps chronologically', async () => {
  useTempDataDir();
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.upsert('real', 'drone-a', {
    id: 'drone-a',
    name: 'Drone A',
    runtime: 'host',
  });
  await upsertChatInStore({ droneId: 'drone-a', chatName: 'default', chatEntry: {} });
  await upsertTranscriptTurnInStore({
    droneId: 'drone-a',
    chatName: 'default',
    turn: {
      id: 'turn-early',
      at: '2026-01-01T10:00:00+14:00',
      prompt: 'earlier',
      ok: true,
      output: 'earlier',
    },
  });
  await upsertTranscriptTurnInStore({
    droneId: 'drone-a',
    chatName: 'default',
    turn: {
      id: 'turn-late',
      at: '2026-01-01T00:30:00-12:00',
      prompt: 'later',
      ok: true,
      output: 'later',
    },
  });

  const model = readCanonicalDroneSummaryModel();

  assert.equal(model.drones['drone-a'].chats.default.turns[0].at, '2026-01-01T12:30:00.000Z');
});

test('canonical active drone read model bounds history', async () => {
  useTempDataDir();
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.upsert('real', 'drone-a', {
    id: 'drone-a',
    name: 'alpha',
    runtime: 'container',
    createdAt: '2026-07-10T10:00:00.000Z',
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
  assert.equal(turns.length, 60);
  assert.equal(turns[0].id, 'turn-5');
  assert.equal(turns.at(-1).id, 'turn-64');
});

test('canonical active drone read model tolerates a malformed stored payload', async () => {
  useTempDataDir();
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.upsert('real', 'drone-a', {
    id: 'drone-a',
    name: 'alpha',
    runtime: 'container',
  });
  await upsertChatInStore({
    droneId: 'drone-a',
    chatName: 'default',
    chatEntry: {},
  });
  await upsertTranscriptTurnInStore({
    droneId: 'drone-a',
    chatName: 'default',
    turn: { id: 'turn-1', at: '2026-07-10T10:00:00.000Z', prompt: 'hello', ok: true, output: 'world' },
  });
  await requireHubDatabase().writeTransaction('corrupt turn fixture', (connection) => {
    connection.exec('DROP TRIGGER active_chat_message_search_turn_update');
    connection.prepare(`UPDATE canonical_chat_turns SET turn_json = '{malformed "dockerSnapshot"'
      WHERE drone_id = 'drone-a' AND chat_name = 'default' AND turn_id = 'turn-1'`).run();
  });

  const turns = readCanonicalActiveDroneModel().drones['drone-a'].chats.default.turns;
  assert.deepEqual(turns, [{}]);
  const summaryTurns = readCanonicalDroneSummaryModel().drones['drone-a'].chats.default.turns;
  assert.deepEqual(summaryTurns, [{ at: '2026-07-10T10:00:00.000Z' }]);
});
