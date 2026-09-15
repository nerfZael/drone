const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { requireHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { ChatTranscriptRepository } = require('../../dist/hub/transcript-store.js');
const { resolveRepairedChatIdentity } = require('../../dist/hub/chat-identity-migration.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
let root;
afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-identity-migration-'));
  process.env.DRONE_DATA_DIR = root;
  resetDroneRootDirForTests();
  const database = requireHubDatabase();
  return { database, repo: new ChatTranscriptRepository(database) };
}

test('repairs duplicate identities, preserves history and scoped references, and enforces uniqueness', async () => {
  const { database, repo } = setup();
  const turn = {
    id: 'turn',
    at: '2026-01-01T00:00:00Z',
    prompt: 'Keep history',
    output: 'Preserved',
    ok: true,
  };
  for (const droneId of ['source', 'clone', 'watcher']) {
    await repo.upsertChat({
      droneId,
      chatName: 'default',
      chatEntry: {
        id: droneId,
        createdAt: '2026-01-01T00:00:00Z',
        chatId: 'provider-session',
        turns: [turn],
      },
    });
  }
  database.read((connection) => {
    connection.exec(`
      DROP INDEX idx_canonical_chats_unique_id;
      DROP TRIGGER canonical_chats_require_id_insert;
      DROP TRIGGER canonical_chats_require_id_update;
      DELETE FROM hub_schema_migrations WHERE scope = 'chats' AND version = 13;
      DROP TABLE canonical_chat_identity_repairs;
      UPDATE canonical_chats SET metadata_json = json_set(metadata_json, '$.id', 'shared') WHERE drone_id != 'watcher';
      CREATE TABLE hub_canonical_drones (drone_id TEXT PRIMARY KEY, lifecycle_json TEXT);
      INSERT INTO hub_canonical_drones VALUES ('source', '{"createdAt":"2026-01-01"}'), ('clone', '{"createdAt":"2026-01-02"}');
      CREATE TABLE resource_subscriptions (
        id TEXT PRIMARY KEY, subscriber_chat_id TEXT, subscriber_drone_id TEXT, subscriber_chat_name TEXT,
        provider TEXT, resource_type TEXT, resource_id TEXT, cursor_json TEXT);
      INSERT INTO resource_subscriptions VALUES
        ('owned', 'shared', 'clone', 'default', 'drone-hub', 'chat', 'watcher', '{}'),
        ('watching', 'watcher', 'watcher', 'default', 'drone-hub', 'chat', 'shared', '{"targetDroneId":"clone","targetChatName":"default"}'),
        ('original', 'watcher', 'watcher', 'default', 'drone-hub', 'chat', 'shared', '{"targetDroneId":"source","targetChatName":"default"}');
      CREATE TABLE subscription_batches (subscriber_chat_id TEXT, subscriber_drone_id TEXT, subscriber_chat_name TEXT);
      INSERT INTO subscription_batches VALUES ('shared', 'clone', 'default');
      CREATE TABLE chat_question_requests (chat_id TEXT, drone_id TEXT, chat_name TEXT);
      INSERT INTO chat_question_requests VALUES ('shared', 'clone', 'default');
    `);
  });
  const migrated = new ChatTranscriptRepository(database);
  const rows = database.read((c) =>
    c.prepare('SELECT drone_id, metadata_json FROM canonical_chats').all(),
  );
  const chats = Object.fromEntries(
    rows.map((row) => [row.drone_id, JSON.parse(row.metadata_json)]),
  );
  assert.equal(chats.source.id, 'shared');
  assert.notEqual(chats.clone.id, 'shared');
  assert.equal(chats.clone.chatId, 'provider-session');
  database.read((c) => {
    assert.equal(
      c.prepare("SELECT COUNT(*) n FROM canonical_chat_turns WHERE drone_id='clone'").get().n,
      1,
    );
    assert.equal(
      JSON.parse(
        c.prepare("SELECT turn_json FROM canonical_chat_turns WHERE drone_id='clone'").get()
          .turn_json,
      ).output,
      'Preserved',
    );
    assert.equal(
      c.prepare("SELECT subscriber_chat_id id FROM resource_subscriptions WHERE id='owned'").get()
        .id,
      chats.clone.id,
    );
    assert.equal(
      c.prepare("SELECT resource_id id FROM resource_subscriptions WHERE id='watching'").get().id,
      chats.clone.id,
    );
    assert.equal(
      c.prepare("SELECT resource_id id FROM resource_subscriptions WHERE id='original'").get().id,
      'shared',
    );
    assert.equal(
      c.prepare('SELECT subscriber_chat_id id FROM subscription_batches').get().id,
      chats.clone.id,
    );
    assert.equal(
      c.prepare('SELECT chat_id id FROM chat_question_requests').get().id,
      chats.clone.id,
    );
    assert.equal(resolveRepairedChatIdentity(c, 'clone', 'default', 'shared'), chats.clone.id);
    assert.equal(resolveRepairedChatIdentity(c, 'source', 'default', 'shared'), 'shared');
    assert.equal(resolveRepairedChatIdentity(c, 'different-drone', 'default', 'shared'), 'shared');
    assert.throws(
      () =>
        c
          .prepare(
            "UPDATE canonical_chats SET metadata_json=json_set(metadata_json,'$.id','shared') WHERE drone_id='clone'",
          )
          .run(),
      /UNIQUE/,
    );
  });
  database.read((c) => {
    assert.throws(
      () =>
        c
          .prepare(
            "UPDATE canonical_chats SET metadata_json=json_remove(metadata_json,'$.id') WHERE drone_id='clone'",
          )
          .run(),
      /requires an identity/,
    );
  });
  // A stale registry snapshot cannot undo the repair.
  await migrated.upsertChat({
    droneId: 'clone',
    chatName: 'default',
    chatEntry: { id: 'shared', turns: [turn] },
  });
  assert.equal(
    database.read(
      (c) =>
        c
          .prepare(
            "SELECT json_extract(metadata_json,'$.id') id FROM canonical_chats WHERE drone_id='clone'",
          )
          .get().id,
    ),
    chats.clone.id,
  );
  new ChatTranscriptRepository(database);
  assert.equal(
    database.read(
      (c) => c.prepare('SELECT COUNT(*) n FROM canonical_chat_identity_repairs').get().n,
    ),
    1,
  );
  await assert.rejects(
    migrated.upsertChat({ droneId: 'another', chatName: 'default', chatEntry: { id: 'shared' } }),
    /UNIQUE/,
  );
});

test('chats created from transcript turns receive distinct IDs immediately', async () => {
  const { database, repo } = setup();
  for (const droneId of ['first', 'second']) {
    await repo.importTurns({
      droneId,
      chatName: 'default',
      turns: [
        { id: 'turn', at: '2026-01-01T00:00:00Z', prompt: 'hello', output: 'world', ok: true },
      ],
    });
  }
  const ids = database
    .read((c) =>
      c.prepare("SELECT json_extract(metadata_json,'$.id') id FROM canonical_chats").all(),
    )
    .map((r) => r.id);
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, 2);
});

