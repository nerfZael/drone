import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

const MIN_CANVAS_SCALE = 0.35;
const MAX_CANVAS_SCALE = 2.6;
const DRONE_CANVAS_STORAGE_KEY = 'droneHub.canvas';
const CANVAS_PERSIST_DEBOUNCE_MS = 180;
const DRAFT_CANVAS_NODE_PREFIX = 'draft:';

type Updater<T> = T | ((prev: T) => T);

export type DroneCanvasNode = {
  droneId: string;
  label: string;
  x: number;
  y: number;
};

type DroneCanvasState = {
  nodesByDroneId: Record<string, DroneCanvasNode>;
  nodeOrder: string[];
  selectedDroneIds: string[];
  draftPromptByNodeId: Record<string, string>;
  draftRepoLabelByNodeId: Record<string, string>;
  panX: number;
  panY: number;
  scale: number;
  upsertNodes: (nodes: Array<{ droneId: string; label: string; x: number; y: number }>) => void;
  moveNode: (droneId: string, x: number, y: number) => void;
  moveNodes: (nodes: Array<{ droneId: string; x: number; y: number }>) => void;
  removeNodes: (droneIds: string[]) => void;
  replaceNodeId: (oldDroneId: string, newDroneId: string, label?: string | null) => void;
  setDraftPromptForNode: (droneId: string, prompt: string) => void;
  setDraftRepoLabelForNode: (droneId: string, repoLabel: string) => void;
  syncNodeLabels: (droneNameById: Record<string, string>) => void;
  setSelectedDroneIds: (droneIds: Updater<string[]>) => void;
  toggleSelectedDroneId: (droneId: string) => void;
  clearSelection: () => void;
  setPan: (panX: number, panY: number) => void;
  setScale: (scale: number) => void;
  setViewport: (panX: number, panY: number, scale: number) => void;
  resetViewport: () => void;
};

type DroneCanvasPersistedState = Pick<
  DroneCanvasState,
  'nodesByDroneId' | 'nodeOrder' | 'draftPromptByNodeId' | 'draftRepoLabelByNodeId' | 'panX' | 'panY' | 'scale'
>;

function roundCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function clampCanvasScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value));
}

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

function normalizeSelection(
  ids: string[],
  nodesByDroneId: Record<string, DroneCanvasNode>,
): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || out.includes(id)) continue;
    if (!nodesByDroneId[id]) continue;
    out.push(id);
  }
  return out;
}

function isCanvasDraftNodeId(value: string): boolean {
  const id = String(value ?? '').trim();
  return id.startsWith(DRAFT_CANVAS_NODE_PREFIX);
}

function normalizeNodesByDroneId(value: unknown): Record<string, DroneCanvasNode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, DroneCanvasNode> = {};
  for (const [rawId, candidate] of Object.entries(value as Record<string, unknown>)) {
    const droneId = String(rawId ?? '').trim();
    if (!droneId) continue;
    const item = candidate as Record<string, unknown>;
    const label = String(item?.label ?? '').trim() || droneId;
    out[droneId] = {
      droneId,
      label,
      x: roundCoord(Number(item?.x ?? 0)),
      y: roundCoord(Number(item?.y ?? 0)),
    };
  }
  return out;
}

function normalizeNodeOrder(value: unknown, nodesByDroneId: Record<string, DroneCanvasNode>): string[] {
  const source = Array.isArray(value) ? value : [];
  const out = normalizeSelection(source as string[], nodesByDroneId);
  for (const droneId of Object.keys(nodesByDroneId)) {
    if (!out.includes(droneId)) out.push(droneId);
  }
  return out;
}

