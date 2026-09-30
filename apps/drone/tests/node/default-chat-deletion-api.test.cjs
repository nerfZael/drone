const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resetDroneRootDirForTests } = require('../../dist/host/paths');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database');
const { startDroneHubApiServer } = require('../../dist/hub/server');
const { droneChatNames } = require('../../dist/hub/drone-chat-names');
const { listChatsFromStore, readChatFromStore, upsertChatInStore } = require('../../dist/hub/transcript-store');

test('default deletion and omitted chat targets use SQLite, not lifecycle chat snapshots', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'default-chat-api-'));
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
  const token = 'default-chat-api-token';
  server = await startDroneHubApiServer({ port: 0, apiToken: token });
  const request = async (pathname, method = 'GET', body) => {
    const response = await fetch(`http://${server.host}:${server.port}${pathname}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const repository = await getDroneLifecycleRepository();
  for (const action of ['delete', 'archive']) {
    const id = `default-${action}`;
    await repository.upsert('real', id, { id, name: id, runtime: 'host', hostPort: 1, token: 'unused', createdAt: new Date().toISOString() });
    for (const name of ['default', 'review']) {
      await upsertChatInStore({ droneId: id, chatName: name, chatEntry: { id: `${id}-${name}`, agent: { kind: 'builtin', id: 'cursor' }, createdAt: new Date().toISOString() } });
    }
    assert.equal(repository.get(id).lifecycle.chats, undefined);
    assert.deepEqual(droneChatNames(id), ['default', 'review']);
    const target = `/api/drones/${id}/chats/default`;
    const removed = await request(action === 'archive' ? `${target}/archive` : target, action === 'archive' ? 'POST' : 'DELETE');
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(removed.body.chats, ['review']);
    assert.equal(readChatFromStore({ droneId: id, chatName: 'default' }).chat, null);
    // Stale legacy data must not change a canonical fallback decision.
    assert.deepEqual(droneChatNames(id, { default: {} }), ['review']);
    const opened = await request('/api/assistant/ui-action', 'POST', { type: 'open_drone_chat', droneId: id });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.uiAction.chatName, 'review');
    assert.deepEqual(listChatsFromStore({ droneId: id }).chats, ['review']);
    const missing = await request(target, 'DELETE');
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
  }
  await repository.upsert('real', 'sole', { id: 'sole', name: 'sole', runtime: 'host', createdAt: new Date().toISOString() });
  await upsertChatInStore({ droneId: 'sole', chatName: 'default', chatEntry: { id: 'sole-default' } });
  assert.equal((await request('/api/drones/sole/chats/default', 'DELETE')).status, 400);
  assert.equal((await request('/api/drones/sole/chats/default/archive', 'POST')).status, 400);
  assert.deepEqual(droneChatNames('empty', { default: {} }), []);
});
