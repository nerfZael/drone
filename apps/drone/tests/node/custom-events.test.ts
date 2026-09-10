import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customEventData,
  normalizeCustomEventName,
} from '../../src/hub/subscriptions/custom-events';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { ResourceSubscriptionService } from '../../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';
import { memoryHubDatabase } from './helpers/memory-hub-database';

const source = { chatId: 'chat-a', droneId: 'drone-a', chatName: 'default' };
const other = { chatId: 'chat-b', droneId: 'drone-b', chatName: 'default' };
const subscriber = { chatId: 'chat-c', droneId: 'drone-c', chatName: 'audit' };
const settings = { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 };
function fixture() {
  const store = memoryHubDatabase();
  const repository = new ResourceSubscriptionRepository(store.database);
  store.database.read((db) => {
    db.exec('CREATE TABLE canonical_chats (drone_id TEXT, chat_name TEXT, metadata_json TEXT)');
    for (const chat of [source, other, subscriber]) {
      db.prepare('INSERT INTO canonical_chats VALUES (?, ?, ?)').run(
        chat.droneId,
        chat.chatName,
        JSON.stringify({ id: chat.chatId }),
      );
    }
  });
  const service = new ResourceSubscriptionService({
    repository,
    readCustomEventHistorySourceIds: async () => [
      source.droneId,
      other.droneId,
      subscriber.droneId,
    ],
    readChatStatus: async () => {
      throw new Error('custom events must not poll chat state');
    },
    readSettings: async () => settings,
    wakePromptQueue: () => {},
    log: () => {},
  });
  return { ...store, repository, service };
}

test('normalizes spoken names, camelCase, acronyms and Unicode without equating synonyms', () => {
  for (const name of [
    ' Production Deployed! ',
    'production-deployed',
    'production.deployed',
    'productionDeployed',
    'PRODUCTION_DEPLOYED',
  ]) {
    assert.equal(normalizeCustomEventName(name), 'production_deployed');
  }
  assert.equal(normalizeCustomEventName('HTTPServerReady'), 'http_server_ready');
  assert.equal(normalizeCustomEventName(' Promjena završena '), 'promjena_završena');
  assert.notEqual(
    normalizeCustomEventName('production changed'),
    normalizeCustomEventName('production deployed'),
  );
  for (const invalid of ['', '!!!', '123', 'a'.repeat(129), null, {}]) {
    assert.throws(() => normalizeCustomEventName(invalid), /custom event name/);
  }
  assert.throws(() => customEventData([]), /JSON object/);
  assert.throws(() => customEventData({ text: 'a'.repeat(16_000) }), /16000 bytes/);
});

test('subscriptions create the catalog before emission and survive repository recreation', async () => {
  const { service, repository, database, close } = fixture();
  try {
    const result = await service.subscribeToCustomEvents({
      subscriber,
      name: 'Production Deployed',
      description: 'A successful production release',
      intent: 'Audit the deployment',
    });
    assert.equal(result.name, 'production_deployed');
    assert.equal(result.subscription.resourceType, 'custom_event');
    assert.equal(result.subscription.resourceLabel, 'production_deployed');
    assert.equal(
      service.listCustomEvents({ query: 'production-deployed' }).events[0]!.lastEmittedAt,
      null,
    );
    assert.equal(service.listCustomEvents({ query: 'successful release' }).events.length, 1);
    assert.equal(service.listCustomEvents({ query: 'productionDeployed' }).events.length, 1);
    assert.equal(service.listCustomEvents({ query: 'unrelated' }).events.length, 0);
    const recreated = new ResourceSubscriptionRepository(database);
    assert.equal(recreated.listCustomEvents({ limit: 50 })[0]!.name, 'production_deployed');
    assert.equal(
      recreated.get(result.subscription.id, subscriber.chatId)!.intent,
      'Audit the deployment',
    );
    const repeated = await service.subscribeToCustomEvents({
      subscriber,
      name: 'production-deployed',
      description: 'Replacement',
      intent: 'Audit again',
    });
    assert.equal(repeated.created, false);
    assert.equal(repeated.subscription.id, result.subscription.id);
    assert.equal(repository.list(subscriber.chatId).length, 1);
    assert.equal(
      service.listCustomEvents({}).events[0]!.description,
      'A successful production release',
    );
  } finally {
    close();
  }
});

