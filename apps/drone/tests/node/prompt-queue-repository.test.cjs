const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { getHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  getPromptQueueRepository,
  resetPromptQueueRepositoryForTests,
} = require('../../dist/host/prompt-queue-repository.js');
const { looksLikeTransientPromptEnqueueError } = require('../../dist/hub/pendingPromptEnqueue.js');
const { createDronePendingPromptStore } = require('../../dist/hub/drone-pending-prompts.js');
const { createPendingDroneStateHelpers } = require('../../dist/hub/drone-pending-state.js');
const {
  resetTranscriptStoreForTests,
  upsertChatInStore,
} = require('../../dist/hub/transcript-store.js');
const { loadRegistryRawSnapshot, saveRegistry } = require('../../dist/host/registry.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function repository(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-prompt-queue-${label}-`));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();
  resetPromptQueueRepositoryForTests();
  const value = getPromptQueueRepository();
  assert.ok(value, 'native SQLite prompt queue should be available to Node tests');
  return value;
}

function prompt(id, at, text = id) {
  return { id, at, prompt: text, state: 'queued', updatedAt: at };
}

afterEach(async () => {
  resetPromptQueueRepositoryForTests();
  await resetHubDatabaseForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('enqueue is idempotent by request key and keeps the original payload', async () => {
  const queue = repository('idempotency');
  const at = '2026-07-10T09:00:00.000Z';
  const first = await queue.enqueue({
    droneId: 'alpha',
    chatName: 'default',
    prompt: prompt('p-1', at, 'original'),
    idempotencyKey: 'request-1',
  });
  const duplicate = await queue.enqueue({
    droneId: 'alpha',
    chatName: 'default',
    prompt: prompt('p-2', at, 'replacement'),
    idempotencyKey: 'request-1',
  });

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.prompt.id, 'p-1');
  assert.equal(duplicate.prompt.prompt, 'original');
  assert.equal(queue.list({ droneId: 'alpha', chatName: 'default' }).length, 1);
});

test('pending prompt updates preserve live agent plans', async () => {
  const queue = repository('agent-plan');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'default', prompt: prompt('p-plan', at) });
  const agentPlan = {
    source: 'codex',
    updatedAt: '2026-07-10T09:00:01.000Z',
    items: [
      { text: 'Inspect code', status: 'completed' },
      { text: 'Run tests', status: 'in_progress' },
    ],
  };

  await queue.update({
    droneId: 'alpha',
    chatName: 'default',
    promptId: 'p-plan',
    patch: { state: 'sent', agentPlan, updatedAt: agentPlan.updatedAt },
  });

  assert.deepEqual(
    queue.get({ droneId: 'alpha', chatName: 'default', promptId: 'p-plan' }).agentPlan,
    agentPlan,
  );
});

test('claims preserve FIFO within a chat while allowing another chat to proceed', async () => {
  const queue = repository('fifo');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'one', prompt: prompt('first', at) });
  await queue.enqueue({ droneId: 'alpha', chatName: 'one', prompt: prompt('second', at) });
  await queue.enqueue({ droneId: 'alpha', chatName: 'two', prompt: prompt('other', at) });

  assert.equal(
    await queue.claim({
      droneId: 'alpha',
      chatName: 'one',
      promptId: 'second',
      leaseOwner: 'worker-a',
      now: at,
    }),
    null,
  );
  assert.ok(
    await queue.claim({
      droneId: 'alpha',
      chatName: 'one',
      promptId: 'first',
      leaseOwner: 'worker-a',
      now: at,
    }),
  );
  assert.ok(
    await queue.claim({
      droneId: 'alpha',
      chatName: 'two',
      promptId: 'other',
      leaseOwner: 'worker-b',
      now: at,
    }),
  );
  await queue.update({
    droneId: 'alpha',
    chatName: 'one',
    promptId: 'first',
    patch: { state: 'sent', updatedAt: at },
  });
  assert.ok(
    await queue.claim({
      droneId: 'alpha',
      chatName: 'one',
      promptId: 'second',
      leaseOwner: 'worker-a',
      now: at,
    }),
  );
});