test('pre-repair signed tokens authenticate as the repaired conversation, including after rename', async () => {
  const { database, repo } = setup();
  const { upsertCanonicalDroneLifecycle } = require('../../dist/hub/drone-lifecycle-service.js');
  const {
    createChatMcpAccessToken,
    authenticateMcpBearerToken,
  } = require('../../dist/hub/mcp-tokens.js');
  for (const droneId of ['source', 'clone']) {
    await upsertCanonicalDroneLifecycle('real', droneId, {
      id: droneId,
      name: droneId,
      runtime: 'host',
      createdAt: droneId === 'source' ? '2026-01-01' : '2026-01-02',
    });
    await repo.upsertChat({ droneId, chatName: 'work', chatEntry: { id: droneId } });
  }
  const secret = 'test-signing-secret';
  const token = createChatMcpAccessToken({
    droneId: 'clone',
    chatName: 'work',
    chatId: 'shared',
    signingSecret: secret,
  });
  database.read((c) =>
    c.exec(`
    DROP INDEX idx_canonical_chats_unique_id;
      DROP TRIGGER canonical_chats_require_id_insert;
      DROP TRIGGER canonical_chats_require_id_update;
    DELETE FROM hub_schema_migrations WHERE scope='chats' AND version=13;
    DROP TABLE canonical_chat_identity_repairs;
    UPDATE canonical_chats SET metadata_json=json_set(metadata_json,'$.id','shared');
  `),
  );
  const migrated = new ChatTranscriptRepository(database);
  const newId = database.read((c) => resolveRepairedChatIdentity(c, 'clone', 'work', 'shared'));
  const identity = await authenticateMcpBearerToken(token, secret);
  assert.equal(identity?.droneId, 'clone');
  assert.equal(identity?.chatId, newId);
  assert.equal(identity?.tokenId, `chat:${newId}`);
  const {
    ResourceSubscriptionRepository,
  } = require('../../dist/hub/subscriptions/resource-subscription-repository.js');
  const {
    ResourceSubscriptionService,
  } = require('../../dist/hub/subscriptions/resource-subscription-service.js');
  const {
    DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
  } = require('../../dist/hub/subscriptions/resource-subscription-types.js');
  const subscriptions = new ResourceSubscriptionRepository(database);
  const service = new ResourceSubscriptionService({
    repository: subscriptions,
    readChatStatus: async () => ({ idle: false, reason: 'active_user_messages' }),
    readSettings: async () => DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
    wakePromptQueue() {},
    log() {},
  });
  const subscribed = await service.subscribe({
    subscriber: { droneId: identity.droneId, chatName: identity.chatName, chatId: identity.chatId },
    provider: 'drone-hub',
    resourceType: 'chat',
    resourceId: 'shared',
    events: ['chat.idle'],
  });
  assert.equal(subscribed.created, true);
  assert.equal(subscribed.subscription.subscriber.chatId, newId);
  assert.equal(subscribed.subscription.cursor.targetDroneId, 'source');
  await assert.rejects(
    service.subscribe({
      subscriber: {
        droneId: identity.droneId,
        chatName: identity.chatName,
        chatId: identity.chatId,
      },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: newId,
      events: ['chat.idle'],
    }),
    /cannot subscribe to its own/,
  );
  await migrated.renameChat({ droneId: 'clone', chatName: 'work', newChatName: 'renamed' });
  const renamed = await authenticateMcpBearerToken(token, secret);
  assert.equal(renamed?.chatId, newId);
  assert.equal(renamed?.chatName, 'renamed');
  assert.equal(await authenticateMcpBearerToken(token, 'wrong-secret'), null);
});
