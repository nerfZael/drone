import type { HubRouteContext, HubRouter } from '../hub-router';
import type { ChannelActor, ChannelChatLocation } from './channel-model';
import { ChannelError, type ChannelChatRef, type ChannelService } from './channel-service';

/**
 * Channel API for the Hub UI (acting as the user) and the DroneHub MCP server (acting as a
 * member chat). Agent requests name their chat in `actor`; channel paths then also accept the
 * channel's name among that chat's channels.
 */
export function registerChannelRoutes(
  router: HubRouter,
  service: ChannelService | null,
  resolveChat: (chatId: string) => ChannelChatLocation | null,
): void {
  const handle =
    (run: (context: HubRouteContext & { body: any; actor: ChannelActor }) => Promise<unknown> | unknown) =>
    async (context: HubRouteContext) => {
      if (!service) return context.json(503, { ok: false, error: 'channels require the Hub database' });
      try {
        const body = context.method === 'GET' || context.method === 'DELETE' ? {} : ((await context.readJson<any>()) ?? {});
        const actor = readActor(body?.actor ?? actorFromQuery(context.url), resolveChat);
        const result = await run({ ...context, body, actor });
        context.json(200, { ok: true, ...(result && typeof result === 'object' ? result : {}) });
      } catch (error) {
        const status = error instanceof ChannelError ? error.status : 400;
        context.json(status, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };
  const channelId = (actor: ChannelActor, ref: string) =>
    actor.kind === 'chat' ? service!.resolveChannelForChat(actor.chatId, ref).id : ref;

  router.get('/api/channels', handle(({ actor }) =>
    actor.kind === 'chat' ? { channels: service!.channelsForChat(actor.chatId) } : { channels: service!.listChannels() }));
  router.post('/api/channels', handle(async ({ actor, body }) => ({ channel: await service!.createChannel(actor, body?.name) })));
  router.get('/api/channels/:id', handle(({ actor, params }) => service!.getChannel(actor, channelId(actor, params.id!))));
  router.delete('/api/channels/:id', handle(async ({ actor, params }) => {
    await service!.deleteChannel(actor, params.id!);
  }));
  router.post('/api/channels/:id/rename', handle(async ({ actor, params, body }) => ({
    channel: await service!.renameChannel(actor, params.id!, body?.name),
  })));
  router.post('/api/channels/:id/read', handle(async ({ actor, params, body }) => {
    if (actor.kind !== 'user') throw new ChannelError(403, 'only the user has a read position');
    await service!.markUserRead(params.id!, Number(body?.seq));
  }));
  router.get('/api/channels/:id/messages', handle(({ actor, params, url }) =>
    service!.readMessages(actor, channelId(actor, params.id!), {
      beforeSeq: url.searchParams.get('beforeSeq') ?? undefined,
      afterSeq: url.searchParams.get('afterSeq') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })));
  router.post('/api/channels/:id/messages', handle(async ({ actor, params, body }) => ({
    message: await service!.postMessage(actor, channelId(actor, params.id!), {
      text: body?.text,
      replyTo: body?.replyTo,
      mentions: body?.mentions,
    }),
  })));
  router.get('/api/channels/:id/members', handle(({ actor, params }) => ({
    members: service!.listMembers(actor, channelId(actor, params.id!)),
  })));
  router.post('/api/channels/:id/members', handle(async ({ actor, params, body }) =>
    service!.addMembers(actor, channelId(actor, params.id!), chatRefs(body?.members))));
  router.post('/api/channels/:id/members/remove', handle(async ({ actor, params, body }) => {
    const ref = chatRefs([body?.member])[0]!;
    await service!.removeMember(actor, channelId(actor, params.id!), ref);
  }));
  router.post('/api/channels/:id/members/:chatId', handle(async ({ actor, params, body }) => ({
    member: await service!.updateMember(actor, params.id!, params.chatId!, {
      canRead: body?.canRead,
      canSend: body?.canSend,
      subscription: body?.subscription,
    }),
  })));
  router.post('/api/channels/:id/subscription', handle(async ({ actor, params, body }) => {
    if (actor.kind !== 'chat') throw new ChannelError(400, 'the user changes member subscriptions from the member controls');
    return service!.setOwnSubscription(actor, channelId(actor, params.id!), body?.mode);
  }));
}

function actorFromQuery(url: URL) {
  const chatId = url.searchParams.get('actorChatId');
  return chatId
    ? { chatId, droneId: url.searchParams.get('actorDroneId'), chatName: url.searchParams.get('actorChatName') }
    : undefined;
}

/** The acting chat must be one the Hub knows; without one, the request is the user's. */
function readActor(raw: any, resolveChat: (chatId: string) => ChannelChatLocation | null): ChannelActor {
  if (raw === undefined || raw === null) return { kind: 'user' };
  const chatId = String(raw?.chatId ?? '').trim();
  const droneId = String(raw?.droneId ?? '').trim();
  if (!chatId || !droneId) throw new ChannelError(400, 'channel actions need a DroneHub conversation identity');
  const location = resolveChat(chatId);
  if (!location || location.droneId !== droneId) {
    throw new ChannelError(403, 'channel actions need an existing DroneHub conversation identity');
  }
  return { kind: 'chat', chatId, droneId, chatName: location.chatName };
}

function chatRefs(raw: unknown): ChannelChatRef[] {
  if (!Array.isArray(raw)) throw new ChannelError(400, 'members must be a list of chats');
  return raw.map((item) => {
    if (typeof item === 'string') {
      const value = item.trim();
      return value.includes('/') && !value.startsWith('@')
        ? { drone: value.slice(0, value.indexOf('/')), chat: value.slice(value.indexOf('/') + 1) }
        : { chatId: value };
    }
    if (!item || typeof item !== 'object') throw new ChannelError(400, 'each member must name a chat');
    const value = item as Record<string, unknown>;
    return {
      ...(value.chatId ? { chatId: String(value.chatId) } : {}),
      ...(value.drone ?? value.droneId ? { drone: String(value.drone ?? value.droneId) } : {}),
      ...(value.chat ?? value.chatName ? { chat: String(value.chat ?? value.chatName) } : {}),
    };
  });
}
