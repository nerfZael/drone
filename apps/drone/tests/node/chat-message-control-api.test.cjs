const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resetDroneRootDirForTests } = require('../../dist/host/paths');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database');
const { startDroneHubApiServer } = require('../../dist/hub/server');
const { readChatMetadataFromStore, upsertChatInStore } = require('../../dist/hub/transcript-store');

test('only the sending chat edits or cancels its queued messages, and only the creator stops a chat', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-message-control-api-'));
  const previousDataDir = process.env.DRONE_DATA_DIR;
  const previousXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, 'xdg-data');
  fs.mkdirSync(process.env.XDG_DATA_HOME, { recursive: true });
  process.env.DRONE_DATA_DIR = root;
  resetDroneRootDirForTests();
  let server;
  t.after(async () => {
    if (server) await server.close();
    await resetHubDatabaseForTests();
    if (previousDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    if (previousXdgDataHome == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdgDataHome;
    resetDroneRootDirForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const token = 'chat-message-control-token';
  server = await startDroneHubApiServer({ port: 0, apiToken: token });
  const request = async (pathname, method = 'GET', body) => {
    const response = await fetch(`http://${server.host}:${server.port}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };

  const droneId = 'chat-control';
  const repository = await getDroneLifecycleRepository();
  await repository.upsert('real', droneId, {
    id: droneId, name: droneId, runtime: 'host', hostPort: 1, token: 'unused', createdAt: new Date().toISOString(),
  });
  await upsertChatInStore({
    droneId,
    chatName: 'default',
    chatEntry: { id: 'chat-default', agent: { kind: 'builtin', id: 'cursor' }, createdAt: new Date().toISOString() },
  });
  const lead = { kind: 'chat', chatId: 'chat-lead', droneId, chatName: 'lead' };

  // Drafts hold messages in the queue, so nothing is claimed while the test edits them.
  const created = await request(`/api/drones/${droneId}/chats`, 'POST', { name: 'worker', draft: true, createdBy: lead });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(readChatMetadataFromStore({ droneId, chatName: 'worker' }).chat.createdBy, lead);

  const send = async (prompt, sentBy) => {
    const sent = await request(`/api/drones/${droneId}/chats/worker/prompt`, 'POST', {
      prompt,
      submissionSource: sentBy ? 'assistant-tool' : 'human',
      ...(sentBy ? { sentBy } : {}),
    });
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    assert.equal(sent.body.senderRecorded, sentBy ? true : undefined);
    return sent.body.promptId;
  };
  const phase1 = await send('Phase 1', lead);
  const phase2 = await send('Phase 2', lead);
  const phase3 = await send('Phase 3', lead);
  const human = await send('From the user');

  const pendingPath = (id) => `/api/drones/${droneId}/chats/worker/pending/${id}`;
  const edited = await request(pendingPath(phase2), 'PATCH', {
    text: 'Also update the docs.',
    mode: 'append',
    requireSentByChatId: 'chat-lead',
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.prompt, 'Phase 2\n\nAlso update the docs.');
  const notMine = await request(pendingPath(human), 'PATCH', { text: 'Hijack', requireSentByChatId: 'chat-lead' });
  assert.equal(notMine.status, 403, JSON.stringify(notMine.body));

  const pending = (await request(`/api/drones/${droneId}/chats/worker/pending`)).body.pending;
  assert.deepEqual(pending.map((item) => item.id), [phase1, phase2, phase3, human]);
  assert.equal(pending[1].prompt, 'Phase 2\n\nAlso update the docs.');
  assert.deepEqual(pending[1].sentBy, lead);
  assert.equal(pending[3].sentBy, undefined);

  const cancelHuman = await request(`${pendingPath(human)}?sentByChatId=chat-lead`, 'DELETE');
  assert.equal(cancelHuman.status, 403, JSON.stringify(cancelHuman.body));
  const cancelMine = await request(`${pendingPath(phase1)}?sentByChatId=chat-lead`, 'DELETE');
  assert.equal(cancelMine.body.cancelled, true, JSON.stringify(cancelMine.body));
  const cancelAgain = await request(`${pendingPath(phase1)}?sentByChatId=chat-lead`, 'DELETE');
  assert.equal(cancelAgain.status, 404, JSON.stringify(cancelAgain.body));

  const strangerStop = await request(`/api/drones/${droneId}/chats/worker/stop`, 'POST', { requireCreatedByChatId: 'chat-other' });
  assert.equal(strangerStop.status, 403, JSON.stringify(strangerStop.body));
  const userChatStop = await request(`/api/drones/${droneId}/chats/default/stop`, 'POST', { requireCreatedByChatId: 'chat-lead' });
  assert.equal(userChatStop.status, 403, JSON.stringify(userChatStop.body));
  const creatorStop = await request(`/api/drones/${droneId}/chats/worker/stop`, 'POST', { requireCreatedByChatId: 'chat-lead' });
  assert.equal(creatorStop.status, 200, JSON.stringify(creatorStop.body));
  assert.deepEqual(creatorStop.body.clearedPromptIds.sort(), [phase2, phase3, human].sort());
});
