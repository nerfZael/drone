import type { DesktopNotificationEvent } from './notifications/DesktopNotificationObserver';

type DroneChatChange = { droneId: string; chatName: string };

type Listener<T> = (change: T) => void;

const desktopNotificationListeners = new Set<Listener<DesktopNotificationEvent>>();

const registryListeners = new Set<Listener<void>>();
const summaryListeners = new Set<Listener<void>>();
const chatListeners = new Set<Listener<DroneChatChange>>();
const resourceDeliveryListeners = new Set<Listener<void>>();
const userWorkspaceListeners = new Set<Listener<void>>();
/** What changed in a channel, so open windows refetch only that. */
export type ChannelChangeScope = 'all' | 'messages' | 'members' | 'read';
type ChannelChange = { channelId: string | null; scope: ChannelChangeScope };
const channelListeners = new Set<Listener<ChannelChange>>();

export const hubChangeEvents = {
  emitDesktopNotification(event: DesktopNotificationEvent): void {
    for (const listener of desktopNotificationListeners) {
      try { listener(event); } catch { /* UI delivery cannot fail a custom event. */ }
    }
  },
  onDesktopNotification(listener: Listener<DesktopNotificationEvent>): () => void {
    desktopNotificationListeners.add(listener);
    return () => desktopNotificationListeners.delete(listener);
  },
  emitResourceDeliveryChange(): void {
    for (const listener of resourceDeliveryListeners) {
      try {
        listener();
      } catch {
        /* A disconnected UI must not interrupt event delivery. */
      }
    }
  },
  onResourceDeliveryChange(listener: Listener<void>): () => void {
    resourceDeliveryListeners.add(listener);
    return () => resourceDeliveryListeners.delete(listener);
  },
  /** Workspaces were added, removed, renamed or moved (Settings → Workspaces). */
  emitUserWorkspacesChange(): void {
    for (const listener of userWorkspaceListeners) {
      try { listener(); } catch { /* A disconnected UI must not interrupt event delivery. */ }
    }
  },
  onUserWorkspacesChange(listener: Listener<void>): () => void {
    userWorkspaceListeners.add(listener);
    return () => userWorkspaceListeners.delete(listener);
  },
  /** A channel changed (null: the channel list as a whole did); `scope` says which part. */
  emitChannelsChange(channelId: string | null = null, scope: ChannelChangeScope = 'all'): void {
    for (const listener of channelListeners) {
      try { listener({ channelId, scope }); } catch { /* A disconnected UI must not interrupt a channel write. */ }
    }
  },
  onChannelsChange(listener: Listener<ChannelChange>): () => void {
    channelListeners.add(listener);
    return () => channelListeners.delete(listener);
  },
  emitRegistryWrite(): void {
    for (const listener of registryListeners) listener();
  },
  emitSummaryChange(): void {
    for (const listener of summaryListeners) listener();
  },
  emitChatWrite(droneId: string, chatName: string): void {
    for (const listener of chatListeners) listener({ droneId, chatName });
  },
  onRegistryWrite(listener: Listener<void>): () => void {
    registryListeners.add(listener);
    return () => registryListeners.delete(listener);
  },
  onSummaryChange(listener: Listener<void>): () => void {
    summaryListeners.add(listener);
    return () => summaryListeners.delete(listener);
  },
  onChatWrite(listener: Listener<DroneChatChange>): () => void {
    chatListeners.add(listener);
    return () => chatListeners.delete(listener);
  },
};
