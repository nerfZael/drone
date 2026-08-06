import assert from 'node:assert/strict';
import test from 'node:test';

import { applyHubDatabaseMigrations } from '../../src/host/hub-database';
import { PromptQueueRepository } from '../../src/host/prompt-queue-repository';
import {
  RESOURCE_SUBSCRIPTION_MIGRATIONS,
  ResourceSubscriptionRepository,
} from '../../src/hub/subscriptions/resource-subscription-repository';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';
import { memoryHubDatabase } from './helpers/memory-hub-database';

test('resolves display names and chat counts for chat subscription resources in one batch', () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    database.read((connection) => {
      connection.exec(`
        CREATE TABLE canonical_chats (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          metadata_json TEXT NOT NULL
        );
        CREATE TABLE hub_canonical_drones (
          drone_id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL
        );
        INSERT INTO hub_canonical_drones (drone_id, name)
          VALUES ('drone-a', 'Build worker'), ('drone-b', 'Review worker');
        INSERT INTO canonical_chats (drone_id, chat_name, metadata_json)
          VALUES
            ('drone-a', 'default', '{"id":"chat-a"}'),
            ('drone-b', 'default', '{"id":"chat-b-default"}'),
            ('drone-b', 'review', '{"id":"chat-b-review"}');
      `);
    });

    assert.deepEqual(repository.resolveChatResources(['chat-a', 'chat-b-review']), new Map([
      [
        'chat-a',
        {
          chatId: 'chat-a',
          droneId: 'drone-a',
          chatName: 'default',
          droneName: 'Build worker',
          droneChatCount: 1,
        },
      ],
      [
        'chat-b-review',
        {
          chatId: 'chat-b-review',
          droneId: 'drone-b',
          chatName: 'review',
          droneName: 'Review worker',
          droneChatCount: 2,
        },
      ],
    ]));
  } finally {
    close();
  }
});

test('deduplicates and batches repository events for the owning conversation', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const subscribed = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'getsentry/junior',
      events: ['pull_request.opened'],
      intent: 'Track new pull requests.',
      maxActive: 50,
    });
    const event = {
      id: 'event-1',
      providerEventId: 'github:getsentry/junior#208:opened:1',
      provider: 'github' as const,
      resourceType: 'pull_request' as const,
      resourceId: 'getsentry/junior#208',
      parentResourceId: 'getsentry/junior',
      eventType: 'pull_request.opened' as const,
      occurredAt: '2026-08-01T00:00:00.000Z',
      summary: 'Pull request #208 opened.',
      providerContent: { title: 'Add subscriptions' },
    };

    assert.equal(await repository.appendEvent(event), true);
    assert.equal(await repository.appendEvent({ ...event, id: 'event-duplicate' }), false);
    const batch = await repository.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 1_000),
    );
    assert.equal(batch?.subscriber.chatId, 'subscriber-chat');
    assert.equal(batch?.items.length, 1);
    assert.equal(batch?.items[0].subscription.id, subscribed.subscription.id);
    assert.equal(batch?.items[0].event.resourceId, 'getsentry/junior#208');
    await repository.completeBatch(batch!.id);
    assert.equal(
      await repository.claimBatch(
        { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
        new Date(Date.now() + 2_000),
      ),
      null,
    );
  } finally {
    close();
  }
});

test('completes exact pull request subscriptions on terminal events', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const created = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'getsentry/junior#208',
      events: ['pull_request.comment.created'],
      intent: '',
      maxActive: 50,
    });
    await repository.appendEvent({
      id: 'merged-event',
      providerEventId: 'github:getsentry/junior#208:merged:1',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'getsentry/junior#208',
      parentResourceId: 'getsentry/junior',
      eventType: 'pull_request.merged',
      occurredAt: '2026-08-01T00:00:00.000Z',
      summary: 'Pull request #208 merged.',
      providerContent: {},
    });
    assert.equal(repository.get(created.subscription.id)?.status, 'completed');
  } finally {
    close();
  }
});

