import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubDatabase } from '../../src/host/hub-database';
import { normalizeCronSubscription } from '../../src/hub/subscriptions/cron-subscription';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import {
  detectChatSubscriptionChanges,
  ResourceSubscriptionService,
} from '../../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';
import { memoryHubDatabase } from './helpers/memory-hub-database';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function addCanonicalChatFixtures(database: HubDatabase): Promise<void> {
  await database.writeTransaction('add canonical chat fixtures', (connection) => {
    connection.exec(`
      CREATE TABLE canonical_chats (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      )
    `);
    const insert = connection.prepare(
      `INSERT INTO canonical_chats (drone_id, chat_name, metadata_json) VALUES (?, ?, ?)`,
    );
    insert.run('subscriber-drone', 'default', JSON.stringify({ id: 'subscriber-chat' }));
    insert.run('watched-drone', 'default', JSON.stringify({ id: 'watched-chat' }));
  });
}

test('slow GitHub polling does not block local subscription observation', async () => {
  const { database, close } = memoryHubDatabase();
  const githubGate = deferred();
  const githubStarted = deferred();
  let githubAborted = false;
  try {
    const repository = new ResourceSubscriptionRepository(database);
    await addCanonicalChatFixtures(database);
    await repository.upsert({
      subscriber: {
        chatId: 'subscriber-chat',
        droneId: 'subscriber-drone',
        chatName: 'default',
      },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      events: ['chat.idle'],
      intent: '',
      cursor: {},
      maxActive: 50,
    });
    await repository.upsert({
      subscriber: {
        chatId: 'subscriber-chat',
        droneId: 'subscriber-drone',
        chatName: 'default',
      },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/repository',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });

    let localObserved = false;
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => {
        localObserved = true;
        return { idle: true, reason: 'idle', latest: null };
      },
      wakePromptQueue: () => {},
      pollGithubRepository: async (_resourceId, _cursor, _now, options) => {
        githubStarted.resolve();
        await Promise.race([
          githubGate.promise,
          new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => {
                githubAborted = true;
                reject(options.signal?.reason);
              },
              { once: true },
            );
          }),
        ]);
        return {
          cursor: {
            initialized: true,
            lastPollAt: new Date().toISOString(),
            pulls: {},
            seenCommentIds: [],
          },
          events: [],
        };
      },
      readSettings: async () => DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      log: () => {},
    });

    const ticking = service.tick();
    await githubStarted.promise;
    for (let index = 0; index < 20 && !localObserved; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(localObserved, true);
    await service.stop();
    await ticking;
    assert.equal(githubAborted, true);
  } finally {
    githubGate.resolve();
    close();
  }
});

test('manual subscription ticks coalesce with active local work', async () => {
  const { database, close } = memoryHubDatabase();
  const localStarted = deferred();
  const localGate = deferred();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    await addCanonicalChatFixtures(database);
    await repository.upsert({
      subscriber: {
        chatId: 'subscriber-chat',
        droneId: 'subscriber-drone',
        chatName: 'default',
      },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      events: ['chat.idle'],
      intent: '',
      cursor: {},
      maxActive: 50,
    });

    let localRuns = 0;
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => {
        localRuns += 1;
        localStarted.resolve();
        await localGate.promise;
        return { idle: true, reason: 'idle', latest: null };
      },
      wakePromptQueue: () => {},
      readSettings: async () => DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      log: () => {},
    });

    const first = service.tick();
    await localStarted.promise;
    const second = service.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(localRuns, 1);

    localGate.resolve();
    await Promise.all([first, second]);
    await service.stop();
  } finally {
    localGate.resolve();
    close();
  }
});

