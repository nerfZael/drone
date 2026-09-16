import { create } from 'zustand';
import { detachedChatKey } from './detached-chat-store';

export type DesktopChat = { droneId: string; chatName: string; request: number };

// Desktop views have their own lifecycle and never alter the Hub's detached
// panels, selected chat, or workspace layout.
export const useDesktopChatRequests = create<{
  windows: Record<string, DesktopChat>;
  request(droneId: string, chatName: string): void;
  close(key: string): void;
}>((set, get) => ({
  windows: {},
  request(droneId, chatName) {
    if (!window.droneHubDesktop?.setChatWindowAlwaysOnTop) return;
    const key = detachedChatKey(droneId, chatName);
    const windows = get().windows;
    set({ windows: { ...windows, [key]: { droneId, chatName, request: (windows[key]?.request ?? 0) + 1 } } });
  },
  close(key) {
    const windows = { ...get().windows };
    delete windows[key];
    set({ windows });
  },
}));
