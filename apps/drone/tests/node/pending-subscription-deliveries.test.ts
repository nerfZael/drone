import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireHubDatabase, resetHubDatabaseForTests } from '../../src/host/hub-database';
import { ResourceSubscriptionService } from '../../src/hub/subscriptions/resource-subscription-service';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';
import { memoryHubDatabase } from './helpers/memory-hub-database';
import {
  PromptQueueRepository,
  getPromptQueueRepository,
} from '../../src/host/prompt-queue-repository';

const settings = {
  ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
  batchWindowMs: 60_000,
  eventDeliveryModes: { 'pull_request.opened': 'asap' as const },
};

async function fixture(store = memoryHubDatabase()) {
  const repository = new ResourceSubscriptionRepository(store.database);
  for (const chatId of ['chat-a', 'chat-b']) {
    await repository.upsert({
      subscriber: { chatId, droneId: 'drone-a', chatName: chatId },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'owner/repo',
      events: ['pull_request.opened', 'pull_request.comment.created'],
      intent: '',
      maxActive: 50,
    });
  }
  const append = async (
    id: string,
    eventType: 'pull_request.opened' | 'pull_request.comment.created',
  ) => {
    await repository.appendEvent({
      id,
      providerEventId: id,
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'owner/repo#1',
      parentResourceId: 'owner/repo',
      eventType,
      occurredAt: new Date().toISOString(),
      summary: id,
      providerContent: {},
    });
  };
  await append('opened', 'pull_request.opened');
  await append('comment', 'pull_request.comment.created');
  return { ...store, repository, append };
}

test('pending events expose server timing, chat scope and effective delivery modes', async () => {
  const f = await fixture();
  try {
    const now = new Date();
    const snapshot = f.repository.pendingDeliveries('drone-a', 'chat-a', settings, now);
    assert.equal(snapshot.serverNow, now.toISOString());
    assert.equal(snapshot.deliveries.length, 2);
    assert.deepEqual(snapshot.deliveries.map((item) => item.deliveryMode).sort(), [
      'asap',
      'queue',
    ]);
    for (const item of snapshot.deliveries) {
      assert.equal(item.subscriberChatId, 'chat-a');
      assert.equal(item.status, 'batching');
      assert.equal(item.canRelease, true);
      assert.ok(Date.parse(item.releaseAt!) > now.getTime());
    }
    assert.equal(await f.repository.claimBatch(settings, now), null);
    assert.deepEqual(
      f.repository.pendingDeliveries('wrong-drone', 'chat-a', settings).deliveries,
      [],
    );
  } finally {
    f.close();
  }
});

test('concurrent manual and automatic claims do not duplicate events or mix modes or chats', async () => {
  const f = await fixture();
  try {
    const ids = f.repository
      .pendingDeliveries('drone-a', 'chat-a', settings)
      .deliveries.map((item) => item.id);
    await f.append('arrived-after-click', 'pull_request.opened');
    const options = { subscriberChatId: 'chat-a', deliveryIds: ids, bypassBatchWindow: true };
    const batches = await Promise.all([
      f.repository.claimBatch(settings, new Date(), options),
      f.repository.claimBatch(settings, new Date(), options),
      f.repository.claimBatch(settings),
      f.repository.claimBatch(settings, new Date(), options),
    ]);
    const claimed = batches.flatMap((batch) => batch?.items ?? []);
    assert.deepEqual(claimed.map((item) => item.deliveryId).sort(), ids.sort());
    for (const batch of batches.filter((item) => item !== null)) {
      assert.equal(batch!.subscriber.chatId, 'chat-a');
      assert.equal(batch!.items.length, 1);
    }
    assert.equal(
      f.repository.pendingDeliveries('drone-a', 'chat-b', settings).deliveries.length,
      3,
    );
    assert.equal(
      f.repository
        .pendingDeliveries('drone-a', 'chat-a', settings)
        .deliveries.filter((item) => item.status === 'batching').length,
      1,
    );
  } finally {
    f.close();
  }
});

test('manual release respects retry backoff, paused subscriptions, and run limits', async () => {
  const f = await fixture();
  try {
    const now = new Date();
    const ids = f.repository
      .pendingDeliveries('drone-a', 'chat-a', settings)
      .deliveries.map((item) => item.id);
    f.database.read((db) =>
      db
        .prepare(
          "UPDATE subscription_deliveries SET next_attempt_at = ?, last_error = 'temporary error' WHERE id = ?",
        )
        .run(new Date(now.getTime() + 120_000).toISOString(), ids[0]),
    );
    let pending = f.repository.pendingDeliveries('drone-a', 'chat-a', settings, now).deliveries;
    assert.equal(pending.find((item) => item.id === ids[0])!.status, 'retrying');
    assert.equal(
      await f.repository.claimBatch(settings, now, {
        subscriberChatId: 'chat-a',
        deliveryIds: [ids[0]!],
        bypassBatchWindow: true,
      }),
      null,
    );
    assert.ok(
      f.repository
        .pendingDeliveries('drone-a', 'chat-a', { ...settings, enabled: false }, now)
        .deliveries.every((item) => item.status === 'paused' && !item.canRelease),
    );
    const noRuns = { ...settings, maxAutomatedRunsPerConversationPerHour: 0 };
    pending = f.repository.pendingDeliveries('drone-a', 'chat-a', noRuns, now).deliveries;
    assert.ok(pending.every((item) => item.status === 'rate-limited' && !item.canRelease));
    assert.equal(
      await f.repository.claimBatch(noRuns, now, {
        subscriberChatId: 'chat-a',
        deliveryIds: ids,
        bypassBatchWindow: true,
      }),
      null,
    );
    f.database.read((db) =>
      db
        .prepare(
          "UPDATE resource_subscriptions SET status = 'paused' WHERE subscriber_chat_id = 'chat-a'",
        )
        .run(),
    );
    assert.ok(
      f.repository
        .pendingDeliveries('drone-a', 'chat-a', settings, now)
        .deliveries.every((item) => item.status === 'paused'),
    );
    assert.equal(
      await f.repository.claimBatch(settings, now, {
        subscriberChatId: 'chat-a',
        deliveryIds: ids,
        bypassBatchWindow: true,
      }),
      null,
    );
  } finally {
    f.close();
  }
});

