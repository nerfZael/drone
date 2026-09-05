const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const build = path.resolve(__dirname, process.env.DRONE_HTTP_TEST_BUILD || '../../dist');
const { resetDroneRootDirForTests } = require(path.join(build, 'host/paths'));
const { getHubDatabase, resetHubDatabaseForTests } = require(path.join(build, 'host/hub-database'));
const { getDroneLifecycleRepository } = require(
  path.join(build, 'host/drone-lifecycle-repository'),
);
const { getPromptQueueRepository } = require(path.join(build, 'host/prompt-queue-repository'));
const { upsertChatInStore, upsertTranscriptTurnInStore, readTranscriptTurnsFromStore } = require(
  path.join(build, 'hub/transcript-store'),
);
const { createDeviceMeshService } = require(path.join(build, 'hub/device-mesh'));

test('HTTP mesh upgrade leaves populated canonical SQLite content and source files intact across reopen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-populated-http-upgrade-'));
  const previous = process.env.DRONE_DATA_DIR;
  process.env.DRONE_DATA_DIR = root;
  resetDroneRootDirForTests();
  try {
    const now = new Date().toISOString();
    const lifecycle = await getDroneLifecycleRepository();
    await lifecycle.upsert('real', 'drone-preserved', {
      id: 'drone-preserved',
      name: 'Preserved drone',
      hostPort: 7777,
      token: 'credential-reference',
      containerPort: 7777,
      repoPath: '/existing/workspace',
      createdAt: now,
    });
    await upsertChatInStore({
      droneId: 'drone-preserved',
      chatName: 'default',
      chatEntry: {
        createdAt: now,
        agent: { kind: 'builtin', id: 'cursor' },
        turns: [],
        pendingPrompts: [],
      },
    });
    await upsertTranscriptTurnInStore({
      droneId: 'drone-preserved',
      chatName: 'default',
      turn: {
        id: 'turn-preserved',
        at: now,
        promptAt: now,
        completedAt: now,
        prompt: 'Keep this question',
        ok: true,
        output: 'Keep this transcript, including Unicode: 🛸',
      },
    });
    await getPromptQueueRepository().enqueue({
      droneId: 'drone-preserved',
      chatName: 'default',
      prompt: {
        id: 'queued-preserved',
        at: now,
        updatedAt: now,
        prompt: 'Keep this queued work',
        state: 'queued',
      },
    });
    const attachment = path.join(root, 'attachment-preserved.bin');
    await fs.writeFile(attachment, Buffer.from([0, 1, 2, 255]));
    const db = getHubDatabase();
    assert.ok(db, 'native SQLite must be available for this preservation test');
    const snapshot = () =>
      db.read((connection) =>
        connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
          .map(({ name }) => ({
            name,
            rows: connection.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
          })),
      );
    const before = snapshot();
    let backup;
    db.read((connection) => {
      backup = connection.backup(path.join(root, 'recovery.sqlite'));
    });
    await backup;
    for (let attempt = 0; attempt < 2; attempt++) {
      const mesh = await createDeviceMeshService({
        rootDir: path.join(root, 'device-mesh'),
        apiToken: 'test-token',
        localHubBaseUrl: () => 'http://127.0.0.1:7777',
      });
      await mesh.close();
      assert.deepEqual(snapshot(), before);
      assert.deepEqual(await fs.readFile(attachment), Buffer.from([0, 1, 2, 255]));
      const transcript = readTranscriptTurnsFromStore({
        droneId: 'drone-preserved',
        chatName: 'default',
        indexes: [0],
      });
      assert.equal(transcript.turns[0].turn.id, 'turn-preserved');
      assert.match(transcript.turns[0].turn.output, /🛸/u);
    }
    const Database = require('better-sqlite3');
    const recovery = new Database(path.join(root, 'recovery.sqlite'), { readonly: true });
    assert.equal(recovery.pragma('integrity_check', { simple: true }), 'ok');
    recovery.close();
  } finally {
    await resetHubDatabaseForTests();
    if (previous === undefined) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previous;
    resetDroneRootDirForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});
