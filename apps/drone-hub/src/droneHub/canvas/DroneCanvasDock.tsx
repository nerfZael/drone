import React from 'react';
import { useDndMonitor, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import type { ChatAgentConfig } from '../../domain';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import type { DroneSummary } from '../types';
import {
  createCanvasChatNodeId,
  parseCanvasChatNodeId,
} from '../app/app-config';
import {
  dispatchCanvasAssignmentPreview,
  resolveFleetAssignmentTargetFromPoint,
} from '../app/fleet-assignment-events';
import {
  draggedCanvasChatNodeIdsFromData,
  parseDroneHubDragData,
} from '../app/drone-hub-dnd';
import { isShortcutMatch } from '../app/shortcuts';
import { resolveCanvasChatDisplay } from '../app/chat-node-helpers';
import { repoPathLabel } from '../app/repo-path-label';
import { buildSpawnModelMenuEntries, getSpawnModelTriggerLabel } from '../app/spawn-model-history';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { TypingDots } from '../overview/icons';
import { CanvasMessageBar } from './CanvasMessageBar';
import {
  collectUniqueChatTargets,
  sortChatNodeIdsForDestructiveDelete,
} from './chat-node-utils';
import {
  buildOptimisticCloneCanvasNodes,
  collectCloneableDroneIdsFromCanvasSelection,
  collectCloneSourceNodeIdByDroneId,
} from './clone-shortcuts';
import {
  DRAFT_CANVAS_NODE_PREFIX,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  clampCanvasScale,
  isCanvasDraftNodeId,
  useDroneCanvasStore,
} from './use-drone-canvas-store';
import {
  measureRectInWorldSpace,
  type CanvasRect,
} from './lineage-geometry';
import {
  buildCanvasRelationshipEdges,
} from './relationship-edges';

const NODE_HEIGHT_PX = 54;
const DROP_STACK_SPACING_Y_PX = 48;
const DRAG_MOVE_THRESHOLD_PX = 3;
const DOT_GRID_BASE_SPACING_PX = 32;
const DOT_GRID_RADIUS_PX = 1.05;
const DOT_GRID_MAX_OPACITY = 0.34;
const DOT_GRID_MIN_OPACITY = 0.08;
const NODE_MIN_WIDTH_PX = 96;
const NODE_MAX_WIDTH_PX = 560;
const NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX = 7.2;
const NODE_SECONDARY_TEXT_WIDTH_ESTIMATE_PX = 5.8;
const NODE_HORIZONTAL_PADDING_PX = 24;
const MIN_DRAFT_SPAWN_COUNT = 1;
const MAX_DRAFT_SPAWN_COUNT = 24;
const SPAWN_COLLISION_MARGIN_PX = 12;
const SPAWN_OFFSET_RINGS = 7;
const CLONE_OFFSET_X_PX = 44;
const CLONE_OFFSET_Y_PX = 34;

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
  lastAgentSnippet: string | null;
};

function resolveCanvasAssignmentDropTarget(
  nodeIds: string[],
  pointTarget: { ownerDroneId: string; canvasNodeId: string | null } | null,
): { ownerDroneId: string | null; targetDroneIds: string[]; canvasNodeId: string | null } {
  const ownerDroneId = String(pointTarget?.ownerDroneId ?? '').trim();
  if (!ownerDroneId) return { ownerDroneId: null, targetDroneIds: [], canvasNodeId: null };
  const draggedDroneIds = Array.from(
    new Set(
      nodeIds
        .map((nodeId) => parseCanvasChatNodeId(nodeId)?.droneId ?? '')
        .filter(Boolean),
    ),
  );
  if (draggedDroneIds.includes(ownerDroneId)) {
    return { ownerDroneId: null, targetDroneIds: [], canvasNodeId: null };
  }
  const targetDroneIds = Array.from(
    new Set(
      draggedDroneIds.filter((droneId) => droneId && droneId !== ownerDroneId),
    ),
  );
  if (targetDroneIds.length === 0) return { ownerDroneId: null, targetDroneIds: [], canvasNodeId: null };
  return {
    ownerDroneId,
    targetDroneIds,
    canvasNodeId: String(pointTarget?.canvasNodeId ?? '').trim() || null,
  };
}

function areCanvasRectMapsEqual(a: Record<string, CanvasRect>, b: Record<string, CanvasRect>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const rectA = a[key];
    const rectB = b[key];
    if (!rectB) return false;
    if (
      rectA.x !== rectB.x ||
      rectA.y !== rectB.y ||
      rectA.width !== rectB.width ||
      rectA.height !== rectB.height
    ) {
      return false;
    }
  }
  return true;
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

