import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const MIN_CANVAS_SCALE = 0.35;
const MAX_CANVAS_SCALE = 2.6;
const DRONE_CANVAS_STORAGE_KEY = 'droneHub.canvas';

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
  panX: number;
  panY: number;
  scale: number;
  upsertNodes: (nodes: Array<{ droneId: string; label: string; x: number; y: number }>) => void;
  moveNode: (droneId: string, x: number, y: number) => void;
  moveNodes: (nodes: Array<{ droneId: string; x: number; y: number }>) => void;
  removeNodes: (droneIds: string[]) => void;
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
  'nodesByDroneId' | 'nodeOrder' | 'panX' | 'panY' | 'scale'
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
  return {
    nodesByDroneId,
    nodeOrder: normalizeNodeOrder(raw.nodeOrder, nodesByDroneId),
    panX: roundCoord(Number(raw.panX ?? 32)),
    panY: roundCoord(Number(raw.panY ?? 32)),
    scale: clampCanvasScale(Number(raw.scale ?? 1)),
  };
}

export const useDroneCanvasStore = create<DroneCanvasState>()(
  persist(
    (set) => ({
      nodesByDroneId: {},
      nodeOrder: [],
      selectedDroneIds: [],
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
          let touched = false;
          const nextById = { ...state.nodesByDroneId };
          for (const candidate of nodes) {
            const id = String(candidate?.droneId ?? '').trim();
            if (!id) continue;
            const previous = nextById[id];
            if (!previous) continue;
            const nextX = roundCoord(candidate?.x ?? previous.x);
            const nextY = roundCoord(candidate?.y ?? previous.y);
            if (previous.x === nextX && previous.y === nextY) continue;
            nextById[id] = { ...previous, x: nextX, y: nextY };
            touched = true;
          }
          if (!touched) return state;
          return { ...state, nodesByDroneId: nextById };
        }),
      removeNodes: (droneIds) =>
        set((state) => {
          const removeSet = new Set(normalizeSelection(droneIds, state.nodesByDroneId));
          if (removeSet.size === 0) return state;
          const nextById: Record<string, DroneCanvasNode> = { ...state.nodesByDroneId };
          for (const droneId of removeSet) {
            delete nextById[droneId];
          }
          const nextOrder = state.nodeOrder.filter((droneId) => !removeSet.has(droneId));
          const nextSelected = state.selectedDroneIds.filter((droneId) => !removeSet.has(droneId));
          return {
            ...state,
            nodesByDroneId: nextById,
            nodeOrder: nextOrder,
            selectedDroneIds: nextSelected,
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
        set((state) => ({
          ...state,
          selectedDroneIds: normalizeSelection(resolveNext(state.selectedDroneIds, next), state.nodesByDroneId),
        })),
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
        set((state) => ({
          ...state,
          panX: roundCoord(panX),
          panY: roundCoord(panY),
        })),
      setScale: (scale) =>
        set((state) => ({
          ...state,
          scale: clampCanvasScale(scale),
        })),
      setViewport: (panX, panY, scale) =>
        set((state) => ({
          ...state,
          panX: roundCoord(panX),
          panY: roundCoord(panY),
          scale: clampCanvasScale(scale),
        })),
      resetViewport: () =>
        set((state) => ({
          ...state,
          panX: 32,
          panY: 32,
          scale: 1,
        })),
    }),
    {
      name: DRONE_CANVAS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): DroneCanvasPersistedState => ({
        nodesByDroneId: state.nodesByDroneId,
        nodeOrder: state.nodeOrder,
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
