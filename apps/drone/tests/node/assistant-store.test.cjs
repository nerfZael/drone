const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');
const Database = require('better-sqlite3');

const {
  ASSISTANT_STORE_MIGRATIONS,
  loadAssistantState,
  resetAssistantStoreForTests,
  saveAssistantState,
} = require('../../dist/host/assistant-store.js');
const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { HubAssistantService } = require('../../dist/hub/assistant.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const tempRoots = [];

function useDataDir(dataDir) {
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
}

function useTempDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `assistant-store-${label}-`));
  tempRoots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  useDataDir(dataDir);
  return dataDir;
}

function state(title = 'first') {
  return {
    defaultModel: { provider: 'openai', model: 'gpt-5.6-sol', thinkingLevel: 'medium' },
    defaultEnabledTools: ['list_drones', 'read_chat'],
    systemPrompt: 'default prompt',
    systemPromptUpdatedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    threads: [
      {
        id: 'native-chat-1',
        ownerDroneId: 'drone-1',
        ownerChatName: 'default',
        title,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        provider: 'openai',
        model: 'gpt-5.5',
        thinkingLevel: 'off',
        systemPrompt: 'chat prompt',
        enabledTools: ['list_drones'],
        accessScope: {
          readMode: 'all',
          writeMode: 'selected',
          executeMode: 'selected',
          droneIds: ['drone-1'],
        },
        autoApprove: false,
        promptDeliveryMode: 'queue',
        status: 'idle',
        error: null,
        futureThreadField: ['kept'],
      },
    ],
  };
}