function getNodeWidthPx(labelRaw: string, secondaryLabelRaw?: string): number {
  const primaryLabel = String(labelRaw ?? '').trim();
  const secondaryLabel = String(secondaryLabelRaw ?? '').trim();
  const primaryWidth = Math.ceil(primaryLabel.length * NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX);
  const secondaryWidth = Math.ceil(secondaryLabel.length * NODE_SECONDARY_TEXT_WIDTH_ESTIMATE_PX);
  const contentWidth = Math.max(primaryWidth, secondaryWidth);
  return Math.max(
    NODE_MIN_WIDTH_PX,
    Math.min(NODE_MAX_WIDTH_PX, contentWidth + NODE_HORIZONTAL_PADDING_PX),
  );
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
  droneById,
  droneNameById,
  sidebarOrderedChatNodeIds,
  sidebarSelectedChatNodeId,
  droneRepoById,
  fleetParentIdByDroneId,
  fleetAssignedIdsByDroneId,
  draftRepoLabel,
  chatNodeStateById,
  onActivateChat,
  onAssignDronesToOwner,
  onSendCanvasPrompt,
  onCreateCanvasDroneFromDraft,
  onRenameChat,
  onDeleteChat,
  onCloneDrone,
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
  droneById: Record<string, DroneSummary>;
  droneNameById: Record<string, string>;
  sidebarOrderedChatNodeIds: string[];
  sidebarSelectedChatNodeId?: string | null;
  droneRepoById: Record<string, string>;
  fleetParentIdByDroneId: Record<string, string>;
  fleetAssignedIdsByDroneId: Record<string, string[]>;
  draftRepoLabel?: string;
  chatNodeStateById: Record<string, DroneCanvasIndicatorState>;
  onActivateChat?: (droneId: string, chatName: string) => void;
  onAssignDronesToOwner?: (
    ownerDroneId: string,
    targetDroneIds: string[],
  ) => Promise<{ ok: boolean; error?: string | null }>;
  onSendCanvasPrompt?: (
    targets: Array<{ droneId: string; chatName: string }>,
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
  onRenameChat?: (
    droneId: string,
    chatName: string,
    newName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onDeleteChat?: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  onCloneDrone?: (
    drone: DroneSummary,
  ) => Promise<{ ok: boolean; droneId?: string; droneName?: string }> | { ok: boolean; droneId?: string; droneName?: string };
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
  const worldLayerRef = React.useRef<HTMLDivElement | null>(null);
  const lineageMarkerId = React.useId();
  const assignedMarkerId = React.useId();
  const nodeDragRef = React.useRef<NodeDragState | null>(null);
  const panDragRef = React.useRef<PanDragState | null>(null);
  const marqueeDragRef = React.useRef<MarqueeDragState | null>(null);
  const nodeElementByDroneIdRef = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const lastSyncedSidebarSelectionRef = React.useRef<string>('');
  const inlineRenameInputRef = React.useRef<HTMLInputElement | null>(null);
  const copiedDroneIdsRef = React.useRef<string[]>([]);
  const copiedSourceNodeIdByDroneIdRef = React.useRef<Record<string, string>>({});
  const suppressNodeClickRef = React.useRef(false);
  const [dragOverCanvas, setDragOverCanvas] = React.useState(false);
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
  const [panning, setPanning] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<SelectionBox | null>(null);
  const [inlineRenamingDroneId, setInlineRenamingDroneId] = React.useState<string | null>(null);
  const [inlineRenameDraft, setInlineRenameDraft] = React.useState('');
  const [inlineRenameBusy, setInlineRenameBusy] = React.useState(false);
  const [deletingChatNodeById, setDeletingChatNodeById] = React.useState<Record<string, boolean>>({});
  const [messageBarExpanded, setMessageBarExpanded] = React.useState(false);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [draftSpawnCount, setDraftSpawnCount] = React.useState('1');
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [messagePendingCount, setMessagePendingCount] = React.useState(0);
  const [renderedNodeBoundsById, setRenderedNodeBoundsById] = React.useState<Record<string, CanvasRect>>({});
  const [optimisticDroneNameById, setOptimisticDroneNameById] = React.useState<Record<string, string>>({});
  const [assignmentHoverNodeId, setAssignmentHoverNodeId] = React.useState<string | null>(null);
  const [assignmentHoverTargetCount, setAssignmentHoverTargetCount] = React.useState(0);
  const messageInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const draftCreateInFlightRef = React.useRef<Set<string>>(new Set());
  const messageSending = messagePendingCount > 0;
  const effectiveDroneNameById = React.useMemo(
    () => ({ ...optimisticDroneNameById, ...droneNameById }),
    [droneNameById, optimisticDroneNameById],
  );

  const nodes = React.useMemo(
    () => nodeOrder.map((droneId) => nodesByDroneId[droneId]).filter(Boolean),
    [nodeOrder, nodesByDroneId],
  );
  const nodeWidthByDroneId = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const node of nodes) {
      if (isCanvasDraftNodeId(node.droneId)) {
        out[node.droneId] = getNodeWidthPx(node.label);
        continue;
      }
      const chatRef = parseCanvasChatNodeId(node.droneId);
      if (!chatRef) {
        out[node.droneId] = getNodeWidthPx(node.label);
        continue;
      }
      const drone = droneById[chatRef.droneId];
      const droneLabel = String(effectiveDroneNameById[chatRef.droneId] ?? '').trim() || chatRef.droneId;
      const { primaryLabel, secondaryLabel } = resolveCanvasChatDisplay(drone, chatRef.chatName, droneLabel);
      out[node.droneId] = getNodeWidthPx(primaryLabel, secondaryLabel);
    }
    return out;
  }, [droneById, effectiveDroneNameById, nodes]);
  const fallbackNodeBoundsById = React.useMemo(() => {
    const out: Record<string, CanvasRect> = {};
    for (const node of nodes) {
      out[node.droneId] = {
        x: node.x,
        y: node.y,
        width: nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX,
        height: NODE_HEIGHT_PX,
      };
    }
    return out;
  }, [nodeWidthByDroneId, nodes]);
  const preferredNodeByDroneId = React.useMemo(() => {
    const out: Record<string, (typeof nodes)[number]> = {};
    for (const node of nodes) {
      if (isCanvasDraftNodeId(node.droneId)) continue;
      const chatRef = parseCanvasChatNodeId(node.droneId);
      if (!chatRef) continue;
      const current = out[chatRef.droneId];
      if (!current) {
        out[chatRef.droneId] = node;
        continue;
      }
      const currentChat = parseCanvasChatNodeId(current.droneId);
      if (currentChat?.chatName !== 'default' && chatRef.chatName === 'default') {
        out[chatRef.droneId] = node;
      }
    }
    return out;
  }, [nodes]);
  const relationshipEdges = React.useMemo(() => {
    return buildCanvasRelationshipEdges({
      preferredNodeByDroneId,
      renderedNodeBoundsById,
      fallbackNodeBoundsById,
      fleetParentIdByDroneId,
      fleetAssignedIdsByDroneId,
    });
  }, [
    fallbackNodeBoundsById,
    fleetAssignedIdsByDroneId,
    fleetParentIdByDroneId,
    preferredNodeByDroneId,
    renderedNodeBoundsById,
  ]);
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
  const selectedMessageLabel = React.useMemo(() => {
    if (selectedDroneIds.length !== 1) return null;
    const selectedNodeId = String(selectedDroneIds[0] ?? '').trim();
    if (!selectedNodeId) return null;
    if (isCanvasDraftNodeId(selectedNodeId)) {
      return String(nodesByDroneId[selectedNodeId]?.label ?? '').trim() || 'Untitled';
    }
    const chatRef = parseCanvasChatNodeId(selectedNodeId);
    if (!chatRef) return null;
    const drone = droneById[chatRef.droneId];
    const droneLabel = String(effectiveDroneNameById[chatRef.droneId] ?? '').trim() || chatRef.droneId;
    const { primaryLabel, secondaryLabel } = resolveCanvasChatDisplay(drone, chatRef.chatName, droneLabel);
    return secondaryLabel ? `${secondaryLabel} / ${primaryLabel}` : primaryLabel;
  }, [droneById, effectiveDroneNameById, nodesByDroneId, selectedDroneIds]);
  const controlsDisabled = messageSending;
  const normalizedSpawnAgentKey = String(spawnAgentKey ?? '').trim();
  const normalizedSpawnModel = String(spawnModel ?? '');
  const normalizedCreateRepoPath = String(createRepoPath ?? '').trim();
  const normalizedCreateGroup = String(createGroup ?? '');
  const normalizedDraftRepoLabel = React.useMemo(
    () => String(draftRepoLabel ?? '').trim(),
    [draftRepoLabel],
  );
  const {
    createDraftShortcutBinding,
    focusPrimaryChatInputShortcutBinding,
    showCanvasLastMessagePreviews,
    setShowCanvasLastMessagePreviews,
    seenModelIds,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      createDraftShortcutBinding: s.shortcutBindings.createDraftDrone,
      focusPrimaryChatInputShortcutBinding: s.shortcutBindings.focusPrimaryChatInput,
      showCanvasLastMessagePreviews: s.showCanvasLastMessagePreviews,
      setShowCanvasLastMessagePreviews: s.setShowCanvasLastMessagePreviews,
      seenModelIds: s.seenModelIds,
    })),
  );
  const spawnModelMenuEntries = React.useMemo(
    () => buildSpawnModelMenuEntries(seenModelIds, normalizedSpawnModel),
    [normalizedSpawnModel, seenModelIds],
  );
  const spawnModelTriggerLabel = React.useMemo(
    () => getSpawnModelTriggerLabel(seenModelIds, normalizedSpawnModel),
    [normalizedSpawnModel, seenModelIds],
  );
  const spawnModelMenuDisabled = controlsDisabled || spawnModelMenuEntries.length <= 1;

  React.useEffect(() => {
    const known = new Set(nodeOrder);
    for (const key of Object.keys(nodeElementByDroneIdRef.current)) {
      if (known.has(key)) continue;
      delete nodeElementByDroneIdRef.current[key];
    }
  }, [nodeOrder]);

  React.useLayoutEffect(() => {
    const worldLayer = worldLayerRef.current;
    if (!worldLayer || nodes.length === 0) {
      setRenderedNodeBoundsById((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const worldRect = worldLayer.getBoundingClientRect();
    const next: Record<string, CanvasRect> = {};
    for (const node of nodes) {
      const element = nodeElementByDroneIdRef.current[node.droneId];
      if (!element) continue;
      next[node.droneId] = measureRectInWorldSpace(element.getBoundingClientRect(), worldRect, scale);
    }
    setRenderedNodeBoundsById((prev) => (areCanvasRectMapsEqual(prev, next) ? prev : next));
  }, [nodes, scale]);

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
      if (!droneId) return;
      if (!isCanvasDraftNodeId(droneId)) {
        const chatRef = parseCanvasChatNodeId(droneId);
        if (!chatRef) return;
        if (chatRef.chatName === 'default') return;
      }
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
    const newName = String(inlineRenameDraft ?? '').trim();
    const currentName = String(nodesByDroneId[droneId]?.label ?? '').trim();
    if (!newName || newName === currentName) {
      cancelInlineRename();
      return;
    }
    if (isCanvasDraftNodeId(droneId)) {
      const node = nodesByDroneId[droneId];
      if (!node) {
        cancelInlineRename();
        return;
      }
      upsertNodes([{ droneId, label: newName, x: node.x, y: node.y }]);
      cancelInlineRename();
      return;
    }
    const chatRef = parseCanvasChatNodeId(droneId);
    if (!chatRef) {
      cancelInlineRename();
      return;
    }
    if (!onRenameChat) {
      setMessageError('Chat rename is unavailable.');
      cancelInlineRename();
      return;
    }
    setInlineRenameBusy(true);
    try {
      const result = await onRenameChat(chatRef.droneId, chatRef.chatName, newName);
      if (result.ok) {
        const nextChatName = String(result.chatName ?? newName).trim() || newName;
        const nextNodeId = createCanvasChatNodeId(chatRef.droneId, nextChatName);
        if (nextNodeId && nextNodeId !== droneId) {
          replaceNodeId(droneId, nextNodeId, nextChatName);
        } else {
          const node = nodesByDroneId[droneId];
          if (node) upsertNodes([{ droneId, label: nextChatName, x: node.x, y: node.y }]);
        }
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
    onRenameChat,
    replaceNodeId,
    setMessageError,
    upsertNodes,
  ]);

  const deleteChatNode = React.useCallback(
    async (nodeIdRaw: string) => {
      const nodeId = String(nodeIdRaw ?? '').trim();
      if (!nodeId || isCanvasDraftNodeId(nodeId)) {
        removeNodes([nodeId]);
        return;
      }
      const chatRef = parseCanvasChatNodeId(nodeId);
      if (!chatRef) {
        removeNodes([nodeId]);
        return;
      }
      if (!onDeleteChat) {
        setMessageError('Chat deletion is unavailable.');
        return;
      }
      setDeletingChatNodeById((prev) => ({ ...prev, [nodeId]: true }));
      setMessageError(null);
      try {
        const result = await onDeleteChat(chatRef.droneId, chatRef.chatName);
        if (!result.ok) {
          const errorText = String(result.error ?? '').trim();
          if (errorText) setMessageError(errorText);
          return;
        }
        if (result.deletedDrone) {
          const toRemove = nodeOrder.filter((candidateId) => {
            const ref = parseCanvasChatNodeId(candidateId);
            return Boolean(ref && ref.droneId === chatRef.droneId);
          });
          if (toRemove.length > 0) removeNodes(toRemove);
          return;
        }
        removeNodes([nodeId]);
      } catch (err: any) {
        setMessageError(err?.message ?? String(err));
      } finally {
        setDeletingChatNodeById((prev) => {
          if (!prev[nodeId]) return prev;
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
      }
    },
    [nodeOrder, onDeleteChat, removeNodes],
  );

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
    const legacyNodeIds = nodeOrder.filter(
      (nodeId) => !isCanvasDraftNodeId(nodeId) && !parseCanvasChatNodeId(nodeId),
    );
    if (legacyNodeIds.length === 0) return;
    for (const legacyNodeId of legacyNodeIds) {
      const replacementNodeId = createCanvasChatNodeId(legacyNodeId, 'default');
      if (!replacementNodeId) {
        removeNodes([legacyNodeId]);
        continue;
      }
      replaceNodeId(legacyNodeId, replacementNodeId, 'default');
    }
  }, [nodeOrder, removeNodes, replaceNodeId]);

  React.useEffect(() => {
    const updates: Array<{ droneId: string; label: string; x: number; y: number }> = [];
    for (const node of nodes) {
      if (isCanvasDraftNodeId(node.droneId)) continue;
      const chatRef = parseCanvasChatNodeId(node.droneId);
      if (!chatRef) continue;
      if (node.label === chatRef.chatName) continue;
      updates.push({ droneId: node.droneId, label: chatRef.chatName, x: node.x, y: node.y });
    }
    if (updates.length === 0) return;
    upsertNodes(updates);
  }, [nodes, upsertNodes]);

  React.useEffect(() => {
    syncNodeLabels(droneNameById);
  }, [droneNameById, syncNodeLabels]);

  React.useEffect(() => {
    setOptimisticDroneNameById((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [droneId, droneName] of Object.entries(prev)) {
        if (String(droneNameById[droneId] ?? '').trim()) {
          changed = true;
          continue;
        }
        next[droneId] = droneName;
      }
      return changed ? next : prev;
    });
  }, [droneNameById]);

  React.useEffect(() => {
    const sidebarId = String(sidebarSelectedChatNodeId ?? '').trim();
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
  }, [
    draggingNodeId,
    nodesByDroneId,
    panning,
    selectedDroneIds,
    selectionBox,
    setSelectedDroneIds,
    sidebarSelectedChatNodeId,
  ]);

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
        if (nodeDrag.moved) {
          const draggedDroneIds = Array.from(
            new Set(
              nodeDrag.droneIds
                .map((nodeId) => parseCanvasChatNodeId(nodeId)?.droneId ?? '')
                .filter(Boolean),
            ),
          );
          if (draggedDroneIds.length > 0) {
            const assignmentTarget = resolveCanvasAssignmentDropTarget(
              nodeDrag.droneIds,
              resolveFleetAssignmentTargetFromPoint(event.clientX, event.clientY),
            );
            setAssignmentHoverNodeId(assignmentTarget.canvasNodeId);
            setAssignmentHoverTargetCount(assignmentTarget.targetDroneIds.length);
            dispatchCanvasAssignmentPreview({
              droneIds: draggedDroneIds,
              overDroneId: assignmentTarget.ownerDroneId,
            });
          }
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

    const onWindowMouseUp = (event: MouseEvent) => {
      const nodeDrag = nodeDragRef.current;
      if (nodeDrag?.moved) {
        suppressNodeClickRef.current = true;
        const assignmentTarget = resolveCanvasAssignmentDropTarget(
          nodeDrag.droneIds,
          resolveFleetAssignmentTargetFromPoint(event.clientX, event.clientY),
        );
        const ownerDroneId = assignmentTarget.ownerDroneId;
        if (ownerDroneId) {
          moveNodes(
            nodeDrag.droneIds
              .map((droneId) => {
                const start = nodeDrag.startPositionsById[droneId];
                if (!start) return null;
                return { droneId, x: start.x, y: start.y };
              })
              .filter(Boolean) as Array<{ droneId: string; x: number; y: number }>,
          );
          if (onAssignDronesToOwner) {
            const targetDroneIds = assignmentTarget.targetDroneIds;
            if (targetDroneIds.length > 0) {
              setMessageError(null);
              void onAssignDronesToOwner(ownerDroneId, targetDroneIds).then((result) => {
                if (result.ok) {
                  setMessageError(null);
                  return;
                }
                if (result.error) setMessageError(result.error);
              });
            }
          }
        }
      }
      dispatchCanvasAssignmentPreview(null);
      setAssignmentHoverNodeId(null);
      setAssignmentHoverTargetCount(0);
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
      dispatchCanvasAssignmentPreview(null);
      setAssignmentHoverNodeId(null);
      setAssignmentHoverTargetCount(0);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [clearSelection, moveNodes, onAssignDronesToOwner, setPan, setSelectedDroneIds]);

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
    const regularNodeIds = selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id));
    const draftNodeIds = selectedDroneIds.filter((id) => isCanvasDraftNodeId(id));
    const regularTargets = collectUniqueChatTargets(regularNodeIds);
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

            // Clear immediately so the create shortcut can be used right away for rapid draft spawning/sending.
            setDraftPromptForNode(draftNodeId, '');
            draftCreateInFlightRef.current.add(draftNodeId);
            try {
              const spawnCountForDraft =
                draftNodeIds.length === 1 && draftNodeId === selectedDraftNodeId
                  ? singleDraftSpawnCount
                  : MIN_DRAFT_SPAWN_COUNT;
              const created: Array<{ nodeId: string; droneId: string; droneName: string; chatName: string }> = [];
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
                  const chatName = 'default';
                  const nodeId = createCanvasChatNodeId(nextDroneId, chatName);
                  if (!nodeId) {
                    draftCreateHadErrors = true;
                    errors.push(`Failed to create card for "${nextDroneName}".`);
                    continue;
                  }
                  created.push({ nodeId, droneId: nextDroneId, droneName: nextDroneName, chatName });
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
              const firstLabel = first.chatName;
              replaceNodeId(draftNodeId, first.nodeId, firstLabel);
              replacedDraftIds.set(draftNodeId, first.nodeId);
              occupiedRects.push({
                x: node.x,
                y: node.y,
                width: getNodeWidthPx(firstLabel),
                height: NODE_HEIGHT_PX,
              });

              for (let i = 1; i < created.length; i += 1) {
                const spawned = created[i];
                const label = spawned.chatName;
                const width = getNodeWidthPx(label);
                const placement = claimPlacement(node.x, node.y, width);
                additionalNodesToUpsert.push({
                  droneId: spawned.nodeId,
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
                spawnedAdditionalIds.push(spawned.nodeId);
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

      if (regularTargets.length > 0) {
        if (!onSendCanvasPrompt) {
          errors.push('Canvas messaging is unavailable.');
        } else {
          const result = await onSendCanvasPrompt(regularTargets, prompt);
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
      const shouldFocusViewport = regularTargets.length === 0 && allDraftCreatesSucceeded;
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
        const chatRef = parseCanvasChatNodeId(droneId);
        if (!chatRef) return;
        onActivateChat?.(chatRef.droneId, chatRef.chatName);
      }
    },
    [focusViewportElement, onActivateChat, setSelectedDroneIds, toggleSelectedDroneId],
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
  const { setNodeRef: setCanvasDropNodeRef } = useDroppable({
    id: 'canvas-drop',
    data: { type: 'canvas-drop' },
  });
  const setViewportNodeRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      setCanvasDropNodeRef(node);
    },
    [setCanvasDropNodeRef],
  );

  const updateCanvasDragState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overType = String(event.over?.data.current?.type ?? '').trim();
      const acceptsCanvasDrop = activeData?.type === 'sidebar-drone' || activeData?.type === 'sidebar-chat';
      setDragOverCanvas(Boolean(acceptsCanvasDrop && overType === 'canvas-drop'));
    },
    [],
  );

  const placeSidebarDragOnCanvas = React.useCallback(
    (event: DragEndEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overType = String(event.over?.data.current?.type ?? '').trim();
      setDragOverCanvas(false);
      if (overType !== 'canvas-drop') return;
      const ids = draggedCanvasChatNodeIdsFromData(activeData, sidebarOrderedChatNodeIds);
      if (ids.length === 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
      if (!activeRect) return;
      const clientX = activeRect.left + activeRect.width / 2;
      const clientY = activeRect.top + activeRect.height / 2;
      const origin = screenToWorldPoint(clientX, clientY, rect, panX, panY, scale);
      upsertNodes(
        ids.map((nodeId, idx) => {
          const chatRef = parseCanvasChatNodeId(nodeId);
          const label = String(chatRef?.chatName ?? '').trim() || 'default';
          const width = getNodeWidthPx(label);
          return {
            droneId: nodeId,
            label,
            x: origin.x - width / 2,
            y: origin.y - NODE_HEIGHT_PX / 2 + idx * DROP_STACK_SPACING_Y_PX,
          };
        }),
      );
      setSelectedDroneIds(ids);
    },
    [panX, panY, scale, setSelectedDroneIds, sidebarOrderedChatNodeIds, upsertNodes],
  );

  useDndMonitor({
    onDragMove: updateCanvasDragState,
    onDragOver: updateCanvasDragState,
    onDragCancel: () => setDragOverCanvas(false),
    onDragEnd: placeSidebarDragOnCanvas,
  });

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

  const copySelectedDronesForClone = React.useCallback((): string[] => {
    const copiedDroneIds = collectCloneableDroneIdsFromCanvasSelection(selectedDroneIds);
    const sourceNodeIdByDroneId = collectCloneSourceNodeIdByDroneId(selectedDroneIds);
    copiedDroneIdsRef.current = copiedDroneIds;
    copiedSourceNodeIdByDroneIdRef.current = sourceNodeIdByDroneId;
    return copiedDroneIds;
  }, [selectedDroneIds]);

  const pasteCopiedDronesAsClones = React.useCallback(() => {
    if (!onCloneDrone) return;
    const copiedDroneIds = copiedDroneIdsRef.current.slice();
    if (copiedDroneIds.length === 0) return;
    const sourceNodeIdByDroneId = { ...copiedSourceNodeIdByDroneIdRef.current };
    void (async () => {
      const cloneResults: Array<{ sourceDroneId: string; cloneDroneId?: string | null; cloneDroneName?: string | null }> = [];
      for (const raw of copiedDroneIds) {
        const sourceDroneId = String(raw ?? '').trim();
        if (!sourceDroneId) continue;
        const drone = droneById[sourceDroneId];
        if (!drone) continue;
        const result = await onCloneDrone(drone);
        if (!result?.ok) continue;
        cloneResults.push({
          sourceDroneId,
          cloneDroneId: result.droneId ?? null,
          cloneDroneName: result.droneName ?? null,
        });
      }
      const optimistic = buildOptimisticCloneCanvasNodes({
        copiedDroneIdsRaw: copiedDroneIds,
        cloneResultsRaw: cloneResults,
        sourceNodeIdByDroneId,
        nodesById: nodesByDroneId,
        cloneOffsetXPx: CLONE_OFFSET_X_PX,
        cloneOffsetYPx: CLONE_OFFSET_Y_PX,
      });
      if (Object.keys(optimistic.optimisticDroneNameById).length > 0) {
        setOptimisticDroneNameById((prev) => ({ ...prev, ...optimistic.optimisticDroneNameById }));
      }
      if (optimistic.nodes.length > 0) upsertNodes(optimistic.nodes);
    })();
  }, [droneById, nodesByDroneId, onCloneDrone, upsertNodes]);

  const onViewportKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const targetIsEditable = isEditableElement(event.target);
      if (targetIsEditable) return;

      if (isShortcutMatch(createDraftShortcutBinding, event.nativeEvent)) {
        event.preventDefault();
        event.stopPropagation();
        createDraftNearViewportCenter();
        return;
      }

      if (isShortcutMatch(focusPrimaryChatInputShortcutBinding, event.nativeEvent)) {
        if (selectedDroneIds.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          openMessageBar();
        }
        return;
      }

      const key = event.key.toLowerCase();
      const isPrimaryMod = event.ctrlKey || event.metaKey;

      if (!event.repeat && isPrimaryMod && !event.altKey && !event.shiftKey && key === 'c') {
        const copiedDroneIds = copySelectedDronesForClone();
        if (copiedDroneIds.length > 0) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!event.repeat && isPrimaryMod && !event.altKey && !event.shiftKey && key === 'v') {
        if (copiedDroneIdsRef.current.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          pasteCopiedDronesAsClones();
        }
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
          setMessageDraft('');

          const draftNodeIds = selectedDroneIds.filter((id) => isCanvasDraftNodeId(id));
          if (draftNodeIds.length > 0) {
            removeNodes(draftNodeIds);
          }

          const chatNodeIds = sortChatNodeIdsForDestructiveDelete(
            selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id)),
          );
          if (chatNodeIds.length > 0) {
            void (async () => {
              for (const nodeId of chatNodeIds) {
                await deleteChatNode(nodeId);
              }
            })();
          }
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
      copySelectedDronesForClone,
      createDraftShortcutBinding,
      messageBarExpanded,
      nodeOrder,
      openMessageBar,
      cancelActivePointerInteractions,
      deleteChatNode,
      createDraftNearViewportCenter,
      focusPrimaryChatInputShortcutBinding,
      pasteCopiedDronesAsClones,
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
              <UiMenuSelect
                variant="toolbar"
                value={normalizedSpawnModel}
                onValueChange={onSpawnModelChange}
                entries={spawnModelMenuEntries}
                disabled={spawnModelMenuDisabled}
                triggerClassName="min-w-[130px] max-w-[180px]"
                panelClassName="w-[320px]"
                menuClassName="max-h-[220px] overflow-y-auto"
                title="Choose from models already seen in existing drones."
                triggerLabel={spawnModelTriggerLabel}
                triggerLabelClassName="font-mono"
              />
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
              panelClassName="w-[380px] max-w-[calc(100vw-3rem)]"
              menuClassName="max-h-[220px] overflow-y-auto"
              title={normalizedCreateRepoPath || 'No repo'}
              triggerLabel={normalizedCreateRepoPath ? repoPathLabel(normalizedCreateRepoPath) : 'No repo'}
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
          <label
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
            style={{ fontFamily: 'var(--display)' }}
            title="Show the latest agent reply above canvas nodes."
          >
            <input
              type="checkbox"
              checked={showCanvasLastMessagePreviews}
              onChange={(event) => setShowCanvasLastMessagePreviews(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Last msgs
          </label>
          <span className="px-2 text-[10px] font-mono text-[var(--muted-dim)]" title="Selected chats">
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
        ref={setViewportNodeRef}
        tabIndex={0}
        data-shortcut-capture="true"
        data-drone-canvas-viewport="1"
        className={`relative flex-1 min-h-0 overflow-hidden select-none outline-none ${cursorClassName} ${dragOverCanvas ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''}`}
        onKeyDown={onViewportKeyDown}
        onMouseDown={onCanvasMouseDown}
        onDoubleClick={onCanvasDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={onWheel}
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
          ref={worldLayerRef}
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {relationshipEdges.length > 0 ? (
            <svg
              width="1"
              height="1"
              className="absolute left-0 top-0 pointer-events-none overflow-visible"
              style={{ overflow: 'visible' }}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={lineageMarkerId}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(123, 188, 255, 0.92)" />
                </marker>
                <marker
                  id={assignedMarkerId}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255, 178, 36, 0.92)" />
                </marker>
              </defs>
              {relationshipEdges.map((edge) => (
                <path
                  key={edge.key}
                  d={edge.path}
                  fill="none"
                  stroke={edge.variant === 'assigned' ? 'rgba(255, 178, 36, 0.74)' : 'rgba(123, 188, 255, 0.74)'}
                  strokeWidth={edge.variant === 'assigned' ? '1.5' : '1.8'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={edge.variant === 'assigned' ? '7 5' : undefined}
                  markerEnd={`url(#${edge.variant === 'assigned' ? assignedMarkerId : lineageMarkerId})`}
                />
              ))}
            </svg>
          ) : null}
          {nodes.map((node) => {
            const draftNode = isCanvasDraftNodeId(node.droneId);
            const chatRef = draftNode ? null : parseCanvasChatNodeId(node.droneId);
            const chatDroneId = chatRef?.droneId ?? null;
            const selected = selectedDroneIdSet.has(node.droneId);
            const dragging = draggingNodeId === node.droneId;
            const inlineEditing = inlineRenamingDroneId === node.droneId;
            const assignmentHoverTarget = assignmentHoverNodeId === node.droneId && assignmentHoverTargetCount > 0;
            const isActiveSidebarChat = !draftNode && node.droneId === sidebarSelectedChatNodeId;
            const indicatorState = draftNode ? null : chatNodeStateById[node.droneId] ?? null;
            const lastAgentSnippet = indicatorState?.lastAgentSnippet ?? null;
            const indicator = renderNodeIndicator(indicatorState);
            const unreadIndicator = renderNodeUnreadIndicator(indicatorState);
            const nodeWidth = nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX;
            const repoLabel = draftNode
              ? String(draftRepoLabelByNodeId[node.droneId] ?? '').trim()
              : chatDroneId
                ? String(droneRepoById[chatDroneId] ?? '').trim()
                : '';
            const repoBranch = !draftNode && chatDroneId
              ? String(droneById[chatDroneId]?.repoBranch ?? '').trim()
              : '';
            const chatDroneLabel = chatDroneId
              ? String(effectiveDroneNameById[chatDroneId] ?? '').trim() || chatDroneId
              : '';
            const chatDisplay =
              !draftNode && chatDroneId && chatRef
                ? resolveCanvasChatDisplay(droneById[chatDroneId], chatRef.chatName, chatDroneLabel)
                : null;
            return (
              <button
                key={node.droneId}
                type="button"
                data-canvas-node="1"
                data-drone-id={node.droneId}
                data-fleet-assignment-owner-id={!draftNode && chatDroneId ? chatDroneId : undefined}
                ref={(el) => {
                  if (el) nodeElementByDroneIdRef.current[node.droneId] = el;
                  else delete nodeElementByDroneIdRef.current[node.droneId];
                }}
                onMouseDown={(event) => onNodeMouseDown(node.droneId, event)}
                onClick={(event) => onNodeClick(node.droneId, event)}
                onDoubleClick={(event) => onNodeDoubleClick(node.droneId, event)}
                aria-pressed={selected}
                className={`group/canvas-node absolute relative overflow-visible rounded-md border text-left px-2.5 shadow-[0_10px_20px_rgba(0,0,0,.28)] transition-[border-color,background-color,box-shadow] duration-100 flex items-center ${
                  dragging
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                    : assignmentHoverTarget
                      ? 'border-[var(--accent)] bg-[rgba(21,31,46,.96)] shadow-[0_0_0_1px_rgba(123,188,255,.16),0_16px_28px_rgba(0,0,0,.3)]'
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
                {isActiveSidebarChat ? (
                  <span className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md bg-[var(--accent)] z-[2]" />
                ) : null}
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
                {showCanvasLastMessagePreviews && lastAgentSnippet ? (
                  <span
                    className="pointer-events-none absolute left-0 bottom-full mb-[18px] z-[1] inline-flex max-w-[280px] rounded-[4px] border border-[var(--border-subtle)] bg-[rgba(10,14,22,.96)] px-2 py-1 text-[10px] leading-[1.35] text-[var(--muted)] shadow-[0_6px_14px_rgba(0,0,0,.35)]"
                    title={lastAgentSnippet}
                  >
                    <span className="line-clamp-2 break-words whitespace-pre-wrap">{lastAgentSnippet}</span>
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
                {repoBranch ? (
                  <span
                    className="pointer-events-none absolute right-2 top-full mt-[1px] inline-flex max-w-[180px] rounded-[4px] border border-[var(--border-subtle)] bg-[rgba(10,14,22,.95)] px-1.5 py-[1px] text-[9px] font-mono text-[var(--muted-dim)] shadow-[0_6px_14px_rgba(0,0,0,.28)]"
                    title={repoBranch}
                  >
                    {repoBranch}
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
                  ) : assignmentHoverTarget ? (
                    <span className="block">
                      <span className="block truncate text-[12.5px] font-semibold text-[var(--fg-secondary)]">
                        Release to choose action
                      </span>
                      <span className="block truncate text-[10px] text-[var(--muted-dim)]">
                        {assignmentHoverTargetCount} drone{assignmentHoverTargetCount === 1 ? '' : 's'} dropped into this chat
                      </span>
                    </span>
                  ) : (
                    <span className="block">
                      <span className="block truncate text-[12.5px] font-semibold text-[var(--fg-secondary)]">
                        {chatDisplay?.primaryLabel ?? node.label}
                      </span>
                      {!draftNode && chatDisplay?.secondaryLabel ? (
                        <span className="block truncate text-[10px] text-[var(--muted-dim)]">
                          {chatDisplay.secondaryLabel}
                        </span>
                      ) : null}
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
                Drag one or more chats from the sidebar and drop them here.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Double-click to create an untitled draft card.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Ctrl-click toggles selection. Left drag draws a selection box.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Esc clears selection. Delete removes selected cards. Shift+Delete deletes selected chats.
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
