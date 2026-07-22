import React from 'react';
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import {
  createWhiteboard,
  listWhiteboards,
  readWhiteboard,
  saveWhiteboard,
} from './whiteboard-api';
import type { WhiteboardDocument, WhiteboardScene, WhiteboardSummary } from './whiteboard-types';
import {
  readActiveWhiteboardId,
  WHITEBOARD_OPEN_EVENT,
  writeActiveWhiteboardId,
} from './whiteboard-events';

const SAVE_DEBOUNCE_MS = 900;
const initialWhiteboardCreationByDrone = new Map<string, ReturnType<typeof createWhiteboard>>();

async function createInitialWhiteboard(droneId: string) {
  const existingRequest = initialWhiteboardCreationByDrone.get(droneId);
  if (existingRequest) return await existingRequest;
  const request = (async () => {
    const listed = await listWhiteboards(droneId);
    const existingId = listed.whiteboards[0]?.id;
    return existingId ? await readWhiteboard(existingId) : await createWhiteboard('Whiteboard 1', droneId);
  })();
  initialWhiteboardCreationByDrone.set(droneId, request);
  try {
    return await request;
  } finally {
    if (initialWhiteboardCreationByDrone.get(droneId) === request) {
      initialWhiteboardCreationByDrone.delete(droneId);
    }
  }
}

export function normalizeWhiteboardScene(raw: unknown): WhiteboardScene {
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
    },
    files: files as Record<string, unknown>,
  };
}