test('completes a paused pull request subscription without delivering its terminal event', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const created = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'getsentry/junior#208',
      events: ['pull_request.merged'],
      intent: '',
      maxActive: 50,
    });
    await repository.pauseForChat('subscriber-chat');
    await repository.appendEvent({
      id: 'paused-merged-event',
      providerEventId: 'github:getsentry/junior#208:merged:paused',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'getsentry/junior#208',
      parentResourceId: 'getsentry/junior',
      eventType: 'pull_request.merged',
      occurredAt: new Date().toISOString(),
      summary: 'Pull request #208 merged.',
      providerContent: {},
    });

    assert.equal(repository.get(created.subscription.id)?.status, 'completed');
    assert.deepEqual(repository.get(created.subscription.id)?.pauseReasons, []);
    assert.equal(
      await repository.claimBatch(
        { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
        new Date(Date.now() + 1_000),
      ),
      null,
    );
  } finally {
    close();
  }
});

test('validates, labels, pauses, and resumes native change request subscriptions', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    let status: 'open' | 'closed' = 'open';
    let batchResolutionCount = 0;
    const changeRequest = () => ({
      number: 42,
      stateVersion: 7,
      status,
      droneId: 'watched-drone',
      droneName: 'Review worker',
      title: 'Improve subscriptions',
    });
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => ({ idle: true, reason: 'idle', latest: null }),
      resolveChangeRequest: (requestNumber) => (requestNumber === 42 ? changeRequest() : null),
      resolveChangeRequests: (requestNumbers) => {
        batchResolutionCount += 1;
        return new Map(requestNumbers.includes(42) ? ([[42, changeRequest()]] as const) : []);
      },
      wakePromptQueue: () => {},
      readSettings: async () => DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      log: () => {},
    });
    const created = await service.subscribe({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'change_request',
      resourceId: '#42',
      events: ['change_request.updated', 'change_request.merged'],
      intent: 'Continue the review.',
    });
    assert.equal(created.subscription.resourceId, '42');
    assert.equal(created.subscription.resourceLabel, '#42 Improve subscriptions');
    assert.equal(created.subscription.resourceDroneId, 'watched-drone');
    assert.deepEqual(created.subscription.resourceConfig, {
      requestNumber: 42,
      droneId: 'watched-drone',
      stateVersion: 7,
    });
    assert.equal(service.list('subscriber-chat')[0]?.resourceLabel, '#42 Improve subscriptions');
    assert.equal(batchResolutionCount, 1);
    const updated = await service.update({
      id: created.subscription.id,
      subscriberChatId: 'subscriber-chat',
      intent: 'Updated intent.',
    });
    assert.equal(updated?.resourceLabel, '#42 Improve subscriptions');
    assert.equal(updated?.resourceDroneId, 'watched-drone');

    await service.pauseForDrone('watched-drone', []);
    assert.equal(repository.get(created.subscription.id)?.status, 'paused');
    await service.resumeForDrone('watched-drone', []);
    assert.equal(repository.get(created.subscription.id)?.status, 'active');

    status = 'closed';
    await assert.rejects(
      service.subscribe({
        subscriber: { chatId: 'other-chat', droneId: 'drone-a', chatName: 'other' },
        provider: 'drone-hub',
        resourceType: 'change_request',
        resourceId: '42',
        events: ['change_request.closed'],
      }),
      /already closed/,
    );
    await assert.rejects(
      service.subscribe({
        subscriber: { chatId: 'other-chat', droneId: 'drone-a', chatName: 'other' },
        provider: 'drone-hub',
        resourceType: 'change_request',
        resourceId: '99',
        events: ['change_request.updated'],
      }),
      /unknown DroneHub change request/,
    );
    const cancelled = await service.cancel(created.subscription.id, 'subscriber-chat');
    assert.equal(cancelled?.resourceLabel, '#42 Improve subscriptions');
    assert.equal(cancelled?.resourceDroneId, 'watched-drone');
  } finally {
    close();
  }
});