function assistantService() {
  return new HubAssistantService({ listDrones: async () => [] });
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  resetAssistantStoreForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('assistant SQLite store', () => {
  test('drops obsolete runtime-owned tables without touching unrelated data', async () => {
    const dataDir = useTempDataDir('obsolete-tables');
    const databasePath = path.join(dataDir, 'hub.sqlite');
    const legacyDatabase = new Database(databasePath);
    ASSISTANT_STORE_MIGRATIONS[0].migrate(legacyDatabase);
    legacyDatabase.exec(`
      CREATE TABLE hub_schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (scope, version),
        UNIQUE (scope, name)
      );
      CREATE TABLE assistant_messages (id TEXT PRIMARY KEY);
      CREATE TABLE assistant_queued_prompts (id TEXT PRIMARY KEY);
      CREATE TABLE assistant_chat_idle_subscriptions (id TEXT PRIMARY KEY);
      CREATE TABLE assistant_reset_sentinel (value TEXT NOT NULL);
      INSERT INTO assistant_reset_sentinel VALUES ('keep me');
    `);
    const recordMigration = legacyDatabase.prepare(
      'INSERT INTO hub_schema_migrations (scope, version, name, applied_at) VALUES (?, ?, ?, ?)',
    );
    for (const migration of ASSISTANT_STORE_MIGRATIONS.filter((item) => item.version < 8)) {
      recordMigration.run(
        'assistant',
        migration.version,
        migration.name,
        '2026-01-01T00:00:00.000Z',
      );
    }
    legacyDatabase.close();

    assert.equal(await loadAssistantState(), null);
    const database = requireHubDatabase();
    assert.equal(
      database.read(
        (connection) =>
          connection.prepare('SELECT value FROM assistant_reset_sentinel').get().value,
      ),
      'keep me',
    );
    for (const table of [
      'assistant_messages',
      'assistant_queued_prompts',
      'assistant_chat_idle_subscriptions',
    ]) {
      assert.equal(
        database.read(
          (connection) =>
            connection
              .prepare(
                "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
              )
              .get(table).count,
        ),
        0,
      );
    }
  });

  test('persists built-in settings without recreating assistant.json', async () => {
    const dataDir = useTempDataDir('settings');
    const service = assistantService();
    await service.updateSystemPrompt({ prompt: 'Canonical built-in prompt.' });

    assert.equal((await loadAssistantState()).systemPrompt, 'Canonical built-in prompt.');
    assert.equal(fs.existsSync(path.join(dataDir, 'assistant.json')), false);
    assert.equal(
      (await assistantService().systemPromptSettings()).assistantSystemPrompt.prompt,
      'Canonical built-in prompt.',
    );
  });

  test('discards legacy standalone JSON instead of importing it', async () => {
    const dataDir = useTempDataDir('legacy-json');
    fs.writeFileSync(path.join(dataDir, 'assistant.json'), JSON.stringify(state('legacy')));

    assert.equal(await loadAssistantState(), null);
    assert.equal(fs.existsSync(path.join(dataDir, 'assistant.json')), false);
  });

  test('updates native chat rows incrementally and preserves unknown metadata', async () => {
    useTempDataDir('incremental');
    const initial = state();
    await saveAssistantState(initial);
    const database = requireHubDatabase();
    await database.writeTransaction('install assistant audit trigger', (connection) => {
      connection.exec(`
        CREATE TABLE assistant_test_audit (operation TEXT NOT NULL);
        CREATE TRIGGER assistant_test_thread_update AFTER UPDATE ON assistant_threads
        BEGIN INSERT INTO assistant_test_audit VALUES ('update'); END;
      `);
    });

    await saveAssistantState(structuredClone(initial));
    assert.deepEqual(
      database.read((connection) => connection.prepare('SELECT * FROM assistant_test_audit').all()),
      [],
    );

    const changed = structuredClone(initial);
    changed.threads[0].title = 'changed';
    await saveAssistantState(changed);
    assert.deepEqual(
      database.read((connection) => connection.prepare('SELECT * FROM assistant_test_audit').all()),
      [{ operation: 'update' }],
    );
    const loaded = await loadAssistantState();
    assert.equal(loaded.threads[0].title, 'changed');
    assert.deepEqual(loaded.threads[0].futureThreadField, ['kept']);
  });

  test('uses the canonical prompt queue for built-in chats without a queue limit', async () => {
    useTempDataDir('native-queue');
    const service = assistantService();
    const created = await service.ensureNativeThread({
      id: 'native-queue-chat',
      droneId: 'drone-1',
      chatName: 'default',
      title: 'default',
    });
    const first = await service.enqueueThreadPrompt(created.chatId, {
      prompt: 'first',
      promptImages: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    });
    assert.equal(first.promptImages[0].data, '');
    const claimed = await service.claimNextQueuedPrompt(created.chatId);
    assert.equal(claimed.promptImages[0].data, 'aW1hZ2U=');
    await service.completeQueuedPrompt(created.chatId, claimed.id);

    const imageOnly = await service.enqueueThreadPrompt(created.chatId, {
      promptImages: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    });
    assert.equal(imageOnly.prompt, '');
    const claimedImageOnly = await service.claimNextQueuedPrompt(created.chatId);
    assert.equal(claimedImageOnly.prompt, '');
    assert.equal(claimedImageOnly.promptImages[0].data, 'aW1hZ2U=');
    await service.completeQueuedPrompt(created.chatId, claimedImageOnly.id);

    for (let index = 0; index < 32; index += 1) {
      await service.enqueueThreadPrompt(created.chatId, { prompt: `queued ${index}` });
    }
    await assert.rejects(
      () => service.enqueueThreadPrompt(created.chatId, { prompt: 'one too many' }),
      /queue is full \(max 32\)/,
    );
    assert.equal(
      (await service.threadSnapshot(created.chatId)).threads[0].queuedPrompts.length,
      32,
    );
  });

  test('switches canonical databases when DRONE_DATA_DIR changes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-store-switch-'));
    tempRoots.push(root);
    const firstDir = path.join(root, 'first');
    const secondDir = path.join(root, 'second');
    fs.mkdirSync(firstDir, { recursive: true });
    fs.mkdirSync(secondDir, { recursive: true });

    useDataDir(firstDir);
    await saveAssistantState(state('first data dir'));
    useDataDir(secondDir);
    await saveAssistantState(state('second data dir'));
    assert.equal((await loadAssistantState()).threads[0].title, 'second data dir');
    useDataDir(firstDir);
    assert.equal((await loadAssistantState()).threads[0].title, 'first data dir');
  });
});
