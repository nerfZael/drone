import { hubChangeEvents } from '../hub-change-events';
import type { HubDatabaseConnection } from '../../host/hub-database';
import type { ResourceEvent, ResourceSubscription } from '../subscriptions/resource-subscription-types';
import type { ResourceSubscriptionService } from '../subscriptions/resource-subscription-service';
import {
  CHANNEL_CHAT_MESSAGES_PER_HOUR,
  CHANNEL_MEMBERS_MAX,
  CHANNEL_MESSAGES_PAGE_MAX,
  USER_HANDLE,
  channelMemberHandles,
  channelSubscriptionModeFromEvents,
  normalizeChannelMessageText,
  normalizeChannelName,
  normalizeChannelSubscriptionMode,
  parseChannelMentions,
  type Channel,
  type ChannelActor,
  type ChannelChatLocation,
  type ChannelEventRouting,
  type ChannelMemberRecord,
  type ChannelMessageAuthor,
  type ChannelMessageMention,
  type ChannelMessageRecord,
  type ChannelSubscriptionMode,
} from './channel-model';
import type { ChannelRepository } from './channel-repository';

export class ChannelError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429,
    message: string,
  ) {
    super(message);
  }
}

export type ChannelMemberView = {
  chatId: string;
  handle: string;
  droneId: string;
  droneName: string;
  chatName: string;
  /** False while the chat is archived or after it was deleted. */
  available: boolean;
  canRead: boolean;
  canSend: boolean;
  subscription: ChannelSubscriptionMode;
  /** The subscription exists but is paused, for example while the chat is archived. */
  subscriptionPaused: boolean;
  addedBy: { kind: 'user' } | { kind: 'chat'; chatId: string; label: string };
  addedAt: string;
};

export type ChannelAuthorView =
  | { kind: 'user'; handle: string }
  | {
      kind: 'chat';
      chatId: string;
      droneId: string;
      droneName: string;
      chatName: string;
      /** Current handle while the chat is a member. */
      handle: string | null;
    };

export type ChannelMessageView = {
  id: string;
  seq: number;
  createdAt: string;
  author: ChannelAuthorView;
  text: string;
  replyTo: { id: string; author: ChannelAuthorView; text: string } | null;
  mentions: ChannelMessageMention[];
  mentionsUser: boolean;
};

export type ChannelSummaryView = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
  lastMessageAt: string | null;
  memberCount: number;
  unreadCount: number;
  mentionCount: number;
  userLastReadSeq: number;
};

/** A chat named by an agent or the UI: its stable ID, or its drone and chat name. */
export type ChannelChatRef = { chatId?: string; drone?: string; chat?: string };

export type ChannelMentionNotification = {
  channel: Channel;
  message: ChannelMessageRecord;
  author: Extract<ChannelMessageAuthor, { kind: 'chat' }>;
};

export type ChannelServiceDependencies = {
  repository: ChannelRepository;
  subscriptions: Pick<
    ResourceSubscriptionService,
    'setChannelSubscription' | 'channelSubscriptions' | 'cancelChannelSubscriptions'
  > | null;
  /** Records subscription events inside the message's own transaction. */
  appendEventInTransaction: ((connection: HubDatabaseConnection, event: ResourceEvent) => void) | null;
  resolveChats: (chatIds: string[]) => Map<string, ChannelChatLocation>;
  notifyUserMention?: (notification: ChannelMentionNotification) => void;
  log?: (level: 'info' | 'warn', message: string, details?: Record<string, unknown>) => void;
};

const REPLY_PREVIEW_CHARS = 300;

export class ChannelService {
  constructor(private readonly deps: ChannelServiceDependencies) {}

  private get repository(): ChannelRepository {
    return this.deps.repository;
  }

  listChannels(): ChannelSummaryView[] {
    return this.repository.listChannels().map((channel) => ({
      id: channel.id,
      name: channel.name,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      lastSeq: channel.lastSeq,
      lastMessageAt: channel.lastMessageAt,
      memberCount: channel.memberCount,
      unreadCount: channel.unreadCount,
      mentionCount: channel.mentionCount,
      userLastReadSeq: channel.userLastReadSeq,
    }));
  }

