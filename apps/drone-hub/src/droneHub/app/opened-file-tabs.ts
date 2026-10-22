import { untitledEditorPath } from './untitled-editor-files';

export type OpenedFileKind = 'text' | 'large-text' | 'image' | 'video' | 'binary';

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
  revision?: string | null;
  externalRevision?: string | null;
  refreshNonce: number;
  /** A new file made in the editor that has not been saved anywhere yet. */
  untitled?: boolean;
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

function normalizeOpenedFilePath(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '');
}

function pathInsideOrEqual(parentRaw: string | null | undefined, childRaw: string | null | undefined): boolean {
  const parent = normalizeOpenedFilePath(parentRaw);
  const child = normalizeOpenedFilePath(childRaw);
  if (!parent || !child) return false;
  return parent === child || child.startsWith(`${parent}/`);
}

function remapPath(sourceRaw: string, targetRaw: string, pathRaw: string): string | null {
  const source = normalizeOpenedFilePath(sourceRaw);
  const target = normalizeOpenedFilePath(targetRaw);
  const current = normalizeOpenedFilePath(pathRaw);
  if (!source || !target || !current || !pathInsideOrEqual(source, current)) return null;
  if (current === source) return target;
  const suffix = current.slice(source.length).replace(/^\/+/, '');
  return suffix ? `${target}/${suffix}` : target;
}

function nameForPath(pathRaw: string): string {
  const path = normalizeOpenedFilePath(pathRaw);
  return path.split('/').filter(Boolean).pop() || path || 'File';
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
    revision: null,
    externalRevision: null,
    refreshNonce: 0,
  };
}

