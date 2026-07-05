import React from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import {
  createWhiteboard,
  listWhiteboards,
  readWhiteboard,
  saveWhiteboard,
} from './whiteboard-api';
import { WHITEBOARD_ACTIVE_STORAGE_KEY, WHITEBOARD_OPEN_EVENT } from './whiteboard-events';
import type { WhiteboardDocument, WhiteboardScene, WhiteboardSummary } from './whiteboard-types';

const SAVE_DEBOUNCE_MS = 900;

function readStoredWhiteboardId(): string {
  try {
    return String(window.localStorage.getItem(WHITEBOARD_ACTIVE_STORAGE_KEY) ?? '').trim() || 'main';
  } catch {
    return 'main';
  }
}

function writeStoredWhiteboardId(id: string): void {
  try {
    window.localStorage.setItem(WHITEBOARD_ACTIVE_STORAGE_KEY, id);
  } catch {
    // Ignore localStorage failures; the backend remains authoritative.
  }
}

function normalizeScene(raw: unknown): WhiteboardScene {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    elements: Array.isArray(source.elements) ? source.elements : [],
    appState: source.appState && typeof source.appState === 'object' && !Array.isArray(source.appState)
      ? (source.appState as Record<string, unknown>)
      : null,
    files: source.files && typeof source.files === 'object' && !Array.isArray(source.files)
      ? (source.files as Record<string, unknown>)
      : {},
  };
}

function sceneFromEditor(elements: readonly any[], appState: AppState, files: BinaryFiles): WhiteboardScene {
  return {
    elements: [...elements],
    appState: {
      name: appState.name,
      viewBackgroundColor: appState.viewBackgroundColor,
      theme: appState.theme,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
    },
    files: files as Record<string, unknown>,
  };
}

function whiteboardLabel(item: WhiteboardSummary): string {
  const title = String(item.title ?? '').trim() || item.id;
  return item.id === 'main' ? `${title} - main` : title;
}

