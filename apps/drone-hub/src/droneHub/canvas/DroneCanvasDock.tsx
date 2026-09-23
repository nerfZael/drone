import type { ChatModelOverrides } from '../chat/selected-chat-model-overrides';
import type { ChatSendPayload, ChatSendContext } from '../chat/ChatInput';
import { useOptionalActiveComposer } from '../chat/ActiveComposerContext';
import type { CanvasSendPrompt, CanvasDraftCreation } from './canvas-messaging';
import React from 'react';
import '@xyflow/react/dist/style.css';
import { useDndMonitor, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import type { ChatAgentConfig } from '../../domain';
import {
  UiMenuSelect,
  type UiMenuSelectEntry,
  UiPaneState,
  UiPanel,
  UiPanelBody,
  UiPanelToolbar,
  UiToolbarButton,
  UiToolbarIconButton,
  UiToolbarInput,
} from '../../ui/components';
import type { DroneSummary } from '../types';
import { selectSidebarChatNodes } from '../app/sidebar-chat-selection';
import { SidebarContextMenu } from '../app/SidebarContextMenu';
import { chatClipboardHasContent, pastableClipboard, useChatClipboardStore } from '../app/chat-clipboard-store';
import {
  composerReferencesFromNodeIds,
  mergeComposerReferences,
  type ComposerReference,
} from '../chat/composer-references';
import { IconTune } from '../app/icons';
import {
  createCanvasChatNodeId,
  createCanvasDroneNodeId,
  parseCanvasChatNodeId,
  parseCanvasDroneNodeId,
} from '../app/app-config';
import {
  dispatchCanvasAssignmentPreview,
  resolveFleetAssignmentTargetFromPoint,
} from '../app/fleet-assignment-events';
import {
  draggedCanvasNodeIdsFromData,
  parseDroneHubDragData,
  useDroneHubActiveDrag,
} from '../app/drone-hub-dnd';
import { isShortcutMatch } from '../app/shortcuts';
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
  collectCloneableChatsFromCanvasSelection,
  collectCloneableDroneIdsFromCanvasSelection,
  collectCloneSourceNodeIdByDroneId,
  planCanvasPastePositions,
  runWithConcurrency,
} from './clone-shortcuts';
import {
  DRAFT_CANVAS_NODE_PREFIX,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  clampCanvasScale,
  getCanvasBoardActions,
  isCanvasDraftNodeId,
  selectCanvasBoard,
  useDroneCanvasStore,
} from './use-drone-canvas-store';
import { OPTIMISTIC_MEMBER_TTL_MS, buildDroneBoardMembers, planDroneBoardPlacements } from './drone-board';
import {
  measureRectInWorldSpace,
  type CanvasRect,
} from './lineage-geometry';
import {
  buildCanvasRelationshipEdges,
} from './relationship-edges';
import {
  CHAT_NODE_HEIGHT_PX,
  NODE_HEIGHT_PX,
  NODE_MIN_WIDTH_PX,
  getNodeHeightPx,
  getChatLabelTextBoost,
  getNodeWidthPx,
} from './node-metrics';