test('steering can claim a follow-up while the current built-in prompt is sending', async () => {
  const queue = repository('steering');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'default', prompt: prompt('current', at) });
  await queue.enqueue({ droneId: 'alpha', chatName: 'default', prompt: prompt('steer', at) });
  assert.ok(
    await queue.claim({
      droneId: 'alpha',
      chatName: 'default',
      promptId: 'current',
      leaseOwner: 'native-current',
      now: at,
    }),
  );
  assert.ok(
    await queue.claimForSteering({
      droneId: 'alpha',
      chatName: 'default',
      promptId: 'steer',
      leaseOwner: 'native-steer',
      now: at,
    }),
  );
  assert.deepEqual(
    queue.listPending({ droneId: 'alpha', chatName: 'default' }).map((item) => item.state),
    ['sending', 'sending'],
  );
});

test('a conditional update permits only one competing claimant', async () => {
  const queue = repository('claim-race');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'default', prompt: prompt('race', at) });
  const claims = await Promise.all(
    ['worker-a', 'worker-b'].map((leaseOwner) =>
      queue.claim({
        droneId: 'alpha',
        chatName: 'default',
        promptId: 'race',
        leaseOwner,
        now: at,
      }),
    ),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(
    queue.get({ droneId: 'alpha', chatName: 'default', promptId: 'race' }).attemptCount,
    1,
  );
});

test('expired leases recover to queued and can be claimed again', async () => {
  const queue = repository('lease-recovery');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'default', prompt: prompt('leased', at) });
  await queue.claim({
    droneId: 'alpha',
    chatName: 'default',
    promptId: 'leased',
    leaseOwner: 'dead-worker',
    leaseMs: 1_000,
    now: at,
  });

  assert.equal(await queue.recoverExpiredLeases({ now: '2026-07-10T09:00:02.000Z' }), 1);
  const recovered = queue.get({ droneId: 'alpha', chatName: 'default', promptId: 'leased' });
  assert.equal(recovered.state, 'queued');
  assert.equal(recovered.leaseOwner, undefined);
  assert.deepEqual(queue.listQueuedChats({ now: '2026-07-10T09:00:02.000Z' }), [
    { droneId: 'alpha', chatName: 'default' },
  ]);
  assert.ok(
    await queue.claim({
      droneId: 'alpha',
      chatName: 'default',
      promptId: 'leased',
      leaseOwner: 'live-worker',
      now: '2026-07-10T09:00:02.000Z',
    }),
  );
});

test('interrupted built-in prompts recover without waiting for their leases to expire', async () => {
  const queue = repository('native-restart-recovery');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'native', prompt: prompt('native', at) });
  await queue.enqueue({ droneId: 'alpha', chatName: 'daemon', prompt: prompt('daemon', at) });
  await queue.claim({
    droneId: 'alpha',
    chatName: 'native',
    promptId: 'native',
    leaseOwner: 'old-hub-process',
    leaseMs: 30 * 60_000,
    now: at,
  });
  await queue.claim({
    droneId: 'alpha',
    chatName: 'daemon',
    promptId: 'daemon',
    leaseOwner: 'live-daemon',
    leaseMs: 30 * 60_000,
    now: at,
  });

  assert.equal(
    await queue.recoverSendingForChat({
      droneId: 'alpha',
      chatName: 'native',
      now: '2026-07-10T09:00:01.000Z',
    }),
    1,
  );
  assert.equal(
    queue.get({ droneId: 'alpha', chatName: 'native', promptId: 'native' }).state,
    'queued',
  );
  assert.equal(
    queue.get({ droneId: 'alpha', chatName: 'daemon', promptId: 'daemon' }).state,
    'sending',
  );
});

test('failed prompts can be dismissed from the pending queue', async () => {
  const queue = repository('dismiss-failed');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'default', prompt: prompt('failed', at) });
  await queue.update({
    droneId: 'alpha',
    chatName: 'default',
    promptId: 'failed',
    patch: { state: 'failed', error: 'model failed', updatedAt: at },
  });

  assert.deepEqual(
    await queue.cancelQueued({ droneId: 'alpha', chatName: 'default', promptId: 'failed' }),
    { cancelled: true, state: 'failed' },
  );
  assert.deepEqual(queue.listPending({ droneId: 'alpha', chatName: 'default' }), []);
});

