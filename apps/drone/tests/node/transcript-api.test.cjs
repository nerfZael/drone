const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resetDroneRootDirForTests } = require('../../dist/host/paths');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository');
const { getPromptQueueRepository } = require('../../dist/host/prompt-queue-repository');
const { getHubDatabase } = require('../../dist/host/hub-database');
const { loadRegistry } = require('../../dist/host/registry');
const { startDroneHubApiServer } = require('../../dist/hub/server');
const {
  getTranscriptStoreUnavailableReason,
  importDroneChatsFromRegistry,
  readChatFromStore,
  readTranscriptTurnsFromStore,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
} = require('../../dist/hub/transcript-store');

async function apiFetch(baseUrl, token, pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { response, data, text };
}

async function seedDrone(droneId) {
  const now = new Date().toISOString();
  const entry = {
    id: droneId,
    name: droneId,
    hostPort: 1,
    token: 'mock-token',
    containerPort: 7777,
    repoPath: '',
    createdAt: now,
  };
  const repository = await getDroneLifecycleRepository();
  await repository.upsert('real', droneId, entry);
  await upsertChatInStore({
    droneId,
    chatName: 'default',
    chatEntry: {
      createdAt: now,
      agent: { kind: 'builtin', id: 'cursor' },
      turns: [],
      pendingPrompts: [],
    },
  });
  await getPromptQueueRepository().enqueue({
    droneId,
    chatName: 'default',
    prompt: {
      id: 'pending-1',
      at: '2026-01-01T00:04:00.000Z',
      updatedAt: '2026-01-01T00:04:01.000Z',
      prompt: 'third',
      state: 'queued',
    },
  });
}

