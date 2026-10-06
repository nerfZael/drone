import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { profileStorageKey } from '../../profile-storage';
import type { DroneSummary } from '../types';
import type { WorkspaceRect } from './side-chat-placement';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';

export type DetachedChat = { droneId: string; chatName: string; open: boolean; bounds?: WorkspaceRect };
export const detachedChatKey = (droneId: string, chatName: string) => JSON.stringify([droneId, chatName]);

/**
 * The key of the window showing this chat. A window keeps the key it opened
 * with when its chat is renamed, so it is found by its chat, not by its key.
 */
export function chatWindowKey(
  windows: Readonly<Record<string, { droneId: string; chatName: string }>>,
  droneId: string,
  chatName: string,
): string | null {
  return Object.keys(windows).find((key) => windows[key]!.droneId === droneId && windows[key]!.chatName === chatName) ?? null;
}

/** The chat's window key, or a new one that no renamed chat's window still holds. */
export function openChatWindowKey(
  windows: Readonly<Record<string, { droneId: string; chatName: string }>>,
  droneId: string,
  chatName: string,
): string {
  const existing = chatWindowKey(windows, droneId, chatName);
  if (existing) return existing;
  let key = detachedChatKey(droneId, chatName);
  for (let n = 2; windows[key]; n += 1) key = JSON.stringify([droneId, chatName, n]);
  return key;
}
export const DETACHED_CHAT_FOCUS_EVENT = 'drone-hub:focus-detached-chat';
export const DETACHED_CHAT_BEFORE_ATTACH_EVENT = 'drone-hub:before-attach-chat';

export function detachableDroneChat(drone: Pick<DroneSummary, 'chats' | 'workflowChats'>): string | null {
  const chats = [...new Set([...drone.chats, ...(drone.workflowChats ?? [])])];
  return chats.length === 1 && chats[0] === 'default' ? 'default' : null;
}

export function normalizeDetachedChats(value: unknown): Record<string, DetachedChat> {
  const chats: Record<string, DetachedChat> = {};
  if (!value || typeof value !== 'object') return chats;
  for (const raw of Object.values(value)) {
    if (!raw || typeof raw.droneId !== 'string' || !raw.droneId.trim() || typeof raw.chatName !== 'string' || !raw.chatName.trim()) continue;
    const bounds = raw.bounds;
    const validBounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
    chats[detachedChatKey(raw.droneId, raw.chatName)] = { droneId: raw.droneId, chatName: raw.chatName, open: raw.open === true, ...(validBounds ? { bounds } : {}) };
  }
  return chats;
}

type DetachedChatState = {
  chats: Record<string, DetachedChat>;
  detach(droneId: string, chatName: string): void;
  attach(key: string): void;
  saveBounds(key: string, bounds: WorkspaceRect): void;
  forgetDrone(droneId: string): void;
  rename(droneId: string, oldName: string, newName: string): void;
  forgetChat(droneId: string, chatName: string): void;
};

export const useDetachedChatStore = create<DetachedChatState>()(persist((set, get) => ({
  chats: {},
  detach(droneId, chatName) {
    const key = openChatWindowKey(get().chats, droneId, chatName);
    set({ chats: { ...get().chats, [key]: { ...get().chats[key], droneId, chatName, open: true } } });
    window.dispatchEvent(new CustomEvent(DETACHED_CHAT_FOCUS_EVENT, { detail: { key } }));
  },
  attach(key) {
    window.dispatchEvent(new CustomEvent(DETACHED_CHAT_BEFORE_ATTACH_EVENT));
    const chat = get().chats[key];
    if (chat) set({ chats: { ...get().chats, [key]: { ...chat, open: false } } });
  },
  saveBounds(key, bounds) {
    const chat = get().chats[key];
    if (chat && JSON.stringify(chat.bounds) !== JSON.stringify(bounds)) {
      set({ chats: { ...get().chats, [key]: { ...chat, bounds } } });
    }
  },
  rename(droneId, oldName, newName) {
    // The window keeps its key, so it stays open and in place on the renamed chat.
    const key = chatWindowKey(get().chats, droneId, oldName);
    if (!key || oldName === newName) return;
    set({ chats: { ...get().chats, [key]: { ...get().chats[key]!, chatName: newName } } });
  },
  forgetChat(droneId, chatName) {
    const key = chatWindowKey(get().chats, droneId, chatName);
    if (!key) return;
    const chats = { ...get().chats };
    delete chats[key];
    set({ chats });
  },
  forgetDrone(droneId) {
    set({ chats: Object.fromEntries(Object.entries(get().chats).filter(([, chat]) => chat.droneId !== droneId)) });
  },
}), { name: profileStorageKey('droneHub.detachedChats'), partialize: ({ chats }) => ({ chats }),
  merge: (persisted, current) => ({ ...current, chats: normalizeDetachedChats((persisted as { chats?: unknown })?.chats) }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (droneId) useDetachedChatStore.getState().forgetDrone(droneId);
  });
}
