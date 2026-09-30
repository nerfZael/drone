import { listChatsFromStore } from './transcript-store';

/** Node lifecycle records omit chats; SQLite is authoritative, even when empty. */
export function droneChatNames(droneId: string, legacyChats?: Record<string, unknown>): string[] {
  if ((globalThis as any).Bun && legacyChats) return Object.keys(legacyChats);
  const stored = listChatsFromStore({ droneId });
  return stored.available ? stored.chats : Object.keys(legacyChats ?? {});
}
