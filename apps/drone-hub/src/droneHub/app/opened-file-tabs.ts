export type OpenedFileKind = 'text' | 'image' | 'video' | 'binary';

export type OpenedFileTab = {
  tabId: string;
  droneId: string;
  path: string;
  name: string;
  targetLine: number | null;
  targetColumn: number | null;
  navigationSeq: number;
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  error: string | null;
  kind: OpenedFileKind;
  mime: string | null;
  size: number;
  content: string;
  savedContent: string;
  mtimeMs: number | null;
  refreshNonce: number;
};

export type OpenedFileTabsState = {
  tabs: OpenedFileTab[];
  activeTabId: string | null;
};

export function openedFileTabId(droneIdRaw: string, pathRaw: string): string {
  const droneId = encodeURIComponent(String(droneIdRaw ?? '').trim());
  const path = encodeURIComponent(String(pathRaw ?? '').trim());
  return `file:${droneId}:${path}`;
}

export function openedFileTabDirty(tab: OpenedFileTab): boolean {
  return tab.kind === 'text' && tab.content !== tab.savedContent;
}

export function createOpenedFileTab(args: {
  droneId: string;
  path: string;
  name: string;
  targetLine: number | null;
  targetColumn: number | null;
  navigationSeq: number;
}): OpenedFileTab {
  return {
    tabId: openedFileTabId(args.droneId, args.path),
    droneId: args.droneId,
    path: args.path,
    name: args.name,
    targetLine: args.targetLine,
    targetColumn: args.targetColumn,
    navigationSeq: args.navigationSeq,
    loading: false,
    saving: false,
    loaded: false,
    error: null,
    kind: 'text',
    mime: null,
    size: 0,
    content: '',
    savedContent: '',
    mtimeMs: null,
    refreshNonce: 0,
  };
}

export function openFileTab(
  state: OpenedFileTabsState,
  next: {
    droneId: string;
    path: string;
    name: string;
    targetLine: number | null;
    targetColumn: number | null;
    navigationSeq: number;
  },
): OpenedFileTabsState {
  const existingIndex = state.tabs.findIndex((tab) => tab.droneId === next.droneId && tab.path === next.path);
  if (existingIndex >= 0) {
    const tabs = state.tabs.slice();
    const existing = tabs[existingIndex];
    if (!existing) return state;
    tabs[existingIndex] = {
      ...existing,
      name: next.name,
      targetLine: next.targetLine,
      targetColumn: next.targetColumn,
      navigationSeq: next.navigationSeq,
    };
    return { tabs, activeTabId: existing.tabId };
  }

  const tab = createOpenedFileTab(next);
  return {
    tabs: [...state.tabs, tab],
    activeTabId: tab.tabId,
  };
}

export function closeFileTab(state: OpenedFileTabsState, tabIdRaw: string | null | undefined): OpenedFileTabsState {
  const tabId = String(tabIdRaw ?? state.activeTabId ?? '').trim();
  if (!tabId) return state;
  const closingIndex = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (closingIndex < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
  if (state.activeTabId !== tabId) return { tabs, activeTabId: state.activeTabId };
  const nextActive = tabs[closingIndex] ?? tabs[closingIndex - 1] ?? null;
  return { tabs, activeTabId: nextActive?.tabId ?? null };
}

export function activateFileTab(state: OpenedFileTabsState, tabIdRaw: string | null | undefined): OpenedFileTabsState {
  const tabId = String(tabIdRaw ?? '').trim();
  if (!tabId) return state;
  if (!state.tabs.some((tab) => tab.tabId === tabId)) return state;
  return { tabs: state.tabs, activeTabId: tabId };
}

export function reorderFileTabs(
  state: OpenedFileTabsState,
  fromTabIdRaw: string | null | undefined,
  toTabIdRaw: string | null | undefined,
): OpenedFileTabsState {
  const fromTabId = String(fromTabIdRaw ?? '').trim();
  const toTabId = String(toTabIdRaw ?? '').trim();
  if (!fromTabId || !toTabId || fromTabId === toTabId) return state;
  const fromIndex = state.tabs.findIndex((tab) => tab.tabId === fromTabId);
  const toIndex = state.tabs.findIndex((tab) => tab.tabId === toTabId);
  if (fromIndex < 0 || toIndex < 0) return state;

  const tabs = state.tabs.slice();
  const [moved] = tabs.splice(fromIndex, 1);
  if (!moved) return state;
  tabs.splice(toIndex, 0, moved);
  return { tabs, activeTabId: state.activeTabId };
}

export function updateFileTabContent(tabs: OpenedFileTab[], tabIdRaw: string | null | undefined, nextRaw: string): OpenedFileTab[] {
  const tabId = String(tabIdRaw ?? '').trim();
  if (!tabId) return tabs;
  const next = typeof nextRaw === 'string' ? nextRaw : '';
  return tabs.map((tab) => (tab.tabId === tabId && tab.kind === 'text' ? { ...tab, content: next } : tab));
}
