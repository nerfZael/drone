const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const {
  loadAssistantState,
  resetAssistantStoreForTests,
  saveAssistantState,
} = require('../../dist/host/assistant-store.js');
const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { HubAssistantService } = require('../../dist/hub/assistant.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const tempRoots = [];

function useTempDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `assistant-store-${label}-`));
  tempRoots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
  return dataDir;
}

function useDataDir(dataDir) {
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
}

function state(title = 'first') {
  return {
    activeThreadId: 'thread-1',
    webSearchToolMigrationApplied: true,
    fetchContentToolMigrationApplied: true,
    systemPrompt: 'default prompt',
    systemPromptUpdatedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    threads: [
      {
        id: 'thread-1',
        title,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        voiceEnabled: false,
        provider: 'openai',
        model: 'gpt-5.5',
        thinkingLevel: 'off',
        systemPrompt: 'thread prompt',
        enabledTools: ['list_drones'],
        accessScope: { readMode: 'all', writeMode: 'selected', droneIds: [] },
        autoApprove: false,
        promptDeliveryMode: 'queue',
        messages: [
          { id: 'message-1', role: 'user', content: 'hello', futureMessageField: 'kept' },
          { id: 'message-2', role: 'assistant', content: 'hi' },
        ],
        queuedPrompts: [
          {
            id: 'queued-1',
            prompt: 'next',
            createdAt: '2026-01-02T00:00:00.000Z',
            provider: 'openai',
            model: 'gpt-5.5',
            thinkingLevel: 'off',
            deliveryMode: 'queue',
            attachments: [{ path: '/tmp/reference.txt', name: 'reference.txt' }],
            futureQueueField: { kept: true },
          },
        ],
        status: 'idle',
        error: null,
        futureThreadField: ['kept'],
      },
    ],
    chatIdleSubscriptions: [
      {
        id: 'subscription-1',
        threadId: 'thread-1',
        toolCallId: 'tool-1',
        voiceSource: null,
        mode: 'all',
        targets: [{ droneId: 'drone-1', chatName: 'default' }],
        createdAt: '2026-01-02T00:00:00.000Z',
        expiresAt: '2026-01-03T00:00:00.000Z',
        idleForMs: 1000,
        status: 'active',
        idleSince: null,
        firedAt: null,
        cancelledAt: null,
        expiredAt: null,
        lastResult: null,
        futureSubscriptionField: 'kept',
      },
    ],
  };
}

