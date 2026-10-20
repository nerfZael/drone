import React from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { requestJson } from '../http';
import { subscribeDesktopEvents } from '../app/desktop-events';

/** Mirrors apps/drone/src/hub/channels/channel-service.ts. */
export type ChannelSubscriptionMode = 'none' | 'mentions' | 'all';

export type ChannelSummary = {
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

export type ChannelMember = {
  chatId: string;
  handle: string;
  droneId: string;
  droneName: string;
  chatName: string;
  available: boolean;
  canRead: boolean;
  canSend: boolean;
  subscription: ChannelSubscriptionMode;
  subscriptionPaused: boolean;
  addedBy: { kind: 'user' } | { kind: 'chat'; chatId: string; label: string };
  addedAt: string;
};

export type ChannelAuthor =
  | { kind: 'user'; handle: string }
  | { kind: 'chat'; chatId: string; droneId: string; droneName: string; chatName: string; handle: string | null };

export type ChannelMention = { kind: 'user'; handle: string } | { kind: 'chat'; chatId: string; handle: string };

export type ChannelMessage = {
  id: string;
  seq: number;
  createdAt: string;
  author: ChannelAuthor;
  text: string;
  replyTo: { id: string; author: ChannelAuthor; text: string } | null;
  mentions: ChannelMention[];
  mentionsUser: boolean;
};

export type ChannelDetail = {
  channel: { id: string; name: string; lastSeq: number; userLastReadSeq: number; createdAt: string };
  members: ChannelMember[];
};

export type ChannelMessagesPage = {
  channel: { id: string; name: string; lastSeq: number; userLastReadSeq: number };
  messages: ChannelMessage[];
  hasMore: boolean;
};

export type ChannelChatRef = { chatId: string } | { droneId: string; chatName: string };

const post = <T>(url: string, body: unknown) =>
  requestJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const path = (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}`;

export const createChannel = async (name: string) =>
  (await post<{ channel: ChannelSummary }>('/api/channels', { name })).channel;
export const renameChannel = (channelId: string, name: string) => post(`${path(channelId)}/rename`, { name });
export const deleteChannel = (channelId: string) => requestJson(path(channelId), { method: 'DELETE' });
export const markChannelRead = (channelId: string, seq: number) => post(`${path(channelId)}/read`, { seq });
export const sendChannelMessage = async (channelId: string, text: string, replyTo: string | null) =>
  (await post<{ message: ChannelMessage }>(`${path(channelId)}/messages`, { text, ...(replyTo ? { replyTo } : {}) })).message;
export const addChannelMembers = (channelId: string, members: ChannelChatRef[]) =>
  post<{ added: ChannelMember[]; alreadyMembers: string[]; subscriptionErrors?: Array<{ chatId: string; error: string }> }>(
    `${path(channelId)}/members`,
    { members },
  );
export const removeChannelMember = (channelId: string, chatId: string) =>
  post(`${path(channelId)}/members/remove`, { member: { chatId } });
export const updateChannelMember = (
  channelId: string,
  chatId: string,
  input: { canRead?: boolean; canSend?: boolean; subscription?: ChannelSubscriptionMode },
) => post<{ member: ChannelMember }>(`${path(channelId)}/members/${encodeURIComponent(chatId)}`, input);
export const loadOlderChannelMessages = (channelId: string, beforeSeq: number) =>
  requestJson<ChannelMessagesPage>(`${path(channelId)}/messages?${new URLSearchParams({ beforeSeq: String(beforeSeq), limit: '100' })}`);

const LIST_KEY = ['channels'] as const;
const detailKey = (channelId: string) => ['channels', 'detail', channelId] as const;
const messagesKey = (channelId: string) => ['channels', 'messages', channelId] as const;

/** One event listener per query client, however many channel views are open. */
const invalidationListeners = new Map<QueryClient, { refs: number; stop: () => void }>();

/**
 * Refetches channel queries when the Hub says a channel changed (any window, any agent),
 * and once more after the event stream reconnects.
 */
function listenForChannelChanges(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Per channel (null: every channel), the parts to refetch. A read position only moves list counts.
  const pending = new Map<string | null, Set<'detail' | 'messages'>>();
  const flush = () => {
    for (const [channelId, parts] of pending) {
      for (const part of parts) {
        void client.invalidateQueries({ queryKey: channelId ? ['channels', part, channelId] : ['channels', part] });
      }
    }
    void client.invalidateQueries({ queryKey: LIST_KEY, exact: true });
    pending.clear();
  };
  const refresh = (channelId: string | null, scope: unknown) => {
    const parts = pending.get(channelId) ?? new Set();
    // Member changes also move handles and names that messages show.
    if (scope !== 'read' && scope !== 'messages') parts.add('detail');
    if (scope !== 'read') parts.add('messages');
    pending.set(channelId, parts);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 40);
  };
  const unsubscribe = subscribeDesktopEvents({
    handlers: {
      channels_changed: (event) => {
        let change: { channelId?: string | null; scope?: string } = {};
        try {
          change = JSON.parse(event.data) ?? {};
        } catch {
          change = {};
        }
        refresh(change.channelId ?? null, change.scope ?? 'all');
      },
    },
    onConnectedChange: (connected) => {
      if (connected) refresh(null, 'all');
    },
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}

function useChannelInvalidation(): void {
  const client = useQueryClient();
  React.useEffect(() => {
    const current = invalidationListeners.get(client);
    if (current) current.refs += 1;
    else invalidationListeners.set(client, { refs: 1, stop: listenForChannelChanges(client) });
    return () => {
      const listener = invalidationListeners.get(client);
      if (!listener || --listener.refs > 0) return;
      listener.stop();
      invalidationListeners.delete(client);
    };
  }, [client]);
}

export function useChannelList() {
  useChannelInvalidation();
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async ({ signal }) => (await requestJson<{ channels: ChannelSummary[] }>('/api/channels', { signal })).channels,
  });
}

/** Unread mentions of the user across channels, for the Channels button's badge. */
export function useChannelMentionCount(): number {
  const list = useChannelList();
  return (list.data ?? []).reduce((total, channel) => total + channel.mentionCount, 0);
}

export function useChannelDetail(channelId: string | null) {
  return useQuery({
    queryKey: detailKey(channelId ?? ''),
    queryFn: ({ signal }) => requestJson<ChannelDetail>(path(channelId!), { signal }),
    enabled: Boolean(channelId),
  });
}

/** The newest page; older pages are loaded on demand and kept beside it. */
export function useChannelMessages(channelId: string | null) {
  return useQuery({
    queryKey: messagesKey(channelId ?? ''),
    queryFn: ({ signal }) =>
      requestJson<ChannelMessagesPage>(`${path(channelId!)}/messages?limit=200`, { signal }),
    enabled: Boolean(channelId),
  });
}

export function useRefreshChannels() {
  const client = useQueryClient();
  return React.useCallback(
    (channelId?: string | null) => {
      void client.invalidateQueries({ queryKey: LIST_KEY, exact: true });
      if (channelId) {
        void client.invalidateQueries({ queryKey: detailKey(channelId) });
        void client.invalidateQueries({ queryKey: messagesKey(channelId) });
      }
    },
    [client],
  );
}
