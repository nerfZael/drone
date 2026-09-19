import { create } from 'zustand';

/** Busy state is per workspace and shared by all views, including desktop portals. */
export const useSideChatBusyStore = create<{ busy: Record<string, boolean> }>(() => ({ busy: {} }));
export function setSideChatBusy(droneId: string, busy: boolean) {
  useSideChatBusyStore.setState(state => {
    const next = { ...state.busy };
    // Keep an explicit false so a menu rendering before its sibling marker
    // commits does not mistake the old DOM busy value for current state.
    next[droneId] = busy;
    return { busy: next };
  });
}
