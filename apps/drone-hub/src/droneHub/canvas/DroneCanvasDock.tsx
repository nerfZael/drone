import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ChatAgentConfig } from '../../domain';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import type { DroneSummary } from '../types';
import { DRONE_DND_MIME } from '../app/app-config';
import { TypingDots } from '../overview/icons';
import { CanvasMessageBar } from './CanvasMessageBar';
import {
  DRAFT_CANVAS_NODE_PREFIX,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  clampCanvasScale,
  isCanvasDraftNodeId,
  useDroneCanvasStore,
} from './use-drone-canvas-store';

const NODE_HEIGHT_PX = 54;
const DROP_STACK_SPACING_Y_PX = 48;
const DRAG_MOVE_THRESHOLD_PX = 3;
const DOT_GRID_BASE_SPACING_PX = 32;
const DOT_GRID_RADIUS_PX = 1.05;
const DOT_GRID_MAX_OPACITY = 0.34;
const DOT_GRID_MIN_OPACITY = 0.08;
const NODE_MIN_WIDTH_PX = 96;
const NODE_MAX_WIDTH_PX = 520;
const NODE_TEXT_WIDTH_ESTIMATE_PX = 7.2;
const NODE_HORIZONTAL_PADDING_PX = 24;
const MIN_DRAFT_SPAWN_COUNT = 1;
const MAX_DRAFT_SPAWN_COUNT = 24;
const SPAWN_COLLISION_MARGIN_PX = 12;
const SPAWN_OFFSET_RINGS = 7;

type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type NodeDragState = {
  droneIds: string[];
  startClientX: number;
  startClientY: number;
  startPositionsById: Record<string, { x: number; y: number }>;
  scale: number;
  moved: boolean;
};

type PanDragState = {
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

type MarqueeDragState = {
  startClientX: number;
  startClientY: number;
  additive: boolean;
  baseSelectedIds: string[];
  moved: boolean;
};

type DroneCanvasIndicatorState = {
  statusOk: boolean;
  statusError: string | null;
  hubPhase?: DroneSummary['hubPhase'];
  hubMessage?: DroneSummary['hubMessage'];
  busy: boolean;
  unreadAgentMessage: boolean;
};

function parseDraggedDroneIds(event: React.DragEvent<HTMLElement>): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    const id = String(raw ?? '').trim();
    if (!id || out.includes(id)) return;
    out.push(id);
  };

  try {
    const jsonRaw = event.dataTransfer.getData(DRONE_DND_MIME);
    if (jsonRaw) {
      const parsed = JSON.parse(jsonRaw);
      if (Array.isArray(parsed)) {
        for (const value of parsed) add(value);
      }
    }
  } catch {
    // Ignore malformed drag payload.
  }

  return out;
}

