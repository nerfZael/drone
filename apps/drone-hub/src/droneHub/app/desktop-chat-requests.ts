import { create } from 'zustand';
import { detachedChatKey } from './detached-chat-store';

export type DesktopChat = { droneId: string; chatName: string; request: number };

function desktopChatWindowKey(windows: Record<string, DesktopChat>, droneId: string, chatName: string): string | null {
  return Object.keys(windows).find((key) => windows[key]!.droneId === droneId && windows[key]!.chatName === chatName) ?? null;
}

// Desktop views have their own lifecycle and never alter the Hub's detached
// panels, selected chat, or workspace layout.
export const useDesktopChatRequests = create<{
  windows: Record<string, DesktopChat>;
  request(droneId: string, chatName: string): void;
  /** The open window keeps its key, so it stays open on the renamed chat. */
  rename(droneId: string, oldName: string, newName: string): void;
  close(key: string): void;
}>((set, get) => ({
  windows: {},
  request(droneId, chatName) {
    if (!window.droneHubDesktop?.setChatWindowAlwaysOnTop) return;
    const windows = get().windows;
    const key = desktopChatWindowKey(windows, droneId, chatName) ?? detachedChatKey(droneId, chatName);
    set({ windows: { ...windows, [key]: { droneId, chatName, request: (windows[key]?.request ?? 0) + 1 } } });
  },
  rename(droneId, oldName, newName) {
    const windows = get().windows;
    const key = desktopChatWindowKey(windows, droneId, oldName);
    if (!key || oldName === newName) return;
    set({ windows: { ...windows, [key]: { ...windows[key]!, chatName: newName } } });
  },
  close(key) {
    const windows = { ...get().windows };
    delete windows[key];
    set({ windows });
  },
}));