function stableJson(value: unknown): string {
  if (typeof value === 'undefined') return '"__undefined__"';
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

export function whiteboardSceneSignature(scene: WhiteboardScene): string {
  const normalized = normalizeWhiteboardScene(scene);
  return stableJson(normalized);
}

export type UseWhiteboardStateResult = {
  whiteboards: WhiteboardSummary[];
  activeId: string;
  document: WhiteboardDocument | null;
  editorKey: number;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  notice: string | null;
  activeInitialData: ExcalidrawInitialDataState;
  loadDocument: (id: string) => Promise<void>;
  handleChange: (elements: readonly any[], appState: AppState, files: BinaryFiles) => void;
  handleCreate: () => Promise<void>;
};

export function useWhiteboardState(droneIdRaw: string): UseWhiteboardStateResult {
  const droneId = String(droneIdRaw ?? '').trim();
  const [whiteboards, setWhiteboards] = React.useState<WhiteboardSummary[]>([]);
  const [activeId, setActiveId] = React.useState(() => readActiveWhiteboardId(droneId));
  const [document, setDocument] = React.useState<WhiteboardDocument | null>(null);
  const [editorKey, setEditorKey] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const documentRef = React.useRef<WhiteboardDocument | null>(null);
  const latestSceneRef = React.useRef<WhiteboardScene | null>(null);
  const savedSceneSignatureRef = React.useRef('');
  const saveTimerRef = React.useRef<number | null>(null);
  const savingRef = React.useRef(false);
  const dirtyRef = React.useRef(false);
  const changedDuringSaveRef = React.useRef(false);
  const ignoreChangesUntilRef = React.useRef(0);
  const loadSequenceRef = React.useRef(0);

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
    const listed = await listWhiteboards(droneId);
    setWhiteboards(listed.whiteboards);
    return listed.whiteboards;
  }, [droneId]);

  const refreshListInBackground = React.useCallback(() => {
    void refreshList().catch((e: any) => {
      setNotice(String(e?.message ?? e ?? 'Failed to refresh whiteboard list.'));
    });
  }, [refreshList]);

  const loadDocument = React.useCallback(
    async (id: string) => {
      const loadSequence = ++loadSequenceRef.current;
      setLoading(true);
      setError(null);
      clearSaveTimer();
      try {
        const loaded = await readWhiteboard(id);
        if (loadSequence !== loadSequenceRef.current) return;
        const normalized = { ...loaded.whiteboard, scene: normalizeWhiteboardScene(loaded.whiteboard.scene) };
        writeActiveWhiteboardId(droneId, normalized.id);
        setActiveId(normalized.id);
        setDocument(normalized);
        latestSceneRef.current = normalized.scene;
        savedSceneSignatureRef.current = whiteboardSceneSignature(normalized.scene);
        dirtyRef.current = false;
        setDirty(false);
        ignoreChangesUntilRef.current = Date.now() + 500;
        setEditorKey((prev) => prev + 1);
        setLoading(false);
        refreshListInBackground();
      } catch (e: any) {
        if (loadSequence !== loadSequenceRef.current) return;
        setError(String(e?.message ?? e ?? 'Failed to load whiteboard.'));
      } finally {
        if (loadSequence === loadSequenceRef.current) setLoading(false);
      }
    },
    [clearSaveTimer, droneId, refreshListInBackground],
  );

  const runSave = React.useCallback(async () => {
    clearSaveTimer();
    const current = documentRef.current;
    const scene = latestSceneRef.current;
    if (!current || !scene) return;
    const sceneSignature = whiteboardSceneSignature(scene);
    if (sceneSignature === savedSceneSignatureRef.current) {
      dirtyRef.current = false;
      changedDuringSaveRef.current = false;
      setDirty(false);
      return;
    }
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
      const next = { ...saved.whiteboard, scene: normalizeWhiteboardScene(saved.whiteboard.scene) };
      setDocument(next);
      latestSceneRef.current = next.scene;
      savedSceneSignatureRef.current = whiteboardSceneSignature(next.scene);
      dirtyRef.current = false;
      setDirty(false);
      refreshListInBackground();
      shouldReschedule =
        changedDuringSaveRef.current &&
        latestSceneRef.current != null &&
        whiteboardSceneSignature(latestSceneRef.current) !== savedSceneSignatureRef.current;
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
  }, [clearSaveTimer, loadDocument, refreshListInBackground]);

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
        if (cancelled) return;
        const listed = await refreshList();
        if (cancelled) return;
        const storedId = readActiveWhiteboardId(droneId);
        const preferredId = listed.some((item) => item.id === storedId) ? storedId : listed[0]?.id ?? '';
        if (preferredId) {
          await loadDocument(preferredId);
        } else {
          const created = await createInitialWhiteboard(droneId);
          if (cancelled) return;
          await loadDocument(created.whiteboard.id);
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e ?? 'Failed to initialize whiteboards.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void start();
    return () => {
      cancelled = true;
      loadSequenceRef.current += 1;
      if (dirtyRef.current) void runSave();
      else clearSaveTimer();
    };
    // Run only once per keyed drone mount; active document changes are handled explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ droneId?: string; whiteboardId?: string }>).detail;
      const targetDroneId = String(detail?.droneId ?? '').trim();
      if (targetDroneId && targetDroneId !== droneId) return;
      const id = String(detail?.whiteboardId ?? '').trim() || 'main';
      void loadDocument(id);
    };
    window.addEventListener(WHITEBOARD_OPEN_EVENT, handler);
    return () => window.removeEventListener(WHITEBOARD_OPEN_EVENT, handler);
  }, [droneId, loadDocument]);

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
            const nextId = listed[0]?.id;
            if (nextId) {
              await loadDocument(nextId);
            } else {
              const created = await createInitialWhiteboard(droneId);
              await loadDocument(created.whiteboard.id);
            }
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
      if (savingRef.current) {
        void refreshList();
        return;
      }
      if (dirtyRef.current) {
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
      const nextScene = sceneFromEditor(elements, appState, files);
      const nextSignature = whiteboardSceneSignature(nextScene);
      latestSceneRef.current = nextScene;
      if (Date.now() < ignoreChangesUntilRef.current) return;
      if (nextSignature === savedSceneSignatureRef.current) {
        clearSaveTimer();
        changedDuringSaveRef.current = false;
        dirtyRef.current = false;
        setDirty(false);
        return;
      }
      if (savingRef.current) {
        changedDuringSaveRef.current = true;
        dirtyRef.current = true;
        setDirty(true);
        return;
      }
      dirtyRef.current = true;
      setDirty(true);
      scheduleSave();
    },
    [clearSaveTimer, scheduleSave],
  );

  const handleCreate = React.useCallback(async () => {
    const title = `Whiteboard ${whiteboards.length + 1}`;
    setLoading(true);
    setError(null);
    try {
      const created = await createWhiteboard(title, droneId);
      await refreshList();
      await loadDocument(created.whiteboard.id);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? 'Failed to create whiteboard.'));
    } finally {
      setLoading(false);
    }
  }, [droneId, loadDocument, refreshList, whiteboards.length]);

  const activeInitialData = React.useMemo<ExcalidrawInitialDataState>(() => {
    const scene = normalizeWhiteboardScene(document?.scene);
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

  return {
    whiteboards,
    activeId,
    document,
    editorKey,
    loading,
    saving,
    dirty,
    error,
    notice,
    activeInitialData,
    loadDocument,
    handleChange,
    handleCreate,
  };
}
