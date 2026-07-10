const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  getPromptQueueRepository,
  resetPromptQueueRepositoryForTests,
} = require('../../dist/host/prompt-queue-repository.js');
const { looksLikeTransientPromptEnqueueError } = require('../../dist/hub/pendingPromptEnqueue.js');
const { createDronePendingPromptStore } = require('../../dist/hub/drone-pending-prompts.js');
const { createPendingDroneStateHelpers } = require('../../dist/hub/drone-pending-state.js');
const { resetTranscriptStoreForTests } = require('../../dist/hub/transcript-store.js');
const { loadRegistryRawSnapshot, updateRegistry } = require('../../dist/host/registry.js');

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
    startupPromptToPendingPrompt: helpers.startupPromptToPendingPrompt,
  });
  await updateRegistry((registry) => {
    registry.drones = {
      alpha: {
        id: 'alpha',
        name: 'alpha',
        chats: { default: { createdAt: now, pendingPrompts: [], turns: [] } },
      },
    };
  });
  const rawBeforeEnqueue = await loadRegistryRawSnapshot();

  await store.pushPendingPrompt({
    droneId: 'alpha',
    chatName: 'default',
    pending: prompt('canonical', now),
  });
  assert.deepEqual(await loadRegistryRawSnapshot(), rawBeforeEnqueue, 'enqueue must not mirror into registry_json');
  assert.deepEqual(
    (await store.readPendingPrompts({ droneId: 'alpha', chatName: 'default' })).map((item) => ({
      id: item.id,
      state: item.state,
    })),
    [{ id: 'canonical', state: 'queued' }],
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
    patch: { state: 'sent', updatedAt: now },
  });
  assert.equal(
    (await store.readPendingPrompts({ droneId: 'alpha', chatName: 'default' }))[0].state,
    'sent',
  );
  assert.deepEqual(await loadRegistryRawSnapshot(), rawBeforeEnqueue);
  resetTranscriptStoreForTests();
});
