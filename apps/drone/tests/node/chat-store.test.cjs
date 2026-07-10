const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  deleteChatFromStore,
  importDroneChatsFromRegistry,
  listChatsFromStore,
  readChatFromStore,
  readTranscriptTurnsFromStore,
  renameChatInStore,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
} = require('../../dist/hub/transcript-store.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useDataDir(dataDir) {
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
}

function tempDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `chat-store-${label}-`));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  useDataDir(dataDir);
  return dataDir;
}

function legacyChat(title, turns = []) {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    title,
    agent: { kind: 'builtin', id: 'codex' },
    turns,
    pendingPrompts: [],
  };
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('canonical chat and transcript repository', () => {
  test('backfills missing rows only and canonical metadata wins over stale registry state', async () => {
    tempDataDir('precedence');
    await importDroneChatsFromRegistry({
      droneId: 'drone-1',
      chats: { default: legacyChat('legacy') },
    });
    await upsertChatInStore({
      droneId: 'drone-1',
      chatName: 'default',
      chatEntry: legacyChat('canonical'),
    });
    await importDroneChatsFromRegistry({
      droneId: 'drone-1',
      chats: { default: legacyChat('stale legacy') },
    });

    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat.title, 'canonical');
    assert.equal(
      requireHubDatabase().read((connection) =>
        connection.prepare("SELECT COUNT(*) AS count FROM hub_schema_migrations WHERE scope = 'chats'").get().count,
      ),
      1,
    );
  });

  test('delete and rename tombstones prevent stale imports from resurrecting old names', async () => {
    tempDataDir('tombstones');
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'review', chatEntry: legacyChat('review') });
    assert.equal(await renameChatInStore({ droneId: 'drone-1', chatName: 'review', newChatName: 'final' }), true);
    await importDroneChatsFromRegistry({
      droneId: 'drone-1',
      chats: { review: legacyChat('stale old name'), final: legacyChat('stale final') },
    });
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'review' }).chat, null);
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'final' }).chat.title, 'review');

    assert.equal(await deleteChatFromStore({ droneId: 'drone-1', chatName: 'final' }), true);
    await importDroneChatsFromRegistry({ droneId: 'drone-1', chats: { final: legacyChat('resurrect') } });
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'final' }).chat, null);
    assert.deepEqual(listChatsFromStore({ droneId: 'drone-1' }).chats, []);
  });

  test('emits aggregate imports and transactional change events without a legacy-turn event flood', async () => {
    tempDataDir('outbox');
    await importDroneChatsFromRegistry({
      droneId: 'drone-1',
      chats: {
        default: legacyChat('legacy', [
          { id: 'one', at: '2026-01-01T00:01:00.000Z', prompt: 'one', ok: true, output: '1' },
          { id: 'two', at: '2026-01-01T00:02:00.000Z', prompt: 'two', ok: true, output: '2' },
        ]),
      },
    });
    await upsertTranscriptTurnInStore({
      droneId: 'drone-1',
      chatName: 'default',
      turn: { id: 'three', at: '2026-01-01T00:03:00.000Z', prompt: 'three', ok: true, output: '3' },
    });

    const events = requireHubDatabase().read((connection) =>
      connection.prepare("SELECT event_type FROM hub_outbox WHERE topic = 'chat.changes' ORDER BY id").all(),
    );
    assert.deepEqual(events, [
      { event_type: 'chat.imported' },
      { event_type: 'chat.turn.changed' },
    ]);
  });

  test('serializes concurrent turn changes and rolls back invalid chat writes', async () => {
    tempDataDir('concurrency');
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'default', chatEntry: legacyChat('base') });
    await Promise.all([
      upsertTranscriptTurnInStore({
        droneId: 'drone-1', chatName: 'default',
        turn: { id: 'later', at: '2026-01-01T00:02:00.000Z', prompt: 'later', ok: true, output: '2' },
      }),
      upsertTranscriptTurnInStore({
        droneId: 'drone-1', chatName: 'default',
        turn: { id: 'earlier', at: '2026-01-01T00:01:00.000Z', prompt: 'earlier', ok: true, output: '1' },
      }),
    ]);
    assert.deepEqual(
      readTranscriptTurnsFromStore({ droneId: 'drone-1', chatName: 'default', indexes: [0, 1] })
        .turns.map((item) => item.turn.id),
      ['earlier', 'later'],
    );

    const circular = {}; circular.self = circular;
    await assert.rejects(
      upsertChatInStore({ droneId: 'drone-1', chatName: 'broken', chatEntry: circular }),
      /circular/i,
    );
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'broken' }).chat, null);
  });

  test('switches data directories and preserves transcript ordering across restart', async () => {
    const first = tempDataDir('switch-first');
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'default', chatEntry: legacyChat('first') });
    await upsertTranscriptTurnInStore({
      droneId: 'drone-1', chatName: 'default',
      turn: { id: 'second', at: '2026-01-01T00:02:00.000Z', prompt: 'second', ok: true, output: '2' },
    });
    await upsertTranscriptTurnInStore({
      droneId: 'drone-1', chatName: 'default',
      turn: { id: 'first', at: '2026-01-01T00:01:00.000Z', prompt: 'first', ok: true, output: '1' },
    });
    await resetHubDatabaseForTests();
    assert.deepEqual(
      readTranscriptTurnsFromStore({ droneId: 'drone-1', chatName: 'default', indexes: [0, 1] })
        .turns.map((item) => item.turn.id),
      ['first', 'second'],
    );

    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-store-switch-second-'));
    roots.push(secondRoot);
    const second = path.join(secondRoot, 'data'); fs.mkdirSync(second, { recursive: true });
    useDataDir(second);
    assert.deepEqual(listChatsFromStore({ droneId: 'drone-1' }).chats, []);
    useDataDir(first);
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat.title, 'first');
  });
});