function assistantService() {
  return new HubAssistantService({
    listDrones: async () => [],
    createDrone: async () => ({ id: 'drone-1', name: 'Drone 1', runtime: 'container' }),
    createChat: async () => ({
      droneId: 'drone-1',
      droneName: 'Drone 1',
      chatName: 'default',
      chats: ['default'],
    }),
    setDroneGroup: async () => ({ group: null, moved: [], rejected: [], total: 0 }),
    renameDrones: async () => ({ renamed: [], rejected: [], total: 0 }),
    messageDrone: async () => ({ promptId: 'prompt-1' }),
  });
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
  test('persists service settings canonically without recreating assistant.json', async () => {
    const dataDir = useTempDataDir('service');
    const service = assistantService();

    await service.updateSystemPrompt({ prompt: 'Canonical assistant prompt.' });
    assert.equal((await loadAssistantState()).systemPrompt, 'Canonical assistant prompt.');
    assert.equal(fs.existsSync(path.join(dataDir, 'assistant.json')), false);

    const reopened = assistantService();
    assert.equal(
      (await reopened.systemPromptSettings()).assistantSystemPrompt.prompt,
      'Canonical assistant prompt.',
    );
  });

  test('migrates assistant.json once and preserves a fingerprint-backed recovery copy', async () => {
    const dataDir = useTempDataDir('migration');
    const legacy = state('from legacy file');
    fs.writeFileSync(path.join(dataDir, 'assistant.json'), JSON.stringify(legacy));

    assert.deepEqual(await loadAssistantState(), legacy);
    assert.equal(fs.existsSync(path.join(dataDir, 'assistant.json')), false);
    const backup = fs
      .readdirSync(dataDir)
      .find((name) => name.startsWith('assistant.json.migrated-') && name.endsWith('.bak'));
    assert.ok(backup);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, backup), 'utf8')), legacy);
    const metadata = requireHubDatabase().read((connection) =>
      connection
        .prepare("SELECT value FROM assistant_store_metadata WHERE key = 'legacy_import'")
        .get(),
    );
    assert.equal(JSON.parse(metadata.value).path, path.join(dataDir, 'assistant.json'));
    assert.equal(JSON.parse(metadata.value).sha256.length, 64);
  });

  test('does not re-import assistant.json after the canonical database is reopened', async () => {
    const dataDir = useTempDataDir('reopen');
    await saveAssistantState(state('canonical'));
    await resetHubDatabaseForTests();
    resetAssistantStoreForTests();
    fs.writeFileSync(path.join(dataDir, 'assistant.json'), JSON.stringify(state('stale file')));

    assert.equal((await loadAssistantState()).threads[0].title, 'canonical');
    assert.equal(fs.existsSync(path.join(dataDir, 'assistant.json')), false);
    assert.ok(fs.readdirSync(dataDir).some((name) => name.startsWith('assistant.json.migrated-')));
  });

  test('updates only changed rows and preserves unknown row fields', async () => {
    useTempDataDir('incremental');
    const initial = state();
    await saveAssistantState(initial);
    const database = requireHubDatabase();
    await database.writeTransaction('install assistant audit triggers', (connection) => {
      connection.exec(`
        CREATE TABLE assistant_test_audit (table_name TEXT NOT NULL, operation TEXT NOT NULL);
        CREATE TRIGGER assistant_test_thread_update AFTER UPDATE ON assistant_threads
        BEGIN INSERT INTO assistant_test_audit VALUES ('threads', 'update'); END;
        CREATE TRIGGER assistant_test_message_update AFTER UPDATE ON assistant_messages
        BEGIN INSERT INTO assistant_test_audit VALUES ('messages', 'update'); END;
        CREATE TRIGGER assistant_test_queue_update AFTER UPDATE ON assistant_queued_prompts
        BEGIN INSERT INTO assistant_test_audit VALUES ('queue', 'update'); END;
        CREATE TRIGGER assistant_test_subscription_update AFTER UPDATE ON assistant_chat_idle_subscriptions
        BEGIN INSERT INTO assistant_test_audit VALUES ('subscriptions', 'update'); END;
      `);
    });

    const changed = structuredClone(initial);
    changed.threads[0].messages[1].content = 'changed reply';
    await saveAssistantState(changed);

    assert.deepEqual(
      database.read((connection) => connection.prepare('SELECT * FROM assistant_test_audit').all()),
      [{ table_name: 'messages', operation: 'update' }],
    );
    const loaded = await loadAssistantState();
    assert.equal(loaded.threads[0].messages[1].content, 'changed reply');
    assert.deepEqual(loaded.threads[0].futureThreadField, ['kept']);
    assert.deepEqual(loaded.threads[0].queuedPrompts[0].futureQueueField, { kept: true });
    assert.equal(loaded.chatIdleSubscriptions[0].futureSubscriptionField, 'kept');
  });

  test('rolls back all assistant rows when referential integrity fails', async () => {
    useTempDataDir('rollback');
    await saveAssistantState(state('before'));
    const invalid = state('should roll back');
    invalid.activeThreadId = 'thread-2';
    invalid.threads.push({
      ...invalid.threads[0],
      id: 'thread-2',
      title: 'new thread',
      messages: [],
      queuedPrompts: [],
    });
    invalid.chatIdleSubscriptions = [
      { ...invalid.chatIdleSubscriptions[0], id: 'bad-subscription', threadId: 'missing' },
    ];

    await assert.rejects(saveAssistantState(invalid), /FOREIGN KEY constraint failed/);
    const loaded = await loadAssistantState();
    assert.equal(loaded.activeThreadId, 'thread-1');
    assert.deepEqual(
      loaded.threads.map((thread) => thread.id),
      ['thread-1'],
    );
    assert.equal(loaded.threads[0].title, 'before');
    assert.equal(loaded.chatIdleSubscriptions[0].id, 'subscription-1');
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
