import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { profileStorageKey } from '../../profile-storage';

const MIN_CANVAS_SCALE = 0.35;
const MAX_CANVAS_SCALE = 2.6;
const DRONE_CANVAS_STORAGE_KEY = profileStorageKey('droneHub.canvas');
const CANVAS_PERSIST_DEBOUNCE_MS = 180;
const CANVAS_PERSIST_MAX_STALE_MS = 900;
const DRAFT_CANVAS_NODE_PREFIX = 'draft:';

type Updater<T> = T | ((prev: T) => T);

export type DroneCanvasNode = {
  droneId: string;
  label: string;
  x: number;
  y: number;
};

export type DroneCanvasBoard = {
  nodesByDroneId: Record<string, DroneCanvasNode>;
  nodeOrder: string[];
  selectedDroneIds: string[];
  draftPromptByNodeId: Record<string, string>;
  draftRepoLabelByNodeId: Record<string, string>;
  panX: number;
  panY: number;
  scale: number;
};

type DroneCanvasBoardActions = {
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

/** `drone` shows every chat of the open drone; `global` is the hand-curated board shared across drones. */
export type DroneCanvasScope = 'global' | 'drone';

/**
 * A chat this client just created. It joins its drone's board at once instead
 * of waiting for the next drone summary, and is dropped once the summary has it.
 */
export type OptimisticBoardMember = {
  chatName: string;
  sourceChatName: string;
  sideChat: boolean;
  addedAt: number;
};

type BoardReducer = (board: DroneCanvasBoard) => DroneCanvasBoard;

// The top-level board is the global canvas. Boards in `droneBoards` belong to
// one drone each; `null` addresses the global board.
type DroneCanvasState = DroneCanvasBoard &
  DroneCanvasBoardActions & {
    droneBoards: Record<string, DroneCanvasBoard>;
    scope: DroneCanvasScope;
    setScope: (scope: DroneCanvasScope) => void;
    optimisticMembersByDroneId: Record<string, OptimisticBoardMember[]>;
    addOptimisticBoardMember: (droneId: string, member: OptimisticBoardMember) => void;
    dropOptimisticBoardMembers: (droneId: string, chatNames: string[]) => void;
    applyToBoard: (boardDroneId: string | null, reducer: BoardReducer) => void;
    removeDroneBoards: (droneIds: string[]) => void;
  };

type DroneCanvasPersistedBoard = Omit<DroneCanvasBoard, 'selectedDroneIds'>;
type DroneCanvasPersistedState = DroneCanvasPersistedBoard & {
  droneBoards: Record<string, DroneCanvasPersistedBoard>;
  scope: DroneCanvasScope;
};

const BOARD_KEYS = [
  'nodesByDroneId',
  'nodeOrder',
  'selectedDroneIds',
  'draftPromptByNodeId',
  'draftRepoLabelByNodeId',
  'panX',
  'panY',
  'scale',
] as const;

export const EMPTY_CANVAS_BOARD: DroneCanvasBoard = Object.freeze({
  nodesByDroneId: {},
  nodeOrder: [],
  selectedDroneIds: [],
  draftPromptByNodeId: {},
  draftRepoLabelByNodeId: {},
  panX: 32,
  panY: 32,
  scale: 1,
});

function pickBoard(source: DroneCanvasBoard): DroneCanvasBoard {
  const out = {} as Record<string, unknown>;
  for (const key of BOARD_KEYS) out[key] = source[key];
  return out as DroneCanvasBoard;
}

export function selectCanvasBoard(state: DroneCanvasState, boardDroneId: string | null): DroneCanvasBoard {
  if (!boardDroneId) return state;
  return state.droneBoards[boardDroneId] ?? EMPTY_CANVAS_BOARD;
}

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
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    if (!nodesByDroneId[id]) continue;
    seen.add(id);
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
  const seen = new Set(out);
  for (const droneId of Object.keys(nodesByDroneId)) {
    if (!seen.has(droneId)) out.push(droneId);
  }
  return out;
}

