import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import {
  ResourceSubscriptionService,
  detectChatSubscriptionChanges,
} from '../../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';
import { memoryHubDatabase } from './helpers/memory-hub-database';

for (const initiallyIdle of [true, false]) {
  test(`subscribe returns current idle=${initiallyIdle} and keeps watching future transitions`, async () => {
    const { database, close } = memoryHubDatabase();
    try {
      const repository = new ResourceSubscriptionRepository(database);
      database.read((db) =>
        db.exec(`
        CREATE TABLE canonical_chats (drone_id TEXT, chat_name TEXT, metadata_json TEXT);
        INSERT INTO canonical_chats VALUES ('drone', 'default', '{"id":"watched"}');
      `),
      );
      let currentIdle = initiallyIdle;
      let reads = 0;
      const status = () => ({
        idle: currentIdle,
        reason: currentIdle ? 'latest_agent_message' : 'active_user_messages',
        latest: { id: currentIdle ? 'answer' : 'prompt', role: currentIdle ? 'agent' : 'user' },
      });
      const service = new ResourceSubscriptionService({
        repository,
        readChatStatus: async () => {
          reads++;
          return status();
        },
        readSettings: async () => DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
        wakePromptQueue: () => {},
        log: () => {},
      });
      const input = {
        subscriber: { chatId: 'companion:test', droneId: 'companion', chatName: 'test' },
        provider: 'drone-hub' as const,
        resourceType: 'chat' as const,
        resourceId: 'watched',
        events: ['chat.idle' as const],
      };
      const first = await service.subscribe(input);
      assert.equal(first.idle, initiallyIdle);
      assert.equal(first.subscription.status, 'active');
      assert.equal(first.subscription.cursor.lastIdle, initiallyIdle);
      assert.equal(reads, 1);
      const location = repository.resolveChatResource('watched')!;
      assert.equal(
        detectChatSubscriptionChanges(first.subscription, location, status()).events.length,
        0,
      );

      currentIdle = !initiallyIdle;
      const repeated = await service.subscribe(input);
      assert.equal(repeated.created, false);
      assert.equal(repeated.idle, currentIdle);
      assert.equal(reads, 2);
      assert.deepEqual(repeated.subscription.cursor, first.subscription.cursor);
      const changed = detectChatSubscriptionChanges(repeated.subscription, location, status());
      assert.equal(changed.events.length, initiallyIdle ? 0 : 1);
      if (initiallyIdle) {
        currentIdle = true;
        assert.equal(
          detectChatSubscriptionChanges(
            { ...repeated.subscription, cursor: changed.cursor },
            location,
            status(),
          ).events.length,
          1,
        );
      }
      assert.equal(
        database.read(
          (db) => (db.prepare('SELECT count(*) AS n FROM resource_events').get() as any).n,
        ),
        0,
      );
    } finally {
      close();
    }
  });
}

test('failed assistant completion emits chat.failed once and does not emit successful idle', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    database.read((db) =>
      db.exec(`CREATE TABLE canonical_chats (drone_id TEXT, chat_name TEXT, metadata_json TEXT);
      INSERT INTO canonical_chats VALUES ('drone', 'default', '{"id":"watched"}');`),
    );
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => ({
        idle: false,
        reason: 'active_user_messages',
        latest: { id: 'prompt', role: 'user' },
      }),
      readSettings: async () => DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      wakePromptQueue: () => {},
      log: () => {},
    });
    const { subscription } = await service.subscribe({
      subscriber: { chatId: 'companion:test', droneId: 'companion', chatName: 'test' },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched',
      events: ['chat.idle', 'chat.failed'],
    });
    const location = repository.resolveChatResource('watched')!;
    const failed = {
      idle: true,
      reason: 'latest_user_failed',
      latest: { id: 'answer', role: 'agent', status: 'failed' },
    };
    const changed = detectChatSubscriptionChanges(subscription, location, failed);
    assert.deepEqual(
      changed.events.map((event) => event.eventType),
      ['chat.failed'],
    );
    assert.equal(
      detectChatSubscriptionChanges({ ...subscription, cursor: changed.cursor }, location, failed)
        .events.length,
      0,
    );
  } finally {
    close();
  }
});