export function WhiteboardDock() {
  const [whiteboards, setWhiteboards] = React.useState<WhiteboardSummary[]>([]);
  const [activeId, setActiveId] = React.useState(() => (typeof window === 'undefined' ? 'main' : readStoredWhiteboardId()));
  const [document, setDocument] = React.useState<WhiteboardDocument | null>(null);
  const [editorKey, setEditorKey] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const documentRef = React.useRef<WhiteboardDocument | null>(null);
  const latestSceneRef = React.useRef<WhiteboardScene | null>(null);
  const saveTimerRef = React.useRef<number | null>(null);
  const savingRef = React.useRef(false);
  const dirtyRef = React.useRef(false);
  const changedDuringSaveRef = React.useRef(false);
  const ignoreChangesUntilRef = React.useRef(0);

  React.useEffect(() => {
    documentRef.current = document;
  }, [document]);

  React.useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const clearSaveTimer = React.useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const refreshList = React.useCallback(async () => {
    const listed = await listWhiteboards();
    setWhiteboards(listed.whiteboards);
    return listed.whiteboards;
  }, []);

  const loadDocument = React.useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      clearSaveTimer();
      try {
        const loaded = await readWhiteboard(id);
        const normalized = { ...loaded.whiteboard, scene: normalizeScene(loaded.whiteboard.scene) };
        writeStoredWhiteboardId(normalized.id);
        setActiveId(normalized.id);
        setDocument(normalized);
        latestSceneRef.current = normalized.scene;
        dirtyRef.current = false;
        setDirty(false);
        ignoreChangesUntilRef.current = Date.now() + 500;
        setEditorKey((prev) => prev + 1);
        await refreshList();
      } catch (e: any) {
        setError(String(e?.message ?? e ?? 'Failed to load whiteboard.'));
      } finally {
        setLoading(false);
      }
    },
    [clearSaveTimer, refreshList],
  );

  const runSave = React.useCallback(async () => {
    clearSaveTimer();
    const current = documentRef.current;
    const scene = latestSceneRef.current;
    if (!current || !scene) return;
    if (savingRef.current) {
      changedDuringSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    let shouldReschedule = false;
    try {
      const saved = await saveWhiteboard({
        id: current.id,
        baseVersion: current.version,
        scene,
      });
      const next = { ...saved.whiteboard, scene: normalizeScene(saved.whiteboard.scene) };
      setDocument(next);
      latestSceneRef.current = scene;
      dirtyRef.current = false;
      setDirty(false);
      await refreshList();
      shouldReschedule = changedDuringSaveRef.current;
    } catch (e: any) {
      if (Number(e?.status) === 409) {
        changedDuringSaveRef.current = false;
        setNotice('Reloaded because the whiteboard changed elsewhere.');
        await loadDocument(current.id);
      } else {
        setError(String(e?.message ?? e ?? 'Failed to save whiteboard.'));
        shouldReschedule = changedDuringSaveRef.current;
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (shouldReschedule) {
        changedDuringSaveRef.current = false;
        dirtyRef.current = true;
        setDirty(true);
        saveTimerRef.current = window.setTimeout(() => {
          void runSave();
        }, SAVE_DEBOUNCE_MS);
      }
    }
  }, [clearSaveTimer, loadDocument, refreshList]);

  const scheduleSave = React.useCallback(() => {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void runSave();
    }, SAVE_DEBOUNCE_MS);
  }, [runSave]);

  React.useEffect(() => {
    let cancelled = false;
    async function start() {
      setLoading(true);
      try {
        const listed = await refreshList();
        if (cancelled) return;
        const preferred = activeId && listed.some((item) => item.id === activeId) ? activeId : listed[0]?.id ?? 'main';
        await loadDocument(preferred);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e ?? 'Failed to initialize whiteboards.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void start();
    return () => {
      cancelled = true;
      clearSaveTimer();
    };
    // Run only once on mount; active document changes are handled explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ whiteboardId?: string }>).detail;
      const id = String(detail?.whiteboardId ?? '').trim() || 'main';
      void loadDocument(id);
    };
    window.addEventListener(WHITEBOARD_OPEN_EVENT, handler);
    return () => window.removeEventListener(WHITEBOARD_OPEN_EVENT, handler);
  }, [loadDocument]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const events = new EventSource('/api/whiteboards/events');
    const handleChangeEvent = (event: MessageEvent) => {
      let payload: any = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const changedId = String(payload?.whiteboardId ?? '').trim();
      if (!changedId) return;
      const current = documentRef.current;

      if (payload?.reason === 'deleted') {
        void (async () => {
          const listed = await refreshList();
          if (current?.id === changedId) {
            await loadDocument(listed[0]?.id ?? 'main');
            setNotice('Whiteboard was deleted elsewhere.');
          }
        })();
        return;
      }

      if (payload?.reason === 'created') {
        void refreshList();
        return;
      }

      if (current?.id !== changedId) {
        void refreshList();
        return;
      }

      const nextVersion = Number(payload?.version ?? 0);
      if (Number.isFinite(nextVersion) && nextVersion <= current.version) return;
      if (dirtyRef.current || savingRef.current) {
        setNotice('Whiteboard changed elsewhere. Auto-save will reconcile or reload on conflict.');
        void refreshList();
        return;
      }
      setNotice('Reloaded because the whiteboard changed elsewhere.');
      void loadDocument(changedId);
    };
    events.addEventListener('whiteboard_change', handleChangeEvent);
    events.onerror = () => {
      setNotice('Whiteboard live updates disconnected. Reconnecting...');
    };
    return () => {
      events.removeEventListener('whiteboard_change', handleChangeEvent);
      events.close();
    };
  }, [loadDocument, refreshList]);

  const handleChange = React.useCallback(
    (elements: readonly any[], appState: AppState, files: BinaryFiles) => {
      if (!documentRef.current) return;
      latestSceneRef.current = sceneFromEditor(elements, appState, files);
      if (Date.now() < ignoreChangesUntilRef.current) return;
      dirtyRef.current = true;
      setDirty(true);
      scheduleSave();
    },
    [scheduleSave],
  );

  const handleCreate = React.useCallback(async () => {
    const title = `Whiteboard ${whiteboards.length + 1}`;
    setLoading(true);
    setError(null);
    try {
      const created = await createWhiteboard(title);
      await refreshList();
      await loadDocument(created.whiteboard.id);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? 'Failed to create whiteboard.'));
    } finally {
      setLoading(false);
    }
  }, [loadDocument, refreshList, whiteboards.length]);

  const activeInitialData = React.useMemo<ExcalidrawInitialDataState>(() => {
    const scene = normalizeScene(document?.scene);
    return {
      elements: scene.elements,
      appState: {
        ...(scene.appState ?? {}),
        name: document?.title ?? 'Whiteboard',
      },
      files: scene.files as BinaryFiles,
      scrollToContent: scene.elements.length > 0,
    };
  }, [document?.id, document?.scene, document?.title, editorKey]);

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-[var(--border)] bg-[rgba(255,255,255,.03)] px-2.5 py-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            Whiteboard
          </div>
          <div className="mt-1 flex items-center gap-2">
            <select
              value={activeId}
              disabled={loading || whiteboards.length === 0}
              onChange={(event) => void loadDocument(event.target.value)}
              className="min-w-0 max-w-full flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
              aria-label="Select whiteboard"
            >
              {whiteboards.map((item) => (
                <option key={item.id} value={item.id}>
                  {whiteboardLabel(item)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={loading}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-50"
            >
              New
            </button>
          </div>
        </div>
        <div className="w-[82px] text-right text-[10px] text-[var(--muted-dim)]" aria-live="polite">
          {saving ? 'Saving...' : dirty ? 'Unsaved' : loading ? 'Loading...' : `v${document?.version ?? 0}`}
        </div>
      </div>
      {error || notice ? (
        <div className={`flex-shrink-0 border-b px-3 py-2 text-[11px] ${error ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)]'}`}>
          {error ?? notice}
        </div>
      ) : null}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {loading && !document ? (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--muted)]">Loading whiteboard...</div>
        ) : document ? (
          <Excalidraw
            key={`${document.id}:${editorKey}`}
            initialData={activeInitialData}
            onChange={handleChange}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
              },
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] text-[var(--muted)]">
            No whiteboard is available.
          </div>
        )}
      </div>
    </div>
  );
}