test('retry scheduling uses bounded backoff and becomes terminal at max attempts', async () => {
  const queue = repository('retry');
  const at = '2026-07-10T09:00:00.000Z';
  await queue.enqueue({ droneId: 'alpha', chatName: 'default', prompt: prompt('retry', at) });
  await queue.claim({
    droneId: 'alpha',
    chatName: 'default',
    promptId: 'retry',
    leaseOwner: 'worker',
    now: at,
  });
  const retry = await queue.scheduleRetry({
    droneId: 'alpha',
    chatName: 'default',
    promptId: 'retry',
    leaseOwner: 'worker',
    error: 'temporary',
    maxAttempts: 2,
    baseDelayMs: 2_000,
    maxDelayMs: 2_000,
    now: at,
  });
  assert.deepEqual(retry, {
    disposition: 'retry',
    nextAttemptAt: '2026-07-10T09:00:02.000Z',
  });
  assert.equal(
    await queue.claim({
      droneId: 'alpha',
      chatName: 'default',
      promptId: 'retry',
      leaseOwner: 'worker',
      now: '2026-07-10T09:00:01.999Z',
    }),
    null,
  );
  await queue.claim({
    droneId: 'alpha',
    chatName: 'default',
    promptId: 'retry',
    leaseOwner: 'worker',
    now: '2026-07-10T09:00:02.000Z',
  });
  assert.deepEqual(
    await queue.scheduleRetry({
      droneId: 'alpha',
      chatName: 'default',
      promptId: 'retry',
      leaseOwner: 'worker',
      error: 'still broken',
      maxAttempts: 2,
      now: '2026-07-10T09:00:02.000Z',
    }),
    { disposition: 'terminal' },
  );
  assert.equal(
    queue.get({ droneId: 'alpha', chatName: 'default', promptId: 'retry' }).state,
    'failed',
  );
});

test('legacy backfill seeds missing rows but never overwrites canonical state', async () => {
  const queue = repository('backfill');
  const at = '2026-07-10T09:00:00.000Z';
  assert.equal(
    await queue.backfillLegacy({
      droneId: 'alpha',
      chatName: 'default',
      prompts: [prompt('legacy', at, 'from registry')],
    }),
    1,
  );
  await queue.update({
    droneId: 'alpha',
    chatName: 'default',
    promptId: 'legacy',
    patch: { state: 'sent', updatedAt: '2026-07-10T09:01:00.000Z' },
  });
  assert.equal(
    await queue.backfillLegacy({
      droneId: 'alpha',
      chatName: 'default',
      prompts: [{ ...prompt('legacy', at, 'stale registry'), state: 'failed', error: 'stale' }],
    }),
    0,
  );
  const stored = queue.get({ droneId: 'alpha', chatName: 'default', promptId: 'legacy' });
  assert.equal(stored.state, 'sent');
  assert.equal(stored.prompt, 'from registry');
});

test('cancellation leaves a tombstone that stale legacy backfill cannot resurrect', async () => {
  const queue = repository('cancel-tombstone');
  const queued = prompt('cancel-me', '2026-07-10T09:00:00.000Z');
  await queue.enqueue({ droneId: 'drone', chatName: 'chat', prompt: queued });
  assert.deepEqual(
    await queue.cancelQueued({ droneId: 'drone', chatName: 'chat', promptId: queued.id }),
    { cancelled: true, state: 'queued' },
  );

  await queue.backfillLegacy({ droneId: 'drone', chatName: 'chat', prompts: [queued] });

  assert.deepEqual(queue.list({ droneId: 'drone', chatName: 'chat' }), []);
  assert.equal(
    queue.get({ droneId: 'drone', chatName: 'chat', promptId: queued.id })?.state,
    'cancelled',
  );
});

test('the exact registry lock timeout is classified as transient', () => {
  assert.equal(
    looksLikeTransientPromptEnqueueError('timed out acquiring registry lock (10000ms)'),
    true,
  );
});

