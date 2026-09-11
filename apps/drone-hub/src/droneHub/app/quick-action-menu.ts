import type { ShortcutActionId } from './shortcuts';

export const QUICK_ACTION_ROWS = ['qwert', 'asdf', 'zxcv'] as const;
export type QuickAction = {
  key: string;
  label: string;
} & ({ action: ShortcutActionId; children?: never } | { children: readonly QuickAction[]; action?: never });

// Every level uses the same key positions. Add children to any item to nest further.
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: 'q', label: 'Create', children: [
    { key: 'q', label: 'Root drone', action: 'createDraftDrone' },
    { key: 'w', label: 'Drone in group', action: 'createDraftDroneInCurrentGroup' },
    { key: 'e', label: 'New chat', action: 'createDroneChat' },
    { key: 'r', label: 'Clone chat', action: 'cloneDroneChat' },
    { key: 't', label: 'Fork chat', action: 'createSideChat' },
    { key: 'a', label: 'New drone group', action: 'createDraftGroup' },
    { key: 's', label: 'New chat group', action: 'createChatGroup' },
  ] },
  { key: 'w', label: 'Windows', children: [
    { key: 'r', label: 'Pull requests', action: 'openPullRequestsTab' },
    { key: 't', label: 'Terminal', action: 'openTerminalTab' },
    { key: 'f', label: 'File Explorer', action: 'openFilesTab' },
    { key: 'x', label: 'Canvas', action: 'openCanvasTab' },
    { key: 'c', label: 'Changes', action: 'openChangesTab' },
  ] },
  { key: 'a', label: 'Organize drone', children: [
    { key: 'q', label: 'Pin / unpin', action: 'toggleSelectedDronePinned' },
    { key: 'w', label: 'Move to top', action: 'moveSelectedDroneToTop' },
    { key: 'e', label: 'Toggle to do', action: 'toggleSelectedDronesToDo' },
    { key: 'r', label: 'Align floating chats', action: 'alignFloatingChats' },
  ] },
  { key: 'd', label: 'Main / floating chat', action: 'toggleSideChatMain' },
  { key: 'z', label: 'Mark unread', action: 'markSelectedDronesUnread' },
  { key: 'v', label: 'Home', action: 'openHome' },
];

export type QuickActionUnavailable = Partial<Record<ShortcutActionId, string>>;
export type QuickActionSnapshot = {
  path: readonly QuickAction[];
  items: readonly QuickAction[];
  unavailable: QuickActionUnavailable;
  labels: Partial<Record<ShortcutActionId, string>>;
} | null;

export function quickActionDisabledReason(item: QuickAction, unavailable: QuickActionUnavailable): string | undefined {
  if (item.action) return unavailable[item.action];
  const reasons = item.children.map((child) => quickActionDisabledReason(child, unavailable));
  return reasons.length > 0 && reasons.every(Boolean) ? reasons[0] : undefined;
}

type MenuKeyEvent = Pick<KeyboardEvent, 'key' | 'repeat' | 'isComposing' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Synchronous state keeps rapid sequences independent of React's render timing. */
export function createQuickActionController(
  execute: (action: ShortcutActionId) => void,
  commit: (update: () => void) => void = (update) => update(),
  root: readonly QuickAction[] = QUICK_ACTIONS,
) {
  let snapshot: QuickActionSnapshot = null;
  const listeners = new Set<() => void>();
  const update = (next: QuickActionSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const close = () => update(null);
  const back = () => {
    if (!snapshot?.path.length) return;
    const path = snapshot.path.slice(0, -1);
    update({ ...snapshot, path, items: path[path.length - 1]?.children ?? root });
  };
  const select = (key: string) => {
    if (!snapshot) return;
    const item = snapshot.items.find((entry) => entry.key === key);
    if (!item || quickActionDisabledReason(item, snapshot.unavailable)) return;
    if (item.children) {
      update({ ...snapshot, path: [...snapshot.path, item], items: item.children });
    } else {
      // Remove the modal and its focus trap before the action focuses its target.
      commit(close);
      execute(item.action);
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    open: (unavailable: QuickActionUnavailable = {}, labels: Partial<Record<ShortcutActionId, string>> = {}) =>
      update({ path: [], items: root, unavailable, labels }),
    close,
    back,
    select,
    handleKey: (event: MenuKeyEvent): boolean => {
      if (!snapshot) return false;
      // Preserve native focus navigation and button activation inside the dialog.
      if (!event.isComposing && ['Tab', 'Enter', ' '].includes(event.key)) return false;
      if (event.repeat || event.isComposing) return true;
      if (event.key === 'Escape') close();
      else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        if (event.key === 'Backspace') back();
        else select(event.key.toLowerCase());
      }
      // Unknown keys never fall through to background shortcuts.
      return true;
    },
  };
}
