import React from 'react';
import type { DroneFsReadPayload, DroneFsSearchPayload, DroneFsWritePayload, DroneSummary } from '../types';
import type { requestJson as requestJsonFn } from '../http';
import {
  activateFileTab,
  closeFileTab,
  closeFileTabsForPaths,
  dirtyFileTabsForPaths,
  openedFileTabDirty,
  openFileTab,
  reorderFileTabs,
  remapFileTabsForPathChange,
  updateFileTabContent,
  type OpenedFileKind,
  type OpenedFileTab,
  type OpenedFileTabsState,
} from './opened-file-tabs';
import {
  canGoBackInEditorHistory,
  canGoForwardInEditorHistory,
  emptyEditorLocationHistory,
  goBackInEditorHistory,
  goForwardInEditorHistory,
  pushEditorLocation,
  type EditorLocation,
  type EditorLocationHistory,
} from '../files/editor-location-history';
import {
  quickOpenNameForPath,
  QUICK_OPEN_SEARCH_MIN_QUERY_LENGTH,
  removeRecentQuickOpenFilesForPaths,
  remapRecentQuickOpenFilesForPathChange,
  trackRecentQuickOpenFile,
  type QuickOpenFile,
  type QuickOpenRecentFile,
} from '../files/quick-open-state';

type RequestJson = typeof requestJsonFn;

type UseFileEditorStateArgs = {
  currentDrone: DroneSummary | null;
  requestJson: RequestJson;
  onRefreshFsList: () => void;
};

function normalizeContainerPath(raw: string): string {
  const trimmed = String(raw ?? '').trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  return trimmed.replace(/\/+/g, '/');
}

function mirrorDroneHomePath(rawPath: string): string {
  const p = normalizeContainerPath(rawPath);
  if (!p.startsWith('/')) return '';
  if (p === '/work/repo' || p.startsWith('/work/repo/')) {
    const suffix = p.slice('/work/repo'.length);
    return `/dvm-data/home${suffix}`;
  }
  if (p === '/dvm-data/home' || p.startsWith('/dvm-data/home/')) {
    const suffix = p.slice('/dvm-data/home'.length);
    return `/work/repo${suffix}`;
  }
  return '';
}

function looksLikeFileNotFound(msgRaw: string): boolean {
  const msg = String(msgRaw ?? '').toLowerCase();
  return msg.includes('file not found') || msg.includes('no such file') || msg.includes('not-file');
}

function confirmDiscardDirtyTabs(tabs: OpenedFileTab[], actionLabel: string): boolean {
  const dirtyTabs = tabs.filter(openedFileTabDirty);
  if (dirtyTabs.length === 0) return true;
  if (typeof window === 'undefined') return true;
  const preview = dirtyTabs
    .slice(0, 4)
    .map((tab) => tab.name || tab.path || 'file')
    .join(', ');
  const suffix = dirtyTabs.length > 4 ? `, and ${dirtyTabs.length - 4} more` : '';
  return window.confirm(
    `${actionLabel} will discard unsaved changes in ${dirtyTabs.length} file${dirtyTabs.length === 1 ? '' : 's'}.\n\n${preview}${suffix}`,
  );
}

function readPayloadToTabState(data: Extract<DroneFsReadPayload, { ok: true }>): {
  kind: OpenedFileKind;
  mime: string | null;
  size: number;
  content: string;
  savedContent: string;
  mtimeMs: number | null;
} {
  const rawKind =
    typeof (data as any).kind === 'string'
      ? String((data as any).kind).trim().toLowerCase()
      : typeof (data as any).content === 'string'
        ? 'text'
        : 'binary';
  const nextKind: OpenedFileKind =
    rawKind === 'text' || rawKind === 'image' || rawKind === 'video' ? rawKind : 'binary';
  const nextMime = typeof (data as any).mime === 'string' ? String((data as any).mime).trim().toLowerCase() : '';
  const nextSize = Number((data as any).size);
  const nextContent = nextKind === 'text' && typeof (data as any).content === 'string' ? (data as any).content : '';
  return {
    kind: nextKind,
    mime: nextMime || null,
    size: Number.isFinite(nextSize) && nextSize >= 0 ? Math.floor(nextSize) : 0,
    content: nextContent,
    savedContent: nextContent,
    mtimeMs: typeof data.mtimeMs === 'number' && Number.isFinite(data.mtimeMs) ? data.mtimeMs : null,
  };
}