test('archived chats pause owned and watched subscriptions without replaying queued events', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const created = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      events: ['chat.idle'],
      intent: '',
      cursor: { idleArmed: true },
      maxActive: 50,
    });
    await repository.appendEvent({
      id: 'queued-before-archive',
      providerEventId: 'drone-hub:watched-chat:idle:before-archive',
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      parentResourceId: null,
      eventType: 'chat.idle',
      occurredAt: '2026-08-01T00:00:00.000Z',
      summary: 'Watched chat became idle.',
      providerContent: {},
    });

    await repository.pauseForChat('subscriber-chat');
    await repository.pauseForChat('watched-chat');
    assert.equal(repository.get(created.subscription.id)?.status, 'paused');
    assert.deepEqual(repository.get(created.subscription.id)?.pauseReasons, [
      'subscriber_chat_archived',
      'resource_chat_archived',
    ]);
    assert.equal(repository.list('subscriber-chat').length, 1);
    await repository.cancelActive(created.subscription.id, 'subscriber-chat');
    assert.equal(repository.get(created.subscription.id)?.status, 'paused');

    await repository.resumeForChat('subscriber-chat');
    assert.equal(repository.get(created.subscription.id)?.status, 'paused');
    assert.deepEqual(repository.get(created.subscription.id)?.pauseReasons, [
      'resource_chat_archived',
    ]);
    await repository.resumeForChat('watched-chat');
    assert.equal(repository.get(created.subscription.id)?.status, 'active');
    assert.deepEqual(repository.get(created.subscription.id)?.pauseReasons, []);
    assert.equal(
      await repository.claimBatch(
        { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
        new Date(Date.now() + 1_000),
      ),
      null,
    );
  } finally {
    close();
  }
});

test('drone and chat pause reasons must all clear before a subscription resumes', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const created = await repository.upsert({
      subscriber: { chatId: 'chat-a', droneId: 'drone-a', chatName: 'a' },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'chat-b',
      events: ['chat.idle'],
      intent: '',
      maxActive: 50,
    });

    await repository.pauseForChat('chat-a');
    await repository.pauseForChat('chat-b');
    await repository.pauseForDrone('drone-a', ['chat-a', 'chat-b']);
    assert.deepEqual(repository.get(created.subscription.id)?.pauseReasons, [
      'subscriber_chat_archived',
      'resource_chat_archived',
      'subscriber_drone_archived',
      'resource_drone_archived',
    ]);

    await repository.resumeForDrone('drone-a', ['chat-a', 'chat-b']);
    await repository.resumeForChat('chat-a');
    assert.equal(repository.get(created.subscription.id)?.status, 'paused');
    assert.deepEqual(repository.get(created.subscription.id)?.pauseReasons, [
      'resource_chat_archived',
    ]);
    await repository.resumeForChat('chat-b');
    assert.equal(repository.get(created.subscription.id)?.status, 'active');
  } finally {
    close();
  }
});

test('permanent chat and drone deletion cancel related subscriptions immediately', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const owned = await repository.upsert({
      subscriber: { chatId: 'deleted-chat', droneId: 'deleted-drone', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/owned',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    const watching = await repository.upsert({
      subscriber: { chatId: 'other-chat', droneId: 'other-drone', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'deleted-chat',
      events: ['chat.idle'],
      intent: '',
      maxActive: 50,
    });

    await repository.cancelForDrone('deleted-drone', ['deleted-chat']);
    assert.equal(repository.get(owned.subscription.id)?.status, 'cancelled');
    assert.equal(repository.get(watching.subscription.id)?.status, 'cancelled');
    assert.deepEqual(repository.get(owned.subscription.id)?.pauseReasons, []);
  } finally {
    close();
  }
});

