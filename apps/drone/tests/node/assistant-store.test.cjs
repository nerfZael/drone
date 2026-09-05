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
const { getPromptQueueRepository } = require('../../dist/host/prompt-queue-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { HubAssistantService } = require('../../dist/hub/assistant.js');
const { createNativePromptSubmitter } = require('../../dist/hub/native-prompt-submission.js');

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
  test('Stop clears native follow-ups and rejects late completion of the stopped claim', async () => {
    useTempDataDir('native-stop');
    const service = assistantService();
    const { chatId } = await service.ensureNativeThread({
      id: 'native-stop',
      droneId: 'drone-1',
      chatName: 'default',
    });
    await service.enqueueThreadPromptWithResult(chatId, { id: 'active', prompt: 'First' });
    await service.enqueueThreadPromptWithResult(chatId, { id: 'follow-up', prompt: 'Next' });
    await service.claimNextQueuedPrompt(chatId);
    const interrupted = [];
    service.setRuntimeStopDelegate((id) => interrupted.push(id));
    await service.stopThread(chatId);
    await service.completeQueuedPrompt(chatId, 'active');
    await service.failQueuedPrompt(chatId, 'active', new Error('Late transport failure'));
    const queue = getPromptQueueRepository();
    assert.equal(
      queue.get({ droneId: 'drone-1', chatName: 'default', promptId: 'active' }).state,
      'cancelled',
    );
    assert.equal(
      queue.get({ droneId: 'drone-1', chatName: 'default', promptId: 'follow-up' }).state,
      'cancelled',
    );
    assert.equal(await service.hasQueuedPrompts(chatId), false);
    assert.ok(interrupted.includes(chatId));
    await service.enqueueThreadPromptWithResult(chatId, { id: 'new', prompt: 'Continue' });
    assert.equal((await service.claimNextQueuedPrompt(chatId)).id, 'new');
  });

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

    const queuedFollowUp = await service.enqueueThreadPrompt(created.chatId, {
      prompt: 'ordinary follow-up',
      deliveryMode: 'queue',
    });
    const asapFollowUp = await service.enqueueThreadPrompt(created.chatId, {
      prompt: 'urgent follow-up',
      deliveryMode: 'asap',
    });
    const claimedAsap = await service.claimNextQueuedPrompt(created.chatId);
    assert.equal(claimedAsap.id, asapFollowUp.id);
    assert.equal(claimedAsap.deliveryMode, 'asap');
    await service.completeQueuedPrompt(created.chatId, claimedAsap.id);
    const claimedQueued = await service.claimNextQueuedPrompt(created.chatId);
    assert.equal(claimedQueued.id, queuedFollowUp.id);
    await service.completeQueuedPrompt(created.chatId, claimedQueued.id);

    for (let index = 0; index < 32; index += 1) {
      await service.enqueueThreadPrompt(created.chatId, { prompt: `queued ${index}` });
    }
    const retry = await service.enqueueThreadPromptWithResult(created.chatId, {
      id: queuedFollowUp.id,
      prompt: 'ordinary follow-up',
    });
    assert.equal(retry.inserted, false);
    assert.equal(retry.prompt.id, queuedFollowUp.id);
    await assert.rejects(
      () => service.enqueueThreadPrompt(created.chatId, { prompt: 'one too many' }),
      /queue is full \(max 32\)/,
    );
    assert.equal(
      (await service.threadSnapshot(created.chatId)).threads[0].queuedPrompts.length,
      32,
    );
  });

  test('adopts a queued startup prompt without replacing its canonical chat row', async () => {
    useTempDataDir('native-startup-queue');
    const service = assistantService();
    const created = await service.ensureNativeThread({
      id: 'native-startup-chat',
      droneId: 'drone-1',
      chatName: 'default',
      title: 'default',
    });
    const queue = getPromptQueueRepository();
    await queue.enqueue({
      droneId: 'drone-1',
      chatName: 'default',
      prompt: {
        id: 'startup-prompt',
        at: '2026-07-17T20:55:44.565Z',
        prompt: 'What tools do you have?',
        state: 'queued',
      },
    });

    const adopted = await service.enqueueThreadPrompt(created.chatId, {
      id: 'startup-prompt',
      prompt: 'What tools do you have?',
    });
    assert.equal(adopted.id, 'startup-prompt');
    assert.equal(adopted.status, 'queued');
    assert.equal(
      (await service.threadSnapshot(created.chatId)).threads[0].queuedPrompts[0].prompt,
      'What tools do you have?',
    );

    const claimed = await service.claimNextQueuedPrompt(created.chatId);
    assert.equal(claimed.id, 'startup-prompt');
    assert.equal(claimed.status, 'running');
  });

  test('native submission wakes a reserved startup prompt once without feeding back duplicate notifications', async () => {
    useTempDataDir('native-startup-delivery');
    const service = assistantService();
    const created = await service.ensureNativeThread({
      id: 'native-startup-delivery',
      droneId: 'drone-1',
      chatName: 'default',
    });
    const queue = getPromptQueueRepository();
    await queue.enqueue({
      droneId: 'drone-1',
      chatName: 'default',
      prompt: {
        id: 'reserved',
        at: new Date().toISOString(),
        prompt: 'First message',
        state: 'queued',
      },
    });
    let notifications = 0;
    let deliveries = 0;
    let drains = 0;
    const work = [];
    const submit = createNativePromptSubmitter({
      assistantService: service,
      blipAssistantHost: { isThreadRunning: () => false },
      notifyNativePromptQueueChanged: async () => {
        notifications++;
      },
      startAssistantPromptDrain: (threadId) => {
        drains++;
        const promise = (async () => {
          const claimed = await service.claimNextQueuedPrompt(threadId);
          if (!claimed) return;
          deliveries++;
          await service.completeQueuedPrompt(threadId, claimed.id);
        })();
        work.push(promise);
        return { promise };
      },
      hubLog: () => {},
    });
    const request = { threadId: created.chatId, promptId: 'reserved', prompt: 'First message' };
    await Promise.all([submit(request), submit(request)]);
    await Promise.all(work);
    assert.equal(deliveries, 1);
    assert.equal(notifications, 0);
    const completedDrains = drains;
    await submit(request);
    assert.equal(drains, completedDrains, 'a completed duplicate must not restart delivery');
    assert.equal(
      queue.get({ droneId: 'drone-1', chatName: 'default', promptId: 'reserved' }).state,
      'sent',
    );
  });

  test('duplicate native requests only need a drain while their durable row is queued', async () => {
    useTempDataDir('native-duplicate-state');
    const service = assistantService();
    const { chatId } = await service.ensureNativeThread({
      id: 'native',
      droneId: 'drone-1',
      chatName: 'default',
    });
    const input = { id: 'p', prompt: 'Hello' };
    assert.equal((await service.enqueueThreadPromptWithResult(chatId, input)).needsDrain, true);
    assert.equal((await service.enqueueThreadPromptWithResult(chatId, input)).needsDrain, true);
    await service.claimNextQueuedPrompt(chatId);
    assert.equal((await service.enqueueThreadPromptWithResult(chatId, input)).needsDrain, false);
    await service.failQueuedPrompt(chatId, 'p', new Error('failure'));
    assert.equal((await service.enqueueThreadPromptWithResult(chatId, input)).needsDrain, false);
  });

  test('native startup handoff preserves prepared images and files without replacing the original message', async () => {
    useTempDataDir('native-prepared-attachments');
    const service = assistantService();
    const { chatId } = await service.ensureNativeThread({
      id: 'native-images',
      droneId: 'drone-1',
      chatName: 'default',
    });
    const queue = getPromptQueueRepository();
    const attachment = { name: 'picture.png', mime: 'image/png', path: '/staged/picture.png' };
    await queue.enqueue({
      droneId: 'drone-1',
      chatName: 'default',
      prompt: {
        id: 'with-images',
        at: new Date().toISOString(),
        prompt: 'Inspect this',
        attachments: [attachment],
        state: 'queued',
      },
    });
    assert.equal(
      await service.claimNextQueuedPrompt(chatId),
      null,
      'another native drain must not consume attachments before preparation',
    );
    const image = { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' };
    await service.enqueueThreadPromptWithResult(chatId, {
      id: 'with-images',
      prompt: 'Inspect this\nAttached files:\n- /artifacts/report.pdf',
      promptImages: [image],
    });
    await service.enqueueThreadPromptWithResult(chatId, {
      id: 'with-images',
      prompt: 'A duplicate must not replace the prepared message',
    });
    const claimed = await service.claimNextQueuedPrompt(chatId);
    assert.equal(claimed.prompt, 'Inspect this\nAttached files:\n- /artifacts/report.pdf');
    assert.deepEqual(claimed.promptImages, [image]);
    const stored = queue.get({ droneId: 'drone-1', chatName: 'default', promptId: 'with-images' });
    assert.equal(stored.prompt, 'Inspect this');
    assert.deepEqual(stored.attachments, [attachment]);
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
