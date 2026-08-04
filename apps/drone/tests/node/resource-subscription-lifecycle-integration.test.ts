import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';

import { DroneLifecycleRepository } from '../../src/host/drone-lifecycle-repository';
import type { HubDatabase, HubDatabaseConnection } from '../../src/host/hub-database';
import { PromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { ChatTranscriptRepository } from '../../src/hub/transcript-store';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';

test('chat archive and deletion update subscriptions in the same transaction', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const subscriptions = new ResourceSubscriptionRepository(database);
    const chats = new ChatTranscriptRepository(database);
    await chats.upsertChat({
      droneId: 'drone-a',
      chatName: 'review',
      chatEntry: { id: 'chat-a', title: 'Review' },
    });
    const owned = await subscriptions.upsert({
      subscriber: { chatId: 'chat-a', droneId: 'drone-a', chatName: 'review' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/owned',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });

    database.read((connection) =>
      connection.exec(`
        CREATE TRIGGER block_subscription_pause
        BEFORE UPDATE ON resource_subscriptions
        WHEN OLD.id = '${owned.subscription.id}' AND NEW.status = 'paused'
        BEGIN
          SELECT RAISE(ABORT, 'blocked subscription pause');
        END;
      `),
    );
    await assert.rejects(
      chats.archiveChat({
        droneId: 'drone-a',
        chatName: 'review',
        archivedAt: '2026-08-04T00:00:00.000Z',
        deleteAt: '2026-08-05T00:00:00.000Z',
        archiveRetention: '1d',
      }),
      /blocked subscription pause/,
    );
    assert.equal(chats.readChat({ droneId: 'drone-a', chatName: 'review' }).chat?.id, 'chat-a');
    assert.equal(subscriptions.get(owned.subscription.id)?.status, 'active');

    database.read((connection) => connection.exec('DROP TRIGGER block_subscription_pause'));
    const archived = await chats.archiveChat({
      droneId: 'drone-a',
      chatName: 'review',
      archivedAt: '2026-08-04T00:00:00.000Z',
      deleteAt: '2026-08-05T00:00:00.000Z',
      archiveRetention: '1d',
    });
    assert.equal(archived.archived, true);
    assert.equal(subscriptions.get(owned.subscription.id)?.status, 'paused');

    database.read((connection) =>
      connection.exec(`
        CREATE TRIGGER block_subscription_cancel
        BEFORE UPDATE ON resource_subscriptions
        WHEN OLD.id = '${owned.subscription.id}' AND NEW.status = 'cancelled'
        BEGIN
          SELECT RAISE(ABORT, 'blocked subscription cancellation');
        END;
      `),
    );
    await assert.rejects(
      chats.deleteArchivedChat({ droneId: 'drone-a', archivedChatName: 'review' }),
      /blocked subscription cancellation/,
    );
    assert.equal(chats.readArchivedChat({ droneId: 'drone-a', chatName: 'review' })?.chat.id, 'chat-a');
    assert.equal(subscriptions.get(owned.subscription.id)?.status, 'paused');

    database.read((connection) => connection.exec('DROP TRIGGER block_subscription_cancel'));
    const deleted = await chats.deleteArchivedChat({
      droneId: 'drone-a',
      archivedChatName: 'review',
    });
    assert.equal(deleted.deleted, true);
    assert.equal(subscriptions.get(owned.subscription.id)?.status, 'cancelled');
  } finally {
    close();
  }
});

test('permanent drone deletion cancels owned and watched subscriptions atomically', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const subscriptions = new ResourceSubscriptionRepository(database);
    const chats = new ChatTranscriptRepository(database);
    const drones = await DroneLifecycleRepository.open(database);
    new PromptQueueRepository(database);
    await drones.upsert('real', 'drone-a', { id: 'drone-a', name: 'Drone A' });
    await chats.upsertChat({
      droneId: 'drone-a',
      chatName: 'default',
      chatEntry: { id: 'chat-a', title: 'Default' },
    });
    const owned = await subscriptions.upsert({
      subscriber: { chatId: 'chat-a', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/owned',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    const watching = await subscriptions.upsert({
      subscriber: { chatId: 'other-chat', droneId: 'drone-b', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'chat-a',
      events: ['chat.idle'],
      intent: '',
      maxActive: 50,
    });

    database.read((connection) =>
      connection.exec(`
        CREATE TRIGGER block_watched_subscription_cancel
        BEFORE UPDATE ON resource_subscriptions
        WHEN OLD.id = '${watching.subscription.id}' AND NEW.status = 'cancelled'
        BEGIN
          SELECT RAISE(ABORT, 'blocked watched subscription cancellation');
        END;
      `),
    );
    await assert.rejects(
      chats.commitPermanentDroneDeletion({ droneId: 'drone-a', lifecycleState: 'real' }),
      /blocked watched subscription cancellation/,
    );
    assert.equal(drones.get('drone-a')?.id, 'drone-a');
    assert.equal(chats.readChat({ droneId: 'drone-a', chatName: 'default' }).chat?.id, 'chat-a');
    assert.equal(subscriptions.get(owned.subscription.id)?.status, 'active');
    assert.equal(subscriptions.get(watching.subscription.id)?.status, 'active');

    database.read((connection) =>
      connection.exec('DROP TRIGGER block_watched_subscription_cancel'),
    );
    const deleted = await chats.commitPermanentDroneDeletion({
      droneId: 'drone-a',
      lifecycleState: 'real',
    });
    assert.equal(deleted.removedLifecycle, true);
    assert.equal(chats.readChat({ droneId: 'drone-a', chatName: 'default' }).chat, null);
    assert.equal(subscriptions.get(owned.subscription.id)?.status, 'cancelled');
    assert.equal(subscriptions.get(watching.subscription.id)?.status, 'cancelled');
  } finally {
    close();
  }
});

function memoryHubDatabase(): { database: HubDatabase; close: () => void } {
  const connection = new BetterSqlite3(':memory:') as HubDatabaseConnection;
  connection.pragma('foreign_keys = ON');
  const database: HubDatabase = {
    path: ':memory:',
    openedAt: new Date().toISOString(),
    read(operation) {
      return operation(connection);
    },
    async writeTransaction(_label, operation) {
      return connection.transaction(() => operation(connection)).immediate();
    },
    diagnostics() {
      return {
        available: true,
        path: ':memory:',
        failureKind: null,
        unavailableReason: null,
        openedAt: this.openedAt,
        schemaVersion: null,
        appliedMigrationCount: null,
        journalMode: 'memory',
        synchronous: 2,
        busyTimeoutMs: 0,
        foreignKeys: true,
        queuedWrites: 0,
        activeWrite: null,
      };
    },
  };
  return { database, close: () => connection.close() };
}