test('emissions without subscribers are recorded but not replayed to later subscriptions', async () => {
  const { service, repository, close } = fixture();
  try {
    const first = await service.emitCustomEvent({ source, name: 'release', data: { version: 1 } });
    assert.equal(first.emitted, true);
    assert.ok(service.listCustomEvents({}).events[0]!.lastEmittedAt);
    await service.subscribeToCustomEvents({ subscriber, name: 'release' });
    assert.equal(await repository.claimBatch(settings), null);
    const second = await service.emitCustomEvent({ source, name: 'release', data: { version: 2 } });
    const batch = await repository.claimBatch(settings, new Date(Date.now() + 1000));
    assert.equal(batch!.items.length, 1);
    assert.equal(batch!.items[0]!.event.id, second.eventId);
    assert.deepEqual(batch!.items[0]!.event.providerContent, {
      name: 'release',
      eventId: second.eventId,
      source,
      data: { version: 2 },
    });
  } finally {
    close();
  }
});

test('retries deduplicate per source chat and canonical name and reject changed data', async () => {
  const { service, repository, close } = fixture();
  try {
    await service.subscribeToCustomEvents({ subscriber, name: 'Production Deployed' });
    const [first, retried] = await Promise.all([
      service.emitCustomEvent({
        source,
        name: 'Production Deployed',
        idempotencyKey: 'deploy-1',
        data: { version: 1, commit: 'abc' },
      }),
      service.emitCustomEvent({
        source,
        name: 'productionDeployed',
        idempotencyKey: 'deploy-1',
        data: { commit: 'abc', version: 1 },
      }),
    ]);
    assert.equal(first.emitted, true);
    assert.equal(retried.emitted, false);
    assert.equal(first.eventId, retried.eventId);
    assert.equal(first.occurredAt, retried.occurredAt);
    await assert.rejects(
      service.emitCustomEvent({
        source,
        name: 'production deployed',
        idempotencyKey: 'deploy-1',
        data: { version: 2 },
      }),
      /different custom event data/,
    );
    const secondSource = await service.emitCustomEvent({
      source: other,
      name: 'production deployed',
      idempotencyKey: 'deploy-1',
      data: { version: 1 },
    });
    assert.notEqual(secondSource.eventId, first.eventId);
    const batch = await repository.claimBatch(settings, new Date(Date.now() + 1000));
    assert.equal(batch!.items.length, 2);
  } finally {
    close();
  }
});

test('source filters select events and existing subscription controls work', async () => {
  const { service, repository, close } = fixture();
  try {
    const sub = await service.subscribeToCustomEvents({
      subscriber,
      name: 'release',
      sourceDroneId: source.droneId,
      sourceChatId: source.chatId,
      intent: 'Audit',
    });
    await service.emitCustomEvent({ source: other, name: 'release' });
    await service.emitCustomEvent({ source, name: 'release' });
    const batch = await repository.claimBatch(settings, new Date(Date.now() + 1000));
    assert.equal(batch!.items.length, 1);
    assert.equal(
      (batch!.items[0]!.event.providerContent.source as typeof source).chatId,
      source.chatId,
    );
    assert.equal(
      (await service.update({
        id: sub.subscription.id,
        subscriberChatId: subscriber.chatId,
        intent: 'Audit again',
        events: ['custom.emitted'],
      }))!.intent,
      'Audit again',
    );
    assert.equal(
      await service.update({
        id: sub.subscription.id,
        subscriberChatId: source.chatId,
        intent: 'Hijack',
      }),
      null,
    );
    await assert.rejects(
      service.update({
        id: sub.subscription.id,
        subscriberChatId: subscriber.chatId,
        events: ['chat.idle'],
      }),
      /supported event|unsupported/,
    );
    await service.cancel(sub.subscription.id, subscriber.chatId);
    assert.equal(service.list(subscriber.chatId).length, 0);
    assert.equal(service.list(subscriber.chatId, true)[0]!.status, 'cancelled');
    assert.equal(service.listCustomEvents({}).events.length, 1);
  } finally {
    close();
  }
});

test('archive and restore retains custom subscriptions without polling event names as chats', async () => {
  const { service, repository, close } = fixture();
  try {
    const sub = await service.subscribeToCustomEvents({ subscriber, name: 'release' });
    await service.pauseForDrone(subscriber.droneId, [subscriber.chatId]);
    assert.equal(repository.get(sub.subscription.id)!.status, 'paused');
    await service.emitCustomEvent({ source, name: 'release' });
    await service.resumeForDrone(subscriber.droneId, [subscriber.chatId]);
    assert.equal(repository.get(sub.subscription.id)!.status, 'active');
    assert.equal(await repository.claimBatch(settings), null);
    await service.emitCustomEvent({ source, name: 'release' });
    assert.equal(
      (await repository.claimBatch(settings, new Date(Date.now() + 1000)))!.items.length,
      1,
    );
  } finally {
    close();
  }
});

