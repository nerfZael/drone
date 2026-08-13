import assert from 'node:assert/strict';
import test from 'node:test';

import { HubOutboxDispatcher, HubOutboxRepository } from '../../src/host/hub-outbox';
import { changeRequestEventFromOutbox } from '../../src/hub/change-requests/change-request-outbox';
import { SqliteChangeRequestRepository } from '../../src/hub/change-requests/change-request-repository';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { ResourceSubscriptionService } from '../../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';
import { memoryHubDatabase } from './helpers/memory-hub-database';

const at = '2026-08-12T10:00:00.000Z';

function requestInput() {
  return {
    id: 'request-internal-id',
    status: 'open' as const,
    droneId: 'drone-b',
    droneName: 'Review worker',
    chatId: 'chat-b',
    chatName: 'default',
    repoRoot: '/repo',
    baseBranch: 'main',
    baseSha: 'base-sha',
    destinationBranch: 'main',
    snapshotRef: 'refs/drone/change-request',
    snapshotSha: 'snapshot-sha',
    sourceHeadSha: 'source-sha',
    revision: 1,
    title: 'Initial title',
    description: '',
    createdBy: { kind: 'user' as const, id: null, label: 'User' },
    mergedBy: null,
    mergeCommitSha: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
    mergedAt: null,
    closedAt: null,
    githubMirror: null,
  };
}

test('stores state-versioned change request events in the shared outbox', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new SqliteChangeRequestRepository(database);
    const outbox = new HubOutboxRepository(database);
    const created = await repository.insert(requestInput());
    const updated = await repository.update(created.id, {
      title: 'Updated title',
      updatedAt: '2026-08-12T10:01:00.000Z',
    });
    const emitted = await repository.emitEvent(
      created.id,
      'change_request.updated',
      '2026-08-12T10:02:00.000Z',
    );

    assert.equal(created.stateVersion, 1);
    assert.equal(updated.stateVersion, 2);
    assert.equal(emitted.stateVersion, 3);
    assert.deepEqual(repository.getByNumbers([created.number, 999]).get(created.number), emitted);
    assert.deepEqual(
      outbox
        .list({ status: 'pending' })
        .map((item) => [
          item.topic,
          item.eventType,
          item.aggregateId,
          (item.payload as any).stateVersion,
        ]),
      [
        ['change-request.events', 'change_request.created', '1', 1],
        ['change-request.events', 'change_request.updated', '1', 2],
        ['change-request.events', 'change_request.updated', '1', 3],
      ],
    );
  } finally {
    close();
  }
});

test('migrates pending specialized outbox events into the shared outbox', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    new SqliteChangeRequestRepository(database);
    const request = { ...requestInput(), number: 7, stateVersion: 4 };
    await database.writeTransaction('restore legacy outbox state', (connection) => {
      connection
        .prepare(
          "DELETE FROM hub_schema_migrations WHERE scope = 'change-requests' AND version = 4",
        )
        .run();
      connection.exec(`
        CREATE TABLE change_request_event_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          request_number INTEGER NOT NULL,
          state_version INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          request_json TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (request_number)
        );
      `);
      connection
        .prepare(
          `INSERT INTO change_request_event_outbox (
            id, request_number, state_version, event_type, occurred_at,
            request_json, attempt_count, last_error, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
        )
        .run(
          'legacy-event',
          request.number,
          request.stateVersion,
          'change_request.updated',
          at,
          JSON.stringify(request),
          at,
        );
    });

    new SqliteChangeRequestRepository(database);
    const migrated = new HubOutboxRepository(database)
      .list({ status: 'pending' })
      .find((event) => event.deduplicationKey === 'change-request:7:v4');
    assert.equal((migrated?.payload as any)?.id, 'legacy-event');
    const legacyTable = database.read(
      (connection) =>
        connection
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'change_request_event_outbox'",
          )
          .get() as { count: number },
    );
    assert.equal(legacyTable.count, 0);
  } finally {
    close();
  }
});

test('uses shared outbox retry semantics for change request delivery', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new SqliteChangeRequestRepository(database);
    const outbox = new HubOutboxRepository(database);
    await repository.insert(requestInput());

    const failing = new HubOutboxDispatcher(
      outbox,
      async () => {
        throw new Error('temporarily unavailable');
      },
      'failed-consumer',
    );
    assert.deepEqual(await failing.drainOnce({ now: at }), {
      claimed: 1,
      delivered: 0,
      failed: 1,
      deadLettered: 0,
    });

    const delivered: string[] = [];
    const recovering = new HubOutboxDispatcher(
      outbox,
      (item) => {
        const event = changeRequestEventFromOutbox(item);
        if (event) delivered.push(event.eventType);
      },
      'recovering-consumer',
    );
    await recovering.drainOnce({ now: '2026-08-12T10:00:02.000Z' });
    assert.deepEqual(delivered, ['change_request.created']);
    assert.equal(outbox.list({ status: 'delivered' }).length, 1);
  } finally {
    close();
  }
});

test('fans shared outbox events into resource subscriptions without polling', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const changeRequests = new SqliteChangeRequestRepository(database);
    const outbox = new HubOutboxRepository(database);
    const subscriptions = new ResourceSubscriptionRepository(database);
    const request = await changeRequests.insert(requestInput());
    await subscriptions.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'change_request',
      resourceId: String(request.number),
      resourceConfig: {
        requestNumber: request.number,
        droneId: request.droneId,
        stateVersion: request.stateVersion,
      },
      events: ['change_request.updated'],
      intent: 'Continue the review.',
      maxActive: 50,
    });
    const subscriptionService = new ResourceSubscriptionService({
      repository: subscriptions,
      readChatStatus: async () => ({ idle: true, reason: 'idle', latest: null }),
      wakePromptQueue: () => {},
      resolveChangeRequest: (number) => changeRequests.getByNumber(number),
      resolveChangeRequests: (numbers) => changeRequests.getByNumbers(numbers),
      readSettings: async () => DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      log: () => {},
    });
    const emitted = await changeRequests.update(request.id, {
      title: 'Updated title',
      updatedAt: '2026-08-12T10:01:00.000Z',
    });
    const dispatcher = new HubOutboxDispatcher(outbox, async (item) => {
      const event = changeRequestEventFromOutbox(item);
      if (!event) return;
      await subscriptionService.publishChangeRequest({
        ...event,
        request: {
          ...event.request,
          stale: true,
          conflicted: false,
          destinationExists: true,
          destinationSha: 'destination-sha',
          conflictFiles: [],
          lineStats: { files: 2, additions: 3, modifications: 1, deletions: 1, total: 5 },
        },
      });
    });
    await dispatcher.drainOnce();

    const batch = await subscriptions.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 1_000),
    );
    assert.equal(batch?.items.length, 1);
    assert.equal(batch?.items[0]?.event.providerContent.title, 'Updated title');
    assert.equal(batch?.items[0]?.event.providerContent.stateVersion, emitted.stateVersion);
    assert.equal(batch?.items[0]?.event.providerContent.stale, true);
    assert.deepEqual(batch?.items[0]?.event.providerContent.lineStats, {
      files: 2,
      additions: 3,
      modifications: 1,
      deletions: 1,
      total: 5,
    });
  } finally {
    close();
  }
});
