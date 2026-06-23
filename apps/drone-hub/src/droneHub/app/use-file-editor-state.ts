import React from 'react';
import type { DroneFsReadPayload, DroneFsSearchPayload, DroneFsWritePayload, DroneSummary } from '../types';
import type { requestJson as requestJsonFn } from '../http';
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
  trackRecentQuickOpenFile,
  type QuickOpenFile,
  type QuickOpenRecentFile,
} from '../files/quick-open-state';

type RequestJson = typeof requestJsonFn;

type OpenEditorFile = {
  droneId: string;
  path: string;
  name: string;
  targetLine: number | null;
  targetColumn: number | null;
  navigationSeq: number;
};

type OpenedFileKind = 'text' | 'image' | 'video' | 'binary';

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

export function useFileEditorState({
  currentDrone,
  requestJson,
  onRefreshFsList,
}: UseFileEditorStateArgs) {
  const [openedFile, setOpenedFile] = React.useState<OpenEditorFile | null>(null);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [openFailure, setOpenFailure] = React.useState<{ message: string; at: number } | null>(null);
  const [kind, setKind] = React.useState<OpenedFileKind>('text');
  const [mime, setMime] = React.useState<string | null>(null);
  const [size, setSize] = React.useState<number>(0);
  const [content, setContent] = React.useState('');
  const [savedContent, setSavedContent] = React.useState('');
  const [mtimeMs, setMtimeMs] = React.useState<number | null>(null);
  const contentRef = React.useRef('');
  const requestSeqRef = React.useRef(0);
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

  const closeEditorFile = React.useCallback(() => {
    setOpenedFile(null);
    setLoading(false);
    setSaving(false);
    setError(null);
    setOpenFailure(null);
    setKind('text');
    setMime(null);
    setSize(0);
    setContent('');
    setSavedContent('');
    contentRef.current = '';
    setMtimeMs(null);
  }, []);

  const normalizePositiveInt = React.useCallback((raw: unknown): number | null => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    if (i <= 0) return null;
    return i;
  }, []);

  const applyEditorLocation = React.useCallback(
    (location: EditorLocation) => {
      setOpenedFile((prev) => ({
        droneId: location.droneId,
        path: location.path,
        name: location.name,
        targetLine: location.line,
        targetColumn: location.column,
        navigationSeq: (prev?.navigationSeq ?? 0) + 1,
      }));
      setRecentFilesByDroneId((prev) => ({
        ...prev,
        [location.droneId]: trackRecentQuickOpenFile(prev[location.droneId] ?? [], {
          path: location.path,
          name: location.name,
        }),
      }));
    },
    [],
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
      setOpenedFile((prev) => {
        const nextNavigationSeq = (prev?.navigationSeq ?? 0) + 1;
        if (prev && prev.droneId === droneId && prev.path === nextPath) {
          return {
            ...prev,
            name: nextName,
            targetLine,
            targetColumn,
            navigationSeq: nextNavigationSeq,
          };
        }
        return {
          droneId,
          path: nextPath,
          name: nextName,
          targetLine,
          targetColumn,
          navigationSeq: nextNavigationSeq,
        };
      });
    },
    [currentDrone?.id, normalizePositiveInt, setEditorLocationHistory],
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
    if (!next.location) return null;
    setEditorLocationHistory(next.history);
    applyEditorLocation(next.location);
    return next.location;
  }, [applyEditorLocation, setEditorLocationHistory]);

  const goForwardLocation = React.useCallback((): EditorLocation | null => {
    const next = goForwardInEditorHistory(locationHistoryRef.current);
    if (!next.location) return null;
    setEditorLocationHistory(next.history);
    applyEditorLocation(next.location);
    return next.location;
  }, [applyEditorLocation, setEditorLocationHistory]);

  React.useEffect(() => {
    if (!openedFile) return;
    if (!currentDrone || String(currentDrone.id) !== String(openedFile.droneId)) {
      closeEditorFile();
      setEditorLocationHistory(emptyEditorLocationHistory);
    }
  }, [closeEditorFile, currentDrone?.id, openedFile, setEditorLocationHistory]);

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
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setQuickOpenLoading(true);
      setQuickOpenError(null);
      void requestJson<DroneFsSearchPayload>(
        `/api/drones/${encodeURIComponent(droneId)}/fs/search?query=${encodeURIComponent(query)}&limit=80`,
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
      window.clearTimeout(timeout);
    };
  }, [currentDrone?.id, quickOpenOpen, quickOpenQuery, requestJson]);

  React.useEffect(() => {
    if (!openedFile) return;
    const droneId = String(openedFile.droneId ?? '').trim();
    const filePath = String(openedFile.path ?? '').trim();
    if (!droneId || !filePath) return;
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;

    setLoading(true);
    setSaving(false);
    setError(null);
    setOpenFailure(null);
    setKind('text');
    setMime(null);
    setSize(0);
    setContent('');
    setSavedContent('');
    contentRef.current = '';
    setMtimeMs(null);

    let cancelled = false;
    void requestJson<Extract<DroneFsReadPayload, { ok: true }>>(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(filePath)}`,
    )
      .then((data) => {
        if (cancelled || requestSeqRef.current !== seq) return;
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
        setKind(nextKind);
        setMime(nextMime || null);
        setSize(Number.isFinite(nextSize) && nextSize >= 0 ? Math.floor(nextSize) : 0);
        setContent(nextContent);
        setSavedContent(nextContent);
        contentRef.current = nextContent;
        setMtimeMs(typeof data.mtimeMs === 'number' && Number.isFinite(data.mtimeMs) ? data.mtimeMs : null);
        setError(null);
        setOpenFailure(null);
      })
      .catch((e: any) => {
        const firstMsg = e?.message ?? String(e);
        const fallbackPath = mirrorDroneHomePath(filePath);
        const shouldRetryFallback =
          Boolean(fallbackPath) && fallbackPath !== filePath && looksLikeFileNotFound(firstMsg);
        if (!shouldRetryFallback) {
          if (cancelled || requestSeqRef.current !== seq) return;
          setError(firstMsg);
          setOpenFailure({ message: firstMsg, at: Date.now() });
          setKind('text');
          setMime(null);
          setSize(0);
          setContent('');
          setSavedContent('');
          contentRef.current = '';
          setMtimeMs(null);
          return;
        }

        void requestJson<Extract<DroneFsReadPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(fallbackPath)}`,
        )
          .then((data) => {
            if (cancelled || requestSeqRef.current !== seq) return;
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
            setKind(nextKind);
            setMime(nextMime || null);
            setSize(Number.isFinite(nextSize) && nextSize >= 0 ? Math.floor(nextSize) : 0);
            setContent(nextContent);
            setSavedContent(nextContent);
            contentRef.current = nextContent;
            setMtimeMs(typeof data.mtimeMs === 'number' && Number.isFinite(data.mtimeMs) ? data.mtimeMs : null);
            setError(null);
            setOpenFailure(null);
            setOpenedFile((prev) => {
              if (!prev) return prev;
              if (prev.droneId !== droneId || prev.path !== filePath) return prev;
              const fallbackName =
                fallbackPath.split('/').filter(Boolean).pop() || prev.name || fallbackPath;
              return { ...prev, path: fallbackPath, name: fallbackName };
            });
          })
          .catch((fallbackErr: any) => {
            if (cancelled || requestSeqRef.current !== seq) return;
            const msg = fallbackErr?.message ?? firstMsg;
            setError(msg);
            setOpenFailure({ message: msg, at: Date.now() });
            setKind('text');
            setMime(null);
            setSize(0);
            setContent('');
            setSavedContent('');
            contentRef.current = '';
            setMtimeMs(null);
          });
      })
      .finally(() => {
        if (cancelled || requestSeqRef.current !== seq) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openedFile?.droneId, openedFile?.path, refreshNonce, requestJson]);

  const dirty = React.useMemo(() => {
    if (!openedFile) return false;
    if (kind !== 'text') return false;
    return content !== savedContent;
  }, [content, kind, openedFile, savedContent]);

  const saveOpenedFile = React.useCallback(async (contentOverride?: string): Promise<boolean> => {
    if (!openedFile || loading || saving) return false;
    if (kind !== 'text') return false;
    const textToSave = typeof contentOverride === 'string' ? contentOverride : contentRef.current;
    if (typeof contentOverride === 'string') {
      contentRef.current = contentOverride;
      setContent(contentOverride);
    }
    setSaving(true);
    setError(null);
    try {
      const resp = await requestJson<Extract<DroneFsWritePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(openedFile.droneId)}/fs/file`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path: openedFile.path,
            content: textToSave,
          }),
        },
      );
      setSavedContent(textToSave);
      setContent(textToSave);
      contentRef.current = textToSave;
      setMtimeMs(typeof resp.mtimeMs === 'number' && Number.isFinite(resp.mtimeMs) ? resp.mtimeMs : null);
      onRefreshFsList();
      return true;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [kind, loading, onRefreshFsList, openedFile, requestJson, saving]);

  const setOpenedFileContent = React.useCallback((next: string) => {
    if (kind !== 'text') return;
    const nextText = typeof next === 'string' ? next : '';
    contentRef.current = nextText;
    setContent(nextText);
  }, [kind]);

  const refreshOpenedFile = React.useCallback(() => {
    if (!openedFile || loading || saving) return;
    if (kind === 'text' && contentRef.current !== savedContent) return;
    setRefreshNonce((n) => n + 1);
  }, [kind, loading, openedFile, savedContent, saving]);

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
    openEditorFile,
    closeEditorFile,
    openQuickOpen,
    closeQuickOpen,
    setQuickOpenQuery,
    goBackLocation,
    goForwardLocation,
    setOpenedFileContent,
    refreshOpenedFile,
    saveOpenedFile,
  };
}
