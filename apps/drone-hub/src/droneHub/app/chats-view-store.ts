import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { profileStorageKey } from '../../profile-storage';

export type ChatsView = 'list' | 'grid';
export const CHATS_VIEWS: readonly ChatsView[] = ['list', 'grid'];

export function normalizeChatsView(raw: unknown): ChatsView {
  return CHATS_VIEWS.includes(raw as ChatsView) ? (raw as ChatsView) : 'list';
}

/** How the Chats window lays out a drone's chats. Shared by the window body and its dock tab. */
export const useChatsViewStore = create<{ view: ChatsView; setView: (view: ChatsView) => void }>()(
  persist(
    (set) => ({
      view: 'list',
      setView: (view) => set({ view: normalizeChatsView(view) }),
    }),
    {
      name: profileStorageKey('droneHub.chatsView'),
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ view: state.view }),
      merge: (persisted, current) => ({
        ...current,
        view: normalizeChatsView((persisted as { view?: unknown } | undefined)?.view),
      }),
    },
  ),
);
