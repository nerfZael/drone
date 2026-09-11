import { Database } from 'bun:sqlite';
import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { COMPANION_SUBSCRIPTION_TOOL_NAMES, DEFAULT_COMPANION_SETTINGS } from '../src/hub/companion/companion-config';
import { HubRouter } from '../src/hub/hub-router';
import { registerResourceSubscriptionRoutes } from '../src/hub/routes/resource-subscription-routes';
import { withTempDroneDataDir } from './test-helpers';
import { expect, test } from 'bun:test';
import type { HubDatabase, HubDatabaseConnection } from '../src/host/hub-database';
import { ResourceSubscriptionRepository } from '../src/hub/subscriptions/resource-subscription-repository';
import {
  ResourceSubscriptionService,
  type SessionSubscriptionDelivery,
} from '../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../src/hub/subscriptions/resource-subscription-types';

const subscriber = { chatId: 'companion:session', droneId: 'companion', chatName: 'session' };
const source = { chatId: 'source-chat', droneId: 'source-drone', chatName: 'default' };

test('Companion receives persisted chat events and close cancels subscriptions without queuing drone prompts', async () => {
  const h = fixture();
  try {
    const subscription = await h.service.subscribe({ subscriber, provider: 'drone-hub', resourceType: 'chat',
      resourceId: source.chatId, events: ['chat.idle'], intent: 'Report completion' });
    h.idle = true;
    await h.service.tick();
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]).toMatchObject({ deliveryMode: 'queue' });
    expect(h.deliveries[0].prompt).toContain('Report completion');
    expect(h.service.get(subscription.subscription.id, subscriber.chatId)?.status).toBe('active');
    expect(h.db.query('SELECT COUNT(*) AS count FROM prompts').get()).toEqual({ count: 0 });
    await h.release();
    expect(h.service.get(subscription.subscription.id, subscriber.chatId)?.status).toBe('cancelled');
    h.idle = false;
    await h.service.tick();
    h.idle = true;
    await h.service.tick();
    expect(h.deliveries).toHaveLength(1);
  } finally { await h.close(); }
});

test('Companion custom subscriptions use current source access for history and delivery, plus Hub run limits', async () => {
  const h = fixture();
  try {
    await h.service.subscribeToCustomEvents({ subscriber, name: 'deploy', intent: 'Report deploys' });
    await h.service.emitCustomEvent({ source, name: 'deploy', data: { version: 1 } });
    await h.service.tick();
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0].deliveryMode).toBe('asap');
    expect((await h.service.getCustomEventHistory({ reader: subscriber, name: 'deploy' })).events).toHaveLength(1);
    h.readable = [];
    await h.service.emitCustomEvent({ source, name: 'deploy', data: { version: 2 } });
    await h.service.tick();
    expect(h.deliveries).toHaveLength(1);
    expect((await h.service.getCustomEventHistory({ reader: subscriber, name: 'deploy' })).events).toHaveLength(0);
    h.readable = [source.droneId];
    // Make retries immediately eligible and impose a one-run hourly limit.
    h.db.exec("UPDATE subscription_deliveries SET next_attempt_at = '2000-01-01T00:00:00.000Z'");
    h.settings.maxAutomatedRunsPerConversationPerHour = 1;
    await h.service.tick();
    expect(h.deliveries).toHaveLength(1);
    h.db.exec("UPDATE subscription_batches SET created_at = '2000-01-01T00:00:00.000Z'");
    await h.service.tick();
    expect(h.deliveries).toHaveLength(2);
    await h.release();
    await expect(h.service.getCustomEventHistory({ reader: subscriber, name: 'deploy' })).rejects.toThrow('existing');
  } finally { await h.close(); }
});

test('Companion cron subscriptions stop on close and orphaned sessions are cancelled after restart', async () => {
  const h = fixture();
  try {
    const result = await h.service.subscribeToCron({ subscriber, expression: '* * * * *', timeZone: 'UTC', intent: 'Check status' });
    h.db.exec("UPDATE resource_subscriptions SET next_event_at = '2026-01-01T00:00:00.000Z'");
    await h.service.tick();
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0].prompt).toContain('Check status');
    const restarted = new ResourceSubscriptionService(h.dependencies);
    await restarted.tick();
    expect(restarted.get(result.subscription.id, subscriber.chatId)?.status).toBe('cancelled');
    expect(h.errors).toEqual([]);
    await restarted.stop();
  } finally { await h.close(); }
});