test('restart recovery does not redeliver a batch whose prompt was already queued', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    new PromptQueueRepository(database);
    await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'getsentry/junior',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    await repository.appendEvent({
      id: 'restart-event',
      providerEventId: 'github:getsentry/junior#209:opened:1',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'getsentry/junior#209',
      parentResourceId: 'getsentry/junior',
      eventType: 'pull_request.opened',
      occurredAt: '2026-08-01T00:00:00.000Z',
      summary: 'Pull request #209 opened.',
      providerContent: {},
    });
    const batch = await repository.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 1_000),
    );
    assert.ok(batch);
    const renamedLocation = {
      chatId: batch.subscriber.chatId,
      droneId: batch.subscriber.droneId,
      chatName: 'renamed-chat',
    };
    await repository.updateSubscriberLocation(batch.id, renamedLocation);
    database.read((connection) => {
      const at = new Date().toISOString();
      connection
        .prepare(
          `
        INSERT INTO prompts (
          drone_id, chat_name, prompt_id, idempotency_key, created_at, updated_at,
          state, prompt, payload_json, attempt_count, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?)
      `,
        )
        .run(
          renamedLocation.droneId,
          renamedLocation.chatName,
          batch.promptId,
          `subscription-batch:${batch.id}`,
          at,
          at,
          '[event notification]',
          JSON.stringify({
            id: batch.promptId,
            at,
            prompt: '[event notification]',
            state: 'queued',
          }),
          at,
        );
    });

    await repository.recoverInterruptedBatches();
    assert.equal(
      await repository.claimBatch(
        { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
        new Date(Date.now() + 2_000),
      ),
      null,
    );
  } finally {
    close();
  }
});

test('cancelling a claimed subscription releases the other item from a mixed batch', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const first = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/first',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/second',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    for (const [index, repositoryId] of ['example/first', 'example/second'].entries()) {
      await repository.appendEvent({
        id: `mixed-event-${index}`,
        providerEventId: `github:${repositoryId}#1:opened:1`,
        provider: 'github',
        resourceType: 'pull_request',
        resourceId: `${repositoryId}#1`,
        parentResourceId: repositoryId,
        eventType: 'pull_request.opened',
        occurredAt: `2026-08-01T00:00:0${index}.000Z`,
        summary: 'Pull request opened.',
        providerContent: {},
      });
    }
    const batch = await repository.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 1_000),
    );
    assert.ok(batch);
    assert.equal(batch.items.length, 2);
    const cancelledItem = batch.items.find(
      (item) => item.subscription.id === first.subscription.id,
    );
    const remainingItems = batch.items.filter(
      (item) => item.subscription.id !== first.subscription.id,
    );
    assert.ok(cancelledItem);

    await repository.cancel(first.subscription.id, 'subscriber-chat');
    await repository.releaseRejectedBatchItems({
      batchId: batch.id,
      rejected: [
        {
          deliveryId: cancelledItem.deliveryId,
          error: 'subscription is no longer active',
          permanent: true,
        },
      ],
      remainingDeliveryIds: remainingItems.map((item) => item.deliveryId),
      retryLimit: 10,
    });
    await repository.completeBatch(batch.id);

    const states = database.read(
      (connection) =>
        connection
          .prepare('SELECT state, COUNT(*) AS count FROM subscription_deliveries GROUP BY state')
          .all() as Array<{ state: string; count: number }>,
    );
    assert.deepEqual(Object.fromEntries(states.map((row) => [row.state, Number(row.count)])), {
      failed: 1,
      pending: 1,
    });
    const retry = await repository.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 2_000),
    );
    assert.deepEqual(
      retry?.items.map((item) => item.subscription.id),
      remainingItems.map((item) => item.subscription.id),
    );
  } finally {
    close();
  }
});

test('failed enqueue attempts do not consume the automated-run budget', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    new PromptQueueRepository(database);
    await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/retry',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    await repository.appendEvent({
      id: 'retry-event',
      providerEventId: 'github:example/retry#1:opened:1',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'example/retry#1',
      parentResourceId: 'example/retry',
      eventType: 'pull_request.opened',
      occurredAt: '2026-08-01T00:00:00.000Z',
      summary: 'Pull request opened.',
      providerContent: {},
    });
    const settings = {
      ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      batchWindowMs: 0,
      maxAutomatedRunsPerConversationPerHour: 1,
    };
    const firstBatch = await repository.claimBatch(settings, new Date(Date.now() + 1_000));
    assert.ok(firstBatch);
    await repository.failBatch(firstBatch.id, 'prompt queue unavailable', 10);

    const retryBatch = await repository.claimBatch(settings, new Date(Date.now() + 10_000));
    assert.ok(retryBatch);
    assert.equal(retryBatch.items.length, 1);
  } finally {
    close();
  }
});

