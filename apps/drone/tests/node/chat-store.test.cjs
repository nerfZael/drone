const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { getPromptQueueRepository } = require('../../dist/host/prompt-queue-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  applyChatReconciliationInStore,
  archiveChatInStore,
  createChatInStore,
  deleteArchivedChatFromStore,
  deleteActiveChatFromStore,
  deleteChatFromStore,
  importArchivedChatsFromRegistry,
  importDroneChatsFromRegistry,
  listArchivedChatsFromStore,
  listChatReadStatesForDronesFromStore,
  listChatReadStatesFromStore,
  listChatsFromStore,
  markChatReadInStore,
  markChatUnreadInStore,
  patchChatMetadataInStore,
  readChatFromStore,
  readDroneChatCleanupProjectionFromStore,
  readChatReadStateFromStore,
  readTranscriptTurnsFromStore,
  renameChatInStore,
  restoreArchivedChatInStore,
  rollbackTranscriptToTurnInStore,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
  updateTranscriptTurnInStore,
  updateChatInStore,
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

    const canonical = readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat;
    assert.equal(canonical.title, 'canonical');
    assert.match(canonical.id, /^[0-9a-f-]{36}$/i);
    const stableChatId = canonical.id;
    await upsertChatInStore({
      droneId: 'drone-1',
      chatName: 'default',
      chatEntry: legacyChat('canonical again'),
    });
    assert.equal(
      readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat.id,
      stableChatId,
    );
    assert.equal(
      requireHubDatabase().read((connection) =>
        connection.prepare("SELECT COUNT(*) AS count FROM hub_schema_migrations WHERE scope = 'chats'").get().count,
      ),
      7,
    );
  });

  test('drops retired follow-up metadata while importing and reading chats', async () => {
    tempDataDir('retired-followup-metadata');
    await upsertChatInStore({
      droneId: 'drone-1',
      chatName: 'default',
      chatEntry: {
        ...legacyChat('legacy follow-up state', [{
          id: 'turn-1',
          at: '2026-01-01T00:01:00.000Z',
          prompt: 'continue',
          ok: true,
          output: 'done',
          agentMessageAutoContinue: { status: 'classified' },
          agentSuggestion: { usedDirectAt: '2026-01-01T00:02:00.000Z' },
          automation: { kind: 'prompt-loop', stage: 'run' },
        }]),
        agentMessageAutoContinueEnabled: true,
        agentMessageAutoContinueEnabledAt: '2026-01-01T00:00:00.000Z',
        agentSuggestionEnabled: true,
        agentSuggestionEnabledAt: '2026-01-01T00:00:00.000Z',
        agentCopilotHandledSourceMessageIds: ['drone-1:turn-1'],
      },
    });

    const chat = readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat;
    assert.equal(chat.agentMessageAutoContinueEnabled, undefined);
    assert.equal(chat.agentMessageAutoContinueEnabledAt, undefined);
    assert.equal(chat.agentSuggestionEnabled, undefined);
    assert.equal(chat.agentSuggestionEnabledAt, undefined);
    assert.equal(chat.agentCopilotHandledSourceMessageIds, undefined);
    assert.equal(chat.turns[0].agentMessageAutoContinue, undefined);
    assert.equal(chat.turns[0].agentSuggestion, undefined);
    assert.equal(chat.turns[0].automation, undefined);

    await importArchivedChatsFromRegistry({
      droneId: 'drone-1',
      archivedChats: {
        archived: {
          ...legacyChat('archived legacy state'),
          archivedAt: '2026-01-01T00:00:00.000Z',
          deleteAt: '2026-01-02T00:00:00.000Z',
          archiveRetention: '1d',
          pendingPrompts: [{
            id: 'queued',
            at: '2026-01-01T00:03:00.000Z',
            prompt: 'later',
            state: 'queued',
            automation: { kind: 'prompt-loop', stage: 'run' },
            blockedByAutomation: true,
          }],
        },
      },
    });
    const archived = listArchivedChatsFromStore({ droneId: 'drone-1' }).archivedChats[0].chat;
    assert.equal(archived.pendingPrompts[0].automation, undefined);
    assert.equal(archived.pendingPrompts[0].blockedByAutomation, undefined);
  });

  test('cleanup projection keeps chat identities and snapshots without deserializing activity detail', async () => {
    tempDataDir('cleanup-projection');
    const activity = {
      version: 1,
      source: 'codex',
      updatedAt: '2026-01-01T00:02:00.000Z',
      messages: [{ id: 'large-activity-sentinel', role: 'assistant', content: 'transient detail' }],
    };
    await importDroneChatsFromRegistry({
      droneId: 'drone-1',
      chats: {
        default: legacyChat('active', [{
          id: 'active-turn',
          at: '2026-01-01T00:01:00.000Z',
          prompt: 'active',
          ok: true,
          output: 'done',
          activity,
          dockerSnapshot: { imageRef: 'snapshot:active' },
        }]),
      },
    });
    await importArchivedChatsFromRegistry({
      droneId: 'drone-1',
      archivedChats: {
        old: {
          ...legacyChat('archived', [{
            id: 'archived-turn',
            at: '2026-01-01T00:01:00.000Z',
            prompt: 'archived',
            ok: true,
            output: 'done',
            activity,
            dockerSnapshot: { imageRef: 'snapshot:archived' },
          }]),
          archivedAt: '2026-01-01T00:00:00.000Z',
          deleteAt: '2026-01-02T00:00:00.000Z',
          archiveRetention: '1d',
        },
      },
    });

    const projected = readDroneChatCleanupProjectionFromStore({ droneId: 'drone-1' });

    assert.equal(projected.chats.default.title, 'active');
    assert.equal(projected.archivedChats.old.title, 'archived');
    assert.equal(projected.chats.default.turns[0].dockerSnapshot.imageRef, 'snapshot:active');
    assert.equal(projected.archivedChats.old.turns[0].dockerSnapshot.imageRef, 'snapshot:archived');
    assert.equal(JSON.stringify(projected).includes('large-activity-sentinel'), false);
  });

  test('shares monotonic unread cursors without letting stale devices clear newer replies', async () => {
    tempDataDir('shared-read-state');
    await importDroneChatsFromRegistry({
      droneId: 'drone-1',
      chats: {
        default: legacyChat('existing', [
          {
            id: 'turn-existing',
            at: '2026-01-01T00:01:00.000Z',
            completedAt: '2026-01-01T00:02:00.000Z',
            prompt: 'old',
            ok: true,
            output: 'old reply',
          },
        ]),
      },
    });
    assert.equal(readChatReadStateFromStore({ droneId: 'drone-1', chatName: 'default' }).unread, false);

    await upsertTranscriptTurnInStore({
      droneId: 'drone-1',
      chatName: 'default',
      turn: {
        id: 'turn-new',
        at: '2026-01-01T00:03:00.000Z',
        completedAt: '2026-01-01T00:04:00.000Z',
        prompt: 'new',
        ok: true,
        output: 'new reply',
      },
    });
    const unread = readChatReadStateFromStore({ droneId: 'drone-1', chatName: 'default' });
    assert.equal(unread.unread, true);
    assert.equal(unread.latestAgentTurnId, 'turn-new');
    assert.equal(unread.latestAgentRevision, 2);
    assert.deepEqual(Object.keys(listChatReadStatesFromStore({ droneId: 'drone-1' })), ['default']);
    const batched = listChatReadStatesForDronesFromStore({
      droneIds: ['drone-1', 'missing', 'drone-1'],
    });
    assert.equal(batched.get('drone-1').default.latestAgentRevision, 2);
    assert.deepEqual(batched.get('missing'), {});

    const stale = await markChatReadInStore({
      droneId: 'drone-1',
      chatName: 'default',
      latestAgentTurnId: 'turn-existing',
      latestAgentRevision: 1,
      updatedByDeviceId: 'phone-old',
    });
    assert.equal(stale.unread, true);

    const read = await markChatReadInStore({
      droneId: 'drone-1',
      chatName: 'default',
      latestAgentTurnId: 'turn-new',
      latestAgentRevision: unread.latestAgentRevision,
      updatedByDeviceId: 'phone-new',
    });
    assert.equal(read.unread, false);

    await upsertTranscriptTurnInStore({
      droneId: 'drone-1',
      chatName: 'default',
      turn: {
        id: 'turn-new',
        at: '2026-01-01T00:03:00.000Z',
        completedAt: '2026-01-01T00:05:00.000Z',
        prompt: 'new',
        ok: true,
        output: 'retried reply',
      },
    });
    const retried = readChatReadStateFromStore({ droneId: 'drone-1', chatName: 'default' });
    assert.equal(retried.latestAgentTurnId, 'turn-new');
    assert.equal(retried.latestAgentRevision, 3);
    assert.equal(retried.unread, true);

    const staleRevision = await markChatReadInStore({
      droneId: 'drone-1',
      chatName: 'default',
      latestAgentTurnId: 'turn-new',
      latestAgentRevision: 2,
      updatedByDeviceId: 'phone-old',
    });
    assert.equal(staleRevision.unread, true);

    const retriedRead = await markChatReadInStore({
      droneId: 'drone-1',
      chatName: 'default',
      latestAgentTurnId: 'turn-new',
      latestAgentRevision: retried.latestAgentRevision,
      updatedByDeviceId: 'phone-new',
    });
    assert.equal(retriedRead.unread, false);

    const manuallyUnread = await markChatUnreadInStore({
      droneId: 'drone-1',
      chatName: 'default',
      updatedByDeviceId: 'desktop',
    });
    assert.equal(manuallyUnread.unread, true);
    const alreadyUnread = await markChatUnreadInStore({
      droneId: 'drone-1',
      chatName: 'default',
      updatedByDeviceId: 'desktop',
    });
    assert.equal(alreadyUnread.readThroughRevision, manuallyUnread.readThroughRevision);
  });

  test('backfills archived chats once and tombstones prevent stale archive resurrection', async () => {
    tempDataDir('archived-backfill');
    const archived = {
      review: {
        ...legacyChat('first archive'),
        archivedAt: '2026-02-01T00:00:00.000Z',
        deleteAt: '2026-02-02T00:00:00.000Z',
        archiveRetention: '1d',
      },
    };
    await importArchivedChatsFromRegistry({ droneId: 'drone-1', archivedChats: archived });
    await importArchivedChatsFromRegistry({
      droneId: 'drone-1',
      archivedChats: { review: { ...archived.review, title: 'stale replacement' } },
    });
    assert.equal(listArchivedChatsFromStore({ droneId: 'drone-1' }).archivedChats.length, 1);
    assert.equal(listArchivedChatsFromStore({ droneId: 'drone-1' }).archivedChats[0].chat.title, 'first archive');

    const deleted = await deleteArchivedChatFromStore({ droneId: 'drone-1', archivedChatName: 'review' });
    assert.equal(deleted.deleted, true);
    await importArchivedChatsFromRegistry({ droneId: 'drone-1', archivedChats: archived });
    assert.deepEqual(listArchivedChatsFromStore({ droneId: 'drone-1' }).archivedChats, []);
  });

  test('atomically archives, restores with collision allocation, and deletes canonical chats', async () => {
    tempDataDir('archive-commands');
    const review = legacyChat('review', [
      { id: 'turn-1', at: '2026-01-01T00:01:00.000Z', prompt: 'inspect', ok: true, output: 'done' },
    ]);
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'default', chatEntry: legacyChat('default') });
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'review', chatEntry: review });

    const archived = await archiveChatInStore({
      droneId: 'drone-1',
      chatName: 'review',
      archivedAt: '2026-02-01T00:00:00.000Z',
      deleteAt: '2026-02-02T00:00:00.000Z',
      archiveRetention: '1d',
    });
    assert.equal(archived.archived, true);
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'review' }).chat, null);
    assert.deepEqual(archived.archivedChat.chat.turns.map((turn) => turn.id), ['turn-1']);

    await importDroneChatsFromRegistry({ droneId: 'drone-1', chats: { review: legacyChat('stale active') } });
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'review' }).chat, null);
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'review', chatEntry: legacyChat('new active') });

    const restored = await restoreArchivedChatInStore({
      droneId: 'drone-1',
      archivedChatName: 'review',
      maxChatNameLength: 64,
    });
    assert.equal(restored.restored, true);
    assert.equal(restored.chatName, 'review (2)');
    assert.deepEqual(readChatFromStore({ droneId: 'drone-1', chatName: 'review (2)' }).chat.turns.map((turn) => turn.id), ['turn-1']);
    assert.deepEqual(listArchivedChatsFromStore({ droneId: 'drone-1' }).archivedChats, []);

    await importArchivedChatsFromRegistry({
      droneId: 'drone-1',
      archivedChats: {
        review: {
          ...review,
          archivedAt: '2026-02-01T00:00:00.000Z',
          deleteAt: '2026-02-02T00:00:00.000Z',
          archiveRetention: '1d',
        },
      },
    });
    assert.deepEqual(listArchivedChatsFromStore({ droneId: 'drone-1' }).archivedChats, []);

    await archiveChatInStore({
      droneId: 'drone-1',
      chatName: 'review (2)',
      archivedAt: '2026-02-03T00:00:00.000Z',
      deleteAt: '2026-02-04T00:00:00.000Z',
      archiveRetention: '1d',
    });
    const deleted = await deleteArchivedChatFromStore({ droneId: 'drone-1', archivedChatName: 'review (2)' });
    assert.equal(deleted.deleted, true);
    assert.deepEqual(deleted.archivedChat.chat.turns.map((turn) => turn.id), ['turn-1']);
    assert.deepEqual(listArchivedChatsFromStore({ droneId: 'drone-1' }).archivedChats, []);
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

  test('active chat commands serialize create and metadata updates and roll back invalid writes', async () => {
    tempDataDir('active-commands');
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'default', chatEntry: legacyChat('default') });

    const creates = await Promise.allSettled([
      createChatInStore({
        droneId: 'drone-1',
        chatName: 'review',
        createEntry: () => legacyChat('first'),
      }),
      createChatInStore({
        droneId: 'drone-1',
        chatName: 'review',
        createEntry: () => legacyChat('second'),
      }),
    ]);
    assert.equal(creates.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(creates.filter((result) => result.status === 'rejected').length, 1);

    await Promise.all([
      updateChatInStore({
        droneId: 'drone-1', chatName: 'review',
        update: (chat) => ({ ...chat, model: 'model-a' }),
      }),
      updateChatInStore({
        droneId: 'drone-1', chatName: 'review',
        update: (chat) => ({ ...chat, agentPermissionMode: 'read' }),
      }),
    ]);
    const updated = readChatFromStore({ droneId: 'drone-1', chatName: 'review' }).chat;
    assert.equal(updated.model, 'model-a');
    assert.equal(updated.agentPermissionMode, 'read');

    const circular = {}; circular.self = circular;
    await assert.rejects(
      updateChatInStore({
        droneId: 'drone-1', chatName: 'review',
        update: (chat) => ({ ...chat, circular }),
      }),
      /circular/i,
    );
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'review' }).chat.circular, undefined);
    await assert.rejects(
      renameChatInStore({ droneId: 'drone-1', chatName: 'default', newChatName: 'renamed-default' }),
      /cannot rename default chat/,
    );
    await assert.rejects(
      deleteActiveChatFromStore({ droneId: 'drone-1', chatName: 'default' }),
      /cannot delete default chat/,
    );

    await assert.rejects(
      createChatInStore({
        droneId: 'drone-2',
        chatName: 'review',
        copyFromChatName: 'default',
        implicitDefaultEntry: legacyChat('implicit default'),
        createEntry: () => { throw new Error('intentional create failure'); },
      }),
      /intentional create failure/,
    );
    assert.deepEqual(listChatsFromStore({ droneId: 'drone-2' }).chats, []);
  });

  test('rename and delete commands coordinate prompt rows outside chat transactions', async () => {
    tempDataDir('active-prompt-coordination');
    await upsertChatInStore({ droneId: 'drone-1', chatName: 'review', chatEntry: legacyChat('review') });
    const prompts = getPromptQueueRepository();
    await prompts.enqueue({
      droneId: 'drone-1',
      chatName: 'review',
      prompt: {
        id: 'prompt-1',
        at: '2026-01-01T00:00:00.000Z',
        prompt: 'queued work',
        state: 'queued',
      },
    });

    assert.equal(await renameChatInStore({ droneId: 'drone-1', chatName: 'review', newChatName: 'final' }), true);
    assert.equal(prompts.get({ droneId: 'drone-1', chatName: 'review', promptId: 'prompt-1' }), null);
    assert.equal(prompts.get({ droneId: 'drone-1', chatName: 'final', promptId: 'prompt-1' }).id, 'prompt-1');

    const deleted = await deleteActiveChatFromStore({
      droneId: 'drone-1',
      chatName: 'final',
      fallbackChat: { chatName: 'default', chatEntry: legacyChat('replacement default') },
    });
    assert.deepEqual(deleted.chats, ['default']);
    assert.equal(prompts.get({ droneId: 'drone-1', chatName: 'final', promptId: 'prompt-1' }), null);
    assert.equal(readChatFromStore({ droneId: 'drone-1', chatName: 'default' }).chat.title, 'replacement default');
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
        update: (turn) => ({ ...turn, reasoning: 'high' }),
      }),
      updateTranscriptTurnInStore({
        droneId: 'drone-1', chatName: 'default', turnId: 'one',
        update: (turn) => ({ ...turn, model: 'test-model' }),
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