test('invalid requests and failed transactions leave no catalog or event debris', async () => {
  const { service, database, close } = fixture();
  try {
    await assert.rejects(
      service.emitCustomEvent({ source: { ...source, droneId: other.droneId }, name: 'spoof' }),
      /conversation identity/,
    );
    await assert.rejects(
      service.subscribeToCustomEvents({
        subscriber,
        name: 'invalid filter',
        sourceDroneId: other.droneId,
        sourceChatId: source.chatId,
      }),
      /does not belong/,
    );
    await assert.rejects(
      service.emitCustomEvent({ source, name: 'large data', data: { value: 'x'.repeat(16_001) } }),
      /16000 bytes/,
    );
    await assert.rejects(
      service.emitCustomEvent({ source, name: 'invalid key', idempotencyKey: ' ' }),
      /idempotencyKey/,
    );
    database.read((db) =>
      db.exec(
        "CREATE TRIGGER fail_emit BEFORE INSERT ON resource_events BEGIN SELECT RAISE(ABORT, 'insert failed'); END",
      ),
    );
    await assert.rejects(service.emitCustomEvent({ source, name: 'failed emit' }), /insert failed/);
    assert.equal(service.listCustomEvents({}).events.length, 0);
  } finally {
    close();
  }
});

test('catalog supports pagination and fills an initially empty description', async () => {
  const { service, close } = fixture();
  try {
    for (const name of ['zeta', 'alpha', 'beta'])
      await service.subscribeToCustomEvents({ subscriber, name });
    await service.emitCustomEvent({ source, name: 'alpha', description: 'First release' });
    const first = service.listCustomEvents({ limit: 2 });
    assert.deepEqual(
      first.events.map((event) => event.name),
      ['alpha', 'beta'],
    );
    assert.equal(first.nextCursor, 'beta');
    const second = service.listCustomEvents({ limit: 2, after: first.nextCursor! });
    assert.deepEqual(
      second.events.map((event) => event.name),
      ['zeta'],
    );
    assert.equal(second.nextCursor, null);
    assert.equal(
      service.listCustomEvents({ query: 'first' }).events[0]!.description,
      'First release',
    );
    assert.throws(() => service.listCustomEvents({ limit: 0 }), /limit/);
  } finally {
    close();
  }
});

test('subscription limit failures roll back catalog registration', async () => {
  const { service, close } = fixture();
  try {
    for (let i = 0; i < settings.maxActiveSubscriptionsPerConversation; i++) {
      await service.subscribeToCustomEvents({ subscriber, name: `event ${i}` });
    }
    await assert.rejects(
      service.subscribeToCustomEvents({ subscriber, name: 'one too many' }),
      /subscription limit/,
    );
    assert.equal(service.listCustomEvents({ query: 'one too many' }).events.length, 0);
  } finally {
    close();
  }
});

test('catalog description search handles Unicode case and normalization', async () => {
  const { service, close } = fixture();
  try {
    await service.subscribeToCustomEvents({
      subscriber,
      name: 'release',
      description: 'ŽUTA VERZIJA CAFÉ',
    });
    assert.equal(service.listCustomEvents({ query: 'žuta cafe\u0301' }).events.length, 1);
  } finally {
    close();
  }
});

test('emission limit permits idempotent retries and rejects new events atomically', async () => {
  const { service, close } = fixture();
  try {
    const first = await service.emitCustomEvent({
      source,
      name: 'release',
      idempotencyKey: 'original',
    });
    for (let i = 1; i < 1000; i++) await service.emitCustomEvent({ source, name: 'release' });
    await assert.rejects(service.emitCustomEvent({ source, name: 'over limit' }), /emission limit/);
    assert.equal(service.listCustomEvents({ query: 'over limit' }).events.length, 0);
    const retry = await service.emitCustomEvent({
      source,
      name: 'release',
      idempotencyKey: 'original',
    });
    assert.equal(retry.eventId, first.eventId);
    assert.equal(retry.emitted, false);
    assert.equal((await service.emitCustomEvent({ source: other, name: 'release' })).emitted, true);
  } finally {
    close();
  }
});

