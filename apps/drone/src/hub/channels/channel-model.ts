/**
 * Channels: hub-wide chat rooms where the user and member agent chats post messages.
 * Members are agent chats, identified by their stable chat ID; the user is always in every channel.
 */

export const CHANNEL_NAME_MAX_CHARS = 80;
export const CHANNEL_MESSAGE_MAX_CHARS = 20_000;
export const CHANNEL_MESSAGES_PAGE_MAX = 200;
export const CHANNEL_MEMBERS_MAX = 100;
/** Runaway agents talking to each other stop here; the subscription run budget usually stops them first. */
export const CHANNEL_CHAT_MESSAGES_PER_HOUR = 500;
export const USER_HANDLE = 'user';

export type ChannelSubscriptionMode = 'none' | 'mentions' | 'all';

/** Who did something in a channel: the user, or an agent chat. */
export type ChannelActor = { kind: 'user' } | { kind: 'chat'; chatId: string; droneId: string; chatName: string };

export type ChannelChatLocation = {
  chatId: string;
  droneId: string;
  chatName: string;
  droneName?: string;
  droneChatCount?: number;
};

export type Channel = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
  lastMessageAt: string | null;
  userLastReadSeq: number;
};

export type ChannelMemberRecord = {
  channelId: string;
  chatId: string;
  /** Where the chat was when last seen; kept so a chat that is archived or deleted still has a name. */
  droneId: string;
  chatName: string;
  droneName: string;
  canRead: boolean;
  canSend: boolean;
  /** The chat that added this one, or null when the user did. */
  addedByChatId: string | null;
  addedAt: string;
};

export type ChannelMessageAuthor =
  | { kind: 'user' }
  | { kind: 'chat'; chatId: string; droneId: string; chatName: string; droneName: string };

export type ChannelMessageMention = { kind: 'user'; handle: string } | { kind: 'chat'; chatId: string; handle: string };

export type ChannelMessageRecord = {
  id: string;
  channelId: string;
  seq: number;
  createdAt: string;
  author: ChannelMessageAuthor;
  text: string;
  replyToId: string | null;
  mentions: ChannelMessageMention[];
  /** The user was @mentioned or someone replied to one of the user's messages. */
  mentionsUser: boolean;
};

export function normalizeChannelName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('channel name must be a string');
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
  if (!name) throw new Error('channel name is required');
  if (name.length > CHANNEL_NAME_MAX_CHARS) {
    throw new Error(`channel name must be at most ${CHANNEL_NAME_MAX_CHARS} characters`);
  }
  return name;
}

export function normalizeChannelMessageText(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('message text must be a string');
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('message text is required');
  if (text.length > CHANNEL_MESSAGE_MAX_CHARS) {
    throw new Error(`message text must be at most ${CHANNEL_MESSAGE_MAX_CHARS} characters`);
  }
  return text;
}

export function normalizeChannelSubscriptionMode(raw: unknown): ChannelSubscriptionMode {
  if (raw === 'none' || raw === 'mentions' || raw === 'all') return raw;
  throw new Error('subscription must be one of none, mentions, all');
}

export function channelSubscriptionEvents(mode: Exclude<ChannelSubscriptionMode, 'none'>) {
  return mode === 'all' ? (['channel.message', 'channel.mention'] as const) : (['channel.mention'] as const);
}

export function channelSubscriptionModeFromEvents(events: readonly string[] | null | undefined): ChannelSubscriptionMode {
  if (!events?.length) return 'none';
  if (events.includes('channel.message')) return 'all';
  return events.includes('channel.mention') ? 'mentions' : 'none';
}

