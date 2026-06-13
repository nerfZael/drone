const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resetDroneRootDirForTests } = require('../../dist/host/paths');
const { loadRegistry, updateRegistry } = require('../../dist/host/registry');
const { startDroneHubApiServer } = require('../../dist/hub/server');
const {
  getTranscriptStoreUnavailableReason,
  readTranscriptTurnsFromStore,
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
  await updateRegistry((reg) => {
    reg.drones = reg.drones ?? {};
    reg.drones[droneId] = {
      id: droneId,
      name: droneId,
      hostPort: 1,
      token: 'mock-token',
      containerPort: 7777,
      repoPath: '',
      createdAt: now,
      chats: {
        default: {
          createdAt: now,
          agent: { kind: 'builtin', id: 'cursor' },
          turns: [],
          pendingPrompts: [],
          agentSuggestionEnabled: true,
        },
      },
    };
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
  await updateRegistry((reg) => {
    const entry = reg.drones?.[droneId]?.chats?.default;
    assert.ok(entry, 'missing seeded chat entry');
    entry.turns = [
      {
        id: 'newer',
        at: newer,
        promptAt: newer,
        completedAt: '2026-01-01T00:03:00.000Z',
        prompt: 'second',
        ok: true,
        output: 'two',
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
    ];
    entry.pendingPrompts = [
      {
        id: 'pending-1',
        at: '2026-01-01T00:04:00.000Z',
        updatedAt: '2026-01-01T00:04:01.000Z',
        prompt: 'third',
        state: 'queued',
      },
    ];
  });

  const first = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`,
  );
  assert.equal(first.response.status, 200, first.text);
  assert.equal(first.data.ok, true);
  assert.deepEqual(
    first.data.transcripts.map((turn) => turn.prompt),
    ['first', 'second'],
  );
  const etag = first.response.headers.get('etag');
  assert.match(etag ?? '', /^"transcript-/);

  const sqlitePath = path.join(droneDataDir, 'hub.sqlite');
  assert.equal(fs.existsSync(sqlitePath), true);
  assert.equal(getTranscriptStoreUnavailableReason(), null);

  const chats = await apiFetch(baseUrl, token, `/api/drones/${encodeURIComponent(droneId)}/chats`);
  assert.equal(chats.response.status, 200, chats.text);
  assert.deepEqual(chats.data.chats, ['default']);

  const chatInfo = await apiFetch(baseUrl, token, `/api/drones/${encodeURIComponent(droneId)}/chats/default`);
  assert.equal(chatInfo.response.status, 200, chatInfo.text);
  assert.equal(chatInfo.data.agentSuggestionEnabled, true);
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

  const second = await apiFetch(
    baseUrl,
    token,
    `/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`,
    { headers: { 'if-none-match': etag ?? '' } },
  );
  assert.equal(second.response.status, 304);
  assert.equal(second.text, '');

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
