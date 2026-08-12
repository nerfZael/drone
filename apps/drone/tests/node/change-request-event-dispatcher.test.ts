import assert from 'node:assert/strict';
import test from 'node:test';

import { ChangeRequestEventDispatcher } from '../../src/hub/change-requests/change-request-event-dispatcher';
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

test('stores state-versioned domain events transactionally and batch-resolves requests', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new SqliteChangeRequestRepository(database);
    const created = await repository.insert(requestInput());
    assert.equal(created.stateVersion, 1);
    assert.deepEqual(repository.getByNumbers([created.number, 999]).get(created.number), created);
    assert.deepEqual(
      repository.listPendingEvents().map((event) => [event.eventType, event.stateVersion]),
      [['change_request.created', 1]],
    );

    const updated = await repository.update(created.id, {
      title: 'Updated title',
      updatedAt: '2026-08-12T10:01:00.000Z',
    });
    assert.equal(updated.stateVersion, 2);
    assert.deepEqual(
      repository.listPendingEvents().map((event) => [event.eventType, event.stateVersion]),
      [['change_request.updated', 2]],
    );
    const emitted = await repository.emitEvent(
      created.id,
      'change_request.updated',
      '2026-08-12T10:01:00.000Z',
    );
    assert.equal(emitted.stateVersion, 3);
    assert.deepEqual(
      repository
        .listPendingEvents()
        .map((event) => [event.eventType, event.stateVersion, event.request.title]),
      [['change_request.updated', 3, 'Updated title']],
    );

    const mirrorUpdatedAt = '2026-08-12T10:02:00.000Z';
    const mirrored = await repository.update(created.id, {
      githubMirror: {
        owner: 'acme',
        repo: 'widgets',
        pullNumber: 42,
        htmlUrl: 'https://github.com/acme/widgets/pull/42',
        headBranch: 'dronehub/cr-1',
        headSha: 'snapshot-sha',
        baseBranch: 'main',
        state: 'open',
        autoUpdate: true,
        branchOwnedByDroneHub: true,
        syncedRevision: 1,
        syncedNativeUpdatedAt: updated.updatedAt,
        mergeCommitSha: null,
        lastError: null,
        createdAt: mirrorUpdatedAt,
        updatedAt: mirrorUpdatedAt,
      },
    });
    assert.equal(mirrored.updatedAt, updated.updatedAt);
    assert.equal(mirrored.stateVersion, 4);
    assert.equal(repository.listPendingEvents()[0]?.occurredAt, mirrorUpdatedAt);
  } finally {
    close();
  }
});

test('upgrades existing change requests with an initial state version and outbox', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    await database.writeTransaction('create legacy change request schema', (connection) => {
      connection.exec(`
        CREATE TABLE hub_schema_migrations (
          scope TEXT NOT NULL,
          version INTEGER NOT NULL,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL,
          PRIMARY KEY (scope, version),
          UNIQUE (scope, name)
        );
        INSERT INTO hub_schema_migrations VALUES
          ('change-requests', 1, 'native change requests', '${at}'),
          ('change-requests', 2, 'github pull request mirrors', '${at}');
        CREATE TABLE change_requests (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          drone_id TEXT NOT NULL,
          drone_name TEXT NOT NULL,
          chat_id TEXT,
          chat_name TEXT NOT NULL,
          repo_root TEXT NOT NULL,
          base_branch TEXT NOT NULL,
          base_sha TEXT NOT NULL,
          destination_branch TEXT NOT NULL,
          snapshot_ref TEXT,
          snapshot_sha TEXT,
          source_head_sha TEXT NOT NULL,
          revision INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          created_by_json TEXT NOT NULL,
          merged_by_json TEXT,
          merge_commit_sha TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          merged_at TEXT,
          closed_at TEXT,
          github_mirror_json TEXT
        );
        INSERT INTO change_requests (
          id, status, drone_id, drone_name, chat_id, chat_name, repo_root,
          base_branch, base_sha, destination_branch, snapshot_ref, snapshot_sha,
          source_head_sha, revision, title, description, created_by_json,
          created_at, updated_at
        ) VALUES (
          'legacy-id', 'open', 'drone-b', 'Review worker', 'chat-b', 'default', '/repo',
          'main', 'base-sha', 'main', 'refs/legacy', 'snapshot-sha',
          'source-sha', 1, 'Legacy request', '', '{"kind":"user","id":null,"label":"User"}',
          '${at}', '${at}'
        );
      `);
    });

    const repository = new SqliteChangeRequestRepository(database);
    const legacy = repository.get('legacy-id');
    assert.equal(legacy?.stateVersion, 1);
    const emitted = await repository.emitEvent(
      'legacy-id',
      'change_request.updated',
      '2026-08-12T10:01:00.000Z',
    );
    assert.equal(emitted.stateVersion, 2);
    assert.equal(repository.listPendingEvents()[0]?.stateVersion, 2);
  } finally {
    close();
  }
});