test('history reads pre-subscription emissions without creating subscriptions or deliveries', async () => {
  const { service, repository, close } = fixture();
  try {
    const first = await service.emitCustomEvent({
      source,
      name: 'Release Ready',
      data: { version: 1 },
    });
    const history = await service.getCustomEventHistory({
      reader: subscriber,
      name: 'releaseReady',
    });
    assert.deepEqual(history.events, [
      {
        eventId: first.eventId,
        name: 'release_ready',
        occurredAt: first.occurredAt,
        source,
        data: { version: 1 },
      },
    ]);
    assert.equal(history.retentionDays, 30);
    assert.equal(history.nextCursor, null);
    assert.deepEqual(repository.list(subscriber.chatId), []);
    assert.equal(await repository.claimBatch(settings), null);
    await service.subscribeToCustomEvents({ subscriber, name: 'release ready' });
    assert.equal(await repository.claimBatch(settings), null);
    assert.equal(
      (await service.getCustomEventHistory({ reader: subscriber, name: 'release ready' })).events
        .length,
      1,
    );
    assert.equal(await repository.claimBatch(settings), null);
    const second = await service.emitCustomEvent({ source, name: 'release ready' });
    const batch = await repository.claimBatch(settings, new Date(Date.now() + 1000));
    assert.deepEqual(
      batch!.items.map((item) => item.event.id),
      [second.eventId],
    );
  } finally {
    close();
  }
});

test('history paginates timestamp ties, filters sources and times, and validates cursors', async () => {
  const { service, database, close } = fixture();
  try {
    const time = '2026-09-01T12:00:00.000Z';
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await service.emitCustomEvent({ source, name: 'release', data: { i } })).eventId);
    }
    await service.emitCustomEvent({ source: other, name: 'release' });
    await service.emitCustomEvent({ source, name: 'unrelated' });
    database.read((db) => db.prepare('UPDATE resource_events SET occurred_at = ?').run(time));
    const input = {
      reader: subscriber,
      name: 'release',
      sourceDroneId: source.droneId,
      sourceChatId: source.chatId,
      since: time,
      until: time,
      limit: 2,
    };
    const first = await service.getCustomEventHistory(input);
    const second = await service.getCustomEventHistory({ ...input, after: first.nextCursor! });
    assert.deepEqual(
      [...first.events, ...second.events].map((event) => event.eventId),
      ids.sort().reverse(),
    );
    assert.equal(second.nextCursor, null);
    assert.equal(
      (
        await service.getCustomEventHistory({
          reader: subscriber,
          name: 'release',
          since: '2026-09-01T12:00:01Z',
        })
      ).events.length,
      0,
    );
    assert.equal(
      (
        await service.getCustomEventHistory({
          reader: subscriber,
          name: 'release',
          until: '2026-09-01T11:59:59Z',
        })
      ).events.length,
      0,
    );
    assert.equal(
      (await service.getCustomEventHistory({ ...input, readDroneIds: [] })).events.length,
      0,
    );
    for (const invalid of [
      { after: 'broken' },
      { after: Buffer.from('{}').toString('base64url') },
      { since: 'yesterday' },
      { since: '2026-09-01T12:00:00' },
      { since: '2026-09-02T00:00:00Z' },
      { limit: 0 },
      { limit: 101 },
      { name: 'unrelated', after: first.nextCursor! },
      { sourceChatId: other.chatId, after: first.nextCursor! },
    ])
      await assert.rejects(service.getCustomEventHistory({ ...input, ...invalid }));
    await assert.rejects(
      service.getCustomEventHistory({
        ...input,
        reader: { ...subscriber, droneId: source.droneId },
      }),
      /conversation identity/,
    );
    assert.equal(
      (await service.getCustomEventHistory({ reader: subscriber, name: 'unknown' })).events.length,
      0,
    );
  } finally {
    close();
  }
});

test('history respects retention cleanup while the catalog survives', async () => {
  const { service, repository, database, close } = fixture();
  try {
    await service.emitCustomEvent({ source, name: 'old release' });
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    database.read((db) =>
      db.prepare('UPDATE resource_events SET created_at = ?, occurred_at = ?').run(old, old),
    );
    assert.equal(
      (await service.getCustomEventHistory({ reader: subscriber, name: 'old release' })).events
        .length,
      1,
    );
    await repository.cleanup(settings);
    assert.equal(
      (await service.getCustomEventHistory({ reader: subscriber, name: 'old release' })).events
        .length,
      0,
    );
    assert.equal(service.listCustomEvents({}).events.length, 1);
  } finally {
    close();
  }
});