const DROP_STACK_SPACING_Y_PX = 48;
const DRAG_MOVE_THRESHOLD_PX = 3;
const DOT_GRID_BASE_SPACING_PX = 32;
const DOT_GRID_RADIUS_PX = 1.05;
const DOT_GRID_MAX_OPACITY = 0.34;
// Zoomed out, the dots are as bright as node outlines and read as noise; they are gone by this scale.
const DOT_GRID_FADE_OUT_SCALE = 0.55;
// Nodes counter-scale so they never render smaller than this fraction of their natural size...
const NODE_LEGIBLE_SCALE = 0.85;
// ...up to this factor, which keeps sibling chat nodes on a drone board from touching.
const NODE_MAX_READABILITY_BOOST = 1.4;
// Arrowheads shrink with the zoom like the nodes used to, but never below a visible size.
const EDGE_MARKER_SCREEN_PX = 14;
const EDGE_DOT_MARKER_SCREEN_PX = 12;
const EDGE_MARKER_MIN_SCREEN_PX = 6;
const FIT_VIEWPORT_PADDING_PX = 48;
const MIN_DRAFT_SPAWN_COUNT = 1;
const MAX_DRAFT_SPAWN_COUNT = 24;
const SPAWN_COLLISION_MARGIN_PX = 12;
const SPAWN_OFFSET_RINGS = 7;
const CLONE_OFFSET_X_PX = 44;
const CLONE_OFFSET_Y_PX = 34;
const CHAT_PASTE_CONCURRENCY = 4;

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
  /** Restored when the cards are dropped on the composer as references rather than moved. */
  selectionBefore: string[];
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
  statusChecking?: boolean;
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
        .map((nodeId) => parseCanvasChatNodeId(nodeId)?.droneId ?? parseCanvasDroneNodeId(nodeId) ?? '')
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
          className="inline-flex items-center rounded-[4px] border border-[var(--yellow-border)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--yellow)] shadow-[0_4px_10px_var(--shadow-color)]"
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

  if (state.statusChecking) {
    return (
      <span
        className="inline-flex items-center rounded-[4px] border border-[var(--yellow-border)] bg-[var(--warning-panel)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--yellow)] shadow-[0_4px_10px_var(--shadow-color)]"
        style={{ fontFamily: 'var(--display)' }}
        title={String(state.statusError ?? 'Checking status')}
      >
        Chk
      </span>
    );
  }

  if (state.hubPhase === 'error' || !state.statusOk) {
    const label = state.hubPhase === 'error' ? 'Error' : 'Offline';
    return (
      <span
        className="inline-flex items-center rounded-[4px] border border-[var(--red-border)] bg-[var(--danger-panel)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--red)] shadow-[0_4px_10px_var(--shadow-color)]"
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

/** Pans and zooms so every rect is inside the viewport, never zooming in past 1:1. */
export function fitViewportToBounds(
  bounds: ReadonlyArray<CanvasRect>,
  viewportWidth: number,
  viewportHeight: number,
): { panX: number; panY: number; scale: number } | null {
  if (bounds.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const rect of bounds) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const innerWidth = Math.max(1, viewportWidth - FIT_VIEWPORT_PADDING_PX * 2);
  const innerHeight = Math.max(1, viewportHeight - FIT_VIEWPORT_PADDING_PX * 2);
  const scale = clampCanvasScale(Math.min(1, innerWidth / width, innerHeight / height));
  return {
    panX: Math.round((viewportWidth - width * scale) / 2 - minX * scale),
    panY: Math.round((viewportHeight - height * scale) / 2 - minY * scale),
    scale,
  };
}

export function DroneCanvasDock({
  boardDrone,
  droneById,
  droneNameById,
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
  onDeleteChats,
  onCloneChat,
  onCloneDrone,
  onCreateChat,
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
}: {
  /** The open drone. Its board shows all of its chats without dragging them in. */
  boardDrone?: DroneSummary | null;
  droneById: Record<string, DroneSummary>;
  droneNameById: Record<string, string>;
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
  onSendCanvasPrompt?: CanvasSendPrompt;
  onCreateCanvasDroneFromDraft?: (payload: CanvasDraftCreation) => Promise<{ ok: boolean; droneId?: string; droneName?: string; error?: string | null }>;
  onRenameChat?: (
    droneId: string,
    chatName: string,
    newName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  /** Deletes the chats together, behind one confirmation; a result per chat asked about. */
  onDeleteChats?: (
    targets: ReadonlyArray<{ droneId: string; chatName: string }>,
  ) => Promise<Array<{ droneId: string; chatName: string; ok: boolean; deletedDrone?: boolean; error?: string | null }>>;
  onCloneChat?: (
    droneId: string,
    chatName: string,
    opts?: { select?: boolean; boardPosition?: { x: number; y: number } },
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onCloneDrone?: (
    drone: DroneSummary,
  ) => Promise<{ ok: boolean; droneId?: string; droneName?: string }> | { ok: boolean; droneId?: string; droneName?: string };
  onCreateChat?: (droneId: string) => Promise<boolean>;
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
}) {
  const { scope, setScope } = useDroneCanvasStore(
    useShallow((s) => ({ scope: s.scope, setScope: s.setScope })),
  );
  const boardDroneId = scope === 'drone' ? String(boardDrone?.id ?? '').trim() || null : null;
  const droneScope = Boolean(boardDroneId);
  const clipboardHasContent = useChatClipboardStore((state) => chatClipboardHasContent(state, boardDroneId));
  const {
    nodesByDroneId,
    nodeOrder: storedNodeOrder,
    selectedDroneIds: storedSelectedDroneIds,
    draftPromptByNodeId,
    draftRepoLabelByNodeId,
    panX,
    panY,
    scale,
  } = useDroneCanvasStore(
    useShallow((s) => {
      const board = selectCanvasBoard(s, boardDroneId);
      return {
        nodesByDroneId: board.nodesByDroneId,
        nodeOrder: board.nodeOrder,
        selectedDroneIds: board.selectedDroneIds,
        draftPromptByNodeId: board.draftPromptByNodeId,
        draftRepoLabelByNodeId: board.draftRepoLabelByNodeId,
        panX: board.panX,
        panY: board.panY,
        scale: board.scale,
      };
    }),
  );
  const {
    upsertNodes,
    moveNodes,
    removeNodes,
    replaceNodeId,
    setDraftPromptForNode,
    setDraftRepoLabelForNode,
    setSelectedDroneIds,
    clearSelection,
    setPan,
    setViewport,
    resetViewport,
  } = React.useMemo(() => getCanvasBoardActions(boardDroneId), [boardDroneId]);
  const optimisticMembers = useDroneCanvasStore((s) =>
    boardDroneId ? s.optimisticMembersByDroneId[boardDroneId] : undefined,
  );
  const boardChats = boardDrone?.chats;
  const boardSideChats = boardDrone?.sideChats;
  const boardChatCloneSources = boardDrone?.chatCloneSources;
  // The summary object is rebuilt on every refresh; the key tracks only the
  // parts membership depends on, and is not recomputed while dragging.
  const boardMemberKey = React.useMemo(
    () =>
      droneScope
        ? JSON.stringify([
            boardChats ?? [],
            (boardSideChats ?? []).map((chat) => [chat.name, chat.sourceChatName]),
            boardChatCloneSources ?? {},
            optimisticMembers ?? [],
          ])
        : '',
    [boardChatCloneSources, boardChats, boardSideChats, droneScope, optimisticMembers],
  );
  const boardMembers = React.useMemo(
    () => (droneScope ? buildDroneBoardMembers(boardDrone, optimisticMembers) : []),
    // The summary is rebuilt on every refresh; only its chat list matters here.
    [boardDroneId, boardMemberKey],
  );
  const forkSourceNodeIdByNodeId = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const member of boardMembers) {
      if (member.sourceNodeId) out[member.nodeId] = member.sourceNodeId;
    }
    return out;
  }, [boardMembers]);
  React.useEffect(() => {
    if (!boardDroneId || !optimisticMembers?.length) return;
    const confirmed = new Set([...(boardDrone?.chats ?? []), ...(boardDrone?.sideChats ?? []).map((chat) => chat.name)]);
    const settled = optimisticMembers.filter((member) => confirmed.has(member.chatName)).map((member) => member.chatName);
    if (settled.length > 0) useDroneCanvasStore.getState().dropOptimisticBoardMembers(boardDroneId, settled);
    // A chat that never shows up in a summary leaves the board once its grace period ends.
    const pending = optimisticMembers.filter((member) => !confirmed.has(member.chatName));
    if (pending.length === 0) return;
    const nextExpiry = Math.min(...pending.map((member) => member.addedAt + OPTIMISTIC_MEMBER_TTL_MS));
    const timer = setTimeout(() => {
      const expired = pending
        .filter((member) => member.addedAt + OPTIMISTIC_MEMBER_TTL_MS <= Date.now())
        .map((member) => member.chatName);
      if (expired.length > 0) useDroneCanvasStore.getState().dropOptimisticBoardMembers(boardDroneId, expired);
    }, Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
    // Keyed like boardMembers: the summary object is rebuilt on every refresh.
  }, [boardDroneId, boardMemberKey]);

  // Stored positions outlive a chat briefly (renames land in two steps), so a
  // drone board renders members only instead of pruning the store.
  const boardMemberIds = React.useMemo(
    () => (droneScope ? new Set(boardMembers.map((member) => member.nodeId)) : null),
    [boardMembers, droneScope],
  );
  const nodeOrder = React.useMemo(
    () => (boardMemberIds ? storedNodeOrder.filter((nodeId) => boardMemberIds.has(nodeId)) : storedNodeOrder),
    [boardMemberIds, storedNodeOrder],
  );
  // A chat deleted elsewhere (or an optimistic card that expired) must not stay
  // selected: the message bar and prompt sending act on the selection.
  const selectedDroneIds = React.useMemo(() => {
    if (!boardMemberIds) return storedSelectedDroneIds;
    const kept = storedSelectedDroneIds.filter((nodeId) => boardMemberIds.has(nodeId));
    return kept.length === storedSelectedDroneIds.length ? storedSelectedDroneIds : kept;
  }, [boardMemberIds, storedSelectedDroneIds]);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  /** Whether a client point is over the visible message composer, which takes drops as references. */
  const isOverMessageComposer = React.useCallback((clientX: number, clientY: number) => {
    const composer = viewportRef.current?.querySelector<HTMLElement>('[data-selected-chats-composer]');
    if (!composer || composer.hidden) return false;
    const rect = composer.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }, []);
  const worldLayerRef = React.useRef<HTMLDivElement | null>(null);
  const lineageMarkerId = React.useId();
  const assignedMarkerId = React.useId();
  const chatOwnerMarkerId = React.useId();
  const nodeDragRef = React.useRef<NodeDragState | null>(null);
  const panDragRef = React.useRef<PanDragState | null>(null);
  const marqueeDragRef = React.useRef<MarqueeDragState | null>(null);
  const nodeElementByDroneIdRef = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const lastSyncedSidebarSelectionRef = React.useRef<string>('');
  const inlineRenameInputRef = React.useRef<HTMLInputElement | null>(null);
  const suppressNodeClickRef = React.useRef(false);
  const cursorClientPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const lastPasteRef = React.useRef<{ x: number; y: number; count: number } | null>(null);
  const pendingChatPlacementRef = React.useRef<{ x: number; y: number } | null>(null);
  const viewRef = React.useRef({ panX, panY, scale });
  viewRef.current = { panX, panY, scale };
  const [dragOverCanvas, setDragOverCanvas] = React.useState(false);
  const activeDroneHubDrag = useDroneHubActiveDrag();
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
  const [panning, setPanning] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<SelectionBox | null>(null);
  const [inlineRenamingDroneId, setInlineRenamingDroneId] = React.useState<string | null>(null);
  const [inlineRenameDraft, setInlineRenameDraft] = React.useState('');
  const [inlineRenameBusy, setInlineRenameBusy] = React.useState(false);
  // Enter and Escape settle a rename themselves; the blur that follows the field going away must not.
  const inlineRenameSettledRef = React.useRef(false);
  const [deletingChatNodeById, setDeletingChatNodeById] = React.useState<Record<string, boolean>>({});
  const [canvasControlsExpanded, setCanvasControlsExpanded] = React.useState(false);
  const [messageBarExpanded, setMessageBarExpanded] = React.useState(false);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [messageReferences, setMessageReferences] = React.useState<ComposerReference[]>([]);
  const [composerDropHover, setComposerDropHover] = React.useState(false);
  const [draftSpawnCount, setDraftSpawnCount] = React.useState('1');
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [messagePendingCount, setMessagePendingCount] = React.useState(0);
  const [renderedNodeBoundsById, setRenderedNodeBoundsById] = React.useState<Record<string, CanvasRect>>({});
  const [optimisticDroneNameById, setOptimisticDroneNameById] = React.useState<Record<string, string>>({});
  const [assignmentHoverNodeId, setAssignmentHoverNodeId] = React.useState<string | null>(null);
  const [assignmentHoverTargetCount, setAssignmentHoverTargetCount] = React.useState(0);
  const activeComposer = useOptionalActiveComposer();
  const composerHasAttachmentsRef = React.useRef(false);
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
      const canvasDroneId = parseCanvasDroneNodeId(node.droneId);
      if (canvasDroneId) {
        const droneLabel = String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId;
        out[node.droneId] = getNodeWidthPx(droneLabel, 'Drone');
        continue;
      }
      const chatRef = parseCanvasChatNodeId(node.droneId);
      if (!chatRef) {
        out[node.droneId] = getNodeWidthPx(node.label);
        continue;
      }
      out[node.droneId] = getNodeWidthPx(chatRef.chatName);
    }
    return out;
  }, [droneById, effectiveDroneNameById, nodes]);
  const nodeHeightByDroneId = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const node of nodes) out[node.droneId] = getNodeHeightPx(node.droneId);
    return out;
  }, [nodes]);
  const fallbackNodeBoundsById = React.useMemo(() => {
    const out: Record<string, CanvasRect> = {};
    for (const node of nodes) {
      out[node.droneId] = {
        x: node.x,
        y: node.y,
        width: nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX,
        height: nodeHeightByDroneId[node.droneId] ?? NODE_HEIGHT_PX,
      };
    }
    return out;
  }, [nodeHeightByDroneId, nodeWidthByDroneId, nodes]);
  const droneNodeByDroneId = React.useMemo(() => {
    const out: Record<string, (typeof nodes)[number]> = {};
    for (const node of nodes) {
      if (isCanvasDraftNodeId(node.droneId)) continue;
      const canvasDroneId = parseCanvasDroneNodeId(node.droneId);
      if (canvasDroneId && !out[canvasDroneId]) out[canvasDroneId] = node;
    }
    return out;
  }, [nodes]);
  const chatNodesByDroneId = React.useMemo(() => {
    const out: Record<string, Array<(typeof nodes)[number]>> = {};
    for (const node of nodes) {
      const chatRef = parseCanvasChatNodeId(node.droneId);
      if (!chatRef) continue;
      (out[chatRef.droneId] ??= []).push(node);
    }
    return out;
  }, [nodes]);
  const preferredNodeByDroneId = React.useMemo(() => {
    const out: Record<string, (typeof nodes)[number]> = { ...droneNodeByDroneId };
    for (const node of nodes) {
      if (isCanvasDraftNodeId(node.droneId)) continue;
      const chatRef = parseCanvasChatNodeId(node.droneId);
      if (!chatRef) continue;
      const current = out[chatRef.droneId];
      if (current && parseCanvasDroneNodeId(current.droneId)) continue;
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
  }, [droneNodeByDroneId, nodes]);
  const relationshipEdges = React.useMemo(() => {
    return buildCanvasRelationshipEdges({
      preferredNodeByDroneId,
      droneNodeByDroneId,
      chatNodesByDroneId,
      renderedNodeBoundsById,
      fallbackNodeBoundsById,
      fleetParentIdByDroneId,
      fleetAssignedIdsByDroneId,
      forkSourceNodeIdByNodeId,
    });
  }, [
    forkSourceNodeIdByNodeId,
    fallbackNodeBoundsById,
    chatNodesByDroneId,
    droneNodeByDroneId,
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
    const canvasDroneId = parseCanvasDroneNodeId(selectedNodeId);
    if (canvasDroneId) {
      return String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId;
    }
    const chatRef = parseCanvasChatNodeId(selectedNodeId);
    if (!chatRef) return null;
    return chatRef.chatName;
  }, [effectiveDroneNameById, nodesByDroneId, selectedDroneIds]);
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
    hideSideChatWindowsWithCanvas,
    setHideSideChatWindowsWithCanvas,
    seenModelIds,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      createDraftShortcutBinding: s.shortcutBindings.createDraftDrone,
      focusPrimaryChatInputShortcutBinding: s.shortcutBindings.focusPrimaryChatInput,
      showCanvasLastMessagePreviews: s.showCanvasLastMessagePreviews,
      setShowCanvasLastMessagePreviews: s.setShowCanvasLastMessagePreviews,
      hideSideChatWindowsWithCanvas: s.hideSideChatWindowsWithCanvas,
      setHideSideChatWindowsWithCanvas: s.setHideSideChatWindowsWithCanvas,
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
      const input = viewportRef.current?.querySelector<HTMLTextAreaElement>('[data-canvas-message-bar] textarea');
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
      inlineRenameSettledRef.current = false;
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
          // The chat may sit on both the global board and its drone's board.
          getCanvasBoardActions(null).replaceNodeId(droneId, nextNodeId, nextChatName);
          getCanvasBoardActions(chatRef.droneId).replaceNodeId(droneId, nextNodeId, nextChatName);
        } else {
          const node = nodesByDroneId[droneId];
          if (node) upsertNodes([{ droneId, label: nextChatName, x: node.x, y: node.y }]);
        }
        cancelInlineRename();
        return;
      }
      setMessageError(String(result.error ?? 'Rename failed.'));
      // The field stays open for another try, and clicking away saves again.
      inlineRenameSettledRef.current = false;
    } catch (err: any) {
      setMessageError(err?.message ?? String(err));
      inlineRenameSettledRef.current = false;
    } finally {
      setInlineRenameBusy(false);
    }
  }, [
    cancelInlineRename,
    inlineRenameDraft,
    inlineRenamingDroneId,
    nodesByDroneId,
    onRenameChat,
    setMessageError,
    upsertNodes,
  ]);

  /** Deletes the chats behind the selected cards, asking once for all of them. */
  const [chatContextMenu, setChatContextMenu] = React.useState<{ x: number; y: number; view: Window; nodeIds: string[] } | null>(null);
  const deleteChatNodes = React.useCallback(
    async (nodeIdsRaw: readonly string[]) => {
      const chatNodeIds: string[] = [];
      const cardsOnly: string[] = [];
      for (const raw of nodeIdsRaw) {
        const nodeId = String(raw ?? '').trim();
        if (!nodeId) continue;
        if (!isCanvasDraftNodeId(nodeId) && parseCanvasChatNodeId(nodeId)) chatNodeIds.push(nodeId);
        else cardsOnly.push(nodeId);
      }
      if (cardsOnly.length > 0) removeNodes(cardsOnly);
      if (chatNodeIds.length === 0) return;
      if (!onDeleteChats) {
        setMessageError('Chat deletion is unavailable.');
        return;
      }
      const targets = chatNodeIds.map((nodeId) => parseCanvasChatNodeId(nodeId)!);
      setDeletingChatNodeById((prev) => Object.assign({ ...prev }, ...chatNodeIds.map((nodeId) => ({ [nodeId]: true }))));
      setMessageError(null);
      try {
        const results = await onDeleteChats(targets);
        const errors = results.map((result) => String(result.error ?? '').trim()).filter(Boolean);
        if (errors.length > 0) setMessageError(errors.length === 1 ? errors[0] : `${errors.length} chats could not be deleted: ${errors[0]}`);
        const toRemove = new Set<string>();
        for (const result of results) {
          if (!result.ok) continue;
          useDroneCanvasStore.getState().dropOptimisticBoardMembers(result.droneId, [result.chatName]);
          if (result.deletedDrone) {
            for (const candidateId of nodeOrder) {
              const ref = parseCanvasChatNodeId(candidateId);
              if (ref?.droneId === result.droneId || parseCanvasDroneNodeId(candidateId) === result.droneId) toRemove.add(candidateId);
            }
          } else {
            toRemove.add(createCanvasChatNodeId(result.droneId, result.chatName));
          }
        }
        if (toRemove.size > 0) removeNodes([...toRemove]);
      } catch (err: any) {
        setMessageError(err?.message ?? String(err));
      } finally {
        setDeletingChatNodeById((prev) => {
          const next = { ...prev };
          for (const nodeId of chatNodeIds) delete next[nodeId];
          return next;
        });
      }
    },
    [nodeOrder, onDeleteChats, removeNodes],
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

  const createChatAtWorldPoint = React.useCallback(
    (worldX: number, worldY: number) => {
      if (!boardDroneId || !onCreateChat) return;
      pendingChatPlacementRef.current = {
        x: Math.round(worldX - NODE_MIN_WIDTH_PX / 2),
        y: Math.round(worldY - CHAT_NODE_HEIGHT_PX / 2),
      };
      void onCreateChat(boardDroneId).then((ok) => {
        if (!ok) pendingChatPlacementRef.current = null;
      });
    },
    [boardDroneId, onCreateChat],
  );

  const requestNewNodeNearViewportCenter = React.useCallback(() => {
    if (!droneScope) {
      createDraftNearViewportCenter();
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const center = screenToWorldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, panX, panY, scale);
    createChatAtWorldPoint(center.x, center.y);
  }, [createChatAtWorldPoint, createDraftNearViewportCenter, droneScope, panX, panY, scale]);

  const removeDraftNodeIfEmpty = React.useCallback(
    (draftNodeIdRaw: string) => {
      const draftNodeId = String(draftNodeIdRaw ?? '').trim();
      if (!draftNodeId || !isCanvasDraftNodeId(draftNodeId)) return false;
      const text = String(draftPromptByNodeId[draftNodeId] ?? '').trim();
      if (text || (draftNodeId === selectedDraftNodeId && composerHasAttachmentsRef.current)) return false;
      removeNodes([draftNodeId]);
      return true;
    },
    [draftPromptByNodeId, removeNodes, selectedDraftNodeId],
  );

  React.useEffect(() => {
    if (!droneScope) return;
    const anyPlaced = boardMembers.some((member) => nodesByDroneId[member.nodeId]);
    let rootAnchor = pendingChatPlacementRef.current;
    const viewport = viewportRef.current;
    if (!rootAnchor && anyPlaced && viewport) {
      // Later arrivals land where the user is looking, not at the board origin.
      const rect = viewport.getBoundingClientRect();
      const view = viewRef.current;
      const center = screenToWorldPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect,
        view.panX,
        view.panY,
        view.scale,
      );
      rootAnchor = { x: center.x - NODE_MIN_WIDTH_PX / 2, y: center.y - CHAT_NODE_HEIGHT_PX / 2 };
    }
    const planned = planDroneBoardPlacements({ members: boardMembers, nodesById: nodesByDroneId, rootAnchor });
    if (planned.length === 0) return;
    if (planned.some((node) => !forkSourceNodeIdByNodeId[node.droneId])) pendingChatPlacementRef.current = null;
    upsertNodes(planned);
  }, [boardMembers, droneScope, forkSourceNodeIdByNodeId, nodesByDroneId, upsertNodes]);

  React.useEffect(() => {
    if (selectedDroneIds.length > 0) return;
    setMessageBarExpanded(false);
    setMessageError(null);
  }, [selectedDroneIds.length]);

  React.useEffect(() => {
    const legacyNodeIds = nodeOrder.filter(
      (nodeId) =>
        !isCanvasDraftNodeId(nodeId) &&
        !parseCanvasChatNodeId(nodeId) &&
        !parseCanvasDroneNodeId(nodeId),
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
      const canvasDroneId = parseCanvasDroneNodeId(node.droneId);
      if (canvasDroneId) {
        const label = String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId;
        if (node.label !== label) {
          updates.push({ droneId: node.droneId, label, x: node.x, y: node.y });
        }
        continue;
      }
      const chatRef = parseCanvasChatNodeId(node.droneId);
      if (!chatRef) continue;
      if (node.label === chatRef.chatName) continue;
      updates.push({ droneId: node.droneId, label: chatRef.chatName, x: node.x, y: node.y });
    }
    if (updates.length === 0) return;
    upsertNodes(updates);
  }, [effectiveDroneNameById, nodes, upsertNodes]);

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
    if (selectedDroneIds.length === 1) {
      const selectedCanvasDroneId = parseCanvasDroneNodeId(selectedDroneIds[0]);
      const sidebarChatDroneId = parseCanvasChatNodeId(sidebarId)?.droneId ?? null;
      if (selectedCanvasDroneId && selectedCanvasDroneId === sidebarChatDroneId) return;
    }
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
        const overComposer = nodeDrag.moved && isOverMessageComposer(event.clientX, event.clientY);
        setComposerDropHover(overComposer);
        if (nodeDrag.moved && !overComposer) {
          const draggedDroneIds = Array.from(
            new Set(
              nodeDrag.droneIds
                .map((nodeId) => parseCanvasChatNodeId(nodeId)?.droneId ?? parseCanvasDroneNodeId(nodeId) ?? '')
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
      setComposerDropHover(false);
      if (nodeDrag?.moved && isOverMessageComposer(event.clientX, event.clientY)) {
        // Dropped on the composer: reference the cards in the message, leaving them and the recipients where they were.
        suppressNodeClickRef.current = true;
        moveNodes(nodeDrag.droneIds.flatMap((droneId) => {
          const start = nodeDrag.startPositionsById[droneId];
          return start ? [{ droneId, x: start.x, y: start.y }] : [];
        }));
        if (nodeDrag.selectionBefore.length) setSelectedDroneIds(nodeDrag.selectionBefore);
        const references = composerReferencesFromNodeIds(nodeDrag.droneIds);
        if (references.length) {
          setMessageReferences((current) => mergeComposerReferences(current, references));
          setMessageBarExpanded(true);
        }
      } else if (nodeDrag?.moved) {
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
  }, [clearSelection, isOverMessageComposer, moveNodes, onAssignDronesToOwner, setPan, setSelectedDroneIds]);

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
  const fitViewportToNodes = React.useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = Object.values(fallbackNodeBoundsById);
    if (!viewport || bounds.length === 0) {
      resetViewport();
      return;
    }
    const fit = fitViewportToBounds(bounds, viewport.clientWidth, viewport.clientHeight);
    if (fit) setViewport(fit.panX, fit.panY, fit.scale);
  }, [fallbackNodeBoundsById, resetViewport, setViewport]);

  const openMessageBar = React.useCallback(() => {
    if (selectedDroneIds.length === 0) return;
    setMessageBarExpanded(true);
    setMessageError(null);
    focusMessageInput();
  }, [focusMessageInput, selectedDroneIds.length]);

  const closeMessageBar = React.useCallback(() => {
    setMessageBarExpanded(false);
    setMessageError(null);
  }, []);

  const sendCanvasPrompt = React.useCallback(async (payload: ChatSendPayload, context: ChatSendContext, overrides: ChatModelOverrides = {}): Promise<boolean> => {
    if (selectedDroneIds.length === 0) return false;
    const regularNodeIds = selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id));
    const draftNodeIds = selectedDroneIds.filter((id) => isCanvasDraftNodeId(id));
    const regularTargets = collectUniqueChatTargets(regularNodeIds);
    // Keep regular-message sends single-flight to avoid accidental duplicate broadcasts.
    if (messageSending && draftNodeIds.length === 0) return false;

    const prompt = String(payload.prompt ?? '').trim();
    if (!prompt && payload.attachments.length === 0) {
      if (selectedDraftNodeId) removeDraftNodeIfEmpty(selectedDraftNodeId);
      return false;
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
          height: nodeHeightByDroneId[node.droneId] ?? NODE_HEIGHT_PX,
        }));
      const claimPlacement = (
        anchorX: number,
        anchorY: number,
        width: number,
      ): { x: number; y: number } => {
        const stepX = Math.max(48, Math.round(width * 0.72));
        const stepY = CHAT_NODE_HEIGHT_PX + 18;
        for (const offset of SPAWN_OFFSETS) {
          const candidateX = Math.round((anchorX + offset.x * stepX) * 10) / 10;
          const candidateY = Math.round((anchorY + offset.y * stepY) * 10) / 10;
          const collides = occupiedRects.some((rect) =>
            rectIntersects(
              candidateX - SPAWN_COLLISION_MARGIN_PX,
              candidateY - SPAWN_COLLISION_MARGIN_PX,
              width + SPAWN_COLLISION_MARGIN_PX * 2,
              CHAT_NODE_HEIGHT_PX + SPAWN_COLLISION_MARGIN_PX * 2,
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
            const promptForDraft = prompt;
            if (!promptForDraft && payload.attachments.length === 0) {
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
                  attachments: payload.attachments,
                  label: node.label,
                  overrides: {
                    agentKey: normalizedSpawnAgentKey,
                    model: overrides.model !== undefined ? overrides.model ?? '' : normalizedSpawnModel,
                    reasoning: overrides.reasoning !== undefined ? overrides.reasoning ?? '' : useDroneHubUiStore.getState().spawnReasoning,
                    repoPath: normalizedCreateRepoPath,
                    group: normalizedCreateGroup,
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
                height: CHAT_NODE_HEIGHT_PX,
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
                  height: CHAT_NODE_HEIGHT_PX,
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
          const result = await onSendCanvasPrompt(regularTargets, { ...payload, prompt }, context, overrides);
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
      return (regularTargets.length === 0 || regularSendSucceeded) && (draftNodeIds.length === 0 || allDraftCreatesSucceeded);
    } catch (err: any) {
      setMessageError(err?.message ?? String(err));
      return false;
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
    nodeHeightByDroneId,
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
    panning,
    removeDraftNodeIfEmpty,
    replaceNodeId,
    selectedDraftNodeId,
    selectedDroneIds,
    selectedMessageDraft,
    setSelectedDroneIds,
    upsertNodes,
  ]);

  const selectionAnchorRef = React.useRef<string | null>(null);
  const onNodeMouseDown = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      if (inlineRenamingDroneId === droneId) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.button !== 0) return;
      focusViewportElement();
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
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
        selectionBefore: selectedDroneIds,
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
      setMessageBarExpanded(true);
      const additive = event.ctrlKey || event.metaKey;
      if (additive || event.shiftKey) {
        setSelectedDroneIds(selectSidebarChatNodes({ currentNodeIds: selectedDroneIds, orderedNodeIds: nodeOrder,
          nodeId: droneId, anchorNodeId: selectionAnchorRef.current, additive, range: event.shiftKey }));
        if (!event.shiftKey) selectionAnchorRef.current = droneId;
        return;
      }
      selectionAnchorRef.current = droneId;
      setSelectedDroneIds([droneId]);
      if (!isCanvasDraftNodeId(droneId)) {
        const canvasDroneId = parseCanvasDroneNodeId(droneId);
        if (canvasDroneId) {
          onActivateChat?.(canvasDroneId, 'default');
          return;
        }
        const chatRef = parseCanvasChatNodeId(droneId);
        if (!chatRef) return;
        // Side chats included: a card opens its chat as the main chat.
        onActivateChat?.(chatRef.droneId, chatRef.chatName);
      }
    },
    [focusViewportElement, nodeOrder, onActivateChat, selectedDroneIds, setSelectedDroneIds],
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
      if (droneScope) {
        createChatAtWorldPoint(worldPoint.x, worldPoint.y);
        return;
      }
      createDraftAtWorldPoint(worldPoint.x, worldPoint.y, { avoidCollisions: false });
    },
    [createChatAtWorldPoint, createDraftAtWorldPoint, droneScope, inlineRenamingDroneId, panX, panY, scale],
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
    // A drone board already holds every chat it can show.
    disabled: droneScope,
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
      const acceptsCanvasDrop =
        !droneScope &&
        (activeData?.type === 'sidebar-drone' ||
          activeData?.type === 'sidebar-pinned-drone' ||
          activeData?.type === 'sidebar-chat');
      setDragOverCanvas(Boolean(acceptsCanvasDrop && overType === 'canvas-drop'));
    },
    [droneScope],
  );

  React.useEffect(() => {
    if (!activeDroneHubDrag) setDragOverCanvas(false);
  }, [activeDroneHubDrag]);

  const placeSidebarDragOnCanvas = React.useCallback(
    (event: DragEndEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overType = String(event.over?.data.current?.type ?? '').trim();
      setDragOverCanvas(false);
      if (droneScope || overType !== 'canvas-drop') return;
      // The composer turns drops on it into references.
      const activator = event.activatorEvent as PointerEvent | null;
      if (activator && isOverMessageComposer(activator.clientX + event.delta.x, activator.clientY + event.delta.y)) return;
      const ids = draggedCanvasNodeIdsFromData(activeData);
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
          const canvasDroneId = parseCanvasDroneNodeId(nodeId);
          const label = chatRef
            ? chatRef.chatName
            : canvasDroneId
              ? String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId
              : 'Untitled';
          const width = getNodeWidthPx(label);
          const height = getNodeHeightPx(nodeId);
          return {
            droneId: nodeId,
            label,
            x: origin.x - width / 2,
            y: origin.y - height / 2 + idx * DROP_STACK_SPACING_Y_PX,
          };
        }),
      );
      setSelectedDroneIds(ids);
    },
    [droneScope, effectiveDroneNameById, isOverMessageComposer, panX, panY, scale, setSelectedDroneIds, upsertNodes],
  );

  useDndMonitor({
    onDragMove: updateCanvasDragState,
    onDragOver: updateCanvasDragState,
    onDragCancel: () => setDragOverCanvas(false),
    onDragEnd: placeSidebarDragOnCanvas,
  });

  const onDraftSpawnCountChange = React.useCallback(
    (nextRaw: string) => {
      const digitsOnly = String(nextRaw ?? '').replace(/\D+/g, '').slice(0, 3);
      setDraftSpawnCount(digitsOnly);
      if (messageError) setMessageError(null);
    },
    [messageError],
  );

  const onDraftSpawnCountBlur = React.useCallback(
    () => {
      const normalized = parseDraftSpawnCount(draftSpawnCount);
      setDraftSpawnCount(String(normalized ?? MIN_DRAFT_SPAWN_COUNT));
    },
    [draftSpawnCount],
  );

  const cancelActivePointerInteractions = React.useCallback(() => {
    nodeDragRef.current = null;
    panDragRef.current = null;
    marqueeDragRef.current = null;
    setDraggingNodeId(null);
    setPanning(false);
    setSelectionBox(null);
  }, []);

  const copyCanvasNodesForClone = React.useCallback((nodeIds: string[] = selectedDroneIds): number => {
    const sourceNodeIdByDroneId = collectCloneSourceNodeIdByDroneId(nodeIds);
    const drones = collectCloneableDroneIdsFromCanvasSelection(nodeIds)
      .map((droneId) => ({ droneId, nodeId: sourceNodeIdByDroneId[droneId] ?? '' }));
    const chats = collectCloneableChatsFromCanvasSelection(nodeIds);
    if (drones.length + chats.length > 0) useChatClipboardStore.getState().copy({ chats, drones });
    return drones.length + chats.length;
  }, [selectedDroneIds]);

  /** Clones what was copied here or in the Chats window. `at` is a client point, e.g. where a menu opened. */
  const pasteCopiedCanvasNodesAsClones = React.useCallback((at?: { x: number; y: number }) => {
    const clipboard = pastableClipboard(useChatClipboardStore.getState(), boardDroneId);
    const copiedDroneIds = clipboard.drones.map((drone) => drone.droneId);
    const copiedChats = clipboard.chats.map((chat) => ({ ...chat, nodeId: createCanvasChatNodeId(chat.droneId, chat.chatName) }));
    if (copiedDroneIds.length === 0 && copiedChats.length === 0) return;
    const sourceNodeIdByDroneId = Object.fromEntries(clipboard.drones.map((drone) => [drone.droneId, drone.nodeId]));

    // Paste lands under the cursor, or mid-view when the cursor is elsewhere.
    const viewport = viewportRef.current;
    let anchor: { x: number; y: number } | null = null;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      const cursor = at ?? cursorClientPointRef.current;
      anchor = screenToWorldPoint(
        cursor?.x ?? rect.left + rect.width / 2,
        cursor?.y ?? rect.top + rect.height / 2,
        rect,
        panX,
        panY,
        scale,
      );
    }
    // Pasting again in the same spot steps aside instead of stacking clones exactly on top of each other.
    const lastPaste = lastPasteRef.current;
    const repeat =
      anchor && lastPaste && Math.hypot(anchor.x - lastPaste.x, anchor.y - lastPaste.y) < CLONE_OFFSET_X_PX
        ? lastPaste.count + 1
        : 0;
    if (anchor) lastPasteRef.current = { x: anchor.x, y: anchor.y, count: repeat };
    const sourceNodeIds = [
      ...copiedDroneIds.map((droneId) => sourceNodeIdByDroneId[droneId] ?? ''),
      ...copiedChats.map((source) => source.nodeId),
    ];
    const pasteAnchor = anchor
      ? { x: anchor.x + repeat * CLONE_OFFSET_X_PX, y: anchor.y + repeat * CLONE_OFFSET_Y_PX }
      : null;
    const positionBySourceNodeId = planCanvasPastePositions({
      sourceNodeIds,
      boundsById: fallbackNodeBoundsById,
      anchor: pasteAnchor,
      fallbackOffset: { x: CLONE_OFFSET_X_PX * (repeat + 1), y: CLONE_OFFSET_Y_PX * (repeat + 1) },
    });
    // Chats copied in the Chats window may have no card here; cascade them from the paste point.
    if (pasteAnchor) {
      sourceNodeIds.filter((nodeId) => nodeId && !positionBySourceNodeId[nodeId]).forEach((nodeId, index) => {
        positionBySourceNodeId[nodeId] = { x: pasteAnchor.x + index * CLONE_OFFSET_X_PX, y: pasteAnchor.y + index * CLONE_OFFSET_Y_PX };
      });
    }

    void (async () => {
      const pastedNodeIds: string[] = [];
      // Drone clones are heavy (each builds a runtime), so they stay sequential.
      const cloneDrones = async () => {
        if (!onCloneDrone) return;
        for (const sourceDroneId of copiedDroneIds) {
          const drone = droneById[sourceDroneId];
          const position = positionBySourceNodeId[sourceNodeIdByDroneId[sourceDroneId] ?? ''];
          if (!drone || !position) continue;
          const result = await onCloneDrone(drone);
          const cloneDroneId = String(result?.droneId ?? '').trim();
          const nodeId = result?.ok && cloneDroneId ? createCanvasDroneNodeId(cloneDroneId) : '';
          if (!nodeId) continue;
          const label = String(result.droneName ?? '').trim() || cloneDroneId;
          if (result.droneName) setOptimisticDroneNameById((prev) => ({ ...prev, [cloneDroneId]: label }));
          upsertNodes([{ droneId: nodeId, label, ...position }]);
          pastedNodeIds.push(nodeId);
        }
      };
      const cloneChats = () =>
        runWithConcurrency(copiedChats, CHAT_PASTE_CONCURRENCY, async (source) => {
          const position = positionBySourceNodeId[source.nodeId];
          if (!onCloneChat || !position) return;
          const result = await onCloneChat(source.droneId, source.chatName, {
            // Keep keyboard focus on the canvas so another paste works immediately.
            select: false,
            // On a drone board the clone handler owns the card, so it appears the moment the clone exists.
            ...(boardDroneId === source.droneId ? { boardPosition: position } : {}),
          });
          const nodeId = result?.ok && result.chatName ? createCanvasChatNodeId(source.droneId, result.chatName) : '';
          if (!nodeId || !result.chatName) return;
          if (boardDroneId !== source.droneId) upsertNodes([{ droneId: nodeId, label: result.chatName, ...position }]);
          pastedNodeIds.push(nodeId);
        });
      await Promise.all([cloneDrones(), cloneChats()]);
      if (pastedNodeIds.length > 0) setSelectedDroneIds(pastedNodeIds);
    })();
  }, [
    boardDroneId,
    droneById,
    fallbackNodeBoundsById,
    onCloneChat,
    onCloneDrone,
    panX,
    panY,
    scale,
    setSelectedDroneIds,
    upsertNodes,
  ]);

  const onViewportKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      const targetIsEditable = isEditableElement(event.target);
      if (targetIsEditable) return;

      const bindings = useDroneHubUiStore.getState().shortcutBindings;
      const voice = isShortcutMatch(bindings.toggleChatVoiceRecording, event.nativeEvent);
      const send = isShortcutMatch(bindings.sendActiveChatComposer, event.nativeEvent);
      const asap = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
      if (!event.repeat && (voice || send || asap)) {
        event.preventDefault();
        event.stopPropagation();
        // A canvas with no recipients must not fall through to another chat.
        if (!selectedDroneIds.length || !activeComposer) return;
        setMessageBarExpanded(true);
        requestAnimationFrame(() => {
          const id = viewportRef.current?.querySelector<HTMLElement>('[data-canvas-message-bar] [data-active-composer-id]')?.dataset.activeComposerId;
          if (!id) return;
          activeComposer.focusComposer(id);
          if (activeComposer.ensureTargetId() !== id) return;
          if (voice) activeComposer.toggleVoiceRecording();
          else activeComposer.sendMessage(asap ? 'asap' : 'queue');
        });
        return;
      }

      // On a drone board the create-drone shortcut keeps its app-wide meaning.
      if (!droneScope && isShortcutMatch(createDraftShortcutBinding, event.nativeEvent)) {
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
        const copiedNodeCount = copyCanvasNodesForClone();
        if (copiedNodeCount > 0) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!event.repeat && isPrimaryMod && !event.altKey && !event.shiftKey && key === 'v') {
        if (chatClipboardHasContent(useChatClipboardStore.getState(), boardDroneId)) {
          event.preventDefault();
          event.stopPropagation();
          pasteCopiedCanvasNodesAsClones();
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
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        cancelActivePointerInteractions();
        setMessageError(null);
        setMessageDraft('');
        // On the global board Delete only takes cards off the board; Shift+Delete deletes the
        // chats themselves. A drone board has no cards to remove, so Delete deletes there too.
        if (droneScope || event.shiftKey) {
          void deleteChatNodes(sortChatNodeIdsForDestructiveDelete(selectedDroneIds));
          return;
        }
        removeNodes(selectedDroneIds);
      }
    },
    [
      activeComposer,
      clearSelection,
      closeMessageBar,
      copyCanvasNodesForClone,
      createDraftShortcutBinding,
      boardDroneId,
      droneScope,
      messageBarExpanded,
      nodeOrder,
      openMessageBar,
      cancelActivePointerInteractions,
      deleteChatNodes,
      createDraftNearViewportCenter,
      focusPrimaryChatInputShortcutBinding,
      pasteCopiedCanvasNodesAsClones,
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
  const dotVisibility = Math.max(0, Math.min(1, (scale - DOT_GRID_FADE_OUT_SCALE) / (1 - DOT_GRID_FADE_OUT_SCALE)));
  const dotOpacity = DOT_GRID_MAX_OPACITY * Math.pow(dotVisibility, 1.2);
  // Positions keep shrinking with zoom; the nodes themselves stop shrinking at a readable size.
  const nodeReadabilityBoost = Math.min(NODE_MAX_READABILITY_BOOST, Math.max(1, NODE_LEGIBLE_SCALE / scale));
  const edgeMarkerWorldSize = (screenPx: number) =>
    Math.max(EDGE_MARKER_MIN_SCREEN_PX, Math.min(screenPx, screenPx * scale)) / scale;

  return (
    <UiPanel
      surface="alternate"
      flush
      className="h-full w-full"
    >
      {chatContextMenu ? <SidebarContextMenu x={chatContextMenu.x} y={chatContextMenu.y}
        view={chatContextMenu.view} label="Canvas chat actions" onClose={() => setChatContextMenu(null)}
        items={[
          ...(chatContextMenu.nodeIds.length ? [{ id: 'copy-chat', shortcut: 'Ctrl+C',
            label: chatContextMenu.nodeIds.length === 1 ? 'Copy chat' : `Copy ${chatContextMenu.nodeIds.length} chats`,
            onSelect: () => { copyCanvasNodesForClone(chatContextMenu.nodeIds); },
          }] : []),
          { id: 'paste-chat', label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboardHasContent || (!onCloneChat && !onCloneDrone),
            onSelect: () => pasteCopiedCanvasNodesAsClones({ x: chatContextMenu.x, y: chatContextMenu.y }) },
          ...(chatContextMenu.nodeIds.length ? [{ id: 'delete-chat', tone: 'danger' as const, separatorBefore: true,
            label: chatContextMenu.nodeIds.length === 1 ? 'Delete chat' : `Delete ${chatContextMenu.nodeIds.length} chats`,
            disabled: !onDeleteChats || chatContextMenu.nodeIds.some((id) => deletingChatNodeById[id]),
            onSelect: () => { void deleteChatNodes(sortChatNodeIdsForDestructiveDelete(chatContextMenu.nodeIds)); },
          }] : []),
        ]} /> : null}
        <UiPanelToolbar aria-label="Canvas controls" className="min-h-0 gap-1.5 px-2 py-1">
          {boardDrone ? (
            <div className="flex flex-shrink-0 items-center gap-1" role="group" aria-label="Canvas board">
              <UiToolbarButton size="xsmall"
                pressed={droneScope}
                onClick={() => setScope('drone')}
                title="Every chat of this drone, laid out for you. New, cloned and side chats appear on their own."
              >
                This drone
              </UiToolbarButton>
              <UiToolbarButton size="xsmall"
                pressed={!droneScope}
                onClick={() => setScope('global')}
                title="One board shared across drones. Drag drones and chats in from the sidebar."
              >
                Global
              </UiToolbarButton>
            </div>
          ) : null}
          {droneScope ? null : (
            <UiToolbarIconButton size="xsmall"
              onClick={() => setCanvasControlsExpanded((expanded) => !expanded)}
              label={canvasControlsExpanded ? 'Hide canvas creation controls' : 'Show canvas creation controls'}
              icon={<IconTune className="h-3.5 w-3.5" />}
              tone="accent"
              active={canvasControlsExpanded}
              title={canvasControlsExpanded ? 'Hide canvas creation controls' : 'Show canvas creation controls'}
              aria-expanded={canvasControlsExpanded}
            />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <UiToolbarButton size="xsmall"
              pressed={showCanvasLastMessagePreviews}
              onClick={() =>
                setShowCanvasLastMessagePreviews(!showCanvasLastMessagePreviews)
              }
              title="Show the latest agent reply above canvas nodes."
            >
              Last msgs
            </UiToolbarButton>
            <UiToolbarButton size="xsmall"
              pressed={!hideSideChatWindowsWithCanvas}
              onClick={() => setHideSideChatWindowsWithCanvas(!hideSideChatWindowsWithCanvas)}
              title="Keep floating side chat windows visible while the canvas is open. Off, they stay hidden until the canvas is closed."
            >
              Side chat windows
            </UiToolbarButton>
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center gap-1">
            <UiToolbarButton size="xsmall" onClick={fitViewportToNodes} disabled={nodes.length === 0} title="Zoom and pan so every node is in view">
              Fit
            </UiToolbarButton>
            <UiToolbarButton size="xsmall" onClick={resetViewport} title="Reset canvas view">
              Reset
            </UiToolbarButton>
            <span className="w-[48px] text-right text-10 font-mono text-[var(--muted-dim)]" title="Current zoom">
              {Math.round(scale * 100)}%
            </span>
          </div>
        </UiPanelToolbar>
        {canvasControlsExpanded && !droneScope ? (
          <UiPanelToolbar
            aria-label="Canvas creation defaults"
            className="flex-wrap overflow-visible px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-10 font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
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
              <UiToolbarButton
                onClick={onOpenCustomAgentModal}
                disabled={controlsDisabled}
                title="Manage custom agents"
              >
                Custom
              </UiToolbarButton>
            </div>
            {spawnAgentConfig.kind === 'builtin' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-10 font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
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
                  searchable
                  searchPlaceholder="Search models"
                />
                <UiToolbarInput
                  value={normalizedSpawnModel}
                  onChange={(event) => onSpawnModelChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') event.currentTarget.blur();
                  }}
                  disabled={controlsDisabled}
                  placeholder="Default model"
                  className="w-[150px]"
                  title="Set default model for canvas-created drones."
                />
                <UiToolbarButton
                  onClick={() => onSpawnModelChange('')}
                  disabled={controlsDisabled || !normalizedSpawnModel.trim()}
                  title="Clear model override"
                >
                  Clear
                </UiToolbarButton>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <span className="text-10 font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
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
                triggerLabelClassName={normalizedCreateRepoPath ? 'font-mono text-11' : undefined}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-10 font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Group
              </span>
              <UiToolbarInput
                value={normalizedCreateGroup}
                onChange={(event) => onCreateGroupChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.blur();
                }}
                disabled={controlsDisabled}
                placeholder="Optional group"
                className="w-[150px]"
                title="Set group for canvas-created drones."
              />
              <UiToolbarButton
                onClick={() => onCreateGroupChange('')}
                disabled={controlsDisabled || !normalizedCreateGroup.trim()}
                title="Clear group"
              >
                Clear
              </UiToolbarButton>
            </div>
          </UiPanelToolbar>
        ) : null}

      <UiPanelBody
        ref={setViewportNodeRef}
        tabIndex={0}
        data-shortcut-capture="true"
        data-drone-canvas-viewport="1"
        className={`relative flex-1 min-h-0 overflow-hidden select-none outline-none ${cursorClassName} ${dragOverCanvas ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''}`}
        onKeyDown={onViewportKeyDown}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={(event) => {
          cursorClientPointRef.current = { x: event.clientX, y: event.clientY };
        }}
        onMouseLeave={() => {
          cursorClientPointRef.current = null;
        }}
        onDoubleClick={onCanvasDoubleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          // Empty canvas offers Paste; cards and the composer have their own menus or none.
          const target = event.target as HTMLElement;
          if (target.closest('[data-canvas-node], [data-selected-chats-composer]')) return;
          setChatContextMenu({ x: event.clientX, y: event.clientY, view: event.currentTarget.ownerDocument.defaultView!, nodeIds: [] });
        }}
        onWheel={onWheel}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: dotOpacity > 0
              ? `radial-gradient(circle, rgba(var(--canvas-dot-rgb), ${dotOpacity.toFixed(3)}) ${DOT_GRID_RADIUS_PX}px, transparent ${DOT_GRID_RADIUS_PX}px)`
              : 'none',
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
                  markerUnits="userSpaceOnUse"
                  markerWidth={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
                  markerHeight={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--canvas-related)" />
                </marker>
                <marker
                  id={assignedMarkerId}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerUnits="userSpaceOnUse"
                  markerWidth={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
                  markerHeight={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--canvas-assigned)" />
                </marker>
                <marker
                  id={chatOwnerMarkerId}
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerUnits="userSpaceOnUse"
                  markerWidth={edgeMarkerWorldSize(EDGE_DOT_MARKER_SCREEN_PX)}
                  markerHeight={edgeMarkerWorldSize(EDGE_DOT_MARKER_SCREEN_PX)}
                  orient="auto"
                >
                  <circle cx="5" cy="5" r="3" fill="var(--canvas-chat-owner)" />
                </marker>
              </defs>
              {relationshipEdges.map((edge) => (
                <path
                  key={edge.key}
                  d={edge.path}
                  fill="none"
                  stroke={
                    edge.variant === 'chat-owner'
                      ? 'var(--canvas-chat-owner-muted)'
                      : edge.variant === 'assigned'
                        ? 'var(--canvas-assigned-muted)'
                        : 'var(--canvas-related-muted)'
                  }
                  strokeWidth={edge.variant === 'chat-owner' ? '2' : edge.variant === 'assigned' ? '1.5' : '1.8'}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={
                    edge.variant === 'chat-owner'
                      ? '2 5'
                      : edge.variant === 'assigned'
                        ? '7 5'
                        : edge.variant === 'chat-fork'
                          ? '4 4'
                          : undefined
                  }
                  markerEnd={`url(#${
                    edge.variant === 'chat-owner'
                      ? chatOwnerMarkerId
                      : edge.variant === 'assigned'
                        ? assignedMarkerId
                        : lineageMarkerId
                  })`}
                />
              ))}
            </svg>
          ) : null}
          {nodes.map((node) => {
            const draftNode = isCanvasDraftNodeId(node.droneId);
            const canvasDroneId = draftNode ? null : parseCanvasDroneNodeId(node.droneId);
            const droneNode = Boolean(canvasDroneId);
            const chatRef = draftNode ? null : parseCanvasChatNodeId(node.droneId);
            const nodeDroneId = canvasDroneId ?? chatRef?.droneId ?? null;
            const selected = selectedDroneIdSet.has(node.droneId);
            const dragging = draggingNodeId === node.droneId;
            const inlineEditing = inlineRenamingDroneId === node.droneId;
            const assignmentHoverTarget = assignmentHoverNodeId === node.droneId && assignmentHoverTargetCount > 0;
            const isActiveSidebarChat = Boolean(chatRef && node.droneId === sidebarSelectedChatNodeId);
            const indicatorState = draftNode
              ? null
              : droneNode && canvasDroneId
                ? chatNodeStateById[createCanvasChatNodeId(canvasDroneId, 'default')] ?? null
                : chatNodeStateById[node.droneId] ?? null;
            const lastAgentSnippet = indicatorState?.lastAgentSnippet ?? null;
            const indicator = renderNodeIndicator(indicatorState);
            const unreadIndicator = renderNodeUnreadIndicator(indicatorState);
            const nodeWidth = nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX;
            const nodeHeight = nodeHeightByDroneId[node.droneId] ?? NODE_HEIGHT_PX;
            // A drone board is one drone's chats: its repository and branch are the same on every card.
            const repoLabel = draftNode
              ? String(draftRepoLabelByNodeId[node.droneId] ?? '').trim()
              : nodeDroneId && !droneScope
                ? String(droneRepoById[nodeDroneId] ?? '').trim()
                : '';
            const repoBranch = !draftNode && nodeDroneId && !droneScope
              ? String(droneById[nodeDroneId]?.repoBranch ?? '').trim()
              : '';
            const canvasDroneLabel = canvasDroneId
              ? String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId
              : '';
            const primaryLabel = droneNode ? canvasDroneLabel : chatRef?.chatName ?? node.label;
            // Ramps in with the counter-scale so nothing jumps at the threshold.
            const labelTextBoost = !droneNode && nodeReadabilityBoost > 1
              ? Math.min(nodeReadabilityBoost, getChatLabelTextBoost(primaryLabel, nodeWidth))
              : 1;
            return (
              <button
                key={node.droneId}
                type="button"
                data-canvas-node="1"
                data-drone-id={node.droneId}
                data-canvas-node-kind={draftNode ? 'draft' : droneNode ? 'drone' : 'chat'}
                data-fleet-assignment-owner-id={!draftNode && nodeDroneId ? nodeDroneId : undefined}
                ref={(el) => {
                  if (el) nodeElementByDroneIdRef.current[node.droneId] = el;
                  else delete nodeElementByDroneIdRef.current[node.droneId];
                }}
                onContextMenu={(event) => {
                  if (draftNode || droneNode) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const selection = selectedDroneIds.includes(node.droneId) ? selectedDroneIds : [node.droneId];
                  setSelectedDroneIds(selection);
                  const nodeIds = selection.filter((id) => !isCanvasDraftNodeId(id) && Boolean(parseCanvasChatNodeId(id)));
                  setChatContextMenu({ x: event.clientX, y: event.clientY,
                    view: event.currentTarget.ownerDocument.defaultView!, nodeIds });
                }}
                onMouseDown={(event) => onNodeMouseDown(node.droneId, event)}
                onClick={(event) => onNodeClick(node.droneId, event)}
                onDoubleClick={(event) => onNodeDoubleClick(node.droneId, event)}
                aria-pressed={selected}
                className={`group/canvas-node absolute relative overflow-visible rounded-[var(--radius-medium)] border text-left ${labelTextBoost > 1 ? 'px-2' : 'px-2.5'} shadow-[0_10px_20px_var(--shadow-color)] transition-[border-color,background-color,box-shadow] duration-100 flex items-center ${
                  dragging
                    ? 'border-[var(--accent)] bg-[var(--panel-raised)] shadow-[inset_0_0_0_1px_var(--accent-muted),0_14px_26px_var(--shadow-color)]'
                    : assignmentHoverTarget
                      ? 'border-[var(--accent)] bg-[var(--panel-raised)] shadow-[0_0_0_1px_var(--canvas-related-subtle),0_16px_28px_var(--shadow-color)]'
                    : selected || inlineEditing
                      ? 'border-[var(--accent-muted)] bg-[var(--panel-raised)] shadow-[inset_0_0_0_1px_var(--accent-subtle),0_10px_20px_var(--shadow-color)]'
                      : draftNode
                        ? 'border-[var(--user-border)] bg-[var(--panel-overlay-soft)] hover:border-[var(--muted)]'
                        : droneNode
                          ? droneById[canvasDroneId ?? '']?.runtime === 'host'
                            ? 'border-[var(--canvas-chat-owner-muted)] bg-[linear-gradient(135deg,var(--canvas-chat-owner-subtle),var(--panel-overlay)_58%)] shadow-[inset_0_0_0_1px_var(--canvas-chat-owner-subtle),0_12px_24px_var(--shadow-color)] hover:border-[var(--canvas-chat-owner)]'
                            : 'border-[var(--canvas-chat-owner-muted)] bg-[var(--panel-overlay)] shadow-[inset_0_0_0_1px_var(--canvas-chat-owner-subtle),0_12px_24px_var(--shadow-color)] hover:border-[var(--canvas-chat-owner)]'
                          : 'border-[var(--border)] bg-[var(--panel-overlay)] hover:border-[var(--accent-muted)]'
                }`}
                style={{
                  left: 0,
                  top: 0,
                  width: nodeWidth,
                  height: nodeHeight,
                  transform: `translate3d(${node.x}px, ${node.y}px, 0)${nodeReadabilityBoost > 1 ? ` scale(${nodeReadabilityBoost.toFixed(3)})` : ''}`,
                  transformOrigin: '0 50%',
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
                    className="pointer-events-none absolute left-0 bottom-full mb-[18px] z-[1] inline-flex max-w-[280px] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-2 py-1 text-10 leading-[1.35] text-[var(--muted)] shadow-[0_6px_14px_var(--shadow-color)]"
                    title={lastAgentSnippet}
                  >
                    <span className="line-clamp-2 break-words whitespace-pre-wrap">{lastAgentSnippet}</span>
                  </span>
                ) : null}
                {draftNode ? (
                  <span className="pointer-events-none absolute -top-2 left-2 z-[2] inline-flex items-center rounded-[4px] border border-[var(--user-border)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted)]">
                    Draft
                  </span>
                ) : null}
                {repoLabel ? (
                  <span className="pointer-events-none absolute left-2 top-full mt-[1px] inline-flex max-w-[260px] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-9 font-mono text-[var(--muted-dim)] shadow-[0_6px_14px_var(--shadow-color)]">
                    {repoLabel}
                  </span>
                ) : null}
                {repoBranch ? (
                  <span
                    className="pointer-events-none absolute right-2 top-full mt-[1px] inline-flex max-w-[180px] rounded-[4px] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-1.5 py-[1px] text-9 font-mono text-[var(--muted-dim)] shadow-[0_6px_14px_var(--shadow-color)]"
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
                      // Clicking away keeps what was typed, as in a file explorer; only Escape discards it.
                      onBlur={() => {
                        if (inlineRenameBusy || inlineRenameSettledRef.current) return;
                        inlineRenameSettledRef.current = true;
                        void submitInlineRename();
                      }}
                      onKeyDown={(event) => {
                        if ((event.nativeEvent as any)?.isComposing) return;
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.stopPropagation();
                          inlineRenameSettledRef.current = true;
                          void submitInlineRename();
                          return;
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          inlineRenameSettledRef.current = true;
                          cancelInlineRename();
                        }
                      }}
                      // Looks like the title it replaces: the card's own border already says it is being edited.
                      className="block w-full min-w-0 border-0 bg-transparent p-0 text-12-5 font-[var(--weight-semibold)] leading-[inherit] text-[var(--fg-secondary)] caret-[var(--accent)] outline-none focus:outline-none focus-visible:outline-none"
                    />
                  ) : assignmentHoverTarget ? (
                    <span className="block">
                      <span className="block truncate text-12-5 font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
                        Release to choose action
                      </span>
                      <span className="block truncate text-10 text-[var(--muted-dim)]">
                        {assignmentHoverTargetCount} drone{assignmentHoverTargetCount === 1 ? '' : 's'} dropped into this chat
                      </span>
                    </span>
                  ) : (
                    <span className={`flex min-w-0 items-center ${droneNode ? 'gap-2' : ''}`}>
                      {droneNode ? (
                        <span className="flex-shrink-0 rounded-[4px] border border-[var(--canvas-chat-owner-muted)] bg-[var(--canvas-chat-owner-subtle)] px-1.5 py-[1px] text-8 font-[var(--weight-semibold)] uppercase tracking-[0.1em] text-[var(--canvas-chat-owner)]">
                          Drone
                        </span>
                      ) : null}
                      <span
                        className={`min-w-0 flex-1 truncate text-12-5 font-[var(--weight-semibold)] text-[var(--fg-secondary)] ${droneNode ? '' : 'text-center'}`}
                        style={labelTextBoost > 1 ? { fontSize: `calc(var(--text-12-5) * ${labelTextBoost.toFixed(3)})` } : undefined}
                      >
                        {primaryLabel}
                      </span>
                      {droneNode && canvasDroneId ? (
                        <span className="flex-shrink-0 text-9 font-mono uppercase text-[var(--muted-dim)]">
                          {droneById[canvasDroneId]?.runtime === 'host' ? 'Host' : 'Container'}
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
          selectionKey={`canvas:${boardDroneId ?? 'global'}:${selectedDraftNodeId ?? 'messages'}`}
          targets={collectUniqueChatTargets(selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id)))}
          droneById={droneById}
          hasDrafts={selectedDroneIds.some(isCanvasDraftNodeId)}
          spawnAgentKey={normalizedSpawnAgentKey}
          onDraftContentChange={(content) => { composerHasAttachmentsRef.current = content.attachments.length > 0; }}
          selectedCount={selectedDroneIds.length}
          selectedLabel={selectedMessageLabel}
          expanded={messageBarExpanded}
          sending={messageSending}
          draft={selectedMessageDraft}
          spawnCountEnabled={Boolean(selectedDraftNodeId)}
          spawnCount={draftSpawnCount}
          error={messageError}
          onExpand={openMessageBar}
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
          onSend={sendCanvasPrompt}
          references={messageReferences}
          onReferencesChange={setMessageReferences}
          referenceDropActive={composerDropHover}
        />

        {nodes.length === 0 ? (
          <UiPaneState
            kind="empty"
            title={droneScope ? 'Drone board' : 'Drone Canvas'}
            description={droneScope ? (
              <span className="block">This drone has no chats yet. Double-click to create one.</span>
            ) : (
              <>
                <span className="block">Drag drones or chats from the sidebar and drop them here.</span>
                <span className="mt-1 block">
                  Double-click creates a draft. Ctrl-click toggles selection; left drag selects.
                </span>
                <span className="mt-1 block">
                  Esc clears selection. Delete removes cards. Shift+Delete deletes chats.
                </span>
                <span className="mt-1 block">
                  Ctrl/Cmd+A selects all nodes. Right-click drag pans; the wheel zooms.
                </span>
                <span className="mt-1 block">
                  Copy/paste clones chat cards as chats and drone cards as drones.
                </span>
              </>
            )}
            className="pointer-events-none absolute inset-0"
          />
        ) : null}

        {dragOverCanvas ? (
          <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)]" />
        ) : null}
      </UiPanelBody>
    </UiPanel>
  );
}
