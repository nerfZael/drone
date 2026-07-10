const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  getHubDatabase,
  resetHubDatabaseForTests,
} = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const {
  appendHubOutboxEvent,
  HubOutboxDispatcher,
  HubOutboxRepository,
} = require('../../dist/host/hub-outbox.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const roots = [];

function useRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-outbox-${label}-`));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();
  return root;
}

function repository(label) {
  useRoot(label);
  return new HubOutboxRepository();
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('an outbox event commits and rolls back with its domain transaction', async () => {
  const outbox = repository('transaction');
  const database = getHubDatabase();
  assert.ok(database);

  await assert.rejects(
    database.writeTransaction('failing domain change', (connection) => {
      appendHubOutboxEvent(connection, {
        topic: 'fleet',
        eventType: 'drone.created',
        aggregateType: 'drone',
        aggregateId: 'alpha',
        payload: { name: 'Alpha' },
      });
      throw new Error('domain write failed');
    }),
    /domain write failed/,
  );
  assert.deepEqual(outbox.list(), []);

  await database.writeTransaction('successful domain change', (connection) => {
    appendHubOutboxEvent(connection, {
      topic: 'fleet',
      eventType: 'drone.created',
      aggregateType: 'drone',
      aggregateId: 'alpha',
      payload: { name: 'Alpha' },
    });
  });
  assert.equal(outbox.list().length, 1);
});

test('deduplication keys make repeated appends idempotent', async () => {
  const outbox = repository('dedupe');
  const first = await outbox.enqueue({
    topic: 'chat',
    eventType: 'chat.updated',
    payload: { version: 1 },
    deduplicationKey: 'chat:alpha:default:1',
  });
  const duplicate = await outbox.enqueue({
    topic: 'chat',
    eventType: 'chat.updated',
    payload: { version: 2 },
    deduplicationKey: 'chat:alpha:default:1',
  });
  assert.equal(duplicate.id, first.id);
  assert.deepEqual(duplicate.payload, { version: 1 });
  assert.equal(outbox.list().length, 1);
});

test('claims are FIFO, topic-filtered, and exclusive across consumers', async () => {
  const outbox = repository('claim');
  await outbox.enqueue({ topic: 'fleet', eventType: 'one' });
  await outbox.enqueue({ topic: 'chat', eventType: 'two' });
  await outbox.enqueue({ topic: 'fleet', eventType: 'three' });

  const [consumerA, consumerB] = await Promise.all([
    outbox.claim({ leaseOwner: 'consumer-a', limit: 10, topics: ['fleet'] }),
    outbox.claim({ leaseOwner: 'consumer-b', limit: 10, topics: ['fleet'] }),
  ]);
  assert.deepEqual(
    [...consumerA, ...consumerB].map((event) => event.eventType).sort(),
    ['one', 'three'],
  );
  assert.equal(consumerA.length === 0 || consumerB.length === 0, true);
  const chat = await outbox.claim({ leaseOwner: 'chat-consumer', topics: ['chat'] });
  assert.deepEqual(chat.map((event) => event.eventType), ['two']);
});

test('expired leases recover and stale owners cannot acknowledge', async () => {
  const outbox = repository('lease');
  const event = await outbox.enqueue({
    topic: 'fleet',
    eventType: 'drone.updated',
    availableAt: '2026-07-10T09:00:00.000Z',
  });
  const first = await outbox.claim({
    leaseOwner: 'dead-worker',
    leaseMs: 1_000,
    now: '2026-07-10T09:00:00.000Z',
  });
  assert.equal(first[0].attemptCount, 1);
  const recovered = await outbox.claim({
    leaseOwner: 'live-worker',
    now: '2026-07-10T09:00:02.000Z',
  });
  assert.equal(recovered[0].id, event.id);
  assert.equal(recovered[0].attemptCount, 2);
  assert.equal(
    await outbox.acknowledge({ id: event.id, leaseOwner: 'dead-worker' }),
    false,
  );
  assert.equal(
    await outbox.acknowledge({ id: event.id, leaseOwner: 'live-worker' }),
    true,
  );
  assert.equal(outbox.get(event.id).status, 'delivered');
});

test('failures back off and eventually dead-letter poison events', async () => {
  const outbox = repository('retry');
  const event = await outbox.enqueue({
    topic: 'background',
    eventType: 'projection.refresh',
    availableAt: '2026-07-10T09:00:00.000Z',
  });
  await outbox.claim({ leaseOwner: 'worker', now: '2026-07-10T09:00:00.000Z' });
  assert.equal(
    await outbox.fail({
      id: event.id,
      leaseOwner: 'worker',
      error: new Error('temporary'),
      maxAttempts: 2,
      baseDelayMs: 2_000,
      now: '2026-07-10T09:00:00.000Z',
    }),
    'retry',
  );
  assert.equal(
    (await outbox.claim({ leaseOwner: 'worker', now: '2026-07-10T09:00:01.999Z' })).length,
    0,
  );
  await outbox.claim({ leaseOwner: 'worker', now: '2026-07-10T09:00:02.000Z' });
  assert.equal(
    await outbox.fail({
      id: event.id,
      leaseOwner: 'worker',
      error: 'permanent',
      maxAttempts: 2,
      now: '2026-07-10T09:00:02.000Z',
    }),
    'dead-letter',
  );
  assert.equal(outbox.get(event.id).status, 'dead-letter');
  assert.equal(outbox.get(event.id).lastError, 'permanent');
});

test('the dispatcher performs effects after claim transactions and persists delivery', async () => {
  const outbox = repository('dispatcher');
  await outbox.enqueue({ topic: 'fleet', eventType: 'drone.updated', payload: { id: 'alpha' } });
  const handled = [];
  const dispatcher = new HubOutboxDispatcher(
    outbox,
    async (event) => {
      handled.push(event.eventType);
      // This nested write would deadlock if the handler ran inside the claim transaction.
      await outbox.enqueue({ topic: 'audit', eventType: 'effect.observed' });
    },
    'dispatcher',
  );
  assert.deepEqual(await dispatcher.drainOnce({ topics: ['fleet'] }), {
    claimed: 1,
    delivered: 1,
    failed: 0,
    deadLettered: 0,
  });
  assert.deepEqual(handled, ['drone.updated']);
  assert.equal(outbox.list({ status: 'delivered' }).length, 1);
  assert.equal(outbox.list({ status: 'pending' }).length, 1);
});

test('repositories follow data-directory switches', async () => {
  const firstRoot = useRoot('switch-a');
  const first = new HubOutboxRepository();
  await first.enqueue({ topic: 'fleet', eventType: 'first' });
  assert.equal(first.list().length, 1);

  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-outbox-switch-b-'));
  roots.push(secondRoot);
  process.env.DRONE_DATA_DIR = path.join(secondRoot, 'data');
  resetDroneRootDirForTests();
  const second = new HubOutboxRepository();
  assert.deepEqual(second.list(), []);
  await second.enqueue({ topic: 'fleet', eventType: 'second' });
  assert.equal(second.list().length, 1);

  process.env.DRONE_DATA_DIR = path.join(firstRoot, 'data');
  resetDroneRootDirForTests();
  const reopened = new HubOutboxRepository();
  assert.deepEqual(reopened.list().map((event) => event.eventType), ['first']);
});