test('active-drone lifecycle uses the canonical queue without rewriting the registry', async () => {
  repository('active-hot-path');
  const now = '2026-07-10T09:00:00.000Z';
  const pendingChanges = [];
  const helpers = createPendingDroneStateHelpers({
    normalizeChatName: (raw) => String(raw || 'default').trim() || 'default',
    nowIso: () => now,
  });
  const store = createDronePendingPromptStore({
    normalizeChatImageAttachmentRefs: () => [],
    normalizeChatName: (raw) => String(raw || 'default').trim() || 'default',
    normalizePendingPromptState: helpers.normalizePendingPromptState,
    normalizePendingPromptText: helpers.normalizePendingPromptText,
    normalizePendingStartupPrompts: helpers.normalizePendingStartupPrompts,
    normalizePromptAutomationMeta: () => undefined,
    nowIso: () => now,
    onPendingPromptChanged: (change) => pendingChanges.push(change),
    startupPromptToPendingPrompt: helpers.startupPromptToPendingPrompt,
  });
  await saveRegistry({
    version: 2,
    drones: {
      alpha: {
        id: 'alpha',
        name: 'alpha',
        chats: { default: { createdAt: now, pendingPrompts: [], turns: [] } },
      },
    },
    pending: {},
    archived: {},
  });
  const rawBeforeEnqueue = await loadRegistryRawSnapshot();

  await store.pushPendingPrompt({
    droneId: 'alpha',
    chatName: 'default',
    pending: prompt('canonical', now),
  });
  await store.pushPendingPrompt({
    droneId: 'alpha',
    chatName: 'default',
    pending: { ...prompt('failed-canonical', now), state: 'failed', error: 'delivery failed' },
  });
  await upsertChatInStore({
    droneId: 'alpha',
    chatName: 'default',
    chatEntry: { createdAt: now, turns: [], pendingPrompts: [] },
  });
  await getHubDatabase().writeTransaction(
    'test remove compatibility backfill marker',
    (connection) => {
      connection
        .prepare("DELETE FROM hub_drone_lifecycle_backfill WHERE id = 'legacy-registry'")
        .run();
    },
  );
  const canonicalCounts = () =>
    getHubDatabase().read((connection) => ({
      backfillMarkers: connection
        .prepare('SELECT COUNT(*) AS count FROM hub_drone_lifecycle_backfill')
        .get().count,
      lifecycle: connection.prepare('SELECT COUNT(*) AS count FROM hub_canonical_drones').get()
        .count,
      pendingLifecycle: connection
        .prepare('SELECT COUNT(*) AS count FROM hub_canonical_pending_drones')
        .get().count,
      chats: connection.prepare('SELECT COUNT(*) AS count FROM canonical_chats').get().count,
      prompts: connection.prepare('SELECT COUNT(*) AS count FROM prompts').get().count,
    }));
  const beforePendingRead = canonicalCounts();
  assert.deepEqual(
    await loadRegistryRawSnapshot(),
    rawBeforeEnqueue,
    'enqueue must not mirror into registry_json',
  );
  assert.deepEqual(
    (await store.readPendingPrompts({ droneId: 'alpha', chatName: 'default' })).map((item) => ({
      id: item.id,
      state: item.state,
      error: item.error,
    })),
    [
      { id: 'canonical', state: 'queued', error: undefined },
      { id: 'failed-canonical', state: 'failed', error: 'delivery failed' },
    ],
  );
  assert.deepEqual(
    canonicalCounts(),
    beforePendingRead,
    'pending reads must not project or backfill compatibility state',
  );
  assert.equal(canonicalCounts().backfillMarkers, 0);
  await (
    await getDroneLifecycleRepository()
  ).upsert('pending', 'starting-alpha', {
    id: 'starting-alpha',
    name: 'starting-alpha',
    startupQueuedPrompts: [
      {
        id: 'startup-canonical',
        chatName: 'default',
        at: now,
        prompt: 'start canonically',
        state: 'queued',
      },
    ],
  });
  const beforeStartupRead = canonicalCounts();
  assert.deepEqual(
    (await store.readPendingStartupPrompts({ droneId: 'starting-alpha', chatName: 'default' })).map(
      (item) => item.id,
    ),
    ['startup-canonical'],
  );
  assert.deepEqual(
    canonicalCounts(),
    beforeStartupRead,
    'startup pending reads must remain read-only',
  );
  assert.equal(
    await store.claimQueuedPendingPromptForSending({
      droneId: 'alpha',
      chatName: 'default',
      id: 'canonical',
    }),
    true,
  );
  await store.updatePendingPrompt({
    droneId: 'alpha',
    chatName: 'default',
    id: 'canonical',
    patch: {
      state: 'sent',
      updatedAt: now,
      agentPlan: {
        source: 'codex',
        updatedAt: now,
        items: [
          { text: 'Inspect code', status: 'completed' },
          { text: 'Run tests', status: 'in_progress' },
        ],
      },
    },
  });
  assert.deepEqual(pendingChanges.at(-1), { droneId: 'alpha', chatName: 'default' });
  assert.equal(
    (await store.readPendingPrompts({ droneId: 'alpha', chatName: 'default' }))[0].state,
    'sent',
  );
  assert.deepEqual(
    (
      await store.readPendingPrompts({ droneId: 'alpha', chatName: 'default' })
    )[0].agentPlan.items.map((item) => item.status),
    ['completed', 'in_progress'],
  );
  assert.deepEqual(await loadRegistryRawSnapshot(), rawBeforeEnqueue);
  resetTranscriptStoreForTests();
});