function normalizePersistedBoard(value: unknown): DroneCanvasPersistedBoard {
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

function normalizePersistedState(value: unknown): DroneCanvasPersistedState {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawDroneBoards =
    raw.droneBoards && typeof raw.droneBoards === 'object' && !Array.isArray(raw.droneBoards)
      ? (raw.droneBoards as Record<string, unknown>)
      : {};
  const droneBoards: Record<string, DroneCanvasPersistedBoard> = {};
  for (const [rawId, rawBoard] of Object.entries(rawDroneBoards)) {
    const droneId = String(rawId ?? '').trim();
    if (droneId) droneBoards[droneId] = normalizePersistedBoard(rawBoard);
  }
  return { ...normalizePersistedBoard(raw), droneBoards, scope: raw.scope === 'global' ? 'global' : 'drone' };
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

const canvasPersistStorage: PersistStorage<DroneCanvasState> = (() => {
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<string, StorageValue<DroneCanvasState>>();
  let pendingSince: number | null = null;

  const flush = () => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    pendingSince = null;
    if (pending.size === 0) return;
    const storage = getBrowserLocalStorage();
    if (!storage) {
      pending.clear();
      return;
    }
    for (const [name, value] of pending.entries()) {
      try {
        // Projection and serialization belong inside the debounce too: a pointer
        // event must not walk and stringify every saved board.
        storage.setItem(name, JSON.stringify({ state: toPersistedState(value.state), version: value.version }));
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
    const remaining = CANVAS_PERSIST_MAX_STALE_MS - (Date.now() - (pendingSince ?? Date.now()));
    flushTimer = setTimeout(flush, Math.max(0, Math.min(CANVAS_PERSIST_DEBOUNCE_MS, remaining)));
  };

  if (typeof window !== 'undefined') {
    const flushOnLifecycle = () => flush();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flushOnLifecycle);
    window.addEventListener('error', flushOnLifecycle);
    window.addEventListener('unhandledrejection', flushOnLifecycle);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
  }

  return {
    getItem: (name) => {
      if (pending.has(name)) return pending.get(name)!;
      const storage = getBrowserLocalStorage();
      if (!storage) return null;
      try {
        const value = storage.getItem(name);
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);
      pendingSince ??= Date.now();
      scheduleFlush();
    },
    removeItem: (name) => {
      pending.delete(name);
      if (pending.size === 0) {
        if (flushTimer !== null) clearTimeout(flushTimer);
        flushTimer = null;
        pendingSince = null;
      }
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

function toPersistedBoard(board: DroneCanvasBoard): DroneCanvasPersistedBoard {
  const { selectedDroneIds: _selected, ...persisted } = pickBoard(board);
  return persisted;
}

function toPersistedState(state: DroneCanvasState): DroneCanvasPersistedState {
  return {
    ...toPersistedBoard(state),
    scope: state.scope,
    droneBoards: Object.fromEntries(
      Object.entries(state.droneBoards).map(([droneId, board]) => [droneId, toPersistedBoard(board)]),
    ),
  };
}

type BoardReducers = {
  [K in keyof DroneCanvasBoardActions]: (...args: Parameters<DroneCanvasBoardActions[K]>) => BoardReducer;
};

// Board logic is pure so the same actions serve the global board and every drone board.
const boardReducers: BoardReducers = {
  upsertNodes: (nodes) => (state) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return state;
    let nextById: Record<string, DroneCanvasNode> | null = null;
    let nextOrder: string[] | null = null;
    for (const candidate of nodes) {
      const droneId = String(candidate?.droneId ?? '').trim();
      if (!droneId) continue;
      const label = String(candidate?.label ?? '').trim() || droneId;
      const x = roundCoord(candidate?.x ?? 0);
      const y = roundCoord(candidate?.y ?? 0);
      const previous = (nextById ?? state.nodesByDroneId)[droneId];
      if (previous?.label === label && previous.x === x && previous.y === y) continue;
      if (!previous) {
        nextOrder ??= state.nodeOrder.slice();
        nextOrder.push(droneId);
      }
      nextById ??= { ...state.nodesByDroneId };
      nextById[droneId] = { droneId, label, x, y };
    }
    if (!nextById) return state;
    // Updating a label or position does not change membership or selection.
    return { ...state, nodesByDroneId: nextById, nodeOrder: nextOrder ?? state.nodeOrder };
  },
  moveNode: (droneId, x, y) => (state) => {
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
  },
  moveNodes: (nodes) => (state) => {
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
  },
  removeNodes: (droneIds) => (state) => {
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
  },
  replaceNodeId: (oldDroneId, newDroneId, label) => (state) => {
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
  },
  setDraftPromptForNode: (droneId, prompt) => (state) => {
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
  },
  setDraftRepoLabelForNode: (droneId, repoLabel) => (state) => {
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
  },
  syncNodeLabels: (droneNameById) => (state) => {
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
  },
  setSelectedDroneIds: (next) => (state) => {
    const normalized = normalizeSelection(resolveNext(state.selectedDroneIds, next), state.nodesByDroneId);
    if (areStringArraysEqual(state.selectedDroneIds, normalized)) return state;
    return {
      ...state,
      selectedDroneIds: normalized,
    };
  },
  toggleSelectedDroneId: (droneId) => (state) => {
    const id = String(droneId ?? '').trim();
    if (!id || !state.nodesByDroneId[id]) return state;
    const selected = state.selectedDroneIds;
    return selected.includes(id)
      ? { ...state, selectedDroneIds: selected.filter((x) => x !== id) }
      : { ...state, selectedDroneIds: [...selected, id] };
  },
  clearSelection: () => (state) => {
    if (state.selectedDroneIds.length === 0) return state;
    return { ...state, selectedDroneIds: [] };
  },
  setPan: (panX, panY) => (state) => {
    const nextPanX = roundCoord(panX);
    const nextPanY = roundCoord(panY);
    if (state.panX === nextPanX && state.panY === nextPanY) return state;
    return {
      ...state,
      panX: nextPanX,
      panY: nextPanY,
    };
  },
  setScale: (scale) => (state) => {
    const nextScale = clampCanvasScale(scale);
    if (state.scale === nextScale) return state;
    return {
      ...state,
      scale: nextScale,
    };
  },
  setViewport: (panX, panY, scale) => (state) => {
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
  },
  resetViewport: () => (state) => {
    if (state.panX === 32 && state.panY === 32 && state.scale === 1) return state;
    return {
      ...state,
      panX: 32,
      panY: 32,
      scale: 1,
    };
  },
};

function bindBoardActions(
  applyToBoard: DroneCanvasState['applyToBoard'],
  boardDroneId: string | null,
): DroneCanvasBoardActions {
  const out = {} as Record<string, (...args: unknown[]) => void>;
  for (const [name, reducer] of Object.entries(boardReducers)) {
    out[name] = (...args: unknown[]) =>
      applyToBoard(boardDroneId, (reducer as (...a: unknown[]) => BoardReducer)(...args));
  }
  return out as unknown as DroneCanvasBoardActions;
}

// Bound per-board actions, reused across renders; a board removed with its drone drops its entry.
const boardActionsByDroneId = new Map<string, DroneCanvasBoardActions>();

export const useDroneCanvasStore = create<DroneCanvasState>()(
  persist(
    (set) => {
      const applyToBoard: DroneCanvasState['applyToBoard'] = (boardDroneIdRaw, reducer) =>
        set((state) => {
          const boardDroneId = String(boardDroneIdRaw ?? '').trim();
          if (!boardDroneId) {
            const board = pickBoard(state);
            const next = reducer(board);
            return next === board ? state : { ...state, ...pickBoard(next) };
          }
          const board = state.droneBoards[boardDroneId] ?? EMPTY_CANVAS_BOARD;
          const next = reducer(board);
          if (next === board) return state;
          return { ...state, droneBoards: { ...state.droneBoards, [boardDroneId]: pickBoard(next) } };
        });
      return {
        ...pickBoard(EMPTY_CANVAS_BOARD),
        droneBoards: {},
        scope: 'drone',
        setScope: (scope) => set((state) => (state.scope === scope ? state : { ...state, scope })),
        optimisticMembersByDroneId: {},
        addOptimisticBoardMember: (droneId, member) =>
          set((state) => ({
            ...state,
            optimisticMembersByDroneId: {
              ...state.optimisticMembersByDroneId,
              [droneId]: [
                ...(state.optimisticMembersByDroneId[droneId] ?? []).filter(
                  (existing) => existing.chatName !== member.chatName,
                ),
                member,
              ],
            },
          })),
        dropOptimisticBoardMembers: (droneId, chatNames) =>
          set((state) => {
            const current = state.optimisticMembersByDroneId[droneId];
            if (!current) return state;
            const remaining = current.filter((member) => !chatNames.includes(member.chatName));
            if (remaining.length === current.length) return state;
            const optimisticMembersByDroneId = { ...state.optimisticMembersByDroneId };
            if (remaining.length > 0) optimisticMembersByDroneId[droneId] = remaining;
            else delete optimisticMembersByDroneId[droneId];
            return { ...state, optimisticMembersByDroneId };
          }),
        applyToBoard,
        ...bindBoardActions(applyToBoard, null),
        removeDroneBoards: (droneIds) =>
          set((state) => {
            // A deleted drone takes its board and any cards still waiting for a summary with it.
            const ids = (Array.isArray(droneIds) ? droneIds : []).filter(
              (id) => state.droneBoards[id] || state.optimisticMembersByDroneId[id],
            );
            if (ids.length === 0) return state;
            const droneBoards = { ...state.droneBoards };
            const optimisticMembersByDroneId = { ...state.optimisticMembersByDroneId };
            for (const id of ids) {
              delete droneBoards[id];
              delete optimisticMembersByDroneId[id];
              boardActionsByDroneId.delete(id);
            }
            return { ...state, droneBoards, optimisticMembersByDroneId };
          }),
      };
    },
    {
      name: DRONE_CANVAS_STORAGE_KEY,
      version: 3,
      storage: canvasPersistStorage,
      merge: (persistedState, currentState) => {
        const persisted = normalizePersistedState(persistedState);
        return {
          ...currentState,
          ...persisted,
          selectedDroneIds: [],
          droneBoards: Object.fromEntries(
            Object.entries(persisted.droneBoards).map(([droneId, board]) => [
              droneId,
              { ...board, selectedDroneIds: [] },
            ]),
          ),
        };
      },
    },
  ),
);

export function getCanvasBoardActions(boardDroneIdRaw: string | null): DroneCanvasBoardActions {
  const boardDroneId = String(boardDroneIdRaw ?? '').trim();
  if (!boardDroneId) return useDroneCanvasStore.getState();
  let actions = boardActionsByDroneId.get(boardDroneId);
  if (!actions) {
    actions = bindBoardActions(
      (id, reducer) => useDroneCanvasStore.getState().applyToBoard(id, reducer),
      boardDroneId,
    );
    boardActionsByDroneId.set(boardDroneId, actions);
  }
  return actions;
}

export { MIN_CANVAS_SCALE, MAX_CANVAS_SCALE, clampCanvasScale };
export { DRAFT_CANVAS_NODE_PREFIX, isCanvasDraftNodeId };