test('restoring a paused GitHub subscription skips archived-time events', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const oldCursor = {
      initialized: true,
      lastPollAt: '2026-08-01T00:00:00.000Z',
      pulls: {},
      seenCommentIds: [],
    };
    await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/resume',
      events: ['pull_request.opened'],
      intent: '',
      initialPollCursor: {
        provider: 'github',
        resourceType: 'repository',
        resourceId: 'example/resume',
        cursor: oldCursor,
      },
      maxActive: 50,
    });
    await repository.pauseForChat('subscriber-chat');
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => ({ idle: true, reason: 'idle', latest: null }),
      wakePromptQueue: () => {},
      log: () => {},
    });

    await service.resumeForChat('subscriber-chat');
    assert.equal(repository.list('subscriber-chat')[0]?.status, 'active');
    await repository.appendEvent({
      id: 'event-during-archive',
      providerEventId: 'github:example/resume#1:opened:during-archive',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'example/resume#1',
      parentResourceId: 'example/resume',
      eventType: 'pull_request.opened',
      occurredAt: '2026-08-02T00:00:00.000Z',
      summary: 'Pull request opened while archived.',
      providerContent: {},
    });
    assert.equal(
      await repository.claimBatch(
        { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
        new Date(Date.now() + 1_000),
      ),
      null,
    );

    const future = new Date(Date.now() + 2_000);
    await repository.appendEvent({
      id: 'event-after-restore',
      providerEventId: 'github:example/resume#2:opened:after-restore',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'example/resume#2',
      parentResourceId: 'example/resume',
      eventType: 'pull_request.opened',
      occurredAt: future.toISOString(),
      summary: 'Pull request opened after restore.',
      providerContent: {},
    });
    assert.equal(
      (
        await repository.claimBatch(
          { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
          new Date(future.getTime() + 1_000),
        )
      )?.items.length,
      1,
    );
  } finally {
    close();
  }
});

test('restoring a paused cron subscription schedules only the next future occurrence', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const archivedAt = new Date(Date.now() - 60 * 60 * 1_000);
    const schedule = normalizeCronSubscription('* * * * *', 'UTC', archivedAt);
    const created = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'cron',
      resourceId: schedule.resourceId,
      resourceConfig: schedule.resourceConfig,
      events: ['cron.triggered'],
      intent: 'Run the scheduled check.',
      nextEventAt: schedule.nextEventAt,
      maxActive: 50,
    });
    await repository.pauseForChat('subscriber-chat');
    let chatStatusReads = 0;
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => {
        chatStatusReads += 1;
        return { idle: true, reason: 'idle', latest: null };
      },
      wakePromptQueue: () => {},
      log: () => {},
    });

    const resumedAfter = Date.now();
    await service.resumeForChat('subscriber-chat');
    const resumed = repository.get(created.subscription.id)!;
    assert.equal(resumed.status, 'active');
    assert.equal(chatStatusReads, 0);
    assert.ok(Date.parse(resumed.nextEventAt ?? '') > resumedAfter);
    assert.deepEqual(repository.listDueCron(new Date()), []);
  } finally {
    close();
  }
});

test('restoring a paused chat subscription resets its cursor to the current chat state', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    await database.writeTransaction('add canonical chat fixture', (connection) => {
      connection.exec(`
        CREATE TABLE canonical_chats (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          metadata_json TEXT NOT NULL
        )
      `);
      connection
        .prepare(
          `INSERT INTO canonical_chats (drone_id, chat_name, metadata_json)
           VALUES (?, ?, ?)`,
        )
        .run('watched-drone', 'default', JSON.stringify({ id: 'watched-chat' }));
    });
    const created = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      events: ['chat.idle'],
      intent: '',
      cursor: { idleArmed: true, idleCauseId: 'old-work' },
      maxActive: 50,
    });
    await repository.pauseForChat('subscriber-chat');
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => ({
        idle: true,
        reason: 'idle',
        latest: { id: 'current-message', role: 'assistant', status: 'completed' },
      }),
      wakePromptQueue: () => {},
      log: () => {},
    });

    await service.resumeForChat('subscriber-chat');
    const resumed = repository.get(created.subscription.id);
    assert.equal(resumed?.status, 'active');
    assert.equal(resumed?.cursor.idleArmed, false);
    assert.equal(resumed?.cursor.lastLatestId, 'current-message');
    assert.equal(resumed?.cursor.idleCauseId, '');
  } finally {
    close();
  }
});