test('Node Hub transcript API uses SQLite read model and cheap conditional ETags', async (t) => {
  const token = 'node-test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-node-transcript-api-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  const previousDroneDataDir = process.env.DRONE_DATA_DIR;
  fs.mkdirSync(droneDataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = droneDataDir;
  resetDroneRootDirForTests();

  let server = null;
  t.after(async () => {
    if (server) await server.close();
    if (previousDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  server = await startDroneHubApiServer({ port: 0, apiToken: token });
  const baseUrl = `http://${server.host}:${server.port}`;
  const droneId = 'node-transcript-sqlite';
  await seedDrone(droneId);

  const older = '2026-01-01T00:01:00.000Z';
  const newer = '2026-01-01T00:02:00.000Z';
  const fileChanges = {
    version: 2,
    capturedAt: '2026-01-01T00:03:03.000Z',
    counts: { changed: 1, additions: 12, deletions: 1, modified: 1 },
    workspaces: [
      {
        targetId: `drone:${droneId}`,
        droneId,
        label: droneId,
        diffArtifactId: 'diff-artifact-newer',
        counts: { changed: 1, additions: 12, deletions: 1, modified: 1 },
        previewEntries: [
          {
            path: 'ARCHITECTURE.md',
            status: 'modified',
            additions: 12,
            deletions: 1,
            modified: 1,
          },
        ],
      },
    ],
  };
  await upsertChatInStore({
    droneId,
    chatName: 'default',
    chatEntry: {
      createdAt: older,
      agent: { kind: 'builtin', id: 'cursor' },
      turns: [
      {
        id: 'newer',
        at: newer,
        promptAt: newer,
        completedAt: '2026-01-01T00:03:00.000Z',
        prompt: 'second',
        ok: true,
        output: 'two',
        dockerSnapshot: {
          id: 'snapshot-newer',
          status: 'ready',
          createdAt: '2026-01-01T00:03:01.000Z',
          imageRef: 'drone-hub-snapshot-node-transcript-sqlite-default:newer',
          sizeBytes: 123456,
          readyAt: '2026-01-01T00:03:02.000Z',
        },
        fileChanges,
      },
      {
        id: 'older',
        at: older,
        promptAt: older,
        completedAt: '2026-01-01T00:01:30.000Z',
        prompt: 'first',
        ok: true,
        output: 'one',
      },
      ],
      pendingPrompts: [
      {
        id: 'pending-1',
        at: '2026-01-01T00:04:00.000Z',
        updatedAt: '2026-01-01T00:04:01.000Z',
        prompt: 'third',
        state: 'queued',
      },
      ],
    },
  });

  const first = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`,
  );
  assert.equal(first.response.status, 200, first.text);
  assert.equal(first.data.ok, true);
  assert.equal(first.data.transcripts[1].dockerSnapshot.id, 'snapshot-newer');
  assert.equal(first.data.transcripts[1].dockerSnapshot.status, 'ready');
  assert.deepEqual(first.data.transcripts[1].fileChanges, fileChanges);
  assert.deepEqual(
    first.data.transcripts.map((turn) => turn.prompt),
    ['first', 'second'],
  );
  const etag = first.response.headers.get('etag');
  assert.match(etag ?? '', /^"sha256-/);
  assert.match(first.response.headers.get('server-timing') ?? '', /lifecycle;dur=/);
  assert.match(first.response.headers.get('server-timing') ?? '', /version;dur=/);
  assert.match(first.response.headers.get('server-timing') ?? '', /rows;dur=/);

  const readCounts = () => getHubDatabase().read((connection) => ({
    lifecycleBackfills: connection.prepare('SELECT COUNT(*) AS count FROM hub_drone_lifecycle_backfill').get().count,
    chats: connection.prepare('SELECT COUNT(*) AS count FROM canonical_chats').get().count,
    turns: connection.prepare('SELECT COUNT(*) AS count FROM canonical_chat_turns').get().count,
    prompts: connection.prepare('SELECT COUNT(*) AS count FROM prompts').get().count,
  }));
  const beforeCanonicalRead = readCounts();
  const stateRead = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=1`,
  );
  assert.equal(stateRead.response.status, 200, stateRead.text);
  assert.deepEqual(readCounts(), beforeCanonicalRead, 'canonical hot reads must not backfill or mutate storage');
  assert.equal(stateRead.data.transcripts.length, 1);
  assert.equal(stateRead.data.transcripts[0].fileChanges.workspaces[0].diffArtifactId, 'diff-artifact-newer');
  assert.equal(stateRead.data.pending[0].id, 'pending-1');
  const stateEtag = stateRead.response.headers.get('etag');
  const unchangedState = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=1`,
    { headers: { 'if-none-match': stateEtag ?? '' } },
  );
  assert.equal(unchangedState.response.status, 304);
  assert.equal(unchangedState.text, '');
  assert.match(unchangedState.response.headers.get('server-timing') ?? '', /conditional;dur=/);
  assert.doesNotMatch(unchangedState.response.headers.get('server-timing') ?? '', /rows;dur=/);

  const sqlitePath = path.join(droneDataDir, 'hub.sqlite');
  assert.equal(fs.existsSync(sqlitePath), true);
  assert.equal(getTranscriptStoreUnavailableReason(), null);

  const orderedImport = await importDroneChatsFromRegistry({
    droneId: 'ordering-drone',
    chats: {
      default: {
        createdAt: '2026-01-01T00:00:00.000Z',
        pendingPrompts: [
          {
            id: 'delayed-start',
            at: '2026-01-01T00:00:30.000Z',
            updatedAt: '2026-01-01T00:05:30.000Z',
            prompt: 'submitted before daemon start',
            state: 'sent',
          },
        ],
        turns: [
          {
            id: 'delayed-start',
            at: '2026-01-01T00:05:00.000Z',
            promptAt: '2026-01-01T00:05:00.000Z',
            completedAt: '2026-01-01T00:05:30.000Z',
            prompt: 'submitted before daemon start',
            ok: true,
            output: 'done',
          },
        ],
      },
    },
  });
  assert.equal(orderedImport.available, true);
  const orderedRead = readTranscriptTurnsFromStore({ droneId: 'ordering-drone', chatName: 'default', indexes: [0] });
  assert.equal(orderedRead.available, true);
  assert.equal(orderedRead.turns[0].turn.promptAt, '2026-01-01T00:00:30.000Z');

  const chats = await apiFetch(baseUrl, token, `/api/drones/${encodeURIComponent(droneId)}/chats`);
  assert.equal(chats.response.status, 200, chats.text);
  assert.deepEqual(chats.data.chats, ['default']);

  const chatInfo = await apiFetch(baseUrl, token, `/api/drones/${encodeURIComponent(droneId)}/chats/default`);
  assert.equal(chatInfo.response.status, 200, chatInfo.text);
  assert.equal(chatInfo.data.turns.length, 2);

  const pending = await apiFetch(baseUrl, token, `/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
  assert.equal(pending.response.status, 200, pending.text);
  assert.equal(pending.data.pending.length, 1);
  assert.equal(pending.data.pending[0].id, 'pending-1');

  const storeRead = readTranscriptTurnsFromStore({ droneId, chatName: 'default', indexes: [0, 1] });
  assert.equal(storeRead.available, true);
  assert.deepEqual(
    storeRead.turns.map((item) => item.turn.prompt),
    ['first', 'second'],
  );
  assert.equal(storeRead.turns[1].turn.dockerSnapshot.id, 'snapshot-newer');

  const second = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`,
    { headers: { 'if-none-match': etag ?? '' } },
  );
  assert.equal(second.response.status, 304);
  assert.equal(second.text, '');
  assert.match(second.response.headers.get('server-timing') ?? '', /conditional;dur=/);
  assert.doesNotMatch(second.response.headers.get('server-timing') ?? '', /rows;dur=/);

  const orphanWrite = await upsertTranscriptTurnInStore({
    droneId,
    chatName: 'default',
    turn: {
      id: 'markdown-doc',
      at: '2026-01-01T00:05:00.000Z',
      promptAt: '2026-01-01T00:05:00.000Z',
      completedAt: '2026-01-01T00:05:30.000Z',
      prompt: 'create a markdown document',
      ok: true,
      output: '# Document\n',
    },
  });
  assert.equal(orphanWrite.available, true);

  const afterOrphan = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`,
    { headers: { 'if-none-match': etag ?? '' } },
  );
  assert.equal(afterOrphan.response.status, 200, afterOrphan.text);
  assert.notEqual(afterOrphan.response.headers.get('etag'), etag);
  assert.deepEqual(
    afterOrphan.data.transcripts.map((turn) => turn.prompt),
    ['first', 'second', 'create a markdown document'],
  );

  const deletedChats = await importDroneChatsFromRegistry({ droneId, chats: {} });
  assert.equal(deletedChats.available, true);
  const deletedChatRead = readChatFromStore({ droneId, chatName: 'default' });
  assert.equal(deletedChatRead.available, true);
  assert.notEqual(deletedChatRead.chat, null);

  const recreatedChats = await importDroneChatsFromRegistry({
    droneId,
    chats: {
      default: {
        createdAt: '2026-01-01T00:06:00.000Z',
        turns: [],
        pendingPrompts: [],
      },
    },
  });
  assert.equal(recreatedChats.available, true);
  const recreatedChatRead = readChatFromStore({ droneId, chatName: 'default' });
  assert.equal(recreatedChatRead.available, true);
  assert.equal(recreatedChatRead.chat.turns.length, 3);

  const missing = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/review/transcript?turn=all`,
  );
  assert.equal(missing.response.status, 404);
  const missingPending = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/review/pending`,
  );
  assert.equal(missingPending.response.status, 404);
  const reg = await loadRegistry();
  assert.equal(reg.drones?.[droneId]?.chats?.review, undefined);
});
