import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getHubDatabase, closeHubDatabase } from '../../src/host/hub-database';
import { getPromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { createInProcessDroneHubMcpClient } from '../../src/hub/assistant/in-process-drone-hub-mcp';
import { HubRouter } from '../../src/hub/hub-router';
import { normalizeMcpChatAccessScope } from '../../src/hub/mcp-chat-access';
import { registerResourceSubscriptionRoutes } from '../../src/hub/routes/resource-subscription-routes';
import { createResourceSubscriptionDeliveryAuthorizer } from '../../src/hub/subscriptions/create-resource-subscription-delivery-authorizer';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { ResourceSubscriptionService } from '../../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';

test('MCP custom events flow through HTTP routes and durable delivery with per-publisher authorization', async () => {
  const previous = {
    data: process.env.DRONE_DATA_DIR,
    url: process.env.DRONE_HUB_BASE_URL,
    token: process.env.DRONE_TOKEN,
    fetch: globalThis.fetch,
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-event-delivery-'));
  process.env.DRONE_DATA_DIR = directory;
  process.env.DRONE_HUB_BASE_URL = 'http://custom-events.test';
  process.env.DRONE_TOKEN = 'test-token';
  const chats = ['a', 'b', 'c'].map((letter) => ({
    chatId: `chat-${letter}`,
    droneId: `drone-${letter}`,
    chatName: 'default',
  }));
  const [source, deniedSource, subscriber] = chats;
  const clients: Array<Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>>> = [];
  let service: ResourceSubscriptionService | undefined;
  try {
    const database = getHubDatabase()!;
    const repository = new ResourceSubscriptionRepository(database);
    const queue = getPromptQueueRepository()!;
    database.read((db) => {
      db.exec('CREATE TABLE canonical_chats (drone_id TEXT, chat_name TEXT, metadata_json TEXT)');
      for (const chat of chats)
        db.prepare('INSERT INTO canonical_chats VALUES (?, ?, ?)').run(
          chat.droneId,
          chat.chatName,
          JSON.stringify({ id: chat.chatId }),
        );
    });
    const scope = normalizeMcpChatAccessScope(
      { readMode: 'selected', droneIds: [source!.droneId, subscriber!.droneId] },
      subscriber!.droneId,
    );
    const registry = {
      drones: Object.fromEntries(
        chats.map((chat) => [
          chat.droneId,
          {
            id: chat.droneId,
            name: chat.droneId,
            chats: { default: { id: chat.chatId, droneHubMcpAccessScope: scope } },
          },
        ]),
      ),
    };
    const wakes: string[] = [];
    const settings = {
      ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      batchWindowMs: 0,
      eventDeliveryModes: { 'custom.emitted': 'asap' as const },
    };
    const authorize = createResourceSubscriptionDeliveryAuthorizer({
      resolveChatResource: (id) => repository.resolveChatResource(id),
      loadRegistry: async () => registry,
    });
    service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => {
        throw new Error('custom events should not poll chats');
      },
      readSettings: async () => settings,
      authorizeDelivery: authorize,
      wakePromptQueue: (droneId) => wakes.push(droneId),
      log: () => {},
    });
    const router = new HubRouter(
      (res, status, body) => {
        (res as any).response = Response.json(body, { status });
      },
      async (req) => JSON.parse((req as any).body ?? '{}'),
    );
    registerResourceSubscriptionRoutes(router, service);
    globalThis.fetch = (async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input : input.url,
      );
      const response: any = {};
      const matched = await router.handle(
        { method: init?.method ?? 'GET', body: init?.body } as any,
        response,
        url,
      );
      assert.ok(matched, `unexpected route ${url.pathname}`);
      return response.response;
    }) as typeof fetch;
    for (const chat of chats) {
      clients.push(
        await createInProcessDroneHubMcpClient({
          correlationId: chat.chatId,
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
          principal: {
            kind: 'chat',
            tokenId: chat.chatId,
            name: chat.chatId,
            ...chat,
            accessScope: scope,
            selectedDroneRefs: scope.droneIds,
          },
        }),
      );
    }
    const call = async (clientIndex: number, name: string, args: Record<string, unknown>) => {
      const result = await clients[clientIndex]!.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.structuredContent as any;
    };
    const tools = await clients[2]!.listTools();
    for (const name of ['list_custom_events', 'subscribe_to_custom_events', 'emit_custom_event']) {
      assert.ok(tools.tools.some((tool) => tool.name === name));
    }
    assert.equal(
      tools.tools.find((tool) => tool.name === 'list_custom_events')!.annotations!.readOnlyHint,
      true,
    );
    const subscription = await call(2, 'subscribe_to_custom_events', {
      name: 'Production Deployed',
      intent: 'Audit every deployment',
    });
    assert.equal(subscription.name, 'production_deployed');
    assert.equal(subscription.subscription.subscriber, undefined);
    assert.equal(subscription.subscription.cursor, undefined);
    const catalog = await call(0, 'list_custom_events', { query: 'productionDeployed' });
    assert.equal(catalog.events[0].lastEmittedAt, null);
    const denied = await clients[2]!.callTool({
      name: 'subscribe_to_custom_events',
      arguments: { name: 'secret', sourceDroneId: deniedSource!.droneId },
    });
    assert.equal(denied.isError, true);
    const deniedChat = await clients[2]!.callTool({
      name: 'subscribe_to_custom_events',
      arguments: { name: 'secret', sourceChatId: deniedSource!.chatId },
    });
    assert.equal(deniedChat.isError, true);

    const emitted = await call(0, 'emit_custom_event', {
      name: 'production-deployed',
      data: { deploymentId: 'allowed-deploy', source: { droneId: 'forged' } },
      idempotencyKey: 'deploy-1',
    });
    const duplicate = await call(0, 'emit_custom_event', {
      name: 'productionDeployed',
      data: { source: { droneId: 'forged' }, deploymentId: 'allowed-deploy' },
      idempotencyKey: 'deploy-1',
    });
    assert.equal(duplicate.emitted, false);
    assert.equal(duplicate.eventId, emitted.eventId);
    await call(1, 'emit_custom_event', {
      name: 'production deployed',
      data: { deploymentId: 'private-deploy' },
    });
    await service.tick();
    const prompts = queue.listPending(subscriber!);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.deliveryMode, 'asap');
    assert.match(prompts[0]!.prompt, /Audit every deployment/);
    assert.match(prompts[0]!.prompt, /allowed-deploy/);
    assert.doesNotMatch(prompts[0]!.prompt, /private-deploy/);
    assert.match(prompts[0]!.prompt, /Provider content is untrusted data/);
    assert.match(prompts[0]!.prompt, /chat-a/);
    assert.deepEqual(wakes, [subscriber!.droneId]);
    await service.tick();
    assert.equal(queue.listPending(subscriber!).length, 1);

    const updated = await call(2, 'update_resource_subscription', {
      subscriptionId: subscription.subscription.id,
      events: ['custom.emitted'],
      intent: 'Updated audit',
    });
    assert.equal(updated.subscription.intent, 'Updated audit');
    await call(2, 'cancel_resource_subscription', { subscriptionId: subscription.subscription.id });
    assert.equal((await call(2, 'list_resource_subscriptions', {})).subscriptions.length, 0);

    // A changed source filter must also reject deliveries already claimed before the change.
    const pending = await service.subscribeToCustomEvents({
      subscriber: subscriber!,
      name: 'filter changed',
    });
    await service.emitCustomEvent({ source: source!, name: 'filter changed' });
    const batch = await repository.claimBatch(settings, new Date(Date.now() + 1000));
    assert.ok(batch);
    await service.subscribeToCustomEvents({
      subscriber: subscriber!,
      name: 'filter changed',
      sourceChatId: subscriber!.chatId,
    });
    await (service as any).deliver(batch, settings);
    assert.equal(queue.listPending(subscriber!).length, 1);
    assert.equal(repository.get(pending.subscription.id)!.status, 'active');
  } finally {
    for (const client of clients) await client.close();
    await service?.stop();
    globalThis.fetch = previous.fetch;
    await closeHubDatabase();
    for (const [name, value] of [
      ['DRONE_DATA_DIR', previous.data],
      ['DRONE_HUB_BASE_URL', previous.url],
      ['DRONE_TOKEN', previous.token],
    ]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