export function useFileEditorState({
  currentDrone,
  requestJson,
  onRefreshFsList,
}: UseFileEditorStateArgs) {
  const [tabState, setTabState] = React.useState<OpenedFileTabsState>({ tabs: [], activeTabId: null });
  const { tabs, activeTabId } = tabState;
  const [openFailure, setOpenFailure] = React.useState<{ message: string; at: number } | null>(null);
  const contentRef = React.useRef('');
  const activeTabIdRef = React.useRef<string | null>(null);
  const requestSeqRef = React.useRef(0);
  const navigationSeqRef = React.useRef(0);
  const locationHistoryRef = React.useRef<EditorLocationHistory>(emptyEditorLocationHistory);
  const [locationHistory, setLocationHistory] = React.useState<EditorLocationHistory>(emptyEditorLocationHistory);
  const [recentFilesByDroneId, setRecentFilesByDroneId] = React.useState<Record<string, QuickOpenRecentFile[]>>({});
  const [quickOpenOpen, setQuickOpenOpen] = React.useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = React.useState('');
  const [quickOpenFiles, setQuickOpenFiles] = React.useState<QuickOpenFile[]>([]);
  const [quickOpenLoading, setQuickOpenLoading] = React.useState(false);
  const [quickOpenError, setQuickOpenError] = React.useState<string | null>(null);

  const setEditorLocationHistory = React.useCallback((next: EditorLocationHistory) => {
    locationHistoryRef.current = next;
    setLocationHistory(next);
  }, []);

  const activeTab = React.useMemo(
    () => tabs.find((tab) => tab.tabId === activeTabId) ?? null,
    [activeTabId, tabs],
  );

  React.useEffect(() => {
    activeTabIdRef.current = activeTab?.tabId ?? null;
    contentRef.current = activeTab?.content ?? '';
  }, [activeTab?.content, activeTab?.tabId]);

  const updateTabs = React.useCallback((updater: (tabs: OpenedFileTab[]) => OpenedFileTab[]) => {
    setTabState((prev) => ({ ...prev, tabs: updater(prev.tabs) }));
  }, []);

  const closeEditorFile = React.useCallback((tabId?: string | null) => {
    const requestedTabId = String(tabId ?? activeTabId ?? '').trim();
    const target = tabs.find((tab) => tab.tabId === requestedTabId);
    if (!target) return;
    if (!confirmDiscardDirtyTabs([target], `Close ${target.name || 'this file'}`)) return;
    setOpenFailure(null);
    setTabState((prev) => closeFileTab(prev, requestedTabId));
  }, [activeTabId, tabs]);

  const normalizePositiveInt = React.useCallback((raw: unknown): number | null => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    if (i <= 0) return null;
    return i;
  }, []);

  const openEditorLocation = React.useCallback(
    (next: { droneId: string; path: string; name: string; line?: number | null; column?: number | null }) => {
      const droneId = String(next.droneId ?? '').trim();
      if (!droneId) return;
      const nextPath = String(next.path ?? '').trim();
      if (!nextPath) return;
      const nextName = String(next.name ?? '').trim() || nextPath.split('/').filter(Boolean).pop() || nextPath;
      const targetLine = normalizePositiveInt(next.line);
      const targetColumn = normalizePositiveInt(next.column);
      navigationSeqRef.current += 1;
      const navigationSeq = navigationSeqRef.current;
      setOpenFailure(null);
      setTabState((prev) =>
        openFileTab(prev, {
          droneId,
          path: nextPath,
          name: nextName,
          targetLine,
          targetColumn,
          navigationSeq,
        }),
      );
    },
    [normalizePositiveInt],
  );

  const openEditorFile = React.useCallback(
    (next: { path: string; name: string; line?: number | null; column?: number | null }) => {
      const droneId = String(currentDrone?.id ?? '').trim();
      if (!droneId) return;
      const nextPath = String(next.path ?? '').trim();
      if (!nextPath) return;
      const nextName = String(next.name ?? '').trim() || nextPath.split('/').filter(Boolean).pop() || nextPath;
      const targetLine = normalizePositiveInt(next.line);
      const targetColumn = normalizePositiveInt(next.column);
      const nextLocation: EditorLocation = {
        droneId,
        path: nextPath,
        name: nextName,
        line: targetLine,
        column: targetColumn,
      };
      setEditorLocationHistory(pushEditorLocation(locationHistoryRef.current, nextLocation));
      setRecentFilesByDroneId((prev) => ({
        ...prev,
        [droneId]: trackRecentQuickOpenFile(prev[droneId] ?? [], {
          path: nextPath,
          name: nextName,
        }),
      }));
      openEditorLocation(nextLocation);
    },
    [currentDrone?.id, normalizePositiveInt, openEditorLocation, setEditorLocationHistory],
  );

  const openQuickOpen = React.useCallback(() => {
    if (!currentDrone?.id) return;
    setQuickOpenQuery('');
    setQuickOpenOpen(true);
    setQuickOpenError(null);
  }, [currentDrone?.id]);

  const closeQuickOpen = React.useCallback(() => {
    setQuickOpenOpen(false);
  }, []);

  const goBackLocation = React.useCallback((): EditorLocation | null => {
    const next = goBackInEditorHistory(locationHistoryRef.current);
    const location = next.location;
    if (!location) return null;
    setEditorLocationHistory(next.history);
    openEditorLocation(location);
    setRecentFilesByDroneId((prev) => ({
      ...prev,
      [location.droneId]: trackRecentQuickOpenFile(prev[location.droneId] ?? [], {
        path: location.path,
        name: location.name,
      }),
    }));
    return location;
  }, [openEditorLocation, setEditorLocationHistory]);

  const goForwardLocation = React.useCallback((): EditorLocation | null => {
    const next = goForwardInEditorHistory(locationHistoryRef.current);
    const location = next.location;
    if (!location) return null;
    setEditorLocationHistory(next.history);
    openEditorLocation(location);
    setRecentFilesByDroneId((prev) => ({
      ...prev,
      [location.droneId]: trackRecentQuickOpenFile(prev[location.droneId] ?? [], {
        path: location.path,
        name: location.name,
      }),
    }));
    return location;
  }, [openEditorLocation, setEditorLocationHistory]);

  React.useEffect(() => {
    const dirtyTabs = tabs.filter(openedFileTabDirty);
    if (dirtyTabs.length === 0 || typeof window === 'undefined') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [tabs]);

  React.useEffect(() => {
    if (tabs.length === 0) return;
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) {
      setTabState({ tabs: [], activeTabId: null });
      setEditorLocationHistory(emptyEditorLocationHistory);
      return;
    }
    if (tabs.every((tab) => String(tab.droneId) === droneId)) return;
    setTabState({ tabs: [], activeTabId: null });
    setOpenFailure(null);
    setEditorLocationHistory(emptyEditorLocationHistory);
  }, [currentDrone?.id, setEditorLocationHistory, tabs]);

  React.useEffect(() => {
    setQuickOpenOpen(false);
    setQuickOpenQuery('');
    setQuickOpenFiles([]);
    setQuickOpenLoading(false);
    setQuickOpenError(null);
    setEditorLocationHistory(emptyEditorLocationHistory);
  }, [currentDrone?.id, setEditorLocationHistory]);

  React.useEffect(() => {
    if (!quickOpenOpen) return;
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) return;
    const query = String(quickOpenQuery ?? '').trim();
    if (!query) {
      setQuickOpenFiles([]);
      setQuickOpenLoading(false);
      setQuickOpenError(null);
      return;
    }
    if (query.length < QUICK_OPEN_SEARCH_MIN_QUERY_LENGTH) {
      setQuickOpenFiles([]);
      setQuickOpenLoading(false);
      setQuickOpenError(null);
      return;
    }
    let cancelled = false;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timeout = window.setTimeout(() => {
      setQuickOpenLoading(true);
      setQuickOpenError(null);
      void requestJson<DroneFsSearchPayload>(
        `/api/drones/${encodeURIComponent(droneId)}/fs/search?query=${encodeURIComponent(query)}&limit=50`,
        controller ? { signal: controller.signal } : undefined,
      )
        .then((data) => {
          if (cancelled) return;
          const entries = Array.isArray((data as any).entries) ? ((data as any).entries as QuickOpenFile[]) : [];
          setQuickOpenFiles(
            entries.map((entry) => {
              const path = String(entry.path ?? '').trim();
              return {
                path,
                name: String(entry.name ?? '').trim() || quickOpenNameForPath(path),
                relativePath: entry.relativePath ?? null,
                size: Number.isFinite(Number(entry.size)) ? Math.max(0, Math.floor(Number(entry.size))) : null,
                mtimeMs: Number.isFinite(Number(entry.mtimeMs)) ? Math.max(0, Math.floor(Number(entry.mtimeMs))) : null,
              };
            }),
          );
          setQuickOpenError(null);
        })
        .catch((e: any) => {
          if (cancelled) return;
          if (e?.name === 'AbortError') return;
          setQuickOpenError(e?.message ?? String(e));
          setQuickOpenFiles([]);
        })
        .finally(() => {
          if (cancelled) return;
          setQuickOpenLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timeout);
    };
  }, [currentDrone?.id, quickOpenOpen, quickOpenQuery, requestJson]);

  React.useEffect(() => {
    if (!activeTab) return;
    if (activeTab.loaded || activeTab.loading) return;
    const activeId = activeTab.tabId;
    const droneId = String(activeTab.droneId ?? '').trim();
    const filePath = String(activeTab.path ?? '').trim();
    if (!droneId || !filePath) return;
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;

    updateTabs((prevTabs) =>
      prevTabs.map((tab) =>
        tab.tabId === activeId
          ? {
              ...tab,
              loading: true,
              saving: false,
              loaded: false,
              error: null,
              kind: 'text',
              mime: null,
              size: 0,
              content: '',
              savedContent: '',
              mtimeMs: null,
            }
          : tab,
      ),
    );
    setOpenFailure(null);
    contentRef.current = '';

    let cancelled = false;
    void requestJson<Extract<DroneFsReadPayload, { ok: true }>>(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(filePath)}`,
    )
      .then((data) => {
        if (cancelled || requestSeqRef.current !== seq) return;
        const nextLoadedState = readPayloadToTabState(data);
        updateTabs((prevTabs) =>
          prevTabs.map((tab) =>
            tab.tabId === activeId
              ? {
                  ...tab,
                  ...nextLoadedState,
                  loading: false,
                  loaded: true,
                  error: null,
                }
              : tab,
          ),
        );
        if (activeTabIdRef.current === activeId) contentRef.current = nextLoadedState.content;
        setOpenFailure(null);
      })
      .catch((e: any) => {
        const firstMsg = e?.message ?? String(e);
        const fallbackPath = mirrorDroneHomePath(filePath);
        const shouldRetryFallback =
          Boolean(fallbackPath) && fallbackPath !== filePath && looksLikeFileNotFound(firstMsg);
        if (!shouldRetryFallback) {
          if (cancelled || requestSeqRef.current !== seq) return;
          updateTabs((prevTabs) =>
            prevTabs.map((tab) =>
              tab.tabId === activeId
                ? {
                    ...tab,
                    loading: false,
                    loaded: true,
                    error: firstMsg,
                    kind: 'text',
                    mime: null,
                    size: 0,
                    content: '',
                    savedContent: '',
                    mtimeMs: null,
                  }
                : tab,
            ),
          );
          setOpenFailure({ message: firstMsg, at: Date.now() });
          return;
        }

        void requestJson<Extract<DroneFsReadPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(fallbackPath)}`,
        )
          .then((data) => {
            if (cancelled || requestSeqRef.current !== seq) return;
            const nextLoadedState = readPayloadToTabState(data);
            updateTabs((prevTabs) =>
              prevTabs.map((tab) => {
                if (tab.tabId !== activeId) return tab;
                const fallbackName = fallbackPath.split('/').filter(Boolean).pop() || tab.name || fallbackPath;
                return {
                  ...tab,
                  ...nextLoadedState,
                  path: fallbackPath,
                  name: fallbackName,
                  loading: false,
                  loaded: true,
                  error: null,
                };
              }),
            );
            if (activeTabIdRef.current === activeId) contentRef.current = nextLoadedState.content;
            setOpenFailure(null);
          })
          .catch((fallbackErr: any) => {
            if (cancelled || requestSeqRef.current !== seq) return;
            const msg = fallbackErr?.message ?? firstMsg;
            updateTabs((prevTabs) =>
              prevTabs.map((tab) =>
                tab.tabId === activeId
                  ? {
                      ...tab,
                      loading: false,
                      loaded: true,
                      error: msg,
                      kind: 'text',
                      mime: null,
                      size: 0,
                      content: '',
                      savedContent: '',
                      mtimeMs: null,
                    }
                  : tab,
              ),
            );
            setOpenFailure({ message: msg, at: Date.now() });
          });
      })
      .finally(() => {
        if (cancelled || requestSeqRef.current !== seq) return;
        updateTabs((prevTabs) => prevTabs.map((tab) => (tab.tabId === activeId ? { ...tab, loading: false } : tab)));
      });

    return () => {
      cancelled = true;
      updateTabs((prevTabs) =>
        prevTabs.map((tab) =>
          tab.tabId === activeId && tab.loading && !tab.loaded ? { ...tab, loading: false } : tab,
        ),
      );
    };
  }, [
    activeTab?.droneId,
    activeTab?.loaded,
    activeTab?.path,
    activeTab?.refreshNonce,
    activeTab?.tabId,
    requestJson,
    updateTabs,
  ]);

  const openedFile = activeTab
    ? {
        droneId: activeTab.droneId,
        path: activeTab.path,
        name: activeTab.name,
        targetLine: activeTab.targetLine,
        targetColumn: activeTab.targetColumn,
        navigationSeq: activeTab.navigationSeq,
      }
    : null;
  const loading = activeTab?.loading ?? false;
  const saving = activeTab?.saving ?? false;
  const error = activeTab?.error ?? null;
  const kind = activeTab?.kind ?? 'text';
  const mime = activeTab?.mime ?? null;
  const size = activeTab?.size ?? 0;
  const content = activeTab?.content ?? '';
  const dirty = activeTab ? openedFileTabDirty(activeTab) : false;
  const mtimeMs = activeTab?.mtimeMs ?? null;

  const openedFileTabs = React.useMemo(
    () =>
      tabs.map((tab) => ({
        tabId: tab.tabId,
        droneId: tab.droneId,
        path: tab.path,
        name: tab.name,
        loading: tab.loading,
        saving: tab.saving,
        error: tab.error,
        kind: tab.kind,
        mime: tab.mime,
        size: tab.size,
        content: tab.content,
        dirty: openedFileTabDirty(tab),
        mtimeMs: tab.mtimeMs,
        targetLine: tab.targetLine,
        targetColumn: tab.targetColumn,
        navigationSeq: tab.navigationSeq,
      })),
    [tabs],
  );

  const setActiveOpenedFileTab = React.useCallback((tabIdRaw: string) => {
    const tabId = String(tabIdRaw ?? '').trim();
    if (!tabId) return;
    setTabState((prev) => activateFileTab(prev, tabId));
  }, []);

  const reorderOpenedFileTabs = React.useCallback((fromTabId: string, toTabId: string) => {
    setTabState((prev) => reorderFileTabs(prev, fromTabId, toTabId));
  }, []);

  const saveOpenedFile = React.useCallback(async (contentOverride?: string): Promise<boolean> => {
    if (!activeTab || activeTab.loading || activeTab.saving) return false;
    if (activeTab.kind !== 'text') return false;
    const tabId = activeTab.tabId;
    const textToSave = typeof contentOverride === 'string' ? contentOverride : contentRef.current;
    if (typeof contentOverride === 'string') {
      contentRef.current = contentOverride;
      updateTabs((prevTabs) => updateFileTabContent(prevTabs, tabId, contentOverride));
    }
    updateTabs((prevTabs) => prevTabs.map((tab) => (tab.tabId === tabId ? { ...tab, saving: true, error: null } : tab)));
    try {
      const resp = await requestJson<Extract<DroneFsWritePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(activeTab.droneId)}/fs/file`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path: activeTab.path,
            content: textToSave,
          }),
        },
      );
      updateTabs((prevTabs) =>
        prevTabs.map((tab) =>
          tab.tabId === tabId
            ? {
                ...tab,
                saving: false,
                error: null,
                content: textToSave,
                savedContent: textToSave,
                mtimeMs: typeof resp.mtimeMs === 'number' && Number.isFinite(resp.mtimeMs) ? resp.mtimeMs : null,
              }
            : tab,
        ),
      );
      if (activeTabIdRef.current === tabId) contentRef.current = textToSave;
      onRefreshFsList();
      return true;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      updateTabs((prevTabs) => prevTabs.map((tab) => (tab.tabId === tabId ? { ...tab, saving: false, error: msg } : tab)));
      return false;
    }
  }, [activeTab, onRefreshFsList, requestJson, updateTabs]);

  const setOpenedFileContent = React.useCallback((next: string) => {
    if (!activeTab || activeTab.kind !== 'text') return;
    const nextText = typeof next === 'string' ? next : '';
    contentRef.current = nextText;
    updateTabs((prevTabs) => updateFileTabContent(prevTabs, activeTab.tabId, nextText));
  }, [activeTab, updateTabs]);

  const refreshOpenedFile = React.useCallback(() => {
    if (!activeTab || activeTab.loading || activeTab.saving) return;
    if (activeTab.kind === 'text' && activeTab.content !== activeTab.savedContent) return;
    updateTabs((prevTabs) =>
      prevTabs.map((tab) =>
        tab.tabId === activeTab.tabId
          ? {
              ...tab,
              loaded: false,
              loading: false,
              error: null,
              refreshNonce: tab.refreshNonce + 1,
            }
          : tab,
      ),
    );
  }, [activeTab, updateTabs]);

  const confirmCloseOpenedFileTabsForPaths = React.useCallback((paths: string[], actionLabel = 'This action'): boolean => {
    const dirtyTabs = dirtyFileTabsForPaths(tabs, paths);
    return confirmDiscardDirtyTabs(dirtyTabs, actionLabel);
  }, [tabs]);

  const closeOpenedFileTabsForPaths = React.useCallback((paths: string[]) => {
    const droneId = String(currentDrone?.id ?? '').trim();
    setTabState((prev) => closeFileTabsForPaths(prev, paths));
    if (droneId) {
      setRecentFilesByDroneId((prev) => ({
        ...prev,
        [droneId]: removeRecentQuickOpenFilesForPaths(prev[droneId] ?? [], paths),
      }));
    }
  }, [currentDrone?.id]);

  const remapOpenedFileTabsForPathChange = React.useCallback((sourcePath: string, targetPath: string) => {
    const droneId = String(currentDrone?.id ?? '').trim();
    setTabState((prev) => remapFileTabsForPathChange(prev, sourcePath, targetPath));
    if (droneId) {
      setRecentFilesByDroneId((prev) => ({
        ...prev,
        [droneId]: remapRecentQuickOpenFilesForPathChange(prev[droneId] ?? [], sourcePath, targetPath),
      }));
    }
  }, [currentDrone?.id]);

  return {
    openedFile,
    loading,
    saving,
    error,
    openFailure,
    kind,
    mime,
    size,
    content,
    dirty,
    mtimeMs,
    recentFiles: recentFilesByDroneId[String(currentDrone?.id ?? '').trim()] ?? [],
    quickOpenOpen,
    quickOpenQuery,
    quickOpenFiles,
    quickOpenLoading,
    quickOpenError,
    canGoBackLocation: canGoBackInEditorHistory(locationHistory),
    canGoForwardLocation: canGoForwardInEditorHistory(locationHistory),
    openedFileTabs,
    activeOpenedFileTabId: activeTabId,
    openEditorFile,
    closeEditorFile,
    confirmCloseOpenedFileTabsForPaths,
    closeOpenedFileTabsForPaths,
    remapOpenedFileTabsForPathChange,
    openQuickOpen,
    closeQuickOpen,
    setQuickOpenQuery,
    goBackLocation,
    goForwardLocation,
    setActiveOpenedFileTab,
    reorderOpenedFileTabs,
    setOpenedFileContent,
    refreshOpenedFile,
    saveOpenedFile,
  };
}
