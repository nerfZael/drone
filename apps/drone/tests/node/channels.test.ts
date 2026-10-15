import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getHubDatabase, closeHubDatabase } from '../../src/host/hub-database';
import { getPromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { createInProcessDroneHubMcpClient } from '../../src/hub/assistant/in-process-drone-hub-mcp';
import { HubRouter } from '../../src/hub/hub-router';
import { hubChangeEvents } from '../../src/hub/hub-change-events';
import { normalizeMcpChatAccessScope } from '../../src/hub/mcp-chat-access';
import { ChannelRepository } from '../../src/hub/channels/channel-repository';
import { ChannelService, type ChannelMentionNotification } from '../../src/hub/channels/channel-service';
import { registerChannelRoutes } from '../../src/hub/channels/channel-routes';
import { channelMemberHandles, parseChannelMentions } from '../../src/hub/channels/channel-model';
import { createResourceSubscriptionDeliveryAuthorizer } from '../../src/hub/subscriptions/create-resource-subscription-delivery-authorizer';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { ResourceSubscriptionService } from '../../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';

test('member handles are short when unique and qualified by drone when they collide', () => {
  const handles = channelMemberHandles([
    { chatId: '1', droneName: 'api', chatName: 'default' },
    { chatId: '2', droneName: 'web', chatName: 'Review Bot' },
    { chatId: '3', droneName: 'ops', chatName: 'Review Bot' },
    { chatId: '4', droneName: 'ops', chatName: 'user' },
  ]);
  assert.deepEqual([...handles.values()], ['api', 'web/review-bot', 'ops/review-bot', 'ops/user']);
  // A drone's default chat goes by the drone's name even when the drone has other chats.
  assert.deepEqual([...channelMemberHandles([
    { chatId: 'a', droneName: 'web', chatName: 'default' },
    { chatId: 'b', droneName: 'web', chatName: 'Review Bot' },
  ]).values()], ['web', 'review-bot']);
  const mentions = parseChannelMentions('@api, can @web/review-bot look? cc @user and @username', handles);
  assert.deepEqual(mentions, [
    { kind: 'chat', chatId: '1', handle: 'api' },
    { kind: 'chat', chatId: '2', handle: 'web/review-bot' },
    { kind: 'user', handle: 'user' },
  ]);
  assert.deepEqual(parseChannelMentions('mail me at x@api.com', handles), []);
  // A longer name that starts with a handle is someone else; trailing punctuation is not.
  assert.deepEqual(parseChannelMentions('@api-gateway is down', handles), []);
  assert.deepEqual(parseChannelMentions('over to @api-- and @web/review-bot/', handles), [
    { kind: 'chat', chatId: '1', handle: 'api' },
    { kind: 'chat', chatId: '2', handle: 'web/review-bot' },
  ]);
  // Code quotes handles; it does not address anyone.
  assert.deepEqual(parseChannelMentions('run `notify(@user)` then\n```ts\n@api.decorate()\n```\nthanks @api', handles), [
    { kind: 'chat', chatId: '1', handle: 'api' },
  ]);
});

test('channels route messages to member chats through MCP and durable subscriptions', async () => {
  const previous = {
    data: process.env.DRONE_DATA_DIR,
    url: process.env.DRONE_HUB_BASE_URL,
    token: process.env.DRONE_TOKEN,
    fetch: globalThis.fetch,
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-'));
  process.env.DRONE_DATA_DIR = directory;
  process.env.DRONE_HUB_BASE_URL = 'http://channels.test';
  process.env.DRONE_TOKEN = 'test-token';
  const chats = ['alpha', 'beta', 'gamma', 'delta'].map((name) => ({
    chatId: `chat-${name}`,
    droneId: `drone-${name}`,
    chatName: 'default',
  }));
  const [alpha, beta, gamma, delta] = chats as [typeof chats[0], typeof chats[0], typeof chats[0], typeof chats[0]];
  const clients: Array<Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>>> = [];
  let service: ResourceSubscriptionService | undefined;
  const changes: Array<{ channelId: string | null; scope: string }> = [];
  const offChanges = hubChangeEvents.onChannelsChange((change) => changes.push(change));
  try {
    const database = getHubDatabase()!;
    const repository = new ResourceSubscriptionRepository(database);
    const channelRepository = new ChannelRepository(database);
    const queue = getPromptQueueRepository()!;
    database.read((db) => {
      db.exec('CREATE TABLE canonical_chats (drone_id TEXT, chat_name TEXT, metadata_json TEXT)');
      db.exec('CREATE TABLE hub_canonical_drones (drone_id TEXT, name TEXT)');
      for (const chat of chats) {
        db.prepare('INSERT INTO canonical_chats VALUES (?, ?, ?)').run(chat.droneId, chat.chatName, JSON.stringify({ id: chat.chatId }));
        db.prepare('INSERT INTO hub_canonical_drones VALUES (?, ?)').run(chat.droneId, chat.droneId.replace('drone-', ''));
      }
    });
    // Drone read scopes do not limit channels: no chat here can read another chat's drone.
    const registry = {
      drones: Object.fromEntries(chats.map((chat) => [chat.droneId, {
        id: chat.droneId,
        name: chat.droneId,
        chats: { default: { id: chat.chatId, droneHubMcpAccessScope: normalizeMcpChatAccessScope({ readMode: 'selected', droneIds: [] }, chat.droneId) } },
      }])),
    };
    const settings = { ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS, batchWindowMs: 0 };
    service = new ResourceSubscriptionService({
      repository,
      readChatStatus: async () => {
        throw new Error('channels should not poll chats');
      },
      readSettings: async () => settings,
      resolveChannelName: (id) => channelRepository.getChannel(id)?.name ?? null,
      authorizeDelivery: createResourceSubscriptionDeliveryAuthorizer({
        resolveChatResource: (id) => repository.resolveChatResource(id),
        canReadChannel: (channelId, chatId) => Boolean(channelRepository.getMember(channelId, chatId)?.canRead),
        loadRegistry: async () => registry,
      }),
      wakePromptQueue: () => {},
      log: () => {},
    });
    const notifications: ChannelMentionNotification[] = [];
    const channels = new ChannelService({
      repository: channelRepository,
      subscriptions: service,
      appendEventInTransaction: (connection, event) => repository.appendEventInTransaction(connection, event),
      resolveChats: (ids) => repository.resolveChatResources(ids),
      notifyUserMention: (notification) => notifications.push(notification),
    });
    const router = new HubRouter(
      (res, status, body) => {
        (res as any).response = Response.json(body, { status });
      },
      async (req) => JSON.parse((req as any).body ?? '{}'),
    );
    registerChannelRoutes(router, channels, (id) => repository.resolveChatResource(id));
    globalThis.fetch = (async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      const response: any = {};
      const matched = await router.handle({ method: init?.method ?? 'GET', body: init?.body } as any, response, url);
      assert.ok(matched, `unexpected route ${url.pathname}`);
      return response.response;
    }) as typeof fetch;
    // The UI acts as the user: no actor.
    const ui = async (method: string, pathname: string, body?: unknown) => {
      const response = await fetch(`http://channels.test${pathname}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      const json = await response.json() as any;
      return { status: response.status, json };
    };
    for (const chat of chats) {
      const scope = normalizeMcpChatAccessScope({ readMode: 'selected', droneIds: [] }, chat.droneId);
      clients.push(await createInProcessDroneHubMcpClient({
        correlationId: chat.chatId,
        allowedDroneRefs: [],
        allowedWriteDroneRefs: [],
        allowedDroneIds: [],
        principal: { kind: 'chat', tokenId: chat.chatId, name: chat.chatId, ...chat, accessScope: scope, selectedDroneRefs: scope.droneIds },
      }));
    }
    const callRaw = (index: number, name: string, args: Record<string, unknown>) => clients[index]!.callTool({ name, arguments: args });
    const call = async (index: number, name: string, args: Record<string, unknown>) => {
      const result = await callRaw(index, name, args);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.structuredContent as any;
    };
    const pending = (chat: typeof alpha) => queue.listPending(chat).map((prompt) => prompt.prompt);
    const deliver = async () => {
      await service!.tick();
    };

    const tools = (await clients[0]!.listTools()).tools;
    for (const name of ['list_channels', 'read_channel_messages', 'send_channel_message', 'list_channel_members',
      'add_channel_members', 'remove_channel_members', 'set_channel_subscription']) {
      assert.ok(tools.some((tool) => tool.name === name), name);
    }
    assert.equal(tools.find((tool) => tool.name === 'read_channel_messages')!.annotations!.readOnlyHint, true);

    // The user creates a channel and adds three chats; each starts subscribed to its mentions.
    const created = await ui('POST', '/api/channels', { name: '  #Release   Train ' });
    assert.equal(created.json.channel.name, 'Release Train');
    const channelId = created.json.channel.id as string;
    const added = await ui('POST', `/api/channels/${channelId}/members`, {
      members: [{ chatId: alpha.chatId }, { drone: 'beta', chat: 'default' }, { droneId: gamma.droneId, chatName: 'default' }],
    });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.deepEqual(added.json.added.map((member: any) => [member.handle, member.subscription, member.canRead, member.canSend]), [
      ['alpha', 'mentions', true, true],
      ['beta', 'mentions', true, true],
      ['gamma', 'mentions', true, true],
    ]);
    assert.ok(changes.some((change) => change.channelId === channelId && change.scope === 'members'));

    // Only members see the channel; it can be named by #name.
    assert.deepEqual((await call(3, 'list_channels', {})).channels, []);
    assert.equal((await callRaw(3, 'read_channel_messages', { channel: channelId })).isError, true);
    const listed = await call(0, 'list_channels', {});
    assert.deepEqual(listed.channels.map((channel: any) => [channel.name, channel.subscription]), [['Release Train', 'mentions']]);

    // A mention wakes only the mentioned chat; the author and other mentions-only members stay asleep.
    const first = await call(0, 'send_channel_message', { channel: '#release train', text: 'Ready for review, @beta?' });
    assert.deepEqual(first.message.mentions, [{ kind: 'chat', chatId: beta.chatId, handle: 'beta' }]);
    await deliver();
    assert.equal(pending(alpha).length, 0);
    assert.equal(pending(gamma).length, 0);
    const betaPrompts = pending(beta);
    assert.equal(betaPrompts.length, 1);
    assert.match(betaPrompts[0]!, /channel\.mention/);
    assert.match(betaPrompts[0]!, /Ready for review, @beta\?/);
    assert.match(betaPrompts[0]!, /send_channel_message/);
    assert.doesNotMatch(betaPrompts[0]!, /readerChatIds|routing/);

    // A reply counts as a mention of the replied-to author.
    await call(1, 'send_channel_message', { channel: channelId, text: 'Looks good.', replyTo: first.message.id });
    await deliver();
    assert.equal(pending(alpha).length, 1);
    assert.match(pending(alpha)[0]!, /Looks good/);

    // Subscribed to everything: every other member's message, but a mention arrives once, as a mention.
    assert.equal((await call(2, 'set_channel_subscription', { channel: channelId, mode: 'all' })).subscription, 'all');
    await ui('POST', `/api/channels/${channelId}/messages`, { text: 'Status check, everyone.' });
    await ui('POST', `/api/channels/${channelId}/messages`, { text: '@gamma please run the tests' });
    await deliver();
    const gammaPrompts = pending(gamma);
    assert.equal(gammaPrompts.length, 1);
    assert.equal((gammaPrompts[0]!.match(/<event>/g) ?? []).length, 2);
    assert.match(gammaPrompts[0]!, /channel\.message/);
    assert.match(gammaPrompts[0]!, /channel\.mention/);
    assert.equal(pending(alpha).length, 1);
    await call(2, 'send_channel_message', { channel: channelId, text: 'Running them now.' });
    await deliver();
    assert.equal(pending(gamma).length, 1, 'own messages never wake the author');

    // The agent reads history, oldest first, with authors and reply context.
    const history = await call(2, 'read_channel_messages', { channel: channelId, limit: 3 });
    assert.deepEqual(history.messages.map((message: any) => message.text), [
      'Status check, everyone.',
      '@gamma please run the tests',
      'Running them now.',
    ]);
    assert.equal(history.hasMore, true);
    const older = await call(2, 'read_channel_messages', { channel: channelId, beforeSeq: history.messages[0].seq });
    assert.equal(older.messages[1].replyTo.id, first.message.id);
    assert.equal(older.messages[1].author.handle, 'beta');
    assert.equal(history.channel.userLastReadSeq, undefined, "agents do not see the user's read position");

    // Agents tagging @user or replying to the user notify the user and count as user mentions.
    const userMessage = (await ui('GET', `/api/channels/${channelId}/messages`)).json.messages[2];
    assert.equal(userMessage.author.kind, 'user');
    await call(0, 'send_channel_message', { channel: channelId, text: 'Done.', replyTo: userMessage.id });
    await call(1, 'send_channel_message', { channel: channelId, text: 'fyi', mentions: ['user'] });
    assert.equal(notifications.length, 2);
    const summary = (await ui('GET', '/api/channels')).json.channels[0];
    assert.equal(summary.mentionCount, 2);
    // Posting marks everything before it read: only the three agent messages after the user's last one count.
    assert.equal(summary.unreadCount, 3);
    await ui('POST', `/api/channels/${channelId}/read`, { seq: summary.lastSeq });
    assert.equal((await ui('GET', '/api/channels')).json.channels[0].unreadCount, 0);

    // Revoking read access also drops what was already waiting for delivery.
    await ui('POST', `/api/channels/${channelId}/messages`, { text: '@gamma one more thing' });
    assert.ok((await repository.pendingDeliveries(gamma.droneId, gamma.chatName, settings)).deliveries.length > 0);
    await ui('POST', `/api/channels/${channelId}/members/${gamma.chatId}`, { canRead: false });
    await deliver();
    await deliver();
    assert.equal(pending(gamma).length, 1);
    assert.equal((await repository.pendingDeliveries(gamma.droneId, gamma.chatName, settings)).deliveries.length, 0);
    await ui('POST', `/api/channels/${channelId}/members/${gamma.chatId}`, { canRead: true });

    // The user turns off gamma's read access: no deliveries, no history, and it cannot subscribe.
    const gammaOff = await ui('POST', `/api/channels/${channelId}/members/${gamma.chatId}`, { canRead: false });
    assert.equal(gammaOff.json.member.canRead, false);
    assert.equal(gammaOff.json.member.subscription, 'all');
    await ui('POST', `/api/channels/${channelId}/messages`, { text: '@gamma are you there?' });
    await deliver();
    assert.equal(pending(gamma).length, 1);
    assert.equal((await callRaw(2, 'read_channel_messages', { channel: channelId })).isError, true);
    assert.equal((await callRaw(2, 'set_channel_subscription', { channel: channelId, mode: 'mentions' })).isError, true);

    // A refused change saves nothing: beta keeps its send access.
    const refused = await ui('POST', `/api/channels/${channelId}/members/${beta.chatId}`, { canSend: false, canRead: false, subscription: 'all' });
    assert.equal(refused.status, 400);
    assert.equal((await ui('GET', `/api/channels/${channelId}`)).json.members.find((member: any) => member.chatId === beta.chatId).canSend, true);

    // Without send access a chat cannot post.
    await ui('POST', `/api/channels/${channelId}/members/${beta.chatId}`, { canSend: false });
    assert.equal((await callRaw(1, 'send_channel_message', { channel: channelId, text: 'hello' })).isError, true);

    // A chat can add chats, and remove itself and the chats it added, but not others.
    const byAgent = await call(0, 'add_channel_members', { channel: channelId, members: [{ drone: 'delta' }] });
    assert.equal(byAgent.added[0].addedBy.kind, 'chat');
    assert.equal(byAgent.added[0].addedBy.label, '@alpha');
    const again = await call(0, 'add_channel_members', { channel: channelId, members: [{ drone: 'delta' }] });
    assert.deepEqual([again.added, again.alreadyMembers], [[], [delta.chatId]]);
    assert.equal((await callRaw(1, 'remove_channel_members', { channel: channelId, members: ['@delta'] })).isError, true);
    // A refused removal does not hide the one that went through.
    const partial = await call(0, 'remove_channel_members', { channel: channelId, members: ['@gamma', '@delta'] });
    assert.deepEqual(partial.removed, ['@delta']);
    assert.equal(partial.failed[0].member, '@gamma');
    assert.match(partial.failed[0].error, /only remove itself and the chats it added/);
    await call(1, 'remove_channel_members', { channel: channelId, members: [beta.chatId] });
    const members = (await ui('GET', `/api/channels/${channelId}`)).json.members;
    assert.deepEqual(members.map((member: any) => member.handle), ['alpha', 'gamma']);
    assert.equal(service.channelSubscriptions(channelId).has(beta.chatId), false);
    assert.equal(service.channelSubscriptions(channelId).has(delta.chatId), false);

    // The user can set a member's subscription; only the user renames or deletes channels.
    const none = await ui('POST', `/api/channels/${channelId}/members/${alpha.chatId}`, { subscription: 'none' });
    assert.equal(none.json.member.subscription, 'none');
    assert.equal((await ui('POST', `/api/channels/${channelId}/rename`, { name: 'Ship it' })).json.channel.name, 'Ship it');
    assert.equal(service.list(gamma.chatId).find((item) => item.resourceType === 'channel')?.resourceLabel, '#Ship it');
    await ui('DELETE', `/api/channels/${channelId}`);
    assert.deepEqual((await ui('GET', '/api/channels')).json.channels, []);
    assert.equal(service.channelSubscriptions(channelId).size, 0);
  } finally {
    offChanges();
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