test('handoff removes processing deliveries as soon as their merged prompt exists', async () => {
  const f = await fixture();
  try {
    const queue = new PromptQueueRepository(f.database);
    const ids = f.repository
      .pendingDeliveries('drone-a', 'chat-a', settings)
      .deliveries.map((item) => item.id);
    const batch = (await f.repository.claimBatch(settings, new Date(), {
      subscriberChatId: 'chat-a',
      deliveryIds: ids,
      bypassBatchWindow: true,
    }))!;
    const event = {
      deliveryId: 'prior',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'owner/repo#0',
      eventType: 'pull_request.opened',
      summary: 'Prior',
    };
    await queue.enqueue({
      droneId: 'drone-a',
      chatName: 'chat-a',
      submissionSource: 'subscription',
      prompt: {
        id: 'existing',
        at: new Date().toISOString(),
        prompt: 'Event',
        state: 'queued',
        deliveryMode: 'asap',
        eventBundle: { events: [event] },
      },
    });
    await queue.enqueue({
      droneId: 'drone-a',
      chatName: 'chat-a',
      submissionSource: 'subscription',
      idempotencyKey: `subscription-batch:${batch.id}`,
      prompt: {
        id: batch.promptId,
        at: new Date().toISOString(),
        prompt: 'Event',
        state: 'queued',
        deliveryMode: 'asap',
        eventBundle: { events: [{ ...event, deliveryId: batch.items[0]!.deliveryId }] },
      },
    });
    const pending = f.repository.pendingDeliveries('drone-a', 'chat-a', settings).deliveries;
    assert.ok(!pending.some((item) => item.id === batch.items[0]!.deliveryId));
    assert.equal(pending.length, 1);
  } finally {
    f.close();
  }
});

test('release service sends immediately through the normal queue exactly once and preserves overrides', async () => {
  const previous = process.env.DRONE_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-events-release-'));
  process.env.DRONE_DATA_DIR = directory;
  try {
    const database = requireHubDatabase();
    const f = await fixture({ database, close: () => {} });
    database.read((db) =>
      db.exec(`
      CREATE TABLE canonical_chats (drone_id TEXT, chat_name TEXT, metadata_json TEXT);
      INSERT INTO canonical_chats VALUES ('drone-a', 'chat-a', '{"id":"chat-a"}');
      INSERT INTO canonical_chats VALUES ('drone-a', 'chat-b', '{"id":"chat-b"}');
    `),
    );
    const wakes: string[] = [];
    const service = new ResourceSubscriptionService({
      repository: f.repository,
      readSettings: async () => ({ ...settings, maxEventsPerPrompt: 1 }),
      readChatStatus: async () => ({ idle: true, reason: '', latest: null }),
      wakePromptQueue: (_droneId, chatName) => {
        wakes.push(chatName);
      },
      log: () => {},
    });
    const ids = (await service.pendingDeliveries('drone-a', 'chat-a')).deliveries.map(
      (item) => item.id,
    );
    const wrongChatIds = (await service.pendingDeliveries('drone-a', 'chat-b')).deliveries.map(
      (item) => item.id,
    );
    await Promise.all([
      service.releasePendingDeliveries('drone-a', 'chat-a', [...ids, ...wrongChatIds]),
      service.releasePendingDeliveries('drone-a', 'chat-a', ids),
    ]);
    const prompts = getPromptQueueRepository()!.list({ droneId: 'drone-a', chatName: 'chat-a' });
    assert.equal(prompts.length, 2);
    assert.deepEqual(prompts.map((prompt) => prompt.deliveryMode).sort(), ['asap', 'queue']);
    assert.ok(prompts.every((prompt) => prompt.state === 'queued'));
    assert.deepEqual(wakes, ['chat-a', 'chat-a']);
    assert.equal((await service.pendingDeliveries('drone-a', 'chat-a')).deliveries.length, 0);
    assert.equal((await service.pendingDeliveries('drone-a', 'chat-b')).deliveries.length, 2);
    await service.releasePendingDeliveries('drone-a', 'chat-a', ids);
    assert.equal(
      getPromptQueueRepository()!.list({ droneId: 'drone-a', chatName: 'chat-a' }).length,
      2,
    );
  } finally {
    await resetHubDatabaseForTests();
    if (previous === undefined) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