  channelName(id: string): string | null {
    return this.repository.getChannel(id)?.name ?? null;
  }

  async createChannel(actor: ChannelActor, rawName: unknown): Promise<Channel> {
    this.requireUser(actor, 'create channels');
    const channel = await this.repository.createChannel(normalizeChannelName(rawName));
    hubChangeEvents.emitChannelsChange(null);
    return channel;
  }

  async renameChannel(actor: ChannelActor, channelId: string, rawName: unknown): Promise<Channel> {
    this.requireUser(actor, 'rename channels');
    const channel = await this.repository.renameChannel(this.requireChannel(channelId).id, normalizeChannelName(rawName));
    if (!channel) throw new ChannelError(404, 'channel not found');
    hubChangeEvents.emitChannelsChange(channel.id);
    return channel;
  }

  async deleteChannel(actor: ChannelActor, channelId: string): Promise<void> {
    this.requireUser(actor, 'delete channels');
    const channel = this.requireChannel(channelId);
    await this.deps.subscriptions?.cancelChannelSubscriptions(channel.id);
    await this.repository.deleteChannel(channel.id);
    hubChangeEvents.emitChannelsChange(null);
  }

  async markUserRead(channelId: string, seq: number): Promise<void> {
    const channel = this.requireChannel(channelId);
    if (!Number.isFinite(seq) || seq <= channel.userLastReadSeq) return;
    await this.repository.markUserRead(channel.id, seq);
    hubChangeEvents.emitChannelsChange(channel.id, 'read');
  }

  /** Channels a chat belongs to, as an agent sees them. */
  channelsForChat(chatId: string) {
    const subscriptions = this.deps.subscriptions;
    return this.repository.membershipsForChat(chatId).map(({ channel, member }) => {
      const subscription = subscriptions?.channelSubscriptions(channel.id).get(chatId);
      return {
        id: channel.id,
        name: channel.name,
        lastMessageAt: channel.lastMessageAt,
        lastSeq: channel.lastSeq,
        canRead: member.canRead,
        canSend: member.canSend,
        subscription: channelSubscriptionModeFromEvents(subscription?.events),
      };
    });
  }