function normalizePersistedState(value: unknown): DroneCanvasPersistedState {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const nodesByDroneId = normalizeNodesByDroneId(raw.nodesByDroneId);
  const rawDraftPromptByNodeId =
    raw.draftPromptByNodeId && typeof raw.draftPromptByNodeId === 'object' && !Array.isArray(raw.draftPromptByNodeId)
      ? (raw.draftPromptByNodeId as Record<string, unknown>)
      : {};
  const draftPromptByNodeId: Record<string, string> = {};
  for (const [rawId, rawPrompt] of Object.entries(rawDraftPromptByNodeId)) {
    const id = String(rawId ?? '').trim();
    if (!id || !nodesByDroneId[id] || !isCanvasDraftNodeId(id)) continue;
    const prompt = String(rawPrompt ?? '');
    if (!prompt) continue;
    draftPromptByNodeId[id] = prompt;
  }
  const rawDraftRepoLabelByNodeId =
    raw.draftRepoLabelByNodeId &&
    typeof raw.draftRepoLabelByNodeId === 'object' &&
    !Array.isArray(raw.draftRepoLabelByNodeId)
      ? (raw.draftRepoLabelByNodeId as Record<string, unknown>)
      : {};
  const draftRepoLabelByNodeId: Record<string, string> = {};
  for (const [rawId, rawLabel] of Object.entries(rawDraftRepoLabelByNodeId)) {
    const id = String(rawId ?? '').trim();
    if (!id || !nodesByDroneId[id] || !isCanvasDraftNodeId(id)) continue;
    const repoLabel = String(rawLabel ?? '').trim();
    if (!repoLabel) continue;
    draftRepoLabelByNodeId[id] = repoLabel;
  }
  return {
    nodesByDroneId,
    nodeOrder: normalizeNodeOrder(raw.nodeOrder, nodesByDroneId),
    draftPromptByNodeId,
    draftRepoLabelByNodeId,
    panX: roundCoord(Number(raw.panX ?? 32)),
    panY: roundCoord(Number(raw.panY ?? 32)),
    scale: clampCanvasScale(Number(raw.scale ?? 1)),
  };
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getBrowserLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

const canvasPersistStorage: StateStorage = (() => {
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<string, string>();

  const flush = () => {
    flushTimer = null;
    if (pending.size === 0) return;
    const storage = getBrowserLocalStorage();
    if (!storage) {
      pending.clear();
      return;
    }
    for (const [name, value] of pending.entries()) {
      try {
        storage.setItem(name, value);
      } catch {
        // Ignore write errors (e.g. quota exceeded/private mode restrictions).
      }
    }
    pending.clear();
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(flush, CANVAS_PERSIST_DEBOUNCE_MS);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
  }

  return {
    getItem: (name) => {
      const storage = getBrowserLocalStorage();
      if (!storage) return null;
      try {
        return storage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);
      scheduleFlush();
    },
    removeItem: (name) => {
      pending.delete(name);
      const storage = getBrowserLocalStorage();
      if (!storage) return;
      try {
        storage.removeItem(name);
      } catch {
        // Ignore remove errors.
      }
    },
  };
})();

export const useDroneCanvasStore = create<DroneCanvasState>()(
  persist(
    (set) => ({
      nodesByDroneId: {},
      nodeOrder: [],
      selectedDroneIds: [],
      draftPromptByNodeId: {},
      draftRepoLabelByNodeId: {},
      panX: 32,
      panY: 32,
      scale: 1,
      upsertNodes: (nodes) =>
        set((state) => {
          if (!Array.isArray(nodes) || nodes.length === 0) return state;
          const nextById = { ...state.nodesByDroneId };
          const nextOrder = state.nodeOrder.slice();
          let touched = false;

          for (const candidate of nodes) {
            const droneId = String(candidate?.droneId ?? '').trim();
            if (!droneId) continue;
            const label = String(candidate?.label ?? '').trim() || droneId;
            const x = roundCoord(candidate?.x ?? 0);
            const y = roundCoord(candidate?.y ?? 0);
            const previous = nextById[droneId];
            if (!previous) {
              nextOrder.push(droneId);
              touched = true;
            } else if (previous.label === label && previous.x === x && previous.y === y) {
              continue;
            } else {
              touched = true;
            }
            nextById[droneId] = { droneId, label, x, y };
          }

          if (!touched) return state;
          return {
            ...state,
            nodesByDroneId: nextById,
            nodeOrder: normalizeNodeOrder(nextOrder, nextById),
            selectedDroneIds: normalizeSelection(state.selectedDroneIds, nextById),
          };
        }),
      moveNode: (droneId, x, y) =>
        set((state) => {
          const id = String(droneId ?? '').trim();
          if (!id) return state;
          const previous = state.nodesByDroneId[id];
          if (!previous) return state;
          const nextX = roundCoord(x);
          const nextY = roundCoord(y);
          if (previous.x === nextX && previous.y === nextY) return state;
          return {
            ...state,
            nodesByDroneId: {
              ...state.nodesByDroneId,
              [id]: { ...previous, x: nextX, y: nextY },
            },
          };
        }),
      moveNodes: (nodes) =>
        set((state) => {
          if (!Array.isArray(nodes) || nodes.length === 0) return state;
          let nextById: Record<string, DroneCanvasNode> | null = null;
          const sourceById = state.nodesByDroneId;
          for (const candidate of nodes) {
            const id = String(candidate?.droneId ?? '').trim();
            if (!id) continue;
            const previous = (nextById ?? sourceById)[id];
            if (!previous) continue;
            const nextX = roundCoord(candidate?.x ?? previous.x);
            const nextY = roundCoord(candidate?.y ?? previous.y);
            if (previous.x === nextX && previous.y === nextY) continue;
            if (!nextById) nextById = { ...sourceById };
            nextById[id] = { ...previous, x: nextX, y: nextY };
          }
          if (!nextById) return state;
          return { ...state, nodesByDroneId: nextById };
        }),
      removeNodes: (droneIds) =>
        set((state) => {
          const removeSet = new Set(normalizeSelection(droneIds, state.nodesByDroneId));
          if (removeSet.size === 0) return state;
          const nextById: Record<string, DroneCanvasNode> = { ...state.nodesByDroneId };
          const nextDraftPromptByNodeId = { ...state.draftPromptByNodeId };
          const nextDraftRepoLabelByNodeId = { ...state.draftRepoLabelByNodeId };
          let draftPromptChanged = false;
          let draftRepoLabelChanged = false;
          for (const droneId of removeSet) {
            delete nextById[droneId];
            if (Object.prototype.hasOwnProperty.call(nextDraftPromptByNodeId, droneId)) {
              delete nextDraftPromptByNodeId[droneId];
              draftPromptChanged = true;
            }
            if (Object.prototype.hasOwnProperty.call(nextDraftRepoLabelByNodeId, droneId)) {
              delete nextDraftRepoLabelByNodeId[droneId];
              draftRepoLabelChanged = true;
            }
          }
          const nextOrder = state.nodeOrder.filter((droneId) => !removeSet.has(droneId));
          const nextSelected = state.selectedDroneIds.filter((droneId) => !removeSet.has(droneId));
          return {
            ...state,
            nodesByDroneId: nextById,
            nodeOrder: nextOrder,
            selectedDroneIds: nextSelected,
            draftPromptByNodeId: draftPromptChanged ? nextDraftPromptByNodeId : state.draftPromptByNodeId,
            draftRepoLabelByNodeId: draftRepoLabelChanged
              ? nextDraftRepoLabelByNodeId
              : state.draftRepoLabelByNodeId,
          };
        }),
      replaceNodeId: (oldDroneId, newDroneId, label) =>
        set((state) => {
          const oldId = String(oldDroneId ?? '').trim();
          const nextId = String(newDroneId ?? '').trim();
          if (!oldId || !nextId) return state;
          const oldNode = state.nodesByDroneId[oldId];
          if (!oldNode) return state;
          const nextLabel = String(label ?? '').trim() || oldNode.label;
          const nextNode: DroneCanvasNode = {
            droneId: nextId,
            label: nextLabel,
            x: oldNode.x,
            y: oldNode.y,
          };
          const nextById = { ...state.nodesByDroneId };
          delete nextById[oldId];
          nextById[nextId] = nextNode;
          const rawOrder = state.nodeOrder.map((id) => (id === oldId ? nextId : id));
          const nextOrder = normalizeNodeOrder(rawOrder, nextById);
          const rawSelected = state.selectedDroneIds.map((id) => (id === oldId ? nextId : id));
          const nextSelected = normalizeSelection(rawSelected, nextById);
          const nextDraftPromptByNodeId = { ...state.draftPromptByNodeId };
          const nextDraftRepoLabelByNodeId = { ...state.draftRepoLabelByNodeId };
          delete nextDraftPromptByNodeId[oldId];
          delete nextDraftRepoLabelByNodeId[oldId];
          return {
            ...state,
            nodesByDroneId: nextById,
            nodeOrder: nextOrder,
            selectedDroneIds: nextSelected,
            draftPromptByNodeId: nextDraftPromptByNodeId,
            draftRepoLabelByNodeId: nextDraftRepoLabelByNodeId,
          };
        }),
      setDraftPromptForNode: (droneId, prompt) =>
        set((state) => {
          const id = String(droneId ?? '').trim();
          if (!id || !state.nodesByDroneId[id] || !isCanvasDraftNodeId(id)) return state;
          const nextPrompt = String(prompt ?? '');
          const prevPrompt = String(state.draftPromptByNodeId[id] ?? '');
          if (prevPrompt === nextPrompt) return state;
          const nextDraftPromptByNodeId = { ...state.draftPromptByNodeId };
          if (nextPrompt) nextDraftPromptByNodeId[id] = nextPrompt;
          else delete nextDraftPromptByNodeId[id];
          return {
            ...state,
            draftPromptByNodeId: nextDraftPromptByNodeId,
          };
        }),
      setDraftRepoLabelForNode: (droneId, repoLabel) =>
        set((state) => {
          const id = String(droneId ?? '').trim();
          if (!id || !state.nodesByDroneId[id] || !isCanvasDraftNodeId(id)) return state;
          const nextRepoLabel = String(repoLabel ?? '').trim();
          const prevRepoLabel = String(state.draftRepoLabelByNodeId[id] ?? '');
          if (prevRepoLabel === nextRepoLabel) return state;
          const nextDraftRepoLabelByNodeId = { ...state.draftRepoLabelByNodeId };
          if (nextRepoLabel) nextDraftRepoLabelByNodeId[id] = nextRepoLabel;
          else delete nextDraftRepoLabelByNodeId[id];
          return {
            ...state,
            draftRepoLabelByNodeId: nextDraftRepoLabelByNodeId,
          };
        }),
      syncNodeLabels: (droneNameById) =>
        set((state) => {
          if (!droneNameById || typeof droneNameById !== 'object') return state;
          let changed = false;
          const nextById = { ...state.nodesByDroneId };
          for (const id of state.nodeOrder) {
            const current = nextById[id];
            if (!current) continue;
            const nextLabel = String(droneNameById[id] ?? '').trim() || current.label;
            if (nextLabel === current.label) continue;
            nextById[id] = { ...current, label: nextLabel };
            changed = true;
          }
          if (!changed) return state;
          return { ...state, nodesByDroneId: nextById };
        }),
      setSelectedDroneIds: (next) =>
        set((state) => {
          const normalized = normalizeSelection(resolveNext(state.selectedDroneIds, next), state.nodesByDroneId);
          if (areStringArraysEqual(state.selectedDroneIds, normalized)) return state;
          return {
            ...state,
            selectedDroneIds: normalized,
          };
        }),
      toggleSelectedDroneId: (droneId) =>
        set((state) => {
          const id = String(droneId ?? '').trim();
          if (!id || !state.nodesByDroneId[id]) return state;
          const selected = state.selectedDroneIds;
          return selected.includes(id)
            ? { ...state, selectedDroneIds: selected.filter((x) => x !== id) }
            : { ...state, selectedDroneIds: [...selected, id] };
        }),
      clearSelection: () =>
        set((state) => {
          if (state.selectedDroneIds.length === 0) return state;
          return { ...state, selectedDroneIds: [] };
        }),
      setPan: (panX, panY) =>
        set((state) => {
          const nextPanX = roundCoord(panX);
          const nextPanY = roundCoord(panY);
          if (state.panX === nextPanX && state.panY === nextPanY) return state;
          return {
            ...state,
            panX: nextPanX,
            panY: nextPanY,
          };
        }),
      setScale: (scale) =>
        set((state) => {
          const nextScale = clampCanvasScale(scale);
          if (state.scale === nextScale) return state;
          return {
            ...state,
            scale: nextScale,
          };
        }),
      setViewport: (panX, panY, scale) =>
        set((state) => {
          const nextPanX = roundCoord(panX);
          const nextPanY = roundCoord(panY);
          const nextScale = clampCanvasScale(scale);
          if (state.panX === nextPanX && state.panY === nextPanY && state.scale === nextScale) return state;
          return {
            ...state,
            panX: nextPanX,
            panY: nextPanY,
            scale: nextScale,
          };
        }),
      resetViewport: () =>
        set((state) => {
          if (state.panX === 32 && state.panY === 32 && state.scale === 1) return state;
          return {
            ...state,
            panX: 32,
            panY: 32,
            scale: 1,
          };
        }),
    }),
    {
      name: DRONE_CANVAS_STORAGE_KEY,
      version: 3,
      storage: createJSONStorage(() => canvasPersistStorage),
      partialize: (state): DroneCanvasPersistedState => ({
        nodesByDroneId: state.nodesByDroneId,
        nodeOrder: state.nodeOrder,
        draftPromptByNodeId: state.draftPromptByNodeId,
        draftRepoLabelByNodeId: state.draftRepoLabelByNodeId,
        panX: state.panX,
        panY: state.panY,
        scale: state.scale,
      }),
      merge: (persistedState, currentState) => {
        const persisted = normalizePersistedState(persistedState);
        return {
          ...currentState,
          ...persisted,
          selectedDroneIds: [],
        };
      },
    },
  ),
);

export { MIN_CANVAS_SCALE, MAX_CANVAS_SCALE, clampCanvasScale };
export { DRAFT_CANVAS_NODE_PREFIX, isCanvasDraftNodeId };
