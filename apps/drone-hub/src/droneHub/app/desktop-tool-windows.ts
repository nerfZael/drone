import { create } from 'zustand';
import type { RightPanelTab } from './app-config';

export type DesktopToolWindow = {
  id: string;
  tab: RightPanelTab;
  /** Set while pinned: the window keeps showing this drone whichever drone the Hub selects. */
  pinnedDroneId: string | null;
  /** Bumped to focus the window again; see DesktopChatWindow. */
  request: number;
};

/**
 * Tools whose pane is bound to the selected drone rather than to the drone it
 * is given: the Browser session lives in a layer above the dock, and Links reads
 * the selected drone's ports. Neither could be pinned truthfully.
 */
const SELECTED_DRONE_ONLY_TABS: ReadonlySet<RightPanelTab> = new Set<RightPanelTab>(['preview', 'links']);

export function desktopToolTabSupported(tab: RightPanelTab | null): tab is RightPanelTab {
  return Boolean(tab) && !SELECTED_DRONE_ONLY_TABS.has(tab!);
}

/** Only the desktop app can give a tool pane its own OS window. */
export function desktopToolWindowsAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.droneHubDesktop?.setChatWindowAlwaysOnTop);
}

/**
 * The lowest id not in use for the tool. A closed window's id comes back, so
 * reopening the Terminal reattaches to the sessions its last window left, the
 * way the dock's fixed pane keys do, instead of leaving them orphaned.
 */
function freeWindowId(windows: Record<string, DesktopToolWindow>, tab: RightPanelTab): string {
  for (let seq = 1; ; seq += 1) {
    const id = `${tab}:${seq}`;
    if (!(id in windows)) return id;
  }
}

// Desktop views have their own lifecycle and never alter the Hub's selected
// drone or workspace layout. Not persisted: OS windows do not outlive a reload.
export const useDesktopToolWindows = create<{
  windows: Record<string, DesktopToolWindow>;
  /** Opens a window for the tool, or focuses the one already following the selected drone. */
  open(tab: RightPanelTab): string | null;
  setPinnedDrone(id: string, droneId: string | null): void;
  close(id: string): void;
}>((set, get) => ({
  windows: {},
  open(tab) {
    if (!desktopToolWindowsAvailable() || !desktopToolTabSupported(tab)) return null;
    const windows = get().windows;
    // A pinned window is a fixed view of its drone; asking for the tool again
    // means another window that follows the selection.
    const following = Object.values(windows).find((item) => item.tab === tab && !item.pinnedDroneId);
    if (following) {
      set({ windows: { ...windows, [following.id]: { ...following, request: following.request + 1 } } });
      return following.id;
    }
    const id = freeWindowId(windows, tab);
    set({ windows: { ...windows, [id]: { id, tab, pinnedDroneId: null, request: 1 } } });
    return id;
  },
  setPinnedDrone(id, droneId) {
    const windows = get().windows;
    const current = windows[id];
    if (!current) return;
    const pinnedDroneId = String(droneId ?? '').trim() || null;
    if (current.pinnedDroneId === pinnedDroneId) return;
    set({ windows: { ...windows, [id]: { ...current, pinnedDroneId } } });
  },
  close(id) {
    const windows = { ...get().windows };
    if (!(id in windows)) return;
    delete windows[id];
    set({ windows });
  },
}));
