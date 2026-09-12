import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { ResourceSubscriptionService } from '../../src/hub/subscriptions/resource-subscription-service';
import { memoryHubDatabase } from './helpers/memory-hub-database';

test('companion receives committed subscribe, update and unsubscribe snapshots scoped to its session', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const service = new ResourceSubscriptionService({
      repository, readChatStatus: async () => ({ idle: true, reason: 'idle', latest: null }),
      wakePromptQueue: () => {}, log: () => {},
    });
    const subscriber = { chatId: 'companion:one', droneId: 'companion', chatName: 'one' };
    const snapshots: string[][] = [];
    const otherSnapshots: string[][] = [];
    const release = service.registerSessionSubscriber({
      subscriber, readDroneIds: async () => [], deliver: async () => {},
      subscriptionsChanged: (rows) => snapshots.push(rows.map((row) => row.id)),
    });
    const releaseOther = service.registerSessionSubscriber({
      subscriber: { ...subscriber, chatId: 'companion:two', chatName: 'two' },
      readDroneIds: async () => [], deliver: async () => {},
      subscriptionsChanged: (rows) => otherSnapshots.push(rows.map((row) => row.id)),
    });
    const { subscription } = await service.subscribeToCron({ subscriber, expression: '* * * * *', timeZone: 'UTC', intent: 'Check progress' });
    assert.deepEqual(snapshots, [[], [subscription.id]]);
    await service.update({ id: subscription.id, subscriberChatId: subscriber.chatId, intent: 'Check again' });
    assert.deepEqual(snapshots.at(-1), [subscription.id]);
    await service.cancel(subscription.id, subscriber.chatId);
    assert.deepEqual(snapshots.at(-1), []);
    assert.deepEqual(otherSnapshots, [[]]);
    await release();
    await releaseOther();
  } finally { close(); }
});