function handleSlug(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The `@handle` of each member: the chat name, or the drone name for a drone's default chat.
 * Names that collide (or would read as `@user`) are qualified with the drone: `@drone/chat`.
 */
export function channelMemberHandles(
  members: ReadonlyArray<{ chatId: string; droneName: string; chatName: string }>,
): Map<string, string> {
  const base = (member: (typeof members)[number]) => {
    const drone = handleSlug(member.droneName) || 'drone';
    const chat = handleSlug(member.chatName) || 'chat';
    const short = member.chatName === 'default' ? drone : chat;
    return { short, long: `${drone}/${chat}` };
  };
  const candidates = members.map((member) => ({ member, ...base(member) }));
  const shortCounts = new Map<string, number>();
  for (const { short } of candidates) shortCounts.set(short, (shortCounts.get(short) ?? 0) + 1);
  const taken = new Set<string>([USER_HANDLE]);
  const handles = new Map<string, string>();
  for (const { member, short, long } of candidates) {
    let handle = shortCounts.get(short) === 1 && short !== USER_HANDLE ? short : long;
    for (let index = 2; taken.has(handle); index += 1) handle = `${long}-${index}`;
    taken.add(handle);
    handles.set(member.chatId, handle);
  }
  return handles;
}

const MENTION_PATTERN = /(^|[^A-Za-z0-9_/@.-])@([A-Za-z0-9][A-Za-z0-9_/-]*)/g;

/**
 * The members a message @mentions. A token matches the longest handle it starts with, so
 * `@drone/chat,` and `@chat's` both resolve; unknown names are left as plain text.
 */
export function parseChannelMentions(
  text: string,
  handles: ReadonlyMap<string, string>,
): ChannelMessageMention[] {
  const byHandle = new Map<string, string>();
  for (const [chatId, handle] of handles) byHandle.set(handle.toLowerCase(), chatId);
  const mentions = new Map<string, ChannelMessageMention>();
  // Code is quoted, not addressed: `@user` in a snippet mentions no one.
  const prose = text.replace(/(`{3,}|~{3,})[\s\S]*?(\1|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const match of prose.matchAll(MENTION_PATTERN)) {
    // A trailing `-` or `/` is punctuation (`@api-`); inside a token both join words, as in handles.
    const token = match[2]!.toLowerCase().replace(/[-/]+$/, '');
    for (let end = token.length; end > 0; end -= 1) {
      const candidate = token.slice(0, end);
      // `@api-gateway` is not `@api`: a handle ends where a word does, as the UI highlights it.
      if (end < token.length && /[A-Za-z0-9_-]/.test(token[end]!) && /[A-Za-z0-9_-]/.test(token[end - 1]!)) continue;
      if (candidate === USER_HANDLE) {
        mentions.set('user', { kind: 'user', handle: USER_HANDLE });
        break;
      }
      const chatId = byHandle.get(candidate);
      if (chatId) {
        mentions.set(`chat:${chatId}`, { kind: 'chat', chatId, handle: handles.get(chatId)! });
        break;
      }
    }
  }
  return [...mentions.values()];
}

/**
 * The routing an event carries for fan-out. Stripped before an agent sees the event.
 * `readerChatIds` are members allowed to read, without the author.
 */
export type ChannelEventRouting = {
  readerChatIds: string[];
  mentionedChatIds: string[];
};

/**
 * Whether a channel event reaches a subscription. Every message produces a `channel.message`
 * event and, when it mentions or replies to chats, a `channel.mention` event; a subscriber that
 * gets the mention never gets the plain message as well.
 */
export function channelEventReachesSubscriber(
  eventType: string,
  routing: Partial<ChannelEventRouting> | null | undefined,
  subscriberChatId: string,
  subscriptionEvents: readonly string[],
): boolean {
  const readers = Array.isArray(routing?.readerChatIds) ? routing!.readerChatIds : [];
  if (!readers.includes(subscriberChatId)) return false;
  const mentioned = (Array.isArray(routing?.mentionedChatIds) ? routing!.mentionedChatIds : []).includes(subscriberChatId);
  if (eventType === 'channel.mention') return mentioned && subscriptionEvents.includes('channel.mention');
  if (eventType === 'channel.message') {
    return subscriptionEvents.includes('channel.message') && !(mentioned && subscriptionEvents.includes('channel.mention'));
  }
  return false;
}

/** Event content as an agent sees it: the routing lists are internal. */
export function channelEventContentForAgent(content: Record<string, unknown>): Record<string, unknown> {
  const { routing: _routing, ...rest } = content;
  return rest;
}

export const CHANNEL_SUBSCRIPTION_INTENT =
  'You are a member of the DroneHub channel named in this event. Messages whose author kind is "user" were written by your user; messages from chats were written by other agents. ' +
  'Decide whether the message needs a response or action from you. Answer in the channel with send_channel_message (replyTo answers a specific message; @handles mention members, @user mentions the user) and use read_channel_messages for earlier context. ' +
  'Do not post messages that only acknowledge.';