test('rate-limited subscribers do not prevent later subscribers from claiming events', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const settings = {
      ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      batchWindowMs: 0,
      maxAutomatedRunsPerConversationPerHour: 1,
    };
    const now = Date.now();

    for (let index = 1; index <= 20; index += 1) {
      await repository.upsert({
        subscriber: {
          chatId: `subscriber-${index}`,
          droneId: 'drone-a',
          chatName: `chat-${index}`,
        },
        provider: 'github',
        resourceType: 'repository',
        resourceId: `example/repository-${index}`,
        events: ['pull_request.opened'],
        intent: '',
        maxActive: 50,
      });
      await appendOpenedEvent(repository, index, 'initial');
    }

    for (let index = 0; index < 20; index += 1) {
      const batch = await repository.claimBatch(settings, new Date(now + 1_000));
      assert.ok(batch);
      await repository.completeBatch(batch.id);
    }

    for (let index = 1; index <= 20; index += 1) {
      await appendOpenedEvent(repository, index, 'pending');
    }
    await repository.upsert({
      subscriber: { chatId: 'subscriber-21', droneId: 'drone-a', chatName: 'chat-21' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/repository-21',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    await appendOpenedEvent(repository, 21, 'initial');

    const batch = await repository.claimBatch(settings, new Date(now + 2_000));
    assert.equal(batch?.subscriber.chatId, 'subscriber-21');
  } finally {
    close();
  }
});

test('GitHub polling resumes from a fresh cursor after the last watcher is cancelled', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const firstCursor = {
      initialized: true,
      lastPollAt: '2026-08-01T00:00:00.000Z',
      pulls: {},
      seenCommentIds: [],
    };
    const first = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/cursor',
      events: ['pull_request.opened'],
      intent: '',
      initialPollCursor: {
        provider: 'github',
        resourceType: 'repository',
        resourceId: 'example/cursor',
        cursor: firstCursor,
      },
      maxActive: 50,
    });
    await repository.cancel(first.subscription.id, 'subscriber-chat');

    const resumedCursor = {
      ...firstCursor,
      lastPollAt: '2026-08-02T00:00:00.000Z',
    };
    await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/cursor',
      events: ['pull_request.opened'],
      intent: '',
      initialPollCursor: {
        provider: 'github',
        resourceType: 'repository',
        resourceId: 'example/cursor',
        cursor: resumedCursor,
      },
      maxActive: 50,
    });
    assert.deepEqual(
      repository.pollCursor('github', 'repository', 'example/cursor'),
      resumedCursor,
    );
  } finally {
    close();
  }
});

test('upgrades existing resource subscription storage for scheduled subscriptions', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    database.read((connection) =>
      applyHubDatabaseMigrations(
        connection,
        RESOURCE_SUBSCRIPTION_MIGRATIONS.slice(0, 2),
        'resource-subscriptions',
      ),
    );
    const repository = new ResourceSubscriptionRepository(database);
    const created = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/migrated',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    assert.deepEqual(created.subscription.resourceConfig, {});
    assert.equal(created.subscription.nextEventAt, null);
  } finally {
    close();
  }
});

