const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const registry = require('../../dist/host/registry.js');
const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { getTranscriptStore } = require('../../dist/hub/transcript-store.js');
const { authenticateMcpBearerToken, createChatMcpAccessToken } = require('../../dist/hub/mcp-tokens.js');

test('chat authentication reads current canonical metadata without loading the registry or transcripts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-auth-'));
  const originalDir = process.env.DRONE_DATA_DIR;
  const originalLoad = registry.loadRegistry;
  process.env.DRONE_DATA_DIR = root;
  resetDroneRootDirForTests();
  try {
    const lifecycle = await getDroneLifecycleRepository();
    for (const id of ['owner', 'target']) {
      await lifecycle.upsert('real', id, { id, name: `${id} name`, runtime: 'host' });
    }
    const chats = getTranscriptStore();
    await chats.upsertChat({ droneId: 'owner', chatName: 'original', chatEntry: {
      id: 'chat-id', droneHubMcpAccessScope: { readMode: 'selected', droneIds: ['target'] },
      turns: [{ id: 'turn', at: '2026-01-01', prompt: 'private history', output: 'history', ok: true }],
    } });
    const db = requireHubDatabase();
    const mutate = (fn) => db.writeTransaction('test authorization changes', fn);
    registry.loadRegistry = async () => { throw new Error('must not load full registry'); };
    chats.readChat = () => { throw new Error('must not hydrate chat history'); };
    const token = (overrides = {}) => createChatMcpAccessToken({
      droneId: 'owner', chatName: 'original', chatId: 'chat-id', signingSecret: 'secret', ...overrides,
    });
    const signed = token();
    const auth = () => authenticateMcpBearerToken(signed, 'secret');
    let identity = await auth();
    assert.equal(identity.chatName, 'original');
    assert.deepEqual(identity.selectedDroneRefs, ['target', 'target name', 'owner', 'owner name']);
    assert.equal(await authenticateMcpBearerToken(signed, 'wrong secret'), null);
    assert.equal(await authenticateMcpBearerToken(token({ droneId: 'target' }), 'secret'), null);

    await mutate(c => {
      c.prepare("UPDATE canonical_chats SET chat_name = 'renamed', metadata_json = json_set(metadata_json, '$.droneHubMcpAccessScope', json(?)) WHERE drone_id = 'owner'")
        .run(JSON.stringify({ readMode: 'selected', writeMode: 'selected', executeMode: 'selected', droneIds: [] }));
      c.prepare("UPDATE hub_canonical_drones SET name = 'new owner name' WHERE drone_id = 'owner'").run();
    });
    identity = await auth();
    assert.equal(identity.chatName, 'renamed');
    assert.deepEqual(identity.selectedDroneRefs, ['owner', 'new owner name']);

    await mutate(c => {
      c.prepare("UPDATE canonical_chats SET metadata_json = json_set(metadata_json, '$.id', 'repaired-id') WHERE drone_id = 'owner'").run();
      c.prepare('INSERT INTO canonical_chat_identity_repairs VALUES (?, ?, ?, ?, ?)')
        .run('owner', 'original', 'chat-id', 'repaired-id', new Date().toISOString());
    });
    assert.equal((await auth()).chatId, 'repaired-id');
    assert.equal(await authenticateMcpBearerToken(token({ chatName: 'unrelated' }), 'secret'), null);

    // Orphaned chat rows must not authorize an archived/deleted/pending drone.
    await mutate(c => c.prepare("DELETE FROM hub_canonical_drones WHERE drone_id = 'owner'").run());
    assert.equal(await auth(), null);
    await lifecycle.upsert('real', 'owner', { id: 'owner', name: 'restored', runtime: 'host' });
    assert.ok(await auth());
    await mutate(c => c.prepare("DELETE FROM canonical_chats WHERE drone_id = 'owner'").run());
    assert.equal(await auth(), null);
    // Reusing a chat name must not resurrect the old token.
    await chats.upsertChat({ droneId: 'owner', chatName: 'original', chatEntry: { id: 'new-chat-id' } });
    assert.equal(await auth(), null);
  } finally {
    registry.loadRegistry = originalLoad;
    await resetHubDatabaseForTests();
    if (originalDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = originalDir;
    resetDroneRootDirForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