test('a transient status read failure does not leave a restored subscription paused', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    await database.writeTransaction('add canonical chat fixture', (connection) => {
      connection.exec(`
        CREATE TABLE canonical_chats (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          metadata_json TEXT NOT NULL
        )
      `);
      connection
        .prepare(
          `INSERT INTO canonical_chats (drone_id, chat_name, metadata_json)
           VALUES (?, ?, ?)`,
        )
        .run('watched-drone', 'default', JSON.stringify({ id: 'watched-chat' }));
    });
    const created = await repository.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      events: ['chat.idle', 'chat.failed'],
      intent: '',
      cursor: { idleArmed: true, idleCauseId: 'archived-work' },
      maxActive: 50,
    });
    await repository.pauseForChat('subscriber-chat');
    const service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => {
        throw new Error('runtime temporarily unavailable');
      },
      wakePromptQueue: () => {},
      log: () => {},
    });

    await service.resumeForChat('subscriber-chat');
    const resumed = repository.get(created.subscription.id)!;
    assert.equal(resumed.status, 'active');
    assert.equal(resumed.cursor.needsBaseline, true);
    const baseline = detectChatSubscriptionChanges(
      resumed,
      { chatId: 'watched-chat', droneId: 'watched-drone', chatName: 'default' },
      {
        idle: true,
        reason: 'latest_user_failed',
        latest: { id: 'archived-failure', role: 'user', status: 'failed' },
      },
    );
    assert.deepEqual(baseline.events, []);
    assert.equal(baseline.cursor.needsBaseline, undefined);
    assert.equal(baseline.cursor.lastFailureId, 'archived-failure');
  } finally {
    close();
  }
});

test('pausing one subscription releases unrelated deliveries from a mixed batch', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new ResourceSubscriptionRepository(database);
    const subscriber = { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' };
    const watched = await repository.upsert({
      subscriber,
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      events: ['chat.idle'],
      intent: '',
      maxActive: 50,
    });
    const github = await repository.upsert({
      subscriber,
      provider: 'github',
      resourceType: 'repository',
      resourceId: 'example/repository',
      events: ['pull_request.opened'],
      intent: '',
      maxActive: 50,
    });
    await repository.appendEvent({
      id: 'watched-chat-event',
      providerEventId: 'drone-hub:watched-chat:idle:mixed-batch',
      provider: 'drone-hub',
      resourceType: 'chat',
      resourceId: 'watched-chat',
      parentResourceId: null,
      eventType: 'chat.idle',
      occurredAt: new Date().toISOString(),
      summary: 'Watched chat became idle.',
      providerContent: {},
    });
    await repository.appendEvent({
      id: 'github-event',
      providerEventId: 'github:example/repository#1:opened:mixed-batch',
      provider: 'github',
      resourceType: 'pull_request',
      resourceId: 'example/repository#1',
      parentResourceId: 'example/repository',
      eventType: 'pull_request.opened',
      occurredAt: new Date().toISOString(),
      summary: 'Pull request opened.',
      providerContent: {},
    });

    const claimed = await repository.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 1_000),
    );
    assert.equal(claimed?.items.length, 2);
    await repository.pauseForChat('watched-chat');

    const states = database.read(
      (connection) =>
        connection
          .prepare(
            `SELECT subscription_id, state, batch_id
           FROM subscription_deliveries`,
          )
          .all() as Array<{ subscription_id: string; state: string; batch_id: string | null }>,
    );
    assert.deepEqual(Object.fromEntries(states.map((row) => [row.subscription_id, row])), {
      [github.subscription.id]: {
        subscription_id: github.subscription.id,
        state: 'pending',
        batch_id: null,
      },
      [watched.subscription.id]: {
        subscription_id: watched.subscription.id,
        state: 'failed',
        batch_id: null,
      },
    });
    const retry = await repository.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 2_000),
    );
    assert.deepEqual(
      retry?.items.map((item) => item.subscription.id),
      [github.subscription.id],
    );
  } finally {
    close();
  }
});