test('stores cron configuration and advances only subscriptions due for an occurrence', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const resourceId = 'v1:hourly';
    const config = { expression: '0 * * * *', timeZone: 'UTC' };
    const due = await repository.upsert({
      subscriber: { chatId: 'due-chat', droneId: 'drone-a', chatName: 'due' },
      provider: 'drone-hub',
      resourceType: 'cron',
      resourceId,
      resourceConfig: config,
      events: ['cron.triggered'],
      intent: 'Run the hourly check.',
      nextEventAt: '2026-08-05T12:00:00.000Z',
      maxActive: 50,
    });
    const overdue = await repository.upsert({
      subscriber: { chatId: 'overdue-chat', droneId: 'drone-a', chatName: 'overdue' },
      provider: 'drone-hub',
      resourceType: 'cron',
      resourceId,
      resourceConfig: config,
      events: ['cron.triggered'],
      intent: 'Run the hourly check.',
      nextEventAt: '2026-08-05T11:00:00.000Z',
      maxActive: 50,
    });
    const future = await repository.upsert({
      subscriber: { chatId: 'future-chat', droneId: 'drone-a', chatName: 'future' },
      provider: 'drone-hub',
      resourceType: 'cron',
      resourceId,
      resourceConfig: config,
      events: ['cron.triggered'],
      intent: 'Run the hourly check.',
      nextEventAt: '2026-08-05T13:00:00.000Z',
      maxActive: 50,
    });

    assert.deepEqual(due.subscription.resourceConfig, config);
    assert.equal(due.subscription.nextEventAt, '2026-08-05T12:00:00.000Z');
    assert.deepEqual(
      new Set(
        repository
          .listDueCron(new Date('2026-08-05T12:30:00.000Z'))
          .map((subscription) => subscription.id),
      ),
      new Set([due.subscription.id, overdue.subscription.id]),
    );

    await assert.rejects(
      repository.appendCronOccurrence(
        cronEvent(resourceId, '2026-08-05T12:00:00.000Z'),
        '2026-08-05T12:00:00.000Z',
      ),
      /must be after/,
    );

    assert.equal(
      await repository.appendCronOccurrence(
        cronEvent(resourceId, '2026-08-05T12:00:00.000Z'),
        '2026-08-05T13:00:00.000Z',
      ),
      2,
    );
    assert.equal(repository.get(due.subscription.id)?.nextEventAt, '2026-08-05T13:00:00.000Z');
    assert.equal(
      repository.get(overdue.subscription.id)?.nextEventAt,
      '2026-08-05T13:00:00.000Z',
    );
    assert.equal(repository.get(future.subscription.id)?.nextEventAt, '2026-08-05T13:00:00.000Z');
    assert.equal(
      await repository.appendCronOccurrence(
        cronEvent(resourceId, '2026-08-05T12:00:00.000Z'),
        '2026-08-05T13:00:00.000Z',
      ),
      0,
    );
  } finally {
    close();
  }
});

test('a newer cron occurrence supersedes an older pending occurrence', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const resourceId = 'v1:every-minute';
    await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'cron',
      resourceId,
      resourceConfig: { expression: '* * * * *', timeZone: 'UTC' },
      events: ['cron.triggered'],
      intent: 'Run the check.',
      nextEventAt: '2026-08-05T12:00:00.000Z',
      maxActive: 50,
    });
    await repository.appendCronOccurrence(
      cronEvent(resourceId, '2026-08-05T12:00:00.000Z'),
      '2026-08-05T12:01:00.000Z',
    );
    await repository.appendCronOccurrence(
      cronEvent(resourceId, '2026-08-05T12:01:00.000Z'),
      '2026-08-05T12:02:00.000Z',
    );

    const states = database.read(
      (connection) =>
        connection
          .prepare('SELECT state, COUNT(*) AS count FROM subscription_deliveries GROUP BY state')
          .all() as Array<{ state: string; count: number }>,
    );
    assert.deepEqual(Object.fromEntries(states.map((row) => [row.state, Number(row.count)])), {
      failed: 1,
      pending: 1,
    });
  } finally {
    close();
  }
});

async function appendOpenedEvent(
  repository: ResourceSubscriptionRepository,
  repositoryNumber: number,
  eventName: string,
): Promise<void> {
  await repository.appendEvent({
    id: `event-${repositoryNumber}-${eventName}`,
    providerEventId: `github:example/repository-${repositoryNumber}:${eventName}`,
    provider: 'github',
    resourceType: 'pull_request',
    resourceId: `example/repository-${repositoryNumber}#1`,
    parentResourceId: `example/repository-${repositoryNumber}`,
    eventType: 'pull_request.opened',
    occurredAt: '2026-08-01T00:00:00.000Z',
    summary: 'Pull request opened.',
    providerContent: {},
  });
}

function cronEvent(resourceId: string, occurredAt: string) {
  return {
    id: `event-${occurredAt}`,
    providerEventId: `drone-hub:cron:${resourceId}:${occurredAt}`,
    provider: 'drone-hub' as const,
    resourceType: 'cron' as const,
    resourceId,
    parentResourceId: null,
    eventType: 'cron.triggered' as const,
    occurredAt,
    summary: 'Cron schedule triggered.',
    providerContent: { scheduledAt: occurredAt },
  };
}