function orderDraggedDroneIds(ids: string[], sidebarOrderedDroneIds: string[]): string[] {
  if (!Array.isArray(ids) || ids.length <= 1) return ids;
  const rankById = new Map<string, number>();
  for (const [index, idRaw] of sidebarOrderedDroneIds.entries()) {
    const id = String(idRaw ?? '').trim();
    if (!id || rankById.has(id)) continue;
    rankById.set(id, index);
  }

  return ids
    .map((id, index) => ({ id, index, rank: rankById.get(id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((item) => item.id);
}

function hasDroneDragPayload(event: React.DragEvent<HTMLElement>): boolean {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  const types = Array.from(transfer.types ?? []);
  return types.includes(DRONE_DND_MIME);
}

function screenToWorldPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  panX: number,
  panY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - panX) / scale,
    y: (clientY - rect.top - panY) / scale,
  };
}

function buildSelectionBox(
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number,
  rect: DOMRect,
): SelectionBox {
  const left = Math.min(startClientX, endClientX) - rect.left;
  const top = Math.min(startClientY, endClientY) - rect.top;
  const width = Math.abs(endClientX - startClientX);
  const height = Math.abs(endClientY - startClientY);
  return { left, top, width, height };
}

function rectIntersects(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function createDraftNodeId(): string {
  return `${DRAFT_CANVAS_NODE_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getNodeWidthPx(labelRaw: string): number {
  const label = String(labelRaw ?? '').trim();
  const nameWidth = Math.ceil(label.length * NODE_TEXT_WIDTH_ESTIMATE_PX) + NODE_HORIZONTAL_PADDING_PX;
  return Math.max(NODE_MIN_WIDTH_PX, Math.min(NODE_MAX_WIDTH_PX, nameWidth));
}

function clampDraftSpawnCount(valueRaw: number): number {
  const value = Number.isFinite(valueRaw) ? Math.round(valueRaw) : MIN_DRAFT_SPAWN_COUNT;
  return Math.max(MIN_DRAFT_SPAWN_COUNT, Math.min(MAX_DRAFT_SPAWN_COUNT, value));
}

function parseDraftSpawnCount(valueRaw: string): number | null {
  const text = String(valueRaw ?? '').trim();
  if (!text || !/^\d+$/.test(text)) return null;
  return clampDraftSpawnCount(Number.parseInt(text, 10));
}

function buildSpawnOffsets(maxRings: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      out.push({ x: dx, y: -ring });
      out.push({ x: dx, y: ring });
    }
    for (let dy = -ring + 1; dy <= ring - 1; dy += 1) {
      out.push({ x: -ring, y: dy });
      out.push({ x: ring, y: dy });
    }
  }
  return out;
}

const SPAWN_OFFSETS = buildSpawnOffsets(SPAWN_OFFSET_RINGS);

function renderNodeIndicator(state: DroneCanvasIndicatorState | null): React.ReactNode {
  if (!state) return null;

  const isStarting = state.hubPhase === 'creating' || state.hubPhase === 'starting' || state.hubPhase === 'seeding';
  if (isStarting || (state.busy && state.statusOk && state.hubPhase !== 'error')) {
    if (isStarting) {
      const label = state.hubPhase === 'seeding' ? 'Seeding' : 'Starting';
      return (
        <span
          className="inline-flex items-center rounded-[4px] border border-[rgba(255,178,36,.35)] bg-[rgba(17,20,28,.96)] px-1.5 py-[1px] text-[8px] font-semibold uppercase tracking-[0.08em] text-[var(--yellow)] shadow-[0_4px_10px_rgba(0,0,0,.35)]"
          style={{ fontFamily: 'var(--display)' }}
          title={String(state.hubMessage ?? label)}
        >
          {label}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center" title="Active">
        <TypingDots color="var(--yellow)" />
      </span>
    );
  }

  if (state.hubPhase === 'error' || !state.statusOk) {
    const label = state.hubPhase === 'error' ? 'Error' : 'Offline';
    return (
      <span
        className="inline-flex items-center rounded-[4px] border border-[rgba(255,90,90,.4)] bg-[rgba(18,12,14,.96)] px-1.5 py-[1px] text-[8px] font-semibold uppercase tracking-[0.08em] text-[var(--red)] shadow-[0_4px_10px_rgba(0,0,0,.35)]"
        style={{ fontFamily: 'var(--display)' }}
        title={String(state.hubMessage ?? state.statusError ?? label)}
      >
        {state.hubPhase === 'error' ? 'Err' : 'Off'}
      </span>
    );
  }

  return null;
}

function renderNodeUnreadIndicator(state: DroneCanvasIndicatorState | null): React.ReactNode {
  if (!state || !state.unreadAgentMessage) return null;
  const isStarting = state.hubPhase === 'creating' || state.hubPhase === 'starting' || state.hubPhase === 'seeding';
  if (isStarting || (state.busy && state.statusOk && state.hubPhase !== 'error')) return null;
  return (
    <span
      className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--yellow)]"
      title="Unread agent message"
      aria-label="Unread agent message"
    />
  );
}

export function DroneCanvasDock({
  droneNameById,
  sidebarOrderedDroneIds,
  sidebarSelectedDroneId,
  droneRepoById,
  draftRepoLabel,
  droneStateById,
  onActivateDrone,
  onSendCanvasPrompt,
  onCreateCanvasDroneFromDraft,
  onRenameDrone,
  onDeleteDrones,
  spawnAgentMenuEntries,
  spawnAgentKey,
  onSpawnAgentKeyChange,
  onOpenCustomAgentModal,
  spawnAgentConfig,
  spawnModel,
  onSpawnModelChange,
  createRepoMenuEntries,
  createRepoPath,
  onCreateRepoPathChange,
  createGroup,
  onCreateGroupChange,
  pullHostBranchBeforeCreate,
  onPullHostBranchBeforeCreateChange,
}: {
  droneNameById: Record<string, string>;
  sidebarOrderedDroneIds: string[];
  sidebarSelectedDroneId?: string | null;
  droneRepoById: Record<string, string>;
  draftRepoLabel?: string;
  droneStateById: Record<string, DroneCanvasIndicatorState>;
  onActivateDrone?: (droneId: string) => void;
  onSendCanvasPrompt?: (
    droneIds: string[],
    prompt: string,
  ) => Promise<{ ok: boolean; error?: string | null }>;
  onCreateCanvasDroneFromDraft?: (payload: {
    draftNodeId: string;
    prompt: string;
    label: string;
    overrides: {
      agentKey: string;
      model: string;
      repoPath: string;
      group: string;
      pullHostBranchBeforeCreate: boolean;
    };
  }) => Promise<{ ok: boolean; droneId?: string; droneName?: string; error?: string | null }>;
  onRenameDrone?: (
    droneId: string,
    newName: string,
  ) => Promise<{ ok: boolean; error?: string | null }>;
  onDeleteDrones?: (droneIds: string[]) => Promise<string[]>;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  spawnAgentKey: string;
  onSpawnAgentKeyChange: (next: string) => void;
  onOpenCustomAgentModal: () => void;
  spawnAgentConfig: ChatAgentConfig;
  spawnModel: string;
  onSpawnModelChange: (next: string) => void;
  createRepoMenuEntries: UiMenuSelectEntry[];
  createRepoPath: string;
  onCreateRepoPathChange: (next: string) => void;
  createGroup: string;
  onCreateGroupChange: (next: string) => void;
  pullHostBranchBeforeCreate: boolean;
  onPullHostBranchBeforeCreateChange: (next: boolean) => void;
}) {
  const {
    nodesByDroneId,
    nodeOrder,
    selectedDroneIds,
    draftPromptByNodeId,
    draftRepoLabelByNodeId,
    panX,
    panY,
    scale,
    upsertNodes,
    moveNodes,
    removeNodes,
    replaceNodeId,
    setDraftPromptForNode,
    setDraftRepoLabelForNode,
    syncNodeLabels,
    setSelectedDroneIds,
    toggleSelectedDroneId,
    clearSelection,
    setPan,
    setViewport,
    resetViewport,
  } = useDroneCanvasStore(
    useShallow((s) => ({
      nodesByDroneId: s.nodesByDroneId,
      nodeOrder: s.nodeOrder,
      selectedDroneIds: s.selectedDroneIds,
      draftPromptByNodeId: s.draftPromptByNodeId,
      draftRepoLabelByNodeId: s.draftRepoLabelByNodeId,
      panX: s.panX,
      panY: s.panY,
      scale: s.scale,
      upsertNodes: s.upsertNodes,
      moveNodes: s.moveNodes,
      removeNodes: s.removeNodes,
      replaceNodeId: s.replaceNodeId,
      setDraftPromptForNode: s.setDraftPromptForNode,
      setDraftRepoLabelForNode: s.setDraftRepoLabelForNode,
      syncNodeLabels: s.syncNodeLabels,
      setSelectedDroneIds: s.setSelectedDroneIds,
      toggleSelectedDroneId: s.toggleSelectedDroneId,
      clearSelection: s.clearSelection,
      setPan: s.setPan,
      setViewport: s.setViewport,
      resetViewport: s.resetViewport,
    })),
  );
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const nodeDragRef = React.useRef<NodeDragState | null>(null);
  const panDragRef = React.useRef<PanDragState | null>(null);
  const marqueeDragRef = React.useRef<MarqueeDragState | null>(null);
  const nodeElementByDroneIdRef = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const lastSyncedSidebarSelectionRef = React.useRef<string>('');
  const inlineRenameInputRef = React.useRef<HTMLInputElement | null>(null);
  const suppressNodeClickRef = React.useRef(false);
  const [dragOverCanvas, setDragOverCanvas] = React.useState(false);
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
  const [panning, setPanning] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<SelectionBox | null>(null);
  const [inlineRenamingDroneId, setInlineRenamingDroneId] = React.useState<string | null>(null);
  const [inlineRenameDraft, setInlineRenameDraft] = React.useState('');
  const [inlineRenameBusy, setInlineRenameBusy] = React.useState(false);
  const [messageBarExpanded, setMessageBarExpanded] = React.useState(false);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [draftSpawnCount, setDraftSpawnCount] = React.useState('1');
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [messagePendingCount, setMessagePendingCount] = React.useState(0);
  const messageInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const draftCreateInFlightRef = React.useRef<Set<string>>(new Set());
  const messageSending = messagePendingCount > 0;

  const nodes = React.useMemo(
    () => nodeOrder.map((droneId) => nodesByDroneId[droneId]).filter(Boolean),
    [nodeOrder, nodesByDroneId],
  );
  const nodeWidthByDroneId = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const node of nodes) {
      out[node.droneId] = getNodeWidthPx(node.label);
    }
    return out;
  }, [nodes]);
  const selectedDroneIdSet = React.useMemo(() => new Set(selectedDroneIds), [selectedDroneIds]);
  const selectedDraftNodeId = React.useMemo(() => {
    if (selectedDroneIds.length !== 1) return null;
    const id = String(selectedDroneIds[0] ?? '').trim();
    if (!id || !isCanvasDraftNodeId(id)) return null;
    return id;
  }, [selectedDroneIds]);
  const selectedDraftPrompt = selectedDraftNodeId
    ? String(draftPromptByNodeId[selectedDraftNodeId] ?? '')
    : '';
  const selectedMessageDraft = selectedDraftNodeId ? selectedDraftPrompt : messageDraft;
  const selectedMessageLabel = selectedDraftNodeId
    ? String(nodesByDroneId[selectedDraftNodeId]?.label ?? '').trim() || 'Untitled'
    : null;
  const controlsDisabled = messageSending;
  const normalizedSpawnAgentKey = String(spawnAgentKey ?? '').trim();
  const normalizedSpawnModel = String(spawnModel ?? '');
  const normalizedCreateRepoPath = String(createRepoPath ?? '').trim();
  const normalizedCreateGroup = String(createGroup ?? '');
  const normalizedDraftRepoLabel = React.useMemo(
    () => String(draftRepoLabel ?? '').trim(),
    [draftRepoLabel],
  );

  React.useEffect(() => {
    const known = new Set(nodeOrder);
    for (const key of Object.keys(nodeElementByDroneIdRef.current)) {
      if (known.has(key)) continue;
      delete nodeElementByDroneIdRef.current[key];
    }
  }, [nodeOrder]);

  const focusMessageInput = React.useCallback(() => {
    requestAnimationFrame(() => {
      const input = messageInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
  }, []);
  const focusViewportElement = React.useCallback(() => {
    viewportRef.current?.focus({ preventScroll: true });
  }, []);
  const focusViewport = React.useCallback(() => {
    requestAnimationFrame(() => {
      focusViewportElement();
    });
  }, [focusViewportElement]);

  const cancelInlineRename = React.useCallback(() => {
    setInlineRenameBusy(false);
    setInlineRenamingDroneId(null);
    setInlineRenameDraft('');
  }, []);

  const beginInlineRename = React.useCallback(
    (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId || isCanvasDraftNodeId(droneId)) return;
      const node = nodesByDroneId[droneId];
      if (!node) return;
      setSelectedDroneIds([droneId]);
      setInlineRenameBusy(false);
      setInlineRenamingDroneId(droneId);
      setInlineRenameDraft(String(node.label ?? droneId));
      setMessageError(null);
    },
    [nodesByDroneId, setSelectedDroneIds],
  );

  const submitInlineRename = React.useCallback(async () => {
    const droneId = String(inlineRenamingDroneId ?? '').trim();
    if (!droneId) return;
    if (!onRenameDrone) {
      cancelInlineRename();
      return;
    }
    const newName = String(inlineRenameDraft ?? '').trim();
    const currentName = String(nodesByDroneId[droneId]?.label ?? '').trim();
    if (!newName || newName === currentName) {
      cancelInlineRename();
      return;
    }
    setInlineRenameBusy(true);
    try {
      const result = await onRenameDrone(droneId, newName);
      if (result.ok) {
        cancelInlineRename();
        return;
      }
      setMessageError(String(result.error ?? 'Rename failed.'));
    } catch (err: any) {
      setMessageError(err?.message ?? String(err));
    } finally {
      setInlineRenameBusy(false);
    }
  }, [
    cancelInlineRename,
    inlineRenameDraft,
    inlineRenamingDroneId,
    nodesByDroneId,
    onRenameDrone,
    setMessageError,
  ]);

  const getDraftPlacement = React.useCallback(
    (
      anchorWorldX: number,
      anchorWorldY: number,
      options?: { avoidCollisions?: boolean },
    ): { x: number; y: number } => {
      const draftWidth = getNodeWidthPx('Untitled');
      const baseX = anchorWorldX - draftWidth / 2;
      const baseY = anchorWorldY - NODE_HEIGHT_PX / 2;
      const roundedBase = { x: Math.round(baseX * 10) / 10, y: Math.round(baseY * 10) / 10 };
      if (options?.avoidCollisions === false) return roundedBase;
      const stepX = Math.max(38, Math.round(draftWidth * 0.36));
      const stepY = NODE_HEIGHT_PX + 16;
      const offsets: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
      for (let ring = 1; ring <= 5; ring += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          offsets.push({ x: dx, y: -ring });
          offsets.push({ x: dx, y: ring });
        }
        for (let dy = -ring + 1; dy <= ring - 1; dy += 1) {
          offsets.push({ x: -ring, y: dy });
          offsets.push({ x: ring, y: dy });
        }
      }

      const collides = (x: number, y: number): boolean => {
        for (const node of nodes) {
          const nodeWidth = nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX;
          if (
            rectIntersects(
              x - 10,
              y - 10,
              draftWidth + 20,
              NODE_HEIGHT_PX + 20,
              node.x,
              node.y,
              nodeWidth,
              NODE_HEIGHT_PX,
            )
          ) {
            return true;
          }
        }
        return false;
      };

      for (const offset of offsets) {
        const x = Math.round((baseX + offset.x * stepX) * 10) / 10;
        const y = Math.round((baseY + offset.y * stepY) * 10) / 10;
        if (!collides(x, y)) return { x, y };
      }
      return roundedBase;
    },
    [nodeWidthByDroneId, nodes],
  );

  const createDraftAtWorldPoint = React.useCallback(
    (anchorWorldX: number, anchorWorldY: number, options?: { avoidCollisions?: boolean }) => {
      const draftNodeId = createDraftNodeId();
      const placement = getDraftPlacement(anchorWorldX, anchorWorldY, options);
      upsertNodes([
        {
          droneId: draftNodeId,
          label: 'Untitled',
          x: placement.x,
          y: placement.y,
        },
      ]);
      setDraftPromptForNode(draftNodeId, '');
      setDraftRepoLabelForNode(draftNodeId, normalizedDraftRepoLabel);
      setSelectedDroneIds([draftNodeId]);
      setMessageDraft('');
      setMessageError(null);
      setMessageBarExpanded(true);
      focusMessageInput();
    },
    [
      focusMessageInput,
      getDraftPlacement,
      normalizedDraftRepoLabel,
      setDraftPromptForNode,
      setDraftRepoLabelForNode,
      setSelectedDroneIds,
      upsertNodes,
    ],
  );

  const createDraftNearViewportCenter = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const centerWorld = screenToWorldPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      rect,
      panX,
      panY,
      scale,
    );
    createDraftAtWorldPoint(centerWorld.x, centerWorld.y);
  }, [createDraftAtWorldPoint, panX, panY, scale]);

  const removeDraftNodeIfEmpty = React.useCallback(
    (draftNodeIdRaw: string) => {
      const draftNodeId = String(draftNodeIdRaw ?? '').trim();
      if (!draftNodeId || !isCanvasDraftNodeId(draftNodeId)) return false;
      const text = String(draftPromptByNodeId[draftNodeId] ?? '').trim();
      if (text) return false;
      removeNodes([draftNodeId]);
      return true;
    },
    [draftPromptByNodeId, removeNodes],
  );

  React.useEffect(() => {
    if (selectedDroneIds.length > 0) return;
    setMessageBarExpanded(false);
    setMessageDraft('');
    setMessageError(null);
  }, [selectedDroneIds.length]);

  React.useEffect(() => {
    syncNodeLabels(droneNameById);
  }, [droneNameById, syncNodeLabels]);

  React.useEffect(() => {
    const sidebarId = String(sidebarSelectedDroneId ?? '').trim();
    if (!sidebarId) {
      lastSyncedSidebarSelectionRef.current = '';
      return;
    }
    // Do not let cross-pane selection sync interrupt an in-progress canvas gesture.
    if (draggingNodeId || panning || nodeDragRef.current || panDragRef.current || marqueeDragRef.current) {
      return;
    }
    if (lastSyncedSidebarSelectionRef.current === sidebarId) return;
    if (!nodesByDroneId[sidebarId]) return;
    lastSyncedSidebarSelectionRef.current = sidebarId;
    if (selectedDroneIds.length === 1 && selectedDroneIds[0] === sidebarId) return;
    setSelectedDroneIds([sidebarId]);
  }, [draggingNodeId, nodesByDroneId, panning, selectedDroneIds, selectionBox, setSelectedDroneIds, sidebarSelectedDroneId]);

  React.useEffect(() => {
    if (!inlineRenamingDroneId) return;
    if (selectedDroneIds.length === 1 && selectedDroneIds[0] === inlineRenamingDroneId) return;
    cancelInlineRename();
  }, [cancelInlineRename, inlineRenamingDroneId, selectedDroneIds]);

  React.useEffect(() => {
    if (!inlineRenamingDroneId) return;
    if (nodesByDroneId[inlineRenamingDroneId]) return;
    cancelInlineRename();
  }, [cancelInlineRename, inlineRenamingDroneId, nodesByDroneId]);

  React.useEffect(() => {
    if (!inlineRenamingDroneId) return;
    requestAnimationFrame(() => {
      const input = inlineRenameInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, [inlineRenamingDroneId]);

  React.useEffect(() => {
    const onWindowMouseMove = (event: MouseEvent) => {
      const nodeDrag = nodeDragRef.current;
      if (nodeDrag) {
        const dx = (event.clientX - nodeDrag.startClientX) / nodeDrag.scale;
        const dy = (event.clientY - nodeDrag.startClientY) / nodeDrag.scale;
        if (!nodeDrag.moved) {
          const movedDistance = Math.hypot(
            event.clientX - nodeDrag.startClientX,
            event.clientY - nodeDrag.startClientY,
          );
          if (movedDistance >= DRAG_MOVE_THRESHOLD_PX) nodeDrag.moved = true;
        }
        moveNodes(
          nodeDrag.droneIds.map((droneId) => {
            const start = nodeDrag.startPositionsById[droneId];
            return { droneId, x: start.x + dx, y: start.y + dy };
          }),
        );
        return;
      }

      const panDrag = panDragRef.current;
      if (panDrag) {
        const dx = event.clientX - panDrag.startClientX;
        const dy = event.clientY - panDrag.startClientY;
        setPan(panDrag.startPanX + dx, panDrag.startPanY + dy);
        return;
      }

      const marqueeDrag = marqueeDragRef.current;
      if (!marqueeDrag) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const box = buildSelectionBox(
        marqueeDrag.startClientX,
        marqueeDrag.startClientY,
        event.clientX,
        event.clientY,
        rect,
      );
      setSelectionBox(box);

      if (!marqueeDrag.moved) {
        const movedDistance = Math.hypot(
          event.clientX - marqueeDrag.startClientX,
          event.clientY - marqueeDrag.startClientY,
        );
        if (movedDistance >= DRAG_MOVE_THRESHOLD_PX) marqueeDrag.moved = true;
      }
      if (!marqueeDrag.moved) return;

      const hits: string[] = [];
      for (const nodeEl of Object.values(nodeElementByDroneIdRef.current)) {
        if (!nodeEl) continue;
        const droneId = String(nodeEl.dataset.droneId ?? '').trim();
        if (!droneId) continue;
        const bounds = nodeEl.getBoundingClientRect();
        const localLeft = bounds.left - rect.left;
        const localTop = bounds.top - rect.top;
        if (
          rectIntersects(
            box.left,
            box.top,
            box.width,
            box.height,
            localLeft,
            localTop,
            bounds.width,
            bounds.height,
          )
        ) {
          hits.push(droneId);
        }
      }

      if (marqueeDrag.additive) {
        const next = marqueeDrag.baseSelectedIds.slice();
        for (const id of hits) {
          if (!next.includes(id)) next.push(id);
        }
        setSelectedDroneIds(next);
      } else {
        setSelectedDroneIds(hits);
      }
    };

    const onWindowMouseUp = () => {
      const nodeDrag = nodeDragRef.current;
      if (nodeDrag?.moved) suppressNodeClickRef.current = true;
      nodeDragRef.current = null;
      setDraggingNodeId(null);

      panDragRef.current = null;
      setPanning(false);

      const marqueeDrag = marqueeDragRef.current;
      if (marqueeDrag && !marqueeDrag.moved && !marqueeDrag.additive) {
        clearSelection();
      }
      marqueeDragRef.current = null;
      setSelectionBox(null);
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [clearSelection, moveNodes, setPan, setSelectedDroneIds]);

  const applyZoomAt = React.useCallback(
    (nextScaleRaw: number, anchorClientX: number, anchorClientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const anchorX = anchorClientX - rect.left;
      const anchorY = anchorClientY - rect.top;
      const nextScale = clampCanvasScale(nextScaleRaw);
      const worldX = (anchorX - panX) / scale;
      const worldY = (anchorY - panY) / scale;
      const nextPanX = anchorX - worldX * nextScale;
      const nextPanY = anchorY - worldY * nextScale;
      setViewport(nextPanX, nextPanY, nextScale);
    },
    [panX, panY, scale, setViewport],
  );

  const zoomIn = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoomAt(scale * 1.14, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [applyZoomAt, scale]);

  const zoomOut = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoomAt(scale / 1.14, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [applyZoomAt, scale]);

  const openMessageBar = React.useCallback(() => {
    if (selectedDroneIds.length === 0) return;
    setMessageBarExpanded(true);
    setMessageError(null);
    focusMessageInput();
  }, [focusMessageInput, selectedDroneIds.length]);

  const closeMessageBar = React.useCallback(() => {
    setMessageBarExpanded(false);
    setMessageError(null);
    if (selectedDraftNodeId) {
      removeDraftNodeIfEmpty(selectedDraftNodeId);
    }
  }, [removeDraftNodeIfEmpty, selectedDraftNodeId]);

  const sendCanvasPrompt = React.useCallback(async () => {
    if (selectedDroneIds.length === 0) return;
    const regularDroneIds = selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id));
    const draftNodeIds = selectedDroneIds.filter((id) => isCanvasDraftNodeId(id));
    // Keep regular-message sends single-flight to avoid accidental duplicate broadcasts.
    if (messageSending && draftNodeIds.length === 0) return;

    const prompt = String(selectedMessageDraft ?? '').trim();
    if (!prompt) {
      if (selectedDraftNodeId) removeDraftNodeIfEmpty(selectedDraftNodeId);
      return;
    }

    const singleDraftSpawnCount =
      draftNodeIds.length === 1 && selectedDraftNodeId && draftNodeIds[0] === selectedDraftNodeId
        ? parseDraftSpawnCount(draftSpawnCount) ?? MIN_DRAFT_SPAWN_COUNT
        : MIN_DRAFT_SPAWN_COUNT;

    setMessagePendingCount((prev) => prev + 1);
    setMessageError(null);
    try {
      const errors: string[] = [];
      const replacedDraftIds = new Map<string, string>();
      const spawnedAdditionalIds: string[] = [];
      const additionalNodesToUpsert: Array<{ droneId: string; label: string; x: number; y: number }> = [];
      let regularSendSucceeded = false;
      let regularSendError: string | null = null;
      let draftCreateHadErrors = false;

      const draftNodeIdSet = new Set(draftNodeIds);
      const occupiedRects = nodes
        .filter((node) => !draftNodeIdSet.has(node.droneId))
        .map((node) => ({
          x: node.x,
          y: node.y,
          width: nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX,
          height: NODE_HEIGHT_PX,
        }));
      const claimPlacement = (
        anchorX: number,
        anchorY: number,
        width: number,
      ): { x: number; y: number } => {
        const stepX = Math.max(48, Math.round(width * 0.72));
        const stepY = NODE_HEIGHT_PX + 18;
        for (const offset of SPAWN_OFFSETS) {
          const candidateX = Math.round((anchorX + offset.x * stepX) * 10) / 10;
          const candidateY = Math.round((anchorY + offset.y * stepY) * 10) / 10;
          const collides = occupiedRects.some((rect) =>
            rectIntersects(
              candidateX - SPAWN_COLLISION_MARGIN_PX,
              candidateY - SPAWN_COLLISION_MARGIN_PX,
              width + SPAWN_COLLISION_MARGIN_PX * 2,
              NODE_HEIGHT_PX + SPAWN_COLLISION_MARGIN_PX * 2,
              rect.x,
              rect.y,
              rect.width,
              rect.height,
            ),
          );
          if (!collides) return { x: candidateX, y: candidateY };
        }
        return {
          x: Math.round((anchorX + (occupiedRects.length + 1) * 14) * 10) / 10,
          y: Math.round((anchorY + (occupiedRects.length + 1) * 10) * 10) / 10,
        };
      };

      if (draftNodeIds.length > 0) {
        if (!onCreateCanvasDroneFromDraft) {
          errors.push('Draft creation is unavailable.');
          draftCreateHadErrors = true;
        } else {
          for (const draftNodeId of draftNodeIds) {
            const node = nodesByDroneId[draftNodeId];
            if (!node) continue;
            if (draftCreateInFlightRef.current.has(draftNodeId)) {
              errors.push(`"${node.label}" is still being created.`);
              draftCreateHadErrors = true;
              continue;
            }
            const draftPrompt = String(draftPromptByNodeId[draftNodeId] ?? '').trim();
            const promptForDraft = draftNodeIds.length === 1 ? draftPrompt || prompt : prompt;
            if (!promptForDraft) {
              removeDraftNodeIfEmpty(draftNodeId);
              continue;
            }

            // Clear immediately so Enter can be used right away for rapid draft spawning/sending.
            setDraftPromptForNode(draftNodeId, '');
            draftCreateInFlightRef.current.add(draftNodeId);
            try {
              const spawnCountForDraft =
                draftNodeIds.length === 1 && draftNodeId === selectedDraftNodeId
                  ? singleDraftSpawnCount
                  : MIN_DRAFT_SPAWN_COUNT;
              const created: Array<{ droneId: string; droneName: string }> = [];
              for (let spawnIdx = 0; spawnIdx < spawnCountForDraft; spawnIdx += 1) {
                const result = await onCreateCanvasDroneFromDraft({
                  draftNodeId: spawnIdx === 0 ? draftNodeId : createDraftNodeId(),
                  prompt: promptForDraft,
                  label: node.label,
                  overrides: {
                    agentKey: normalizedSpawnAgentKey,
                    model: normalizedSpawnModel,
                    repoPath: normalizedCreateRepoPath,
                    group: normalizedCreateGroup,
                    pullHostBranchBeforeCreate: pullHostBranchBeforeCreate === true,
                  },
                });
                if (result.ok && String(result.droneId ?? '').trim()) {
                  const nextDroneId = String(result.droneId ?? '').trim();
                  const nextDroneName = String(result.droneName ?? '').trim() || nextDroneId;
                  created.push({ droneId: nextDroneId, droneName: nextDroneName });
                  continue;
                }
                draftCreateHadErrors = true;
                const fallback =
                  spawnCountForDraft > 1
                    ? `Failed to create "${node.label}" (${spawnIdx + 1}/${spawnCountForDraft}).`
                    : `Failed to create "${node.label}".`;
                errors.push(String(result.error ?? '').trim() || fallback);
              }

              if (created.length === 0) {
                // Restore the prompt if creation failed and the draft still exists.
                setDraftPromptForNode(draftNodeId, promptForDraft);
                continue;
              }

              const first = created[0];
              const firstLabel =
                String(first.droneName ?? '').trim() ||
                String(droneNameById[first.droneId] ?? '').trim() ||
                node.label;
              replaceNodeId(draftNodeId, first.droneId, firstLabel);
              replacedDraftIds.set(draftNodeId, first.droneId);
              occupiedRects.push({
                x: node.x,
                y: node.y,
                width: getNodeWidthPx(firstLabel),
                height: NODE_HEIGHT_PX,
              });

              for (let i = 1; i < created.length; i += 1) {
                const spawned = created[i];
                const label =
                  String(spawned.droneName ?? '').trim() ||
                  String(droneNameById[spawned.droneId] ?? '').trim() ||
                  node.label;
                const width = getNodeWidthPx(label);
                const placement = claimPlacement(node.x, node.y, width);
                additionalNodesToUpsert.push({
                  droneId: spawned.droneId,
                  label,
                  x: placement.x,
                  y: placement.y,
                });
                occupiedRects.push({
                  x: placement.x,
                  y: placement.y,
                  width,
                  height: NODE_HEIGHT_PX,
                });
                spawnedAdditionalIds.push(spawned.droneId);
              }
            } finally {
              draftCreateInFlightRef.current.delete(draftNodeId);
            }
          }
        }
      }

      if (additionalNodesToUpsert.length > 0) {
        upsertNodes(additionalNodesToUpsert);
      }

      if (regularDroneIds.length > 0) {
        if (!onSendCanvasPrompt) {
          errors.push('Canvas messaging is unavailable.');
        } else {
          const result = await onSendCanvasPrompt(regularDroneIds, prompt);
          regularSendSucceeded = result.ok;
          regularSendError = result.error ?? null;
          if (!result.ok && regularSendError) {
            errors.push(regularSendError);
          } else if (!result.ok) {
            errors.push('Failed to send message.');
          }
        }
      }

      const allDraftCreatesSucceeded =
        draftNodeIds.length > 0 &&
        replacedDraftIds.size === draftNodeIds.length &&
        !draftCreateHadErrors;
      if (replacedDraftIds.size > 0 || spawnedAdditionalIds.length > 0) {
        setSelectedDroneIds((prev) => {
          const remapped = prev.map((id) => replacedDraftIds.get(id) ?? id);
          for (const droneId of spawnedAdditionalIds) {
            if (!remapped.includes(droneId)) remapped.push(droneId);
          }
          return Array.from(new Set(remapped));
        });
      }

      const shouldClearMessageDraft = !selectedDraftNodeId && regularSendSucceeded;
      if (shouldClearMessageDraft) {
        setMessageDraft('');
      }
      if (regularSendSucceeded && regularSendError) errors.push(regularSendError);
      setMessageError(errors.length > 0 ? errors.join(' ') : null);
      const shouldFocusViewport = regularDroneIds.length === 0 && allDraftCreatesSucceeded;
      const interactionActive =
        draggingNodeId || panning || nodeDragRef.current || panDragRef.current || marqueeDragRef.current;
      if (!interactionActive) {
        if (shouldFocusViewport) {
          focusViewport();
        } else {
          focusMessageInput();
        }
      }
    } catch (err: any) {
      setMessageError(err?.message ?? String(err));
    } finally {
      setMessagePendingCount((prev) => Math.max(0, prev - 1));
    }
  }, [
    draftPromptByNodeId,
    draftSpawnCount,
    draggingNodeId,
    droneNameById,
    focusMessageInput,
    focusViewport,
    messageSending,
    nodeWidthByDroneId,
    nodes,
    setDraftPromptForNode,
    nodesByDroneId,
    normalizedCreateGroup,
    normalizedCreateRepoPath,
    normalizedSpawnAgentKey,
    normalizedSpawnModel,
    onCreateCanvasDroneFromDraft,
    onSendCanvasPrompt,
    pullHostBranchBeforeCreate,
    panning,
    removeDraftNodeIfEmpty,
    replaceNodeId,
    selectedDraftNodeId,
    selectedDroneIds,
    selectedMessageDraft,
    setSelectedDroneIds,
    upsertNodes,
  ]);

  const onNodeMouseDown = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      if (inlineRenamingDroneId === droneId) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.button !== 0) return;
      focusViewportElement();
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();

      const node = nodesByDroneId[droneId];
      if (!node) return;
      const selectedSet = new Set(selectedDroneIds);
      const dragIds =
        selectedSet.has(droneId) && selectedDroneIds.length > 1
          ? selectedDroneIds.filter((id) => Boolean(nodesByDroneId[id]))
          : [droneId];
      const startPositionsById: Record<string, { x: number; y: number }> = {};
      for (const id of dragIds) {
        const dragNode = nodesByDroneId[id];
        if (!dragNode) continue;
        startPositionsById[id] = { x: dragNode.x, y: dragNode.y };
      }

      if (!selectedSet.has(droneId) || selectedDroneIds.length === 0) {
        setSelectedDroneIds([droneId]);
      }

      nodeDragRef.current = {
        droneIds: dragIds,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPositionsById,
        scale,
        moved: false,
      };
      setDraggingNodeId(droneId);
      marqueeDragRef.current = null;
      setSelectionBox(null);
    },
    [focusViewportElement, inlineRenamingDroneId, nodesByDroneId, scale, selectedDroneIds, setSelectedDroneIds],
  );

  const onNodeClick = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      focusViewportElement();
      if (suppressNodeClickRef.current) {
        suppressNodeClickRef.current = false;
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        toggleSelectedDroneId(droneId);
        return;
      }
      setSelectedDroneIds([droneId]);
      if (!isCanvasDraftNodeId(droneId)) {
        onActivateDrone?.(droneId);
      }
    },
    [focusViewportElement, onActivateDrone, setSelectedDroneIds, toggleSelectedDroneId],
  );

  const onNodeDoubleClick = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      beginInlineRename(droneId);
    },
    [beginInlineRename],
  );

  const onCanvasMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[data-canvas-node="1"]')) {
        return;
      }
      if (event.button === 2) {
        event.preventDefault();
        panDragRef.current = {
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPanX: panX,
          startPanY: panY,
        };
        setPanning(true);
        marqueeDragRef.current = null;
        setSelectionBox(null);
        return;
      }

      if (event.button !== 0) return;
      event.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const additive = event.ctrlKey || event.metaKey;
      if (!additive && selectedDroneIds.length > 0) {
        setSelectedDroneIds([]);
      }
      marqueeDragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        additive,
        baseSelectedIds: selectedDroneIds.slice(),
        moved: false,
      };
      setSelectionBox(buildSelectionBox(event.clientX, event.clientY, event.clientX, event.clientY, rect));
    },
    [panX, panY, selectedDroneIds, setSelectedDroneIds],
  );

  const onCanvasDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (inlineRenamingDroneId) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[data-canvas-node="1"]')) return;
      for (const nodeEl of Object.values(nodeElementByDroneIdRef.current)) {
        if (!nodeEl) continue;
        const bounds = nodeEl.getBoundingClientRect();
        if (
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        ) {
          return;
        }
      }
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const worldPoint = screenToWorldPoint(event.clientX, event.clientY, rect, panX, panY, scale);
      createDraftAtWorldPoint(worldPoint.x, worldPoint.y, { avoidCollisions: false });
    },
    [createDraftAtWorldPoint, inlineRenamingDroneId, panX, panY, scale],
  );

  const onWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextScale = clampCanvasScale(scale * factor);
      applyZoomAt(nextScale, event.clientX, event.clientY);
    },
    [applyZoomAt, scale],
  );

  const onDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDroneDragPayload(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!dragOverCanvas) setDragOverCanvas(true);
    },
    [dragOverCanvas],
  );

  const onDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragOverCanvas(false);
  }, []);

  const onDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDroneDragPayload(event)) return;
      event.preventDefault();
      setDragOverCanvas(false);
      const droppedIds = parseDraggedDroneIds(event);
      const ids = orderDraggedDroneIds(droppedIds, sidebarOrderedDroneIds);
      if (ids.length === 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const origin = screenToWorldPoint(event.clientX, event.clientY, rect, panX, panY, scale);
      upsertNodes(
        ids.map((droneId, idx) => {
          const label = String(droneNameById[droneId] ?? '').trim() || droneId;
          const width = getNodeWidthPx(label);
          return {
            droneId,
            label,
            // Keep the cursor at the center of the first dropped card.
            x: origin.x - width / 2,
            y: origin.y - NODE_HEIGHT_PX / 2 + idx * DROP_STACK_SPACING_Y_PX,
          };
        }),
      );
      setSelectedDroneIds(ids);
    },
    [droneNameById, panX, panY, scale, setSelectedDroneIds, sidebarOrderedDroneIds, upsertNodes],
  );

  const onMessageInputBlur = React.useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof HTMLElement && nextTarget.closest('[data-canvas-message-bar="1"]')) return;
      if (!selectedDraftNodeId) return;
      removeDraftNodeIfEmpty(selectedDraftNodeId);
    },
    [removeDraftNodeIfEmpty, selectedDraftNodeId],
  );

  const onDraftSpawnCountChange = React.useCallback(
    (nextRaw: string) => {
      const digitsOnly = String(nextRaw ?? '').replace(/\D+/g, '').slice(0, 3);
      setDraftSpawnCount(digitsOnly);
      if (messageError) setMessageError(null);
    },
    [messageError],
  );

  const onDraftSpawnCountBlur = React.useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      const normalized = parseDraftSpawnCount(draftSpawnCount);
      setDraftSpawnCount(String(normalized ?? MIN_DRAFT_SPAWN_COUNT));
      onMessageInputBlur(event);
    },
    [draftSpawnCount, onMessageInputBlur],
  );

  const cancelActivePointerInteractions = React.useCallback(() => {
    nodeDragRef.current = null;
    panDragRef.current = null;
    marqueeDragRef.current = null;
    setDraggingNodeId(null);
    setPanning(false);
    setSelectionBox(null);
  }, []);

  const onViewportKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const targetIsEditable = isEditableElement(event.target);
      if (
        event.key === 'Tab' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !targetIsEditable
      ) {
        if (selectedDroneIds.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          openMessageBar();
        }
        return;
      }

      if (targetIsEditable) return;

      const key = event.key.toLowerCase();
      const isPrimaryMod = event.ctrlKey || event.metaKey;
      const hasNoModifiers = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

      if (hasNoModifiers && key === 'enter') {
        event.preventDefault();
        event.stopPropagation();
        createDraftNearViewportCenter();
        return;
      }

      if (isPrimaryMod && !event.altKey && !event.shiftKey && key === 'a') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedDroneIds(nodeOrder.slice());
        return;
      }

      if (key === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        if (messageBarExpanded) {
          closeMessageBar();
          return;
        }
        clearSelection();
        return;
      }

      if ((key === 'delete' || key === 'backspace') && selectedDroneIds.length > 0) {
        const shiftDeleteOnly =
          key === 'delete' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        if (shiftDeleteOnly) {
          event.preventDefault();
          event.stopPropagation();
          cancelActivePointerInteractions();
          setMessageError(null);

          const draftNodeIds = selectedDroneIds.filter((id) => isCanvasDraftNodeId(id));
          const regularDroneIds = selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id));
          if (draftNodeIds.length > 0) {
            removeNodes(draftNodeIds);
          }
          if (regularDroneIds.length === 0) return;

          if (!onDeleteDrones) {
            removeNodes(regularDroneIds);
            return;
          }

          void (async () => {
            try {
              const deletedDroneIds = await onDeleteDrones(regularDroneIds);
              const deletedSet = new Set(
                (Array.isArray(deletedDroneIds) ? deletedDroneIds : [])
                  .map((id) => String(id ?? '').trim())
                  .filter((id) => id && regularDroneIds.includes(id)),
              );
              if (deletedSet.size > 0) {
                removeNodes(Array.from(deletedSet));
              }
            } catch (err: any) {
              setMessageError(err?.message ?? String(err));
            }
          })();
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        cancelActivePointerInteractions();
        removeNodes(selectedDroneIds);
        setMessageDraft('');
        setMessageError(null);
      }
    },
    [
      clearSelection,
      closeMessageBar,
      messageBarExpanded,
      nodeOrder,
      onDeleteDrones,
      openMessageBar,
      cancelActivePointerInteractions,
      createDraftNearViewportCenter,
      removeNodes,
      selectedDroneIds,
      setSelectedDroneIds,
    ],
  );

  const cursorClassName = panning
    ? 'cursor-grabbing'
    : draggingNodeId
      ? 'cursor-grabbing'
      : selectionBox
        ? 'cursor-crosshair'
        : 'cursor-default';
  const dotOpacity = Math.max(
    DOT_GRID_MIN_OPACITY,
    Math.min(DOT_GRID_MAX_OPACITY, DOT_GRID_MAX_OPACITY * Math.pow(scale, 1.2)),
  );

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Canvas
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
              Agent
            </span>
            <UiMenuSelect
              variant="toolbar"
              value={normalizedSpawnAgentKey}
              onValueChange={onSpawnAgentKeyChange}
              entries={spawnAgentMenuEntries}
              disabled={controlsDisabled}
              triggerClassName="min-w-[140px] max-w-[210px]"
              panelClassName="w-[300px]"
              title="Choose agent for canvas-created drones."
            />
            <button
              type="button"
              onClick={onOpenCustomAgentModal}
              disabled={controlsDisabled}
              className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                controlsDisabled
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Manage custom agents"
            >
              Custom
            </button>
          </div>
          {spawnAgentConfig.kind === 'builtin' ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Model
              </span>
              <input
                value={normalizedSpawnModel}
                onChange={(event) => onSpawnModelChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.blur();
                }}
                disabled={controlsDisabled}
                placeholder="Default model"
                className={`h-[28px] w-[150px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
                  controlsDisabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                }`}
                title="Set default model for canvas-created drones."
              />
              <button
                type="button"
                onClick={() => onSpawnModelChange('')}
                disabled={controlsDisabled || !normalizedSpawnModel.trim()}
                className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                  controlsDisabled || !normalizedSpawnModel.trim()
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Clear model override"
              >
                Clear
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
              Repo
            </span>
            <UiMenuSelect
              variant="toolbar"
              value={normalizedCreateRepoPath}
              onValueChange={onCreateRepoPathChange}
              entries={createRepoMenuEntries}
              disabled={controlsDisabled}
              triggerClassName="min-w-[170px] max-w-[280px]"
              panelClassName="w-[680px] max-w-[calc(100vw-3rem)]"
              menuClassName="max-h-[220px] overflow-y-auto"
              title={normalizedCreateRepoPath || 'No repo'}
              triggerLabel={normalizedCreateRepoPath || 'No repo'}
              triggerLabelClassName={normalizedCreateRepoPath ? 'font-mono text-[11px]' : undefined}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
              Group
            </span>
            <input
              value={normalizedCreateGroup}
              onChange={(event) => onCreateGroupChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') event.currentTarget.blur();
              }}
              disabled={controlsDisabled}
              placeholder="Optional group"
              className={`h-[28px] w-[150px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all ${
                controlsDisabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
              }`}
              title="Set group for canvas-created drones."
            />
            <button
              type="button"
              onClick={() => onCreateGroupChange('')}
              disabled={controlsDisabled || !normalizedCreateGroup.trim()}
              className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                controlsDisabled || !normalizedCreateGroup.trim()
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Clear group"
            >
              Clear
            </button>
          </div>
          <label
            className={`inline-flex items-center gap-1.5 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
              controlsDisabled
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] cursor-pointer'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Before creating a repo-attached drone, run a host git pull --ff-only on the current branch."
          >
            <input
              type="checkbox"
              checked={pullHostBranchBeforeCreate}
              onChange={(event) => onPullHostBranchBeforeCreateChange(event.target.checked)}
              disabled={controlsDisabled}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Pull host branch
          </label>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <span className="px-2 text-[10px] font-mono text-[var(--muted-dim)]" title="Selected drones">
            {selectedDroneIds.length} sel
          </span>
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= MIN_CANVAS_SCALE + 0.001}
            className={`h-7 px-2 rounded border text-[10px] font-semibold transition-colors ${
              scale <= MIN_CANVAS_SCALE + 0.001
                ? 'opacity-50 cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= MAX_CANVAS_SCALE - 0.001}
            className={`h-7 px-2 rounded border text-[10px] font-semibold transition-colors ${
              scale >= MAX_CANVAS_SCALE - 0.001
                ? 'opacity-50 cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={resetViewport}
            className="h-7 px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] transition-colors"
            title="Reset canvas view"
          >
            Reset view
          </button>
          <span className="w-[58px] text-right text-[10px] font-mono text-[var(--muted-dim)]" title="Current zoom">
            {Math.round(scale * 100)}%
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        tabIndex={0}
        data-shortcut-capture="true"
        data-drone-canvas-viewport="1"
        className={`relative flex-1 min-h-0 overflow-hidden select-none outline-none ${cursorClassName} ${dragOverCanvas ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''}`}
        onKeyDown={onViewportKeyDown}
        onMouseDown={onCanvasMouseDown}
        onDoubleClick={onCanvasDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={onWheel}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(141, 161, 197, ${dotOpacity.toFixed(3)}) ${DOT_GRID_RADIUS_PX}px, transparent ${DOT_GRID_RADIUS_PX}px)`,
            backgroundSize: `${DOT_GRID_BASE_SPACING_PX * scale}px ${DOT_GRID_BASE_SPACING_PX * scale}px`,
            backgroundPosition: `${panX}px ${panY}px`,
          }}
        />

        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {nodes.map((node) => {
            const draftNode = isCanvasDraftNodeId(node.droneId);
            const selected = selectedDroneIdSet.has(node.droneId);
            const dragging = draggingNodeId === node.droneId;
            const inlineEditing = inlineRenamingDroneId === node.droneId;
            const indicatorState = draftNode ? null : droneStateById[node.droneId] ?? null;
            const indicator = renderNodeIndicator(indicatorState);
            const unreadIndicator = renderNodeUnreadIndicator(indicatorState);
            const nodeWidth = nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX;
            const repoLabel = draftNode
              ? String(draftRepoLabelByNodeId[node.droneId] ?? '').trim()
              : String(droneRepoById[node.droneId] ?? '').trim();
            return (
              <button
                key={node.droneId}
                type="button"
                data-canvas-node="1"
                data-drone-id={node.droneId}
                ref={(el) => {
                  if (el) nodeElementByDroneIdRef.current[node.droneId] = el;
                  else delete nodeElementByDroneIdRef.current[node.droneId];
                }}
                onMouseDown={(event) => onNodeMouseDown(node.droneId, event)}
                onClick={(event) => onNodeClick(node.droneId, event)}
                onDoubleClick={(event) => onNodeDoubleClick(node.droneId, event)}
                aria-pressed={selected}
                className={`absolute relative overflow-visible rounded-md border text-left px-2.5 shadow-[0_10px_20px_rgba(0,0,0,.28)] transition-[border-color,background-color,box-shadow] duration-100 flex items-center ${
                  dragging
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                    : selected || inlineEditing
                      ? 'border-[var(--accent-muted)] bg-[rgba(38,46,66,.95)]'
                      : draftNode
                        ? 'border-[rgba(138,152,184,.45)] bg-[rgba(16,18,23,.88)] hover:border-[rgba(138,152,184,.72)]'
                        : 'border-[var(--border)] bg-[rgba(16,18,23,.92)] hover:border-[var(--accent-muted)]'
                }`}
                style={{
                  left: 0,
                  top: 0,
                  width: nodeWidth,
                  height: NODE_HEIGHT_PX,
                  transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
                  willChange: dragging ? 'transform' : undefined,
                }}
              >
                {indicator ? (
                  <span className="pointer-events-none absolute right-0 bottom-full mb-1 z-[2]">
                    {indicator}
                  </span>
                ) : null}
                {unreadIndicator ? (
                  <span className="pointer-events-none absolute left-0 bottom-full mb-1 z-[2]">
                    {unreadIndicator}
                  </span>
                ) : null}
                {draftNode ? (
                  <span className="pointer-events-none absolute -top-2 left-2 z-[2] inline-flex items-center rounded-[4px] border border-[rgba(138,152,184,.4)] bg-[rgba(10,14,22,.96)] px-1.5 py-[1px] text-[8px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Draft
                  </span>
                ) : null}
                {repoLabel ? (
                  <span className="pointer-events-none absolute left-2 top-full mt-[1px] inline-flex max-w-[260px] rounded-[4px] border border-[var(--border-subtle)] bg-[rgba(10,14,22,.95)] px-1.5 py-[1px] text-[9px] font-mono text-[var(--muted-dim)] shadow-[0_6px_14px_rgba(0,0,0,.28)]">
                    {repoLabel}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  {inlineEditing ? (
                    <input
                      ref={inlineRenameInputRef}
                      value={inlineRenameDraft}
                      disabled={inlineRenameBusy}
                      onChange={(event) => setInlineRenameDraft(event.target.value)}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                      }}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                      }}
                      onBlur={() => {
                        cancelInlineRename();
                      }}
                      onKeyDown={(event) => {
                        if ((event.nativeEvent as any)?.isComposing) return;
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.stopPropagation();
                          void submitInlineRename();
                          return;
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelInlineRename();
                        }
                      }}
                      className="h-8 w-full rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[12.5px] font-semibold text-[var(--fg-secondary)] focus:outline-none focus:border-[var(--accent-muted)]"
                    />
                  ) : (
                    <span className="block whitespace-nowrap text-[12.5px] font-semibold text-[var(--fg-secondary)]">
                      {node.label}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {selectionBox ? (
          <div
            className="absolute pointer-events-none border border-dashed border-[var(--accent)] bg-[var(--accent-subtle)]"
            style={{
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        ) : null}

        <CanvasMessageBar
          selectedCount={selectedDroneIds.length}
          selectedLabel={selectedMessageLabel}
          expanded={messageBarExpanded}
          sending={messageSending}
          draft={selectedMessageDraft}
          spawnCountEnabled={Boolean(selectedDraftNodeId)}
          spawnCount={draftSpawnCount}
          error={messageError}
          inputRef={messageInputRef}
          onExpand={openMessageBar}
          onCollapse={closeMessageBar}
          onSpawnCountChange={onDraftSpawnCountChange}
          onSpawnCountBlur={onDraftSpawnCountBlur}
          onDraftChange={(next) => {
            if (selectedDraftNodeId) {
              setDraftPromptForNode(selectedDraftNodeId, next);
            } else {
              setMessageDraft(next);
            }
            if (messageError) setMessageError(null);
          }}
          onInputBlur={onMessageInputBlur}
          onRequestNewDraft={createDraftNearViewportCenter}
          onSend={() => {
            void sendCanvasPrompt();
          }}
        />

        {nodes.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center px-5 text-center pointer-events-none">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(11,13,18,.7)] px-4 py-3 max-w-[380px]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Drone Canvas
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                Drag one or more drones from the sidebar and drop them here.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Double-click to create an untitled draft card.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Ctrl-click toggles selection. Left drag draws a selection box.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Esc clears selection. Delete removes selected nodes. Shift+Delete deletes selected drones.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Ctrl/Cmd+A selects all nodes.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Right-click drag pans. Mouse wheel zooms.
              </div>
            </div>
          </div>
        ) : null}

        {dragOverCanvas ? (
          <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)]" />
        ) : null}
      </div>
    </div>
  );
}