/** A new, empty file that exists only in the editor until it is saved. */
export function createUntitledFileTab(args: {
  droneId: string;
  name: string;
  content?: string;
  navigationSeq: number;
}): OpenedFileTab {
  return {
    ...createOpenedFileTab({
      droneId: args.droneId,
      path: untitledEditorPath(args.name),
      name: args.name,
      targetLine: null,
      targetColumn: null,
      navigationSeq: args.navigationSeq,
    }),
    loaded: true,
    content: args.content ?? '',
    untitled: true,
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

/**
 * Closes several tabs at once. When the active tab goes, `preferredTabId` takes
 * over if it stays open (the tab "Close Others" was asked from), else the
 * nearest open tab after the old active one, else the nearest before it. Tabs
 * in `skipped` (shown in their own windows) never take over: activating one
 * would pull focus to its window, so with only those left none is active.
 */
export function closeFileTabs(
  state: OpenedFileTabsState,
  tabIdsRaw: readonly string[],
  preferredTabIdRaw?: string | null,
  skipped?: ReadonlySet<string>,
): OpenedFileTabsState {
  const closing = new Set(tabIdsRaw.map((id) => String(id ?? '').trim()).filter(Boolean));
  const tabs = state.tabs.filter((tab) => !closing.has(tab.tabId));
  if (tabs.length === state.tabs.length) return state;
  if (state.activeTabId && !closing.has(state.activeTabId)) return { tabs, activeTabId: state.activeTabId };
  const candidate = (tab: OpenedFileTab) => !closing.has(tab.tabId) && !skipped?.has(tab.tabId);
  const preferredTabId = String(preferredTabIdRaw ?? '').trim();
  if (preferredTabId && tabs.some((tab) => tab.tabId === preferredTabId && candidate(tab))) return { tabs, activeTabId: preferredTabId };
  const activeIndex = state.tabs.findIndex((tab) => tab.tabId === state.activeTabId);
  const nextActive =
    state.tabs.slice(activeIndex + 1).find(candidate) ??
    state.tabs.slice(0, Math.max(0, activeIndex)).reverse().find(candidate) ??
    null;
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

/** One editor's strip can hold tabs of several workspaces; path operations then apply to `droneId`'s tabs only. */
const inWorkspace = (tab: OpenedFileTab, droneId?: string | null) => !droneId || tab.droneId === droneId;

export function dirtyFileTabsForPaths(tabs: OpenedFileTab[], paths: string[], droneId?: string | null): OpenedFileTab[] {
  const normalizedPaths = paths.map(normalizeOpenedFilePath).filter(Boolean);
  if (normalizedPaths.length === 0) return [];
  return tabs.filter((tab) => inWorkspace(tab, droneId) && openedFileTabDirty(tab) && normalizedPaths.some((path) => pathInsideOrEqual(path, tab.path)));
}

export function remapFileTabsForPathChange(
  state: OpenedFileTabsState,
  sourcePath: string,
  targetPath: string,
  droneId?: string | null,
): OpenedFileTabsState {
  const nextTabs: OpenedFileTab[] = [];
  const tabIndexById = new Map<string, number>();
  let activeTabId = state.activeTabId;

  for (const tab of state.tabs) {
    const nextPath = inWorkspace(tab, droneId) ? remapPath(sourcePath, targetPath, tab.path) : null;
    const nextTab = nextPath
      ? {
          ...tab,
          path: nextPath,
          name: nameForPath(nextPath),
          tabId: openedFileTabId(tab.droneId, nextPath),
          targetLine: tab.targetLine,
          targetColumn: tab.targetColumn,
          navigationSeq: tab.navigationSeq + 1,
        }
      : tab;
    if (nextPath && activeTabId === tab.tabId) activeTabId = nextTab.tabId;
    const existingIndex = tabIndexById.get(nextTab.tabId);
    if (existingIndex != null) {
      const existing = nextTabs[existingIndex];
      if (existing && openedFileTabDirty(nextTab) && !openedFileTabDirty(existing)) {
        nextTabs[existingIndex] = nextTab;
      }
      continue;
    }
    tabIndexById.set(nextTab.tabId, nextTabs.length);
    nextTabs.push(nextTab);
  }

  return { tabs: nextTabs, activeTabId };
}

/** Closes the tabs of the workspaces `closed` picks (by file route id); a tab with unsaved changes stays open. */
export function closeFileTabsOfWorkspaces(state: OpenedFileTabsState, closed: (routeId: string) => boolean): OpenedFileTabsState {
  const tabs = state.tabs.filter((tab) => !closed(tab.droneId) || openedFileTabDirty(tab));
  if (tabs.length === state.tabs.length) return state;
  if (state.activeTabId && tabs.some((tab) => tab.tabId === state.activeTabId)) {
    return { tabs, activeTabId: state.activeTabId };
  }
  const activeIndex = state.tabs.findIndex((tab) => tab.tabId === state.activeTabId);
  const nextActive = tabs[activeIndex] ?? tabs[activeIndex - 1] ?? tabs[tabs.length - 1] ?? null;
  return { tabs, activeTabId: nextActive?.tabId ?? null };
}

export function closeFileTabsForPaths(state: OpenedFileTabsState, paths: string[], droneId?: string | null): OpenedFileTabsState {
  const normalizedPaths = paths.map(normalizeOpenedFilePath).filter(Boolean);
  if (normalizedPaths.length === 0) return state;
  const tabs = state.tabs.filter((tab) => !inWorkspace(tab, droneId) || !normalizedPaths.some((path) => pathInsideOrEqual(path, tab.path)));
  if (tabs.length === state.tabs.length) return state;
  if (state.activeTabId && tabs.some((tab) => tab.tabId === state.activeTabId)) {
    return { tabs, activeTabId: state.activeTabId };
  }
  const activeIndex = state.tabs.findIndex((tab) => tab.tabId === state.activeTabId);
  const nextActive = tabs[activeIndex] ?? tabs[activeIndex - 1] ?? tabs[tabs.length - 1] ?? null;
  return { tabs, activeTabId: nextActive?.tabId ?? null };
}
