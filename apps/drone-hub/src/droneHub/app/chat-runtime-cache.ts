import { CacheExpiryTimer } from '@drone/hub-model';
import type { ChatInfo } from '../../domain';
import type { PendingPrompt, TranscriptItem } from '../types';
import { chatSelectionKey } from './chat-selection-model';
import { deleteNativeChatSnapshot, renameNativeChatSnapshot } from '../assistant/native-chat-cache';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';

export const CHAT_RUNTIME_CACHE_TTL_MS = 30_000;
export const CHAT_RUNTIME_SNAPSHOT_TTL_MS = 5 * 60_000;

const CHAT_RUNTIME_CACHE_MAX_ENTRIES = 40;

type TimedValue<T> = {
  atMs: number;
  value: T;
};

type ChatRuntimeCacheEntry = {
  chatInfo?: TimedValue<ChatInfo>;
  pending?: TimedValue<PendingPrompt[]>;
  transcripts?: TimedValue<TranscriptItem[]>;
};

export type ChatRuntimeCacheSnapshot = {
  chatInfo?: ChatInfo;
  pending?: PendingPrompt[];
  transcripts?: TranscriptItem[];
};

const cache = new Map<string, ChatRuntimeCacheEntry>();
const fields = ['chatInfo', 'pending', 'transcripts'] as const;
const expiry = new CacheExpiryTimer((nowMs) => {
  let next: number | null = null;
  for (const [key, entry] of cache) {
    for (const field of fields) {
      const value = entry[field];
      if (!value) continue;
      const deadline = value.atMs + CHAT_RUNTIME_SNAPSHOT_TTL_MS;
      if (deadline <= nowMs) delete entry[field];
      else next = next === null ? deadline : Math.min(next, deadline);
    }
    if (Object.keys(entry).length === 0) cache.delete(key);
  }
  return next;
});

export function chatRuntimeCacheKey(
  droneId: string | null | undefined,
  chatName: string | null | undefined,
): string {
  return chatSelectionKey(droneId, chatName);
}

export function readFreshChatRuntimeCache(
  key: string,
  nowMs = Date.now(),
): ChatRuntimeCacheSnapshot | null {
  return readCache(key, nowMs, CHAT_RUNTIME_CACHE_TTL_MS);
}

/** Display the last visit immediately, but still revalidate stale configuration. */
export function readChatRuntimeSnapshot(key: string, nowMs = Date.now()): ChatRuntimeCacheSnapshot | null {
  return readCache(key, nowMs, CHAT_RUNTIME_SNAPSHOT_TTL_MS);
}

function readCache(key: string, nowMs: number, maxAge: number): ChatRuntimeCacheSnapshot | null {
  const entry = key ? cache.get(key) : null;
  if (!entry) return null;

  const snapshot: ChatRuntimeCacheSnapshot = {};
  for (const field of fields) {
    const timedValue = entry[field];
    if (!timedValue) continue;
    if (nowMs - timedValue.atMs >= maxAge) {
      if (nowMs - timedValue.atMs >= CHAT_RUNTIME_SNAPSHOT_TTL_MS) delete entry[field];
      continue;
    }
    (snapshot as Record<string, unknown>)[field] = timedValue.value;
  }

  if (Object.keys(snapshot).length > 0) return snapshot;
  if (Object.keys(entry).length === 0) deleteChatRuntimeCache(key);
  return null;
}

export function writeChatRuntimeCache(
  key: string,
  patch: ChatRuntimeCacheSnapshot,
  atMs = Date.now(),
): void {
  if (!key) return;
  if (!cache.has(key) && cache.size >= CHAT_RUNTIME_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === 'string') cache.delete(oldestKey);
  }
  const entry = cache.get(key) ?? {};
  if (patch.chatInfo) entry.chatInfo = { atMs, value: patch.chatInfo };
  if (patch.pending) entry.pending = { atMs, value: patch.pending };
  if (patch.transcripts) entry.transcripts = { atMs, value: patch.transcripts };
  cache.delete(key);
  cache.set(key, entry);
  for (const field of fields) {
    if (entry[field]) expiry.schedule(entry[field].atMs + CHAT_RUNTIME_SNAPSHOT_TTL_MS);
  }
}

export function deleteChatRuntimeCache(key: string): void {
  const separator = key.indexOf('\u0000');
  if (separator >= 0) deleteNativeChatSnapshot(key.slice(0, separator), key.slice(separator + 1));
  if (key) cache.delete(key);
  if (cache.size === 0) expiry.clear();
}

export function renameChatRuntimeCache(
  droneId: string,
  oldChatName: string,
  newChatName: string,
): void {
  const oldKey = chatRuntimeCacheKey(droneId, oldChatName);
  const newKey = chatRuntimeCacheKey(droneId, newChatName);
  if (!oldKey || !newKey || oldKey === newKey) return;
  const oldEntry = cache.get(oldKey);
  if (!oldEntry) deleteChatRuntimeCache(newKey);
  // Native chats keep their warm view in a cache of their own.
  renameNativeChatSnapshot(droneId, oldChatName, newChatName);
  if (!oldEntry) return;
  const renamedEntry = { ...oldEntry };
  const oldChatInfo = oldEntry.chatInfo;
  if (oldChatInfo) {
    renamedEntry.chatInfo = {
      atMs: oldChatInfo.atMs,
      value: { ...oldChatInfo.value, chat: String(newChatName).trim() || 'default' },
    };
  }
  cache.delete(oldKey);
  cache.delete(newKey);
  cache.set(newKey, renamedEntry);
}

export const chatRuntimeCacheTesting = {
  entryCount: () => cache.size,
  fieldCount: () => [...cache.values()].reduce((count, entry) => count + Object.keys(entry).length, 0),
  reset() {
    cache.clear();
    expiry.clear();
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const id = disposedDroneIdFromEvent(event);
    if (!id) return;
    for (const key of cache.keys()) if (key.startsWith(`${id}\u0000`)) deleteChatRuntimeCache(key);
  });
}