  /**
   * A channel named by an agent: its ID, or its name (with or without `#`) among the
   * channels the chat belongs to.
   */
  resolveChannelForChat(chatId: string, rawChannel: unknown): Channel {
    const ref = String(rawChannel ?? '').trim();
    if (!ref) throw new ChannelError(400, 'channel is required');
    const byId = this.repository.getChannel(ref);
    if (byId) return byId;
    const name = ref.replace(/^#+/, '').trim().toLowerCase();
    const matches = this.repository
      .membershipsForChat(chatId)
      .map(({ channel }) => channel)
      .filter((channel) => channel.name.toLowerCase() === name);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new ChannelError(409, `several channels are named ${ref}; pass the channel ID`);
    throw new ChannelError(404, `channel not found: ${ref}`);
  }

  /** The channel with its members, as the UI or a member agent sees it. */
  getChannel(actor: ChannelActor, channelId: string) {
    const channel = this.requireChannel(channelId);
    if (actor.kind === 'chat') this.requireMember(channel.id, actor);
    const { userLastReadSeq, ...shared } = channel;
    return { channel: actor.kind === 'user' ? channel : shared, members: this.memberViews(channel.id) };
  }

  listMembers(actor: ChannelActor, channelId: string): ChannelMemberView[] {
    const channel = this.requireChannel(channelId);
    if (actor.kind === 'chat') this.requireMember(channel.id, actor);
    return this.memberViews(channel.id);
  }

  async addMembers(actor: ChannelActor, channelId: string, refs: readonly ChannelChatRef[]) {
    const channel = this.requireChannel(channelId);
    if (actor.kind === 'chat') this.requireMember(channel.id, actor);
    if (!Array.isArray(refs) || refs.length === 0) throw new ChannelError(400, 'at least one chat is required');
    if (refs.length > CHANNEL_MEMBERS_MAX) throw new ChannelError(400, `at most ${CHANNEL_MEMBERS_MAX} chats at once`);
    const locations: ChannelChatLocation[] = [];
    const notFound: string[] = [];
    for (const ref of refs) {
      const location = this.resolveChatRef(ref);
      if (location) locations.push(location);
      else notFound.push(describeChatRef(ref));
    }
    if (notFound.length) throw new ChannelError(404, `chat not found: ${notFound.join(', ')}`);
    let added: ChannelMemberRecord[];
    try {
      added = await this.repository.addMembers(
        channel.id,
        locations,
        actor.kind === 'chat' ? actor.chatId : null,
        CHANNEL_MEMBERS_MAX,
      );
    } catch (error) {
      throw new ChannelError(400, error instanceof Error ? error.message : String(error));
    }
    // New members hear about mentions and replies to them; they can switch to every message or none.
    const subscriptionErrors: Array<{ chatId: string; error: string }> = [];
    for (const member of added) {
      try {
        await this.deps.subscriptions?.setChannelSubscription({
          subscriber: { chatId: member.chatId, droneId: member.droneId, chatName: member.chatName },
          channelId: channel.id,
          mode: 'mentions',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        subscriptionErrors.push({ chatId: member.chatId, error: message });
        this.deps.log?.('warn', 'channel member could not be subscribed to mentions', {
          channelId: channel.id,
          chatId: member.chatId,
          error: message,
        });
      }
    }
    hubChangeEvents.emitChannelsChange(channel.id, 'members');
    const views = this.memberViews(channel.id);
    const addedIds = new Set(added.map((member) => member.chatId));
    return {
      added: views.filter((member) => addedIds.has(member.chatId)),
      alreadyMembers: locations.filter((location) => !addedIds.has(location.chatId)).map((location) => location.chatId),
      ...(subscriptionErrors.length ? { subscriptionErrors } : {}),
    };
  }

  /** The user removes anyone; a chat removes itself and the chats it added. */
  async removeMember(actor: ChannelActor, channelId: string, ref: ChannelChatRef): Promise<void> {
    const channel = this.requireChannel(channelId);
    const chatId = this.memberChatId(channel.id, ref);
    const member = this.repository.getMember(channel.id, chatId);
    if (!member) throw new ChannelError(404, 'that chat is not a member of this channel');
    if (actor.kind === 'chat') {
      this.requireMember(channel.id, actor);
      if (member.chatId !== actor.chatId && member.addedByChatId !== actor.chatId) {
        throw new ChannelError(403, 'a chat can only remove itself and the chats it added');
      }
    }
    await this.deps.subscriptions?.cancelChannelSubscriptions(channel.id, [member.chatId]);
    await this.repository.removeMember(channel.id, member.chatId);
    hubChangeEvents.emitChannelsChange(channel.id, 'members');
  }

  /** The user's member controls: read and send permissions and the subscription mode. */
  async updateMember(
    actor: ChannelActor,
    channelId: string,
    chatId: string,
    input: { canRead?: unknown; canSend?: unknown; subscription?: unknown },
  ): Promise<ChannelMemberView> {
    this.requireUser(actor, 'change member permissions');
    const channel = this.requireChannel(channelId);
    const member = this.repository.getMember(channel.id, chatId);
    if (!member) throw new ChannelError(404, 'that chat is not a member of this channel');
    const permissions: { canRead?: boolean; canSend?: boolean } = {};
    if (input.canRead !== undefined) permissions.canRead = requireBoolean(input.canRead, 'canRead');
    if (input.canSend !== undefined) permissions.canSend = requireBoolean(input.canSend, 'canSend');
    // Everything is checked before anything is saved, so a refused change leaves the member as it was.
    let mode: ChannelSubscriptionMode | undefined;
    if (input.subscription !== undefined) {
      mode = normalizeChannelSubscriptionMode(input.subscription);
      if (mode !== 'none' && !(permissions.canRead ?? member.canRead)) {
        throw new ChannelError(400, 'a chat without read access cannot subscribe');
      }
    }
    if (mode !== undefined) await this.setSubscription(channel.id, member, mode);
    if (Object.keys(permissions).length) await this.repository.setMemberPermissions(channel.id, chatId, permissions);
    hubChangeEvents.emitChannelsChange(channel.id, 'members');
    return this.memberViews(channel.id).find((view) => view.chatId === chatId)!;
  }

  /** A member chat chooses what wakes it: mentions, every message, or nothing. */
  async setOwnSubscription(actor: Extract<ChannelActor, { kind: 'chat' }>, channelId: string, rawMode: unknown) {
    const channel = this.requireChannel(channelId);
    const member = this.requireMember(channel.id, actor);
    const mode = normalizeChannelSubscriptionMode(rawMode);
    if (mode !== 'none' && !member.canRead) {
      throw new ChannelError(403, 'read access to this channel is turned off for this chat');
    }
    await this.setSubscription(channel.id, member, mode);
    return { channelId: channel.id, subscription: mode };
  }

  readMessages(
    actor: ChannelActor,
    channelId: string,
    input: { beforeSeq?: unknown; afterSeq?: unknown; limit?: unknown },
  ) {
    const channel = this.requireChannel(channelId);
    if (actor.kind === 'chat') {
      const member = this.requireMember(channel.id, actor);
      if (!member.canRead) throw new ChannelError(403, 'read access to this channel is turned off for this chat');
    }
    const limit = clampInt(input.limit, 50, 1, CHANNEL_MESSAGES_PAGE_MAX);
    const beforeSeq = optionalSeq(input.beforeSeq, 'beforeSeq');
    const afterSeq = optionalSeq(input.afterSeq, 'afterSeq');
    if (beforeSeq !== undefined && afterSeq !== undefined) {
      throw new ChannelError(400, 'pass beforeSeq or afterSeq, not both');
    }
    const page = this.repository.listMessages(channel.id, {
      limit,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
      ...(afterSeq !== undefined ? { afterSeq } : {}),
    });
    return {
      channel: {
        id: channel.id,
        name: channel.name,
        lastSeq: channel.lastSeq,
        ...(actor.kind === 'user' ? { userLastReadSeq: channel.userLastReadSeq } : {}),
      },
      messages: this.messageViews(channel.id, page.messages),
      hasMore: page.hasMore,
    };
  }

  async postMessage(
    actor: ChannelActor,
    channelId: string,
    input: { text: unknown; replyTo?: unknown; mentions?: unknown },
  ): Promise<ChannelMessageView> {
    const channel = this.requireChannel(channelId);
    let author: ChannelMessageAuthor;
    if (actor.kind === 'chat') {
      const member = this.requireMember(channel.id, actor);
      if (!member.canSend) throw new ChannelError(403, 'send access to this channel is turned off for this chat');
      const since = new Date(Date.now() - 60 * 60_000).toISOString();
      if (this.repository.countChatMessagesSince(actor.chatId, since) >= CHANNEL_CHAT_MESSAGES_PER_HOUR) {
        throw new ChannelError(429, `channel message limit reached (${CHANNEL_CHAT_MESSAGES_PER_HOUR} per chat per hour)`);
      }
      const location = this.deps.resolveChats([actor.chatId]).get(actor.chatId);
      author = {
        kind: 'chat',
        chatId: actor.chatId,
        droneId: location?.droneId ?? actor.droneId,
        chatName: location?.chatName ?? actor.chatName,
        droneName: location?.droneName || member.droneName || actor.droneId,
      };
    } else {
      author = { kind: 'user' };
    }
    let text: string;
    try {
      text = normalizeChannelMessageText(input.text);
    } catch (error) {
      throw new ChannelError(400, error instanceof Error ? error.message : String(error));
    }
    const replyToId = String(input.replyTo ?? '').trim() || null;
    const replyTo = replyToId ? this.repository.getMessage(channel.id, replyToId) : null;
    if (replyToId && !replyTo) throw new ChannelError(404, 'the message to reply to is not in this channel');

    const members = this.repository.listMembers(channel.id);
    const handles = this.memberHandles(members);
    const mentions = mergeMentions(
      parseChannelMentions(text, handles),
      this.explicitMentions(input.mentions, handles, members),
    ).filter((mention) => !(author.kind === 'chat' && mention.kind === 'chat' && mention.chatId === author.chatId));
    const authorChatId = author.kind === 'chat' ? author.chatId : null;
    const mentionedChatIds = new Set(
      mentions.flatMap((mention) => (mention.kind === 'chat' ? [mention.chatId] : [])),
    );
    if (replyTo?.author.kind === 'chat' && replyTo.author.chatId !== authorChatId) {
      mentionedChatIds.add(replyTo.author.chatId);
    }
    const mentionsUser =
      author.kind === 'chat' &&
      (mentions.some((mention) => mention.kind === 'user') || replyTo?.author.kind === 'user');
    const routing: ChannelEventRouting = {
      readerChatIds: members.filter((member) => member.canRead && member.chatId !== authorChatId).map((member) => member.chatId),
      mentionedChatIds: [...mentionedChatIds],
    };
    const appendEvent = this.deps.appendEventInTransaction;
    const message = await this.repository.appendMessage(
      { channelId: channel.id, author, text, replyToId: replyTo?.id ?? null, mentions, mentionsUser },
      appendEvent
        ? (connection, stored) => {
            for (const event of this.messageEvents(channel, stored, replyTo, handles, routing)) {
              appendEvent(connection, event);
            }
          }
        : undefined,
    );
    hubChangeEvents.emitChannelsChange(channel.id, 'messages');
    if (mentionsUser && author.kind === 'chat') {
      try {
        this.deps.notifyUserMention?.({ channel, message, author });
      } catch {
        // A notification failure must not fail a stored message.
      }
    }
    return this.messageViews(channel.id, [message])[0]!;
  }

  private async setSubscription(channelId: string, member: ChannelMemberRecord, mode: ChannelSubscriptionMode) {
    const subscriptions = this.deps.subscriptions;
    if (!subscriptions) throw new ChannelError(409, 'channel subscriptions are unavailable');
    const location = this.deps.resolveChats([member.chatId]).get(member.chatId);
    if (!location && mode !== 'none') throw new ChannelError(409, 'that chat is archived or deleted');
    try {
      await subscriptions.setChannelSubscription({
        subscriber: {
          chatId: member.chatId,
          droneId: location?.droneId ?? member.droneId,
          chatName: location?.chatName ?? member.chatName,
        },
        channelId,
        mode,
      });
    } catch (error) {
      throw new ChannelError(409, error instanceof Error ? error.message : String(error));
    }
  }

  private messageEvents(
    channel: Channel,
    message: ChannelMessageRecord,
    replyTo: ChannelMessageRecord | null,
    handles: ReadonlyMap<string, string>,
    routing: ChannelEventRouting,
  ): ResourceEvent[] {
    const author = eventAuthor(message.author, handles);
    const authorLabel = author.kind === 'user' ? 'The user' : `@${author.handle}`;
    const content = {
      channel: { id: channel.id, name: channel.name },
      message: {
        id: message.id,
        seq: message.seq,
        at: message.createdAt,
        author,
        text: message.text,
        replyTo: replyTo
          ? {
              id: replyTo.id,
              author: eventAuthor(replyTo.author, handles),
              text: preview(replyTo.text, REPLY_PREVIEW_CHARS),
            }
          : null,
        mentions: message.mentions.map((mention) => `@${mention.handle}`),
      },
      routing,
    };
    const base = {
      provider: 'drone-hub' as const,
      resourceType: 'channel' as const,
      resourceId: channel.id,
      parentResourceId: null,
      occurredAt: message.createdAt,
      providerContent: content,
    };
    const events: ResourceEvent[] = [
      {
        ...base,
        id: `${message.id}:message`,
        providerEventId: `channel:${message.id}:message`,
        eventType: 'channel.message',
        summary: `${authorLabel} posted in #${channel.name}.`,
      },
    ];
    if (routing.mentionedChatIds.length) {
      events.push({
        ...base,
        id: `${message.id}:mention`,
        providerEventId: `channel:${message.id}:mention`,
        eventType: 'channel.mention',
        summary: `${authorLabel} mentioned you or replied to your message in #${channel.name}.`,
      });
    }
    return events;
  }

  private memberHandles(members: readonly ChannelMemberRecord[]): Map<string, string> {
    const locations = this.deps.resolveChats(members.map((member) => member.chatId));
    return channelMemberHandles(
      members.map((member) => {
        const location = locations.get(member.chatId);
        return {
          chatId: member.chatId,
          droneName: location?.droneName || member.droneName,
          chatName: location?.chatName ?? member.chatName,
        };
      }),
    );
  }

  private memberViews(channelId: string): ChannelMemberView[] {
    const members = this.repository.listMembers(channelId);
    const locations = this.deps.resolveChats(members.map((member) => member.chatId));
    const stale = [...locations.values()].filter((location) => {
      const member = members.find((item) => item.chatId === location.chatId);
      return (
        member &&
        (member.droneId !== location.droneId ||
          member.chatName !== location.chatName ||
          (location.droneName && member.droneName !== location.droneName))
      );
    });
    if (stale.length) void this.repository.refreshMemberLocations(stale).catch(() => {});
    const handles = this.memberHandles(members);
    const subscriptions = this.deps.subscriptions?.channelSubscriptions(channelId) ?? new Map<string, ResourceSubscription>();
    return members.map((member) => {
      const location = locations.get(member.chatId);
      const subscription = subscriptions.get(member.chatId);
      const adder = member.addedByChatId ? members.find((item) => item.chatId === member.addedByChatId) : undefined;
      return {
        chatId: member.chatId,
        handle: handles.get(member.chatId)!,
        droneId: location?.droneId ?? member.droneId,
        droneName: location?.droneName || member.droneName,
        chatName: location?.chatName ?? member.chatName,
        available: Boolean(location),
        canRead: member.canRead,
        canSend: member.canSend,
        subscription: channelSubscriptionModeFromEvents(subscription?.events),
        subscriptionPaused: subscription?.status === 'paused',
        addedBy: member.addedByChatId
          ? {
              kind: 'chat' as const,
              chatId: member.addedByChatId,
              label: adder ? `@${handles.get(adder.chatId)}` : 'a chat that has left',
            }
          : { kind: 'user' as const },
        addedAt: member.addedAt,
      };
    });
  }

  private messageViews(channelId: string, messages: readonly ChannelMessageRecord[]): ChannelMessageView[] {
    const replyIds = [...new Set(messages.flatMap((message) => (message.replyToId ? [message.replyToId] : [])))];
    const loaded = new Map(messages.map((message) => [message.id, message]));
    const missing = replyIds.filter((id) => !loaded.has(id));
    for (const [id, message] of this.repository.getMessages(channelId, missing)) loaded.set(id, message);
    const members = this.repository.listMembers(channelId);
    const handles = this.memberHandles(members);
    const authorChatIds = [...new Set([...loaded.values()].flatMap((message) => (message.author.kind === 'chat' ? [message.author.chatId] : [])))];
    const locations = this.deps.resolveChats(authorChatIds);
    const authorView = (author: ChannelMessageAuthor): ChannelAuthorView => {
      if (author.kind === 'user') return { kind: 'user', handle: USER_HANDLE };
      const location = locations.get(author.chatId);
      return {
        kind: 'chat',
        chatId: author.chatId,
        droneId: location?.droneId ?? author.droneId,
        droneName: location?.droneName || author.droneName || author.droneId,
        chatName: location?.chatName ?? author.chatName,
        handle: handles.get(author.chatId) ?? null,
      };
    };
    return messages.map((message) => {
      const reply = message.replyToId ? loaded.get(message.replyToId) : undefined;
      return {
        id: message.id,
        seq: message.seq,
        createdAt: message.createdAt,
        author: authorView(message.author),
        text: message.text,
        replyTo: reply ? { id: reply.id, author: authorView(reply.author), text: preview(reply.text, REPLY_PREVIEW_CHARS) } : null,
        mentions: message.mentions,
        mentionsUser: message.mentionsUser,
      };
    });
  }

  private explicitMentions(
    raw: unknown,
    handles: ReadonlyMap<string, string>,
    members: readonly ChannelMemberRecord[],
  ): ChannelMessageMention[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new ChannelError(400, 'mentions must be a list of member handles');
    const byHandle = new Map([...handles].map(([chatId, handle]) => [handle.toLowerCase(), chatId]));
    const memberIds = new Set(members.map((member) => member.chatId));
    return raw.map((item) => {
      const value = String(item ?? '').trim().replace(/^@/, '');
      if (value.toLowerCase() === USER_HANDLE) return { kind: 'user' as const, handle: USER_HANDLE };
      const chatId = byHandle.get(value.toLowerCase()) ?? (memberIds.has(value) ? value : undefined);
      if (!chatId) throw new ChannelError(400, `not a member of this channel: ${String(item)}`);
      return { kind: 'chat' as const, chatId, handle: handles.get(chatId)! };
    });
  }

  private resolveChatRef(ref: ChannelChatRef): ChannelChatLocation | null {
    const chatId = String(ref?.chatId ?? '').trim();
    if (chatId) return this.deps.resolveChats([chatId]).get(chatId) ?? null;
    const drone = String(ref?.drone ?? '').trim();
    if (!drone) return null;
    const chatName = String(ref?.chat ?? '').trim() || 'default';
    const found = this.repository.findChat(drone, chatName);
    if (!found) return null;
    return this.deps.resolveChats([found.chatId]).get(found.chatId) ?? found;
  }

  /** A member named by chat ID, handle, or drone and chat name. */
  private memberChatId(channelId: string, ref: ChannelChatRef): string {
    const chatId = String(ref?.chatId ?? '').trim();
    const members = this.repository.listMembers(channelId);
    if (chatId) {
      if (members.some((member) => member.chatId === chatId)) return chatId;
      const handle = chatId.replace(/^@/, '').toLowerCase();
      for (const [id, value] of this.memberHandles(members)) if (value.toLowerCase() === handle) return id;
      throw new ChannelError(404, 'that chat is not a member of this channel');
    }
    // A qualified handle (`@drone/chat`) reads like a drone and chat name.
    const qualified = `${String(ref?.drone ?? '').replace(/^@/, '')}/${String(ref?.chat ?? '')}`.toLowerCase();
    for (const [id, value] of this.memberHandles(members)) if (value.toLowerCase() === qualified) return id;
    const location = this.resolveChatRef(ref);
    if (!location) throw new ChannelError(404, `chat not found: ${describeChatRef(ref)}`);
    return location.chatId;
  }

  private requireChannel(channelId: string): Channel {
    const channel = this.repository.getChannel(String(channelId ?? '').trim());
    if (!channel) throw new ChannelError(404, 'channel not found');
    return channel;
  }

  private requireMember(channelId: string, actor: Extract<ChannelActor, { kind: 'chat' }>): ChannelMemberRecord {
    const member = this.repository.getMember(channelId, actor.chatId);
    if (!member) throw new ChannelError(403, 'this chat is not a member of that channel');
    return member;
  }

  private requireUser(actor: ChannelActor, action: string): void {
    if (actor.kind !== 'user') throw new ChannelError(403, `only the user can ${action}`);
  }
}

function eventAuthor(author: ChannelMessageAuthor, handles: ReadonlyMap<string, string>) {
  if (author.kind === 'user') return { kind: 'user' as const, handle: USER_HANDLE };
  return {
    kind: 'chat' as const,
    handle: handles.get(author.chatId) ?? `${author.droneName}/${author.chatName}`,
    chatId: author.chatId,
    drone: author.droneName,
    chat: author.chatName,
  };
}

function mergeMentions(...lists: ChannelMessageMention[][]): ChannelMessageMention[] {
  const merged = new Map<string, ChannelMessageMention>();
  for (const mention of lists.flat()) {
    merged.set(mention.kind === 'user' ? 'user' : `chat:${mention.chatId}`, mention);
  }
  return [...merged.values()];
}

function preview(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describeChatRef(ref: ChannelChatRef): string {
  if (ref?.chatId) return String(ref.chatId);
  return `${String(ref?.drone ?? '')}/${String(ref?.chat ?? 'default')}`;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new ChannelError(400, `${name} must be true or false`);
  return value;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function optionalSeq(raw: unknown, name: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new ChannelError(400, `${name} must be a message sequence number`);
  return Math.floor(value);
}
