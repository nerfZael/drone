import { ExpiringMap } from '@drone/hub-model';
import type { BlipHistoryPage } from '@blip/protocol';
import type { AssistantBootstrapSnapshot, AssistantSnapshot } from './assistant-types';
import { chatSelectionKey } from '../app/chat-selection-model';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';

const TTL_MS = 5 * 60_000;
const MAX_CHATS = 20;
type Timed<T> = { value: T; expiresAt: number };
const snapshots = new ExpiringMap<string, Timed<AssistantSnapshot>>((entry) => entry.expiresAt);
const histories = new ExpiringMap<string, Timed<BlipHistoryPage>>((entry) => entry.expiresAt);

function read<T>(cache: Map<string, Timed<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function write<T>(cache: Map<string, Timed<T>>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_CHATS) cache.delete(cache.keys().next().value!);
}

export function readNativeChatSnapshot(droneId: string, chatName: string): AssistantBootstrapSnapshot | null {
  const snapshot = read(snapshots, chatSelectionKey(droneId, chatName));
  if (!snapshot) return null;
  const threadId = snapshot.threads[0]?.id ?? '';
  const initialHistory = read(histories, threadId);
  // Without matching history there is no useful warm conversation to restore.
  return initialHistory ? { ...snapshot, initialHistory } : null;
}

export function writeNativeChatSnapshot(droneId: string, chatName: string, snapshot: AssistantSnapshot): void {
  // History has its own bounded cache; don't also retain a bootstrap payload.
  const { initialHistory: _history, ...metadata } = snapshot as AssistantBootstrapSnapshot;
  write(snapshots, chatSelectionKey(droneId, chatName), metadata);
}

export function writeNativeChatHistory(page: BlipHistoryPage): void {
  const entries = page.entries.slice(-200);
  write(histories, page.threadId, {
    ...page, entries,
    page: {
      ...page.page,
      hasOlder: page.page.hasOlder || entries.length < page.entries.length,
      beforeCursor: entries.length < page.entries.length ? entries[0]!.sequence : page.page.beforeCursor,
    },
  });
}

export function deleteNativeChatSnapshot(droneId: string, chatName: string): void {
  const key = chatSelectionKey(droneId, chatName);
  const threadId = snapshots.get(key)?.value.threads[0]?.id;
  snapshots.delete(key);
  if (threadId) histories.delete(threadId);
}

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const id = disposedDroneIdFromEvent(event);
    if (!id) return;
    for (const key of snapshots.keys()) {
      if (key.startsWith(`${id}\u0000`)) deleteNativeChatSnapshot(id, key.slice(id.length + 1));
    }
  });
}