test('recovers pending outbox events and notifies observers after durable delivery', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const repository = new SqliteChangeRequestRepository(database);
    const request = await repository.insert(requestInput());
    await repository.emitEvent(request.id, 'change_request.updated', '2026-08-12T10:01:00.000Z');

    const failedDispatcher = new ChangeRequestEventDispatcher({
      repository,
      deliver: async () => {
        throw new Error('temporarily unavailable');
      },
      now: () => '2026-08-12T10:02:00.000Z',
      retryDelayMs: 60_000,
      log: () => {},
    });
    failedDispatcher.start();
    await waitFor(() => repository.listPendingEvents()[0]?.attemptCount === 1);
    await failedDispatcher.stop();

    const delivered: string[] = [];
    const observed: string[] = [];
    const recoveringDispatcher = new ChangeRequestEventDispatcher({
      repository,
      deliver: async (event) => {
        delivered.push(event.eventType);
      },
      now: () => '2026-08-12T10:03:00.000Z',
      retryDelayMs: 10,
      log: () => {},
    });
    recoveringDispatcher.subscribe((event) => observed.push(event.eventType));
    recoveringDispatcher.start();
    await waitFor(() => repository.listPendingEvents().length === 0);
    await recoveringDispatcher.stop();

    assert.deepEqual(delivered, ['change_request.updated']);
    assert.deepEqual(observed, delivered);
  } finally {
    close();
  }
});

test('fans one committed domain event into resource subscriptions without polling', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const changeRequests = new SqliteChangeRequestRepository(database);
    const subscriptions = new ResourceSubscriptionRepository(database);
    const request = await changeRequests.insert(requestInput());
    await subscriptions.upsert({
      subscriber: { chatId: 'subscriber-chat', droneId: 'drone-a', chatName: 'default' },
      provider: 'drone-hub',
      resourceType: 'change_request',
      resourceId: String(request.number),
      resourceConfig: { requestNumber: request.number, droneId: request.droneId },
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
    const dispatcher = new ChangeRequestEventDispatcher({
      repository: changeRequests,
      hydrate: async (event) => ({
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
      }),
      deliver: async (event) => await subscriptionService.publishChangeRequest(event),
      now: () => '2026-08-12T10:02:00.000Z',
      log: () => {},
    });
    dispatcher.start();
    await waitFor(() => changeRequests.listPendingEvents().length === 0);

    await changeRequests.update(request.id, {
      title: 'Updated title',
      updatedAt: '2026-08-12T10:01:00.000Z',
    });
    const emitted = await changeRequests.emitEvent(
      request.id,
      'change_request.updated',
      '2026-08-12T10:01:00.000Z',
    );
    await waitFor(() => changeRequests.listPendingEvents().length === 0);
    await dispatcher.stop();

    const batch = await subscriptions.claimBatch(
      { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 },
      new Date(Date.now() + 1_000),
    );
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
    assert.equal(
      batch?.items[0]?.event.providerEventId,
      `drone-hub:change-request:${request.number}:v${emitted.stateVersion}:change_request.updated`,
    );
  } finally {
    close();
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
