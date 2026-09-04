const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createArchiveRuntime } = require('../../dist/hub/archive-runtime.js');

function record(state, id, name, extra = {}) {
  return {
    state,
    id,
    name,
    containerName: null,
    runtimeKind: 'host',
    phase: null,
    archivedAt: null,
    deleteAt: null,
    archiveRetention: null,
    archiveRuntimePolicy: null,
    lifecycle: { id, name, runtime: 'stale-runtime', ...extra },
    ...extra,
  };
}

function dependencies(overrides = {}) {
  return {
    CHAT_NAME_MAX_LEN: 80,
    DRONE_DISPLAY_NAME_MAX_LEN: 80,
    allocateUntitledDisplayName: () => 'Untitled',
    archiveChatInStore: async () => ({ archived: false, chats: [] }),
    archiveRetentionMs: () => 86_400_000,
    buildNewChatEntry: ({ droneEntry, createdAt }) => ({ droneName: droneEntry.name, createdAt }),
    collectDockerSnapshotImageRefsFromChatEntry: () => [],
    collectDockerSnapshotImageRefsFromDroneEntry: () => [],
    deleteArchivedChatFromStore: async () => ({ deleted: false }),
    deleteNativeChatSessionsForDrone: async () => {},
    droneDisplayNameExists: (registry, name) =>
      [...Object.values(registry.drones ?? {}), ...Object.values(registry.pending ?? {})]
        .some((entry) => entry.name === name),
    droneRuntime: (entry) => entry.runtime,
    dvmContainerExists: async () => true,
    dvmStart: async () => {},
    hubLog: () => {},
    importArchivedChatsFromRegistry: async () => {},
    importDroneChatsFromRegistry: async () => {},
    listExpiredArchivedChatsFromStore: () => ({ available: true, archivedChats: [] }),
    listCanonicalDroneLifecycleForRead: async () => [],
    listChatsFromStore: () => ({ available: true, chats: [] }),
    loadRegistry: async () => {
      throw new Error('full registry projection must not be loaded');
    },
    looksLikeContainerAlreadyRunningError: () => false,
    normalizeChatName: (value) => String(value ?? '').trim(),
    normalizeDroneIdentity: (value) => String(value ?? '').trim(),
    nowIso: () => '2026-08-09T12:00:00.000Z',
    parseArchiveRetentionId: (value) => value,
    parseArchiveRuntimePolicy: (value) => value,
    pauseResourceSubscriptionsForDrone: async () => {},
    permanentlyDeleteCanonicalDrone: async () => ({ removedLifecycle: true }),
    readChatFromStore: () => ({ available: true, chat: null }),
    readDroneChatCleanupProjectionFromStore: () => ({
      available: true,
      chats: {},
      archivedChats: {},
    }),
    removeDockerSnapshotImagesBestEffort: async () => {},
    removeDroneRuntimeArtifacts: async () => ({ containerGone: true, removeErr: null }),
    restoreArchivedChatInStore: async () => ({ restored: false, chatName: '', renamed: false, chats: [] }),
    resumeResourceSubscriptionsForChat: async () => {},
    resumeResourceSubscriptionsForDrone: async () => {},
    revokeMcpAccessTokensForDrone: async () => {},
    updateRegistry: async () => {},
    upsertCanonicalDroneLifecycle: async () => {},
    ...overrides,
  };
}

test('archive chat uses targeted canonical lifecycle and transcript reads', async () => {
  const lifecycle = record('real', 'drone-a', 'Alpha', { agent: { kind: 'builtin', id: 'codex' } });
  let archivedInput = null;
  const runtime = createArchiveRuntime(dependencies({
    listCanonicalDroneLifecycleForRead: async (state) => state === 'real' ? [lifecycle] : [],
    listChatsFromStore: () => ({ available: true, chats: ['default'] }),
    readChatFromStore: () => ({ available: true, chat: { id: 'chat-a', turns: [] } }),
    archiveChatInStore: async (input) => {
      archivedInput = input;
      return { archived: true, archivedChat: { chat: { id: 'chat-a' } }, chats: ['default'] };
    },
  }));

  const result = await runtime.archiveChatById({
    droneId: 'drone-a',
    chatName: 'default',
    archiveRetention: '1d',
  });

  assert.equal(result.archived, true);
  assert.equal(archivedInput.droneId, 'drone-a');
  assert.equal(archivedInput.fallbackChat.chatEntry.droneName, 'Alpha');
});

test('restore archived drone allocates names from lightweight canonical lifecycle rows', async () => {
  const archived = record('archived', 'drone-a', 'Alpha', {
    archivedAt: '2026-08-08T12:00:00.000Z',
    deleteAt: '2026-08-10T12:00:00.000Z',
    archiveRetention: '1d',
    archiveRuntimePolicy: 'keep-running',
  });
  const existing = record('real', 'drone-b', 'Alpha');
  let upsert = null;
  const runtime = createArchiveRuntime(dependencies({
    listCanonicalDroneLifecycleForRead: async (state) => {
      if (state === 'archived') return [archived];
      if (state === 'real') return [existing];
      return [];
    },
    upsertCanonicalDroneLifecycle: async (state, id, entry) => {
      upsert = { state, id, entry };
    },
  }));

  const result = await runtime.restoreArchivedDroneById({ id: 'drone-a' });

  assert.equal(result.restored, true);
  assert.equal(result.name, 'Alpha (2)');
  assert.deepEqual({ state: upsert.state, id: upsert.id, name: upsert.entry.name }, {
    state: 'real',
    id: 'drone-a',
    name: 'Alpha (2)',
  });
  assert.equal('archivedAt' in upsert.entry, false);
});

test('expired chat cleanup consumes targeted expiry keys and deletes one archive at a time', async () => {
  const lifecycle = record('real', 'drone-a', 'Alpha');
  const deleted = [];
  let cutoff = null;
  const runtime = createArchiveRuntime(dependencies({
    listCanonicalDroneLifecycleForRead: async (state) => state === 'real' ? [lifecycle] : [],
    listExpiredArchivedChatsFromStore: (input) => {
      cutoff = input.deleteAtOrBefore;
      return {
        available: true,
        archivedChats: [
          { droneId: 'drone-a', chatName: 'one' },
          { droneId: 'drone-a', chatName: 'two' },
        ],
      };
    },
    deleteArchivedChatFromStore: async ({ droneId, archivedChatName }) => {
      deleted.push({ droneId, chatName: archivedChatName });
      return { deleted: true, archivedChat: { chat: { id: archivedChatName } } };
    },
  }));

  await runtime.cleanupExpiredArchivedChats({ reason: 'test' });

  assert.ok(Number.isFinite(Date.parse(cutoff)));
  assert.deepEqual(deleted, [
    { droneId: 'drone-a', chatName: 'one' },
    { droneId: 'drone-a', chatName: 'two' },
  ]);
});
