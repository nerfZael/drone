const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  applyChatReconciliationInStore,
  deleteChatFromStore,
  importDroneChatsFromRegistry,
  listChatsFromStore,
  patchChatMetadataInStore,
  readChatFromStore,
  readTranscriptTurnsFromStore,
  renameChatInStore,
  rollbackTranscriptToTurnInStore,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
  updateTranscriptTurnInStore,
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

  test('serializes metadata commands and commits reconciliation with one transactional outbox event', async () => {
    tempDataDir('metadata-commands');
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'default', chatEntry: legacyChat('base') });
    requireHubDatabase().read((connection) => connection.exec('DELETE FROM hub_outbox'));

    await Promise.all([
      patchChatMetadataInStore({
        droneId: 'drone-1', chatName: 'default', patch: { setIfMissing: { claudeSessionId: 'session-a' } },
      }),
      patchChatMetadataInStore({
        droneId: 'drone-1', chatName: 'default', patch: { setIfMissing: { claudeSessionId: 'session-b' } },
      }),
    ]);
    const selectedSession = readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat.claudeSessionId;
    assert.ok(selectedSession === 'session-a' || selectedSession === 'session-b');

    await applyChatReconciliationInStore({
      droneId: 'drone-1',
      chatName: 'default',
      metadataPatch: { set: { codexThreadId: 'thread-1', piSessionId: 'pi-1' } },
      turns: [{ id: 'reconciled', at: '2026-01-01T00:01:00.000Z', prompt: 'work', ok: true, output: 'done' }],
    });
    const chat = readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat;
    assert.equal(chat.codexThreadId, 'thread-1');
    assert.equal(chat.piSessionId, 'pi-1');
    assert.deepEqual(chat.turns.map((turn) => turn.id), ['reconciled']);

    const circular = {}; circular.self = circular;
    await assert.rejects(
      applyChatReconciliationInStore({
        droneId: 'drone-1',
        chatName: 'default',
        metadataPatch: { set: { broken: circular } },
        turns: [{ id: 'must-rollback', at: '2026-01-01T00:02:00.000Z', prompt: 'bad', ok: true, output: 'bad' }],
      }),
      /circular/i,
    );
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat.turns.length, 1);

    const events = requireHubDatabase().read((connection) =>
      connection.prepare("SELECT event_type FROM hub_outbox WHERE topic = 'chat.changes' ORDER BY id").all(),
    );
    assert.deepEqual(events, [
      { event_type: 'chat.metadata.changed' },
      { event_type: 'chat.reconciled' },
    ]);
  });

  test('updates individual turns and rolls back later turns without rewriting the transcript', async () => {
    tempDataDir('targeted-turns');
    await upsertChatInStore({
      droneId: 'drone-1',
      chatName: 'default',
      chatEntry: legacyChat('base', [
        { id: 'one', at: '2026-01-01T00:01:00.000Z', prompt: 'one', ok: true, output: '1' },
        { id: 'two', at: '2026-01-01T00:02:00.000Z', prompt: 'two', ok: true, output: '2' },
        { id: 'three', at: '2026-01-01T00:03:00.000Z', prompt: 'three', ok: true, output: '3', dockerSnapshot: { id: 'later', status: 'ready', createdAt: '2026-01-01T00:03:01.000Z', imageRef: 'later-image' } },
      ]),
    });
    const beforeOne = requireHubDatabase().read((connection) => connection.prepare(
      "SELECT turn_json FROM canonical_chat_turns WHERE drone_id = 'drone-1' AND chat_name = 'default' AND turn_id = 'one'",
    ).get().turn_json);
    requireHubDatabase().read((connection) => connection.exec('DELETE FROM hub_outbox'));

    await Promise.all([
      updateTranscriptTurnInStore({
        droneId: 'drone-1', chatName: 'default', turnId: 'two',
        update: (turn) => ({ ...turn, agentSuggestion: { usedDirectAt: '2026-01-01T00:04:00.000Z' } }),
      }),
      updateTranscriptTurnInStore({
        droneId: 'drone-1', chatName: 'default', turnId: 'one',
        update: (turn) => ({ ...turn, agentMessageAutoContinue: { status: 'classified', updatedAt: '2026-01-01T00:04:00.000Z' } }),
      }),
    ]);
    const afterOne = requireHubDatabase().read((connection) => connection.prepare(
      "SELECT turn_json FROM canonical_chat_turns WHERE drone_id = 'drone-1' AND chat_name = 'default' AND turn_id = 'one'",
    ).get().turn_json);
    assert.notEqual(afterOne, beforeOne);

    const rollback = await rollbackTranscriptToTurnInStore({
      droneId: 'drone-1', chatName: 'default', turnId: 'two',
      update: (turn) => ({
        ...turn,
        dockerSnapshot: { id: 'checkpoint', status: 'ready', createdAt: '2026-01-01T00:02:01.000Z', restoredAt: '2026-01-01T00:05:00.000Z' },
      }),
    });
    assert.deepEqual(rollback.removedTurns.map((turn) => turn.id), ['three']);
    const final = readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat.turns;
    assert.deepEqual(final.map((turn) => turn.id), ['one', 'two']);
    assert.equal(final[1].dockerSnapshot.restoredAt, '2026-01-01T00:05:00.000Z');

    const eventTypes = requireHubDatabase().read((connection) => connection.prepare(
      "SELECT event_type FROM hub_outbox WHERE topic = 'chat.changes' ORDER BY id",
    ).all().map((row) => row.event_type));
    assert.deepEqual(eventTypes, ['chat.turn.changed', 'chat.turn.changed', 'chat.turns.rolled-back']);
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
