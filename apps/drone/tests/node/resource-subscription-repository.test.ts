import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';

import type { HubDatabase, HubDatabaseConnection } from '../../src/host/hub-database';
import { PromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';

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