test('Companion runtime exposes working MCP subscriptions scoped to its own session', async () => {
  await withTempDroneDataDir('companion-subscription-mcp-', async () => {
    const h = fixture();
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.DRONE_HUB_BASE_URL;
    const previousToken = process.env.DRONE_TOKEN;
    process.env.DRONE_HUB_BASE_URL = 'http://companion-events.test';
    process.env.DRONE_TOKEN = 'test';
    const router = new HubRouter(
      (res, status, body) => { (res as any).response = Response.json(body, { status }); },
      async (req) => JSON.parse((req as any).body ?? '{}'),
    );
    registerResourceSubscriptionRoutes(router, h.service);
    globalThis.fetch = (async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      const response: any = {};
      expect(await router.handle({ method: init?.method ?? 'GET', body: init?.body } as any, response, url)).toBe(true);
      return response.response;
    }) as typeof fetch;
    const runtime = new CompanionRuntime({
      hubServices: {} as any,
      resourceSubscriptions: () => h.service,
      buildDroneSummaries: () => h.readable.map((id) => ({ id, name: id, chats: ['default'] })) as any,
    });
    const configurations: any[] = [];
    const toolsFor = async (runId: string) => {
      runtime.connectSubscriptions(runId, async (delivery) => { h.deliveries.push(delivery); });
      (runtime as any).contexts.set(`companion:${runId}`, {
        runId, settings: { ...DEFAULT_COMPANION_SETTINGS, enabledTools: [...COMPANION_SUBSCRIPTION_TOOL_NAMES] },
      });
      const config = await (runtime as any).configuration(`companion:${runId}`);
      configurations.push(config);
      const tools = await config.toolProviders[0].load({ session: { id: runId } });
      expect(tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining([...COMPANION_SUBSCRIPTION_TOOL_NAMES]));
      expect(tools.some((tool: any) => tool.name === 'emit_custom_event')).toBe(false);
      return async (name: string, args: unknown = {}) => (await tools.find((tool: any) => tool.name === name).execute('call', args)).details;
    };
    try {
      const call = await toolsFor('mcp-session');
      const otherCall = await toolsFor('other-session');
      const created = await call('subscribe_to_custom_events', { name: 'release', intent: 'Report releases' });
      expect(created.subscription.subscriber).toBeUndefined();
      const subscriptionId = created.subscription.id;
      expect((await call('list_resource_subscriptions')).subscriptions).toHaveLength(1);
      expect((await otherCall('list_resource_subscriptions')).subscriptions).toHaveLength(0);
      await expect(otherCall('cancel_resource_subscription', { subscriptionId })).rejects.toThrow('not found');
      await call('update_resource_subscription', { subscriptionId, intent: 'Summarize releases' });
      await h.service.emitCustomEvent({ source, name: 'release', data: { version: 3 } });
      expect((await call('get_custom_event_history', { name: 'release' })).events).toHaveLength(1);
      await h.service.tick();
      expect(h.deliveries).toHaveLength(1);
      expect(h.deliveries[0].prompt).toContain('Summarize releases');
      expect((await call('get_resource_subscription', { subscriptionId })).subscription.status).toBe('active');
      await call('cancel_resource_subscription', { subscriptionId });
      expect((await call('list_resource_subscriptions')).subscriptions).toHaveLength(0);
      await call('subscribe_to_cron', { expression: '* * * * *', timeZone: 'UTC', intent: 'Remind me' });
      await runtime.deleteSession('mcp-session');
      expect(h.service.list('companion:mcp-session')).toHaveLength(0);
    } finally {
      for (const config of configurations) await config.dispose();
      await runtime.close();
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previousUrl;
      if (previousToken === undefined) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previousToken;
      await h.close();
    }
  });
});

function fixture() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const connection = db as unknown as HubDatabaseConnection;
  const database = {
    read: (operation: (db: HubDatabaseConnection) => unknown) => operation(connection),
    writeTransaction: async (_label: string, operation: (db: HubDatabaseConnection) => unknown) =>
      db.transaction(() => operation(connection)).immediate(),
  } as HubDatabase;
  const repository = new ResourceSubscriptionRepository(database);
  db.exec('CREATE TABLE canonical_chats (drone_id TEXT, chat_name TEXT, metadata_json TEXT)');
  db.prepare('INSERT INTO canonical_chats VALUES (?, ?, ?)').run(source.droneId, source.chatName, JSON.stringify({ id: source.chatId }));
  const deliveries: SessionSubscriptionDelivery[] = [];
  const errors: string[] = [];
  const settings = { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0,
    eventDeliveryModes: { 'custom.emitted': 'asap' as const } };
  const state = { idle: false, readable: [source.droneId] };
  const dependencies = {
    repository,
    readChatStatus: async () => ({ idle: state.idle, reason: 'test', latest: null }),
    readSettings: async () => settings,
    authorizeDelivery: async () => false,
    wakePromptQueue: () => { throw new Error('Companion must not enqueue a drone prompt'); },
    log: (_level: string, message: string) => { if (message.includes('failed')) errors.push(message); },
  };
  const service = new ResourceSubscriptionService(dependencies);
  const release = service.registerSessionSubscriber({ subscriber, readDroneIds: async () => state.readable,
    deliver: async (delivery) => { deliveries.push(delivery); } });
  return Object.assign(state, { db, service, deliveries, errors, settings, dependencies, release,
    close: async () => { await release(); await service.stop(); db.close(); } });
}
