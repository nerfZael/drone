import type { ChatModelOverrides } from '../chat/selected-chat-model-overrides';
import type { ChatSendPayload, ChatSendContext } from '../chat/ChatInput';
import { useOptionalActiveComposer } from '../chat/ActiveComposerContext';
import type { CanvasSendPrompt, CanvasDraftCreation } from './canvas-messaging';
import React from 'react';
import { createFrameBatch } from './frame-batch';
import { canvasPerf } from './canvas-perf';
import { flushSync } from 'react-dom';
import '@xyflow/react/dist/style.css';
import { useDndMonitor, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import type { ChatAgentConfig } from '../../domain';
import {
  UiMenuSelect,
  type UiMenuSelectEntry,
  UiPanel,
  UiPanelBody,
  UiPanelToolbar,
  UiToolbarButton,
  UiToolbarIconButton,
  UiToolbarInput,
} from '../../ui/components';
import type { DroneSummary } from '../types';
import { selectSidebarChatNodes } from '../app/sidebar-chat-selection';
import { chatClipboardHasContent, pastableClipboard, useChatClipboardStore } from '../app/chat-clipboard-store';
import { markChatsDeleted, pruneDeletedChatsOfDrone, useChatDeletionStore } from '../app/chat-deletion-store';
import {
  composerReferencesFromNodeIds,
  mergeComposerReferences,
  type ComposerReference,
} from '../chat/composer-references';
import { IconTune } from '../app/icons';
import {
  DETAILED_CARD_HEIGHT_PX,
  DETAILED_CARD_SPREAD,
  DETAILED_CARD_WIDTH_PX,
  detailedCardWidthPx,
  combineDetailedCards,
  costText,
  deriveDetailedCard,
  type DetailedCard,
} from './detailed-card-model';
import { useCanvasChatActivity } from './use-canvas-chat-activity';
import { ChatStepsControl } from './ChatStepsControl';
import { DraftRepoSelect, useCanvasModelPicker } from './CanvasDraftControls';
import { canvasSettingsForAgent, type CanvasNewCardSettings } from './canvas-new-card-settings';
import { agentAccessChoiceGroups, agentAccessSupport } from '../app/agent-access-choice-groups';
import { ChatComposerRuntimePicker } from '../chat/ChatComposerRuntimePicker';
import { requestJson } from '../http';
import { newChatConfigurationForAgent } from '../app/new-chat-creation';
import type { DroneDeleteMode } from '../app/settings-types';
import {
  BUILTIN_AGENT_OPTIONS,
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
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
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
  getCanvasBoardActions,
  isCanvasDraftNodeId,
  selectCanvasBoard,
  topicBoardKey,
  useCanvasBoardNodeMeta,
  useDroneCanvasStore,
} from './use-drone-canvas-store';
import {
  OPTIMISTIC_MEMBER_TTL_MS,
  buildDroneBoardMembers,
  planDroneBoardPlacements,
  planTopicBoardPlacements,
  type DroneBoardMember,
} from './drone-board';
import { CanvasTopicSwitcher } from './CanvasTopicSwitcher';
import type { CanvasRect } from './lineage-geometry';
import {
  CHAT_NODE_HEIGHT_PX,
  DRONE_NODE_CHROME_WIDTH_PX,
  NODE_HEIGHT_PX,
  NODE_MIN_WIDTH_PX,
  getNodeHeightPx,
  getNodeWidthPx,
  nodeLabelWidthPx,
} from './node-metrics';
import { CanvasNodeCard, type CanvasNodeActions, type DroneCanvasIndicatorState } from './CanvasNodeCard';
import { CANVAS_STEPS_PANEL_WIDTH_PX, CanvasStepsPanel } from './CanvasStepsPanel';
import {
  CanvasCardsLayer,
  CanvasEdgesLayer,
  CanvasWorldLayer,
  CanvasZoomLabel,
  NO_CARD_SPREAD,
  setCanvasGesture,
  viewBoundsOf,
  type CanvasNodeSize,
} from './CanvasLayers';
import {
  buildSelectionBox,
  fitViewportToBounds,
  rectIntersects,
  screenToWorldPoint,
  type SelectionBox,
} from './canvas-geometry';
import { useStableRecordValues } from './use-stable-record-values';
import { createCardHover, HoveredCard } from './card-hover';
import { useCanvasWheelZoom } from './use-canvas-wheel-zoom';
import { CanvasEmptyState } from './CanvasEmptyState';
import { CanvasEdgePanControls, CanvasEdgePanOverlay } from './CanvasEdgePan';
import { isEdgePanLockedEvent, useCanvasEdgePanLock } from './use-canvas-edge-pan-lock';
import { closeCanvasChatPanel, leaveCanvasFullView, showCanvasChatPanel, toggleCanvasFullView, useCanvasFullViewStore } from './canvas-full-view';

const DROP_STACK_SPACING_Y_PX = 48;
const DRAG_MOVE_THRESHOLD_PX = 3;
const MIN_DRAFT_SPAWN_COUNT = 1;
const MAX_DRAFT_SPAWN_COUNT = 24;
const SPAWN_COLLISION_MARGIN_PX = 12;
const SPAWN_OFFSET_RINGS = 7;
const CLONE_OFFSET_X_PX = 44;
const CLONE_OFFSET_Y_PX = 34;
const CHAT_PASTE_CONCURRENCY = 4;

type NodeDragState = {
  droneIds: string[];
  startClientX: number;
  startClientY: number;
  startPositionsById: Record<string, { x: number; y: number }>;
  scale: number;
  /** The board can pan under a drag (edge panning); the cards stay under the cursor. */
  startPanX: number;
  startPanY: number;
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
  /** The box's first corner stays on the same spot of the board if it pans meanwhile. */
  startPanX: number;
  startPanY: number;
  additive: boolean;
  baseSelectedIds: string[];
  moved: boolean;
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

/** A drone's chats, main and side; a drone without any still has its default chat. */
function droneChatNames(drone: { chats?: string[]; sideChats?: Array<{ name: string }> } | null | undefined): string[] {
  const names = [...(drone?.chats ?? []), ...(drone?.sideChats ?? []).map((chat) => chat.name)];
  return names.length ? names : ['default'];
}

/** "plan (Alpha)", "plan (Alpha), default (Beta)", or the first two and how many more. */
function formatMessageTargetLabel(labels: string[]): string | null {
  if (labels.length === 0) return null;
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

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

export function DroneCanvasDock({
  boardDrone,
  droneById,
  droneNameById,
  sidebarSelectedChatNodeId,
  droneRepoById,
  fleetParentIdByDroneId,
  fleetAssignedIdsByDroneId,
  draftRepoLabel,
  chatNodeStateById: chatNodeStateByIdProp,
  onActivateChat,
  onAssignDronesToOwner,
  onSendCanvasPrompt,
  onCreateCanvasDroneFromDraft,
  onRenameChat,
  onRenameDrone,
  onDeleteChats,
  onCloneChat,
  onCloneDrone,
  onCreateChat,
  spawnAgentMenuEntries,
  spawnAgentKey,
  onOpenCustomAgentModal,
  resolveAgentKey,
  spawnModel,
  createRepoMenuEntries,
  createRepoPath,
  onCreateRepoPathChange,
  createGroup,
  onCreateGroupChange,
  onDeleteDrones,
  droneDeleteMode,
  onDeleteDronesConfirmed,
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
  onRenameDrone?: (droneId: string, newName: string) => Promise<{ ok: boolean; error?: string | null }>;
  /** Deletes the chats together, behind one confirmation; a result per chat asked about. */
  onDeleteChats?: (
    targets: ReadonlyArray<{ droneId: string; chatName: string }>,
  ) => Promise<Array<{ droneId: string; chatName: string; ok: boolean; deletedDrone?: boolean; error?: string | null }>>;
  onCloneChat?: (
    droneId: string,
    chatName: string,
    opts?: { select?: boolean; boardPosition?: { x: number; y: number }; onPlaced?: (chatName: string) => void },
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onCloneDrone?: (
    drone: DroneSummary,
  ) => Promise<{ ok: boolean; droneId?: string; droneName?: string }> | { ok: boolean; droneId?: string; droneName?: string };
  /** Makes a new chat on a drone's board, with the canvas's settings. */
  onCreateChat?: (droneId: string, settings: CanvasNewCardSettings) => Promise<boolean>;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  /** The app's new-drone agent and model: where the canvas's own settings start, the first time. */
  spawnAgentKey: string;
  onOpenCustomAgentModal: () => void;
  resolveAgentKey: (key: string) => ChatAgentConfig;
  spawnModel: string;
  createRepoMenuEntries: UiMenuSelectEntry[];
  createRepoPath: string;
  onCreateRepoPathChange: (next: string) => void;
  createGroup: string;
  onCreateGroupChange: (next: string) => void;
  /** Deletes drones, behind the app's own confirmation. Shift+Delete on a topic's drone card. */
  onDeleteDrones?: (droneIds: string[]) => void;
  /** Whether deleting drones archives or deletes them, from the app's delete setting. */
  droneDeleteMode?: DroneDeleteMode;
  /** Deletes drones without asking again, for a question already asked here (deleting a topic with its drones). */
  onDeleteDronesConfirmed?: (droneIds: string[]) => void;
}) {
  const perfStart = canvasPerf.renderStart();
  React.useLayoutEffect(() => canvasPerf.renderEnd('dock', perfStart));
  // Each summary refresh rebuilds every chat's state; keep the objects whose fields did not change,
  // so a refresh re-renders only the cards it changed.
  const chatNodeStateById = useStableRecordValues(chatNodeStateByIdProp);
  const { scope, setScope } = useDroneCanvasStore(
    useShallow((s) => ({ scope: s.scope, setScope: s.setScope })),
  );
  const activeTopic = useDroneCanvasStore((s) =>
    s.scope === 'topic' ? s.topics.find((topic) => topic.id === s.activeTopicId) ?? null : null,
  );
  const topicScope = Boolean(activeTopic);
  const activeTopicId = activeTopic?.id ?? null;
  const boardDroneId = scope === 'drone' ? String(boardDrone?.id ?? '').trim() || null : null;
  const droneScope = Boolean(boardDroneId);
  // Where this board's cards are stored: a drone's board, the active topic's, or the global one.
  const boardKey = boardDroneId ?? (activeTopicId ? topicBoardKey(activeTopicId) : null);
  // Members of a topic are every chat of its drones, each drone with its own card.
  const topicDrones = React.useMemo(
    () => (activeTopic ? activeTopic.droneIds.flatMap((droneId) => (droneById[droneId] ? [droneById[droneId]] : [])) : []),
    [activeTopic, droneById],
  );
  const autoMembers = droneScope || topicScope;
  // Positions and zoom are left out: the layers that draw them follow them, and handlers read them
  // from the store when they run, so dragging, panning and zooming do not render the dock.
  const {
    nodeOrder: storedNodeOrder,
    selectedDroneIds: storedSelectedDroneIds,
    draftPromptByNodeId,
    draftRepoLabelByNodeId,
  } = useDroneCanvasStore(
    useShallow((s) => {
      const board = selectCanvasBoard(s, boardKey);
      return {
        nodeOrder: board.nodeOrder,
        selectedDroneIds: board.selectedDroneIds,
        draftPromptByNodeId: board.draftPromptByNodeId,
        draftRepoLabelByNodeId: board.draftRepoLabelByNodeId,
      };
    }),
  );
  const nodeMetaById = useCanvasBoardNodeMeta(boardKey);
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
  } = React.useMemo(() => getCanvasBoardActions(boardKey), [boardKey]);
  const optimisticMembers = useDroneCanvasStore((s) =>
    boardDroneId ? s.optimisticMembersByDroneId[boardDroneId] : undefined,
  );
  const optimisticMembersByDroneId = useDroneCanvasStore((s) => (topicScope ? s.optimisticMembersByDroneId : null));
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
        : topicScope
          ? JSON.stringify(topicDrones.map((drone) => [
              drone.id,
              drone.chats ?? [],
              (drone.sideChats ?? []).map((chat) => [chat.name, chat.sourceChatName]),
              drone.chatCloneSources ?? {},
              optimisticMembersByDroneId?.[drone.id] ?? [],
            ]))
          : '',
    [boardChatCloneSources, boardChats, boardSideChats, droneScope, optimisticMembers, optimisticMembersByDroneId, topicDrones, topicScope],
  );
  const summaryBoardMembers = React.useMemo(
    () => droneScope
      ? buildDroneBoardMembers(boardDrone, optimisticMembers)
      : topicDrones.flatMap((drone) => buildDroneBoardMembers(drone, optimisticMembersByDroneId?.[drone.id])),
    // The summary is rebuilt on every refresh; only its chat list matters here.
    [boardKey, boardMemberKey],
  );
  // A chat deleted or renamed here keeps its old entry in the summary until the next refresh.
  // Apply the change meanwhile, or placement would take the old name for a new chat and drop
  // a card (and its line) at the view center until the refresh lands.
  // Deletes from any surface (sidebar, Chats window, here) hide the chat until the summary drops it.
  const deletedAtByNodeId = useChatDeletionStore((state) => state.deletedAtByNodeId);
  const [renamedChatNodes, setRenamedChatNodes] = React.useState<Readonly<Record<string, { nodeId: string; chatName: string }>>>({});
  const boardMembers = React.useMemo(() => {
    if (Object.keys(deletedAtByNodeId).length === 0 && Object.keys(renamedChatNodes).length === 0) return summaryBoardMembers;
    const out: DroneBoardMember[] = [];
    const seen = new Set<string>();
    for (const member of summaryBoardMembers) {
      if (member.nodeId in deletedAtByNodeId) continue;
      const renamed = renamedChatNodes[member.nodeId];
      const sourceRenamed = member.sourceNodeId ? renamedChatNodes[member.sourceNodeId] : undefined;
      const next = {
        ...member,
        ...(renamed ?? {}),
        ...(sourceRenamed ? { sourceNodeId: sourceRenamed.nodeId } : {}),
      };
      if (seen.has(next.nodeId)) continue;
      seen.add(next.nodeId);
      out.push(next);
    }
    return out;
  }, [deletedAtByNodeId, renamedChatNodes, summaryBoardMembers]);
  React.useEffect(() => {
    if (boardDrone && droneScope) pruneDeletedChatsOfDrone(boardDrone);
    for (const drone of topicDrones) pruneDeletedChatsOfDrone(drone);
    // Keyed like the members: the summary object is rebuilt on every refresh.
  }, [boardKey, boardMemberKey]);
  React.useEffect(() => {
    const listed = new Set(summaryBoardMembers.map((member) => member.nodeId));
    // Done once the summary no longer lists the old name.
    if (Object.keys(renamedChatNodes).some((nodeId) => !listed.has(nodeId))) {
      setRenamedChatNodes((prev) => Object.fromEntries(Object.entries(prev).filter(([nodeId]) => listed.has(nodeId))));
    }
  }, [renamedChatNodes, summaryBoardMembers]);
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
  const boardMemberIds = React.useMemo(() => {
    if (!autoMembers) return null;
    const ids = new Set(boardMembers.map((member) => member.nodeId));
    for (const drone of topicDrones) ids.add(createCanvasDroneNodeId(drone.id));
    return ids;
  }, [autoMembers, boardMembers, topicDrones]);
  // A topic also holds drafts: double-click makes a new drone there, as on the global board.
  const isShownNode = React.useCallback(
    (nodeId: string) => !boardMemberIds || boardMemberIds.has(nodeId) || (topicScope && isCanvasDraftNodeId(nodeId)),
    [boardMemberIds, topicScope],
  );
  const nodeOrder = React.useMemo(
    () => (boardMemberIds ? storedNodeOrder.filter(isShownNode) : storedNodeOrder),
    [boardMemberIds, isShownNode, storedNodeOrder],
  );
  // A chat deleted elsewhere (or an optimistic card that expired) must not stay
  // selected: the message bar and prompt sending act on the selection.
  const selectedDroneIds = React.useMemo(() => {
    if (!boardMemberIds) return storedSelectedDroneIds;
    const kept = storedSelectedDroneIds.filter(isShownNode);
    return kept.length === storedSelectedDroneIds.length ? storedSelectedDroneIds : kept;
  }, [boardMemberIds, isShownNode, storedSelectedDroneIds]);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  /** Whether a client point is over the visible message composer, which takes drops as references. */
  const isOverMessageComposer = React.useCallback((clientX: number, clientY: number) => {
    const composer = viewportRef.current?.querySelector<HTMLElement>('[data-selected-chats-composer]');
    if (!composer || composer.hidden) return false;
    const rect = composer.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }, []);
  const nodeDragRef = React.useRef<NodeDragState | null>(null);
  const panDragRef = React.useRef<PanDragState | null>(null);
  const marqueeDragRef = React.useRef<MarqueeDragState | null>(null);
  const selectionAnchorRef = React.useRef<string | null>(null);
  const nodeElementByDroneIdRef = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const lastSyncedSidebarSelectionRef = React.useRef<string>('');
  const inlineRenameInputRef = React.useRef<HTMLInputElement | null>(null);
  const suppressNodeClickRef = React.useRef(false);
  const cursorClientPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const lastPasteRef = React.useRef<{ x: number; y: number; count: number } | null>(null);
  /** Pasted clones shown before the server has finished copying them; each settles to whether it was created. */
  const pendingClonesRef = React.useRef(new Map<string, Promise<boolean>>());
  const pendingChatPlacementRef = React.useRef<{ x: number; y: number } | null>(null);
  const getView = React.useCallback(() => selectCanvasBoard(useDroneCanvasStore.getState(), boardKey), [boardKey]);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const edgePan = useCanvasEdgePanLock({
    regionRef: panelRef, getView, setPan,
    // A double middle-click fills the workspace with the canvas, or leaves that again.
    onDoubleMiddleClick: toggleCanvasFullView,
  });
  const [dragOverCanvas, setDragOverCanvas] = React.useState(false);
  const activeDroneHubDrag = useDroneHubActiveDrag();
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
  // Set once a card drag has moved past the threshold, not on a plain click: promoting cards to layers costs a frame.
  const [movingNodeIds, setMovingNodeIds] = React.useState<ReadonlySet<string>>(EMPTY_ID_SET);
  const [panning, setPanning] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<SelectionBox | null>(null);
  const [inlineRenamingDroneId, setInlineRenamingDroneId] = React.useState<string | null>(null);
  const [inlineRenameDraft, setInlineRenameDraft] = React.useState('');
  const [inlineRenameBusy, setInlineRenameBusy] = React.useState(false);
  // Enter and Escape settle a rename themselves; the blur that follows the field going away must not.
  const inlineRenameSettledRef = React.useRef(false);
  const deletingChatNodeById = useChatDeletionStore((state) => state.deletingByNodeId);
  const [canvasControlsExpanded, setCanvasControlsExpanded] = React.useState(false);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [messageReferences, setMessageReferences] = React.useState<ComposerReference[]>([]);
  const [composerDropHover, setComposerDropHover] = React.useState(false);
  const [draftSpawnCount, setDraftSpawnCount] = React.useState('1');
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [messagePendingCount, setMessagePendingCount] = React.useState(0);
  const [optimisticDroneNameById, setOptimisticDroneNameById] = React.useState<Record<string, string>>({});
  const [assignmentHoverNodeId, setAssignmentHoverNodeId] = React.useState<string | null>(null);
  const [assignmentHoverTargetCount, setAssignmentHoverTargetCount] = React.useState(0);
  const activeComposer = useOptionalActiveComposer();
  const composerHasAttachmentsRef = React.useRef(false);
  const draftCreateInFlightRef = React.useRef<Set<string>>(new Set());
  const messageSending = messagePendingCount > 0;
  // A drone renamed here shows its new name until the next summary reports it.
  const [renamedDroneNameById, setRenamedDroneNameById] = React.useState<Record<string, string>>({});
  const effectiveDroneNameById = React.useMemo(
    () => ({ ...optimisticDroneNameById, ...droneNameById, ...renamedDroneNameById }),
    [droneNameById, optimisticDroneNameById, renamedDroneNameById],
  );

  const existingDroneNameById = React.useMemo(
    () => Object.fromEntries(Object.keys(droneById).map((droneId) => [droneId, String(effectiveDroneNameById[droneId] ?? '').trim()])),
    [droneById, effectiveDroneNameById],
  );

  // Cards are drawn spread apart from where they are stored: positions are stored, placed and pasted in the compact
  // space of the cards' first, smaller look, so arrangements made then keep their shape.
  const cardSpread = DETAILED_CARD_SPREAD;
  const cardSpreadRef = React.useRef(cardSpread);
  cardSpreadRef.current = cardSpread;
  /**
   * Half a new card as drawn, in the space positions are stored in: a new card is centred on the point it is made
   * at, and it is drawn at its own size, spread out of where it is stored.
   */
  const newCardHalfInStore = React.useCallback((label: string) => ({
    x: detailedCardWidthPx(nodeLabelWidthPx(label), { stateIcon: true, runtimeIcon: false, clock: false }) / 2 / cardSpreadRef.current.x,
    y: DETAILED_CARD_HEIGHT_PX / 2 / cardSpreadRef.current.y,
  }), []);
  /** A point under the pointer, in the space positions are stored in. */
  const screenToStorePoint = React.useCallback((...args: Parameters<typeof screenToWorldPoint>) => {
    const point = screenToWorldPoint(...args);
    return { x: point.x / cardSpreadRef.current.x, y: point.y / cardSpreadRef.current.y };
  }, []);
  const nodes = React.useMemo(
    () => nodeOrder.map((droneId) => nodeMetaById[droneId]).filter(Boolean),
    [nodeOrder, nodeMetaById],
  );
  const nodeWidthByDroneId = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const node of nodes) {
      if (node.droneId === inlineRenamingDroneId) {
        out[node.droneId] = getNodeWidthPx(inlineRenameDraft, parseCanvasDroneNodeId(node.droneId) ? DRONE_NODE_CHROME_WIDTH_PX : 0);
        continue;
      }
      if (isCanvasDraftNodeId(node.droneId)) {
        out[node.droneId] = getNodeWidthPx(node.label);
        continue;
      }
      const canvasDroneId = parseCanvasDroneNodeId(node.droneId);
      if (canvasDroneId) {
        const droneLabel = String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId;
        out[node.droneId] = getNodeWidthPx(droneLabel, DRONE_NODE_CHROME_WIDTH_PX);
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
  }, [effectiveDroneNameById, inlineRenameDraft, inlineRenamingDroneId, nodes]);
  const nodeHeightByDroneId = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const node of nodes) out[node.droneId] = getNodeHeightPx(node.droneId);
    return out;
  }, [nodes]);
  // Where cards are drawn before the zoom boost: stored positions and compact sizes, or detailed cards spread apart.
  // Detailed cards: cost and timing from the Hub, a clock that ticks while anything works.
  const busyChatKey = React.useMemo(
    () => Object.entries(chatNodeStateById).filter(([, state]) => state.busy).map(([nodeId]) => nodeId).sort().join('|'),
    [chatNodeStateById],
  );
  const { activity: chatActivityByNodeId, steps: chatStepsByNodeId } = useCanvasChatActivity(busyChatKey);
  // A detailed card is as wide as its name and, while it works, its clock need.
  const detailedWidthByNodeId = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const node of nodes) {
      const canvasDroneId = parseCanvasDroneNodeId(node.droneId);
      const busy = canvasDroneId
        ? droneChatNames(droneById[canvasDroneId]).some((chatName) => chatNodeStateById[createCanvasChatNodeId(canvasDroneId, chatName)]?.busy)
        : Boolean(chatNodeStateById[node.droneId]?.busy);
      const label = node.droneId === inlineRenamingDroneId
        ? inlineRenameDraft
        : canvasDroneId
          ? String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId
          : parseCanvasChatNodeId(node.droneId)?.chatName ?? node.label;
      out[node.droneId] = detailedCardWidthPx(nodeLabelWidthPx(label), { stateIcon: true, runtimeIcon: Boolean(canvasDroneId), clock: busy });
    }
    return out;
  }, [chatNodeStateById, droneById, effectiveDroneNameById, inlineRenameDraft, inlineRenamingDroneId, nodes]);
  // What every chat on the canvas has cost, each counted once: a drone card stands for all its chats.
  const canvasCost = React.useMemo(() => {
    const chatIds = new Set<string>();
    for (const node of nodes) {
      const canvasDroneId = parseCanvasDroneNodeId(node.droneId);
      if (canvasDroneId) {
        for (const chatName of droneChatNames(droneById[canvasDroneId])) chatIds.add(createCanvasChatNodeId(canvasDroneId, chatName));
      } else if (parseCanvasChatNodeId(node.droneId)) chatIds.add(node.droneId);
    }
    const total = [...chatIds].reduce((sum, id) => sum + (chatActivityByNodeId[id]?.estimatedCost ?? 0), 0);
    return total > 0 ? costText({ estimatedCost: total }) : null;
  }, [chatActivityByNodeId, droneById, nodes]);
  // Card sizes as drawn.
  const viewSizeById = React.useMemo(() => {
    const out: Record<string, CanvasNodeSize> = {};
    for (const node of nodes) {
      out[node.droneId] = { width: detailedWidthByNodeId[node.droneId] ?? DETAILED_CARD_WIDTH_PX, height: DETAILED_CARD_HEIGHT_PX };
    }
    return out;
  }, [detailedWidthByNodeId, nodes]);
  const viewSizeByIdRef = React.useRef(viewSizeById);
  viewSizeByIdRef.current = viewSizeById;
  const shownNodeIdsRef = React.useRef(nodeOrder);
  shownNodeIdsRef.current = nodeOrder;
  /** Compact bounds at the stored positions, read when needed: positions change without rendering the dock. */
  const readCompactNodeBounds = React.useCallback((): Record<string, CanvasRect> => {
    const sizeById: Record<string, CanvasNodeSize> = {};
    for (const node of nodes) {
      sizeById[node.droneId] = {
        width: nodeWidthByDroneId[node.droneId] ?? NODE_MIN_WIDTH_PX,
        height: nodeHeightByDroneId[node.droneId] ?? NODE_HEIGHT_PX,
      };
    }
    return viewBoundsOf(getView().nodesByDroneId, nodeOrder, sizeById, NO_CARD_SPREAD);
  }, [getView, nodeHeightByDroneId, nodeOrder, nodeWidthByDroneId, nodes]);
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
  // The global canvas has no board members: read each chat card's source from its drone's summary.
  const edgeForkSourceNodeIdByNodeId = React.useMemo(() => {
    if (droneScope) return forkSourceNodeIdByNodeId;
    const out: Record<string, string> = {};
    for (const [droneId, chatNodes] of Object.entries(chatNodesByDroneId)) {
      const drone = droneById[droneId];
      if (!drone) continue;
      for (const node of chatNodes) {
        const chatName = parseCanvasChatNodeId(node.droneId)?.chatName;
        if (!chatName) continue;
        const sourceChatName = drone.chatCloneSources?.[chatName]
          ?? drone.sideChats?.find((sideChat) => sideChat.name === chatName)?.sourceChatName;
        if (sourceChatName && sourceChatName !== chatName) out[node.droneId] = createCanvasChatNodeId(droneId, sourceChatName);
      }
    }
    return out;
  }, [chatNodesByDroneId, droneById, droneScope, forkSourceNodeIdByNodeId]);
  const selectedDroneIdSet = React.useMemo(() => new Set(selectedDroneIds), [selectedDroneIds]);
  // In the full view, clearing the selection on a board closes the chat panel: nothing is picked to read. A move to
  // another board brings that board's own selection, which says nothing about the chat.
  const previousSelectionRef = React.useRef({ boardKey, count: selectedDroneIds.length });
  React.useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = { boardKey, count: selectedDroneIds.length };
    if (previous.boardKey === boardKey && previous.count > 0 && selectedDroneIds.length === 0) closeCanvasChatPanel();
  }, [boardKey, selectedDroneIds.length]);
  const busySeenAtRef = React.useRef<Record<string, number>>({});
  const busySeenAt = React.useMemo(() => {
    const busy = busyChatKey ? busyChatKey.split('|') : [];
    const next: Record<string, number> = {};
    for (const nodeId of busy) next[nodeId] = busySeenAtRef.current[nodeId] ?? Date.now();
    busySeenAtRef.current = next;
    return next;
  }, [busyChatKey]);
  const [cardNowMs, setCardNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    setCardNowMs(Date.now());
    const timer = setInterval(() => setCardNowMs(Date.now()), busyChatKey ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [busyChatKey]);
  const cardHover = React.useMemo(() => createCardHover(), []);
  // The steps panel sits at the bottom left, above the message bar wherever the two would overlap.
  const [stepsPanelBottomPx, setStepsPanelBottomPx] = React.useState(8);
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const bar = viewport?.querySelector<HTMLElement>('[data-canvas-message-bar]');
    if (!viewport || !bar) return;
    const place = () => {
      const area = viewport.getBoundingClientRect();
      const rect = bar.getBoundingClientRect();
      const overlaps = !bar.hidden && rect.height > 0 && rect.left - area.left < 8 + CANVAS_STEPS_PANEL_WIDTH_PX + 8;
      setStepsPanelBottomPx(overlaps ? Math.round(area.bottom - rect.top) + 8 : 8);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(viewport);
    observer?.observe(bar);
    // Showing or hiding the bar changes no size: watch its hidden attribute too.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(place);
    mutations?.observe(bar, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    return () => { observer?.disconnect(); mutations?.disconnect(); };
  }, []);
  const detailCacheRef = React.useRef<Record<string, { key: string; card: DetailedCard }>>({});
  const detailByNodeId = React.useMemo(() => {
    const chatInput = (droneId: string, chatName: string) => {
      const nodeId = createCanvasChatNodeId(droneId, chatName);
      const state = chatNodeStateById[nodeId];
      const drone = droneById[droneId];
      const activity = chatActivityByNodeId[nodeId] ?? null;
      return {
        activity,
        card: deriveDetailedCard({
          busy: Boolean(state?.busy),
          unread: Boolean(state?.unreadAgentMessage),
          approval: Boolean(drone?.approvalChats?.includes(chatName)),
          queued: Boolean(drone?.queuedChats?.includes(chatName)),
          statusOk: state?.statusOk ?? true,
          statusError: state?.statusError ?? null,
          hubPhase: state?.hubPhase ?? null,
          hubMessage: state?.hubMessage ?? null,
          lastAgentSnippet: state?.lastAgentSnippet ?? null,
          activity,
          steps: chatStepsByNodeId[nodeId] ?? null,
          busySeenAt: busySeenAt[nodeId] ?? null,
        }, cardNowMs),
      };
    };
    const out: Record<string, DetailedCard> = {};
    const cache = detailCacheRef.current;
    const nextCache: typeof cache = {};
    for (const node of nodes) {
      let card: DetailedCard;
      if (isCanvasDraftNodeId(node.droneId)) {
        const prompt = String(draftPromptByNodeId[node.droneId] ?? '').replace(/\s+/g, ' ').trim();
        card = { state: 'idle', icon: 'idle', label: 'draft', showState: true, unread: false, text: prompt || 'Write a message to start a drone', clock: '', workingSince: null, cost: '', costTitle: '', pips: null, stepsTitle: '', steps: null, stepsStale: false };
      } else {
        const canvasDroneId = parseCanvasDroneNodeId(node.droneId);
        const chatRef = canvasDroneId ? null : parseCanvasChatNodeId(node.droneId);
        if (canvasDroneId) {
          const drone = droneById[canvasDroneId];
          const chatNames = [...(drone?.chats ?? []), ...(drone?.sideChats ?? []).map((chat) => chat.name)];
          const chats = droneChatNames(drone).map((chatName) => chatInput(canvasDroneId, chatName));
          // With its chats on the canvas, each says its own state; a one-chat drone or one shown alone says it here.
          const showState = chatNames.length <= 1 || !chatNodesByDroneId[canvasDroneId]?.length;
          card = { ...combineDetailedCards(chats.map((chat) => chat.card), chats.map((chat) => chat.activity), cardNowMs, chatNames.length), showState };
        } else if (chatRef) {
          card = chatInput(chatRef.droneId, chatRef.chatName).card;
        } else continue;
      }
      // Same content, same object: a card re-renders only when what it shows changes.
      const key = JSON.stringify(card);
      const cached = cache[node.droneId];
      nextCache[node.droneId] = cached && cached.key === key ? cached : { key, card };
      out[node.droneId] = nextCache[node.droneId].card;
    }
    detailCacheRef.current = nextCache;
    return out;
  }, [busySeenAt, cardNowMs, chatActivityByNodeId, chatNodeStateById, chatNodesByDroneId, chatStepsByNodeId, draftPromptByNodeId, droneById, nodes]);
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
  // What the composer edits: the selected draft card's message, or the message for the selected chats. With nothing
  // selected it keeps editing the last one, so its text and attachments stay until something else is selected.
  const composerDraftNodeIdRef = React.useRef<string | null>(null);
  if (selectedDroneIds.length > 0) composerDraftNodeIdRef.current = selectedDraftNodeId;
  else if (composerDraftNodeIdRef.current && !nodeMetaById[composerDraftNodeIdRef.current]) composerDraftNodeIdRef.current = null;
  const composerDraftNodeId = composerDraftNodeIdRef.current;
  const composerDraft = composerDraftNodeId ? String(draftPromptByNodeId[composerDraftNodeId] ?? '') : messageDraft;
  // A drone card sends to one of its chats: resolve it here so the composer names that chat.
  const selectedMessageTargets = React.useMemo(
    () => collectUniqueChatTargets(selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id)), droneById),
    [droneById, selectedDroneIds],
  );
  const selectedMessageLabel = React.useMemo(() => {
    const draftLabels = selectedDroneIds
      .filter(isCanvasDraftNodeId)
      .map((id) => String(nodeMetaById[id]?.label ?? '').trim() || 'Untitled');
    const chatLabels = selectedMessageTargets.map((target) => {
      const droneName = String(effectiveDroneNameById[target.droneId] ?? '').trim() || target.droneId;
      return `${target.chatName} (${droneName})`;
    });
    return formatMessageTargetLabel([...chatLabels, ...draftLabels]);
  }, [effectiveDroneNameById, nodeMetaById, selectedDroneIds, selectedMessageTargets]);
  const controlsDisabled = messageSending;
  // A new drone (a draft card) or a new chat on a drone's canvas is set up from the composer.
  const selectedDraftChat = React.useMemo(() => {
    if (!autoMembers || selectedMessageTargets.length !== 1 || selectedDroneIds.length !== 1) return null;
    const target = selectedMessageTargets[0];
    const drone = droneById[target.droneId];
    return drone?.draftChats?.[target.chatName] === true ? target : null;
  }, [autoMembers, droneById, selectedDroneIds.length, selectedMessageTargets]);
  // The canvas keeps its own settings for new drones and chats. The first time, they start from the app's.
  const storedNewCardSettings = useDroneCanvasStore((s) => s.newCardSettings);
  const newCardSettings = React.useMemo((): CanvasNewCardSettings => {
    if (storedNewCardSettings) return storedNewCardSettings;
    const ui = useDroneHubUiStore.getState();
    return {
      agentKey: String(spawnAgentKey ?? '').trim() || 'builtin:cursor',
      model: String(spawnModel ?? '').trim(),
      reasoning: String(ui.spawnReasoning ?? '').trim(),
      permissionMode: ui.spawnAgentPermissionMode,
      approvalPolicy: ui.spawnApprovalPolicy,
    };
  }, [spawnAgentKey, spawnModel, storedNewCardSettings]);
  React.useEffect(() => {
    if (!storedNewCardSettings) useDroneCanvasStore.getState().setNewCardSettings(newCardSettings);
  }, [newCardSettings, storedNewCardSettings]);
  const newCardAgent = React.useMemo(
    () => resolveAgentKey(newCardSettings.agentKey),
    [newCardSettings.agentKey, resolveAgentKey],
  );
  const newCardConfiguration = React.useMemo(
    () => newChatConfigurationForAgent(newCardAgent, newCardSettings),
    [newCardAgent, newCardSettings],
  );
  const newCardAgentLabel = React.useMemo(() => {
    for (const entry of spawnAgentMenuEntries) {
      if (entry.kind !== 'separator' && entry.value === newCardSettings.agentKey && typeof entry.label === 'string') {
        return entry.label;
      }
    }
    if (newCardAgent.kind === 'custom') return newCardAgent.label || newCardAgent.id;
    return BUILTIN_AGENT_OPTIONS.find((option) => option.key === newCardSettings.agentKey)?.label ?? newCardSettings.agentKey;
  }, [newCardAgent, newCardSettings.agentKey, spawnAgentMenuEntries]);
  // A new chat that has had no message yet follows the settings as they change, as in its own composer.
  const applyNewCardSettings = React.useCallback((next: CanvasNewCardSettings) => {
    useDroneCanvasStore.getState().setNewCardSettings(next);
    if (!selectedDraftChat) return;
    const { droneId, chatName } = selectedDraftChat;
    const configuration = newChatConfigurationForAgent(resolveAgentKey(next.agentKey), next);
    void requestJson(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: configuration.agent,
        model: configuration.model ?? null,
        reasoning: configuration.reasoning ?? null,
        agentPermissionMode: configuration.agentPermissionMode,
        ...(configuration.approvalPolicy ? { approvalPolicy: configuration.approvalPolicy } : {}),
      }),
    }).then(() => {
      window.dispatchEvent(new CustomEvent('drone-hub:chat-model-settings-changed', { detail: { droneId, chatName, settings: {} } }));
    }).catch((error: unknown) => {
      setMessageError(`Could not update "${chatName}": ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [resolveAgentKey, selectedDraftChat]);
  const newCardModelPicker = useCanvasModelPicker({
    agent: newCardAgent,
    agentKey: newCardSettings.agentKey,
    model: newCardSettings.model,
    reasoning: newCardSettings.reasoning,
    onChange: (patch) => applyNewCardSettings({ ...newCardSettings, ...patch }),
    disabled: controlsDisabled,
  });
  // Messages to chats that already exist keep their own settings, with a one-off override instead of this picker.
  const messagingExistingChats = selectedMessageTargets.some(
    (target) => droneById[target.droneId]?.draftChats?.[target.chatName] !== true,
  );
  const newCardRuntimePicker = messagingExistingChats ? null : (
    <ChatComposerRuntimePicker config={{
      agent: {
        value: newCardSettings.agentKey,
        label: newCardAgentLabel,
        entries: spawnAgentMenuEntries,
        onChange: (key) => applyNewCardSettings(canvasSettingsForAgent(newCardSettings, key, resolveAgentKey(key))),
        disabled: controlsDisabled,
      },
      model: newCardModelPicker,
      choiceGroups: agentAccessChoiceGroups({
        permissionMode: newCardSettings.permissionMode,
        onPermissionModeChange: (permissionMode) => applyNewCardSettings({ ...newCardSettings, permissionMode }),
        approvalPolicy: newCardSettings.approvalPolicy,
        onApprovalPolicyChange: (approvalPolicy) => applyNewCardSettings({ ...newCardSettings, approvalPolicy }),
        ...agentAccessSupport(newCardAgent),
        disabled: controlsDisabled,
      }),
    }} />
  );
  // A topic keeps its own repository for new drones; the global board uses the app's.
  const normalizedCreateRepoPath = String((activeTopic ? activeTopic.repoPath || createRepoPath : createRepoPath) ?? '').trim();
  const changeCreateRepoPath = React.useCallback((next: string) => {
    if (activeTopicId) useDroneCanvasStore.getState().setTopicRepoPath(activeTopicId, next);
    else onCreateRepoPathChange(next);
  }, [activeTopicId, onCreateRepoPathChange]);
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
  } = useDroneHubUiStore(
    useShallow((s) => ({
      createDraftShortcutBinding: s.shortcutBindings.createDraftDrone,
      focusPrimaryChatInputShortcutBinding: s.shortcutBindings.focusPrimaryChatInput,
      showCanvasLastMessagePreviews: s.showCanvasLastMessagePreviews,
      setShowCanvasLastMessagePreviews: s.setShowCanvasLastMessagePreviews,
      hideSideChatWindowsWithCanvas: s.hideSideChatWindowsWithCanvas,
      setHideSideChatWindowsWithCanvas: s.setHideSideChatWindowsWithCanvas,
    })),
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
      const canvasDroneId = parseCanvasDroneNodeId(droneId);
      if (canvasDroneId) {
        if (!onRenameDrone) return;
      } else if (!isCanvasDraftNodeId(droneId)) {
        const chatRef = parseCanvasChatNodeId(droneId);
        if (!chatRef) return;
        if (chatRef.chatName === 'default') return;
      }
      const node = nodeMetaById[droneId];
      if (!node) return;
      setSelectedDroneIds([droneId]);
      inlineRenameSettledRef.current = false;
      setInlineRenameBusy(false);
      setInlineRenamingDroneId(droneId);
      setInlineRenameDraft(canvasDroneId
        ? String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId
        : String(node.label ?? droneId));
      setMessageError(null);
    },
    [effectiveDroneNameById, nodeMetaById, onRenameDrone, setSelectedDroneIds],
  );

  const submitInlineRename = React.useCallback(async () => {
    const droneId = String(inlineRenamingDroneId ?? '').trim();
    if (!droneId) return;
    const newName = String(inlineRenameDraft ?? '').trim();
    const renamingDroneId = parseCanvasDroneNodeId(droneId);
    const currentName = renamingDroneId
      ? String(effectiveDroneNameById[renamingDroneId] ?? '').trim() || renamingDroneId
      : String(nodeMetaById[droneId]?.label ?? '').trim();
    if (!newName || newName === currentName) {
      cancelInlineRename();
      return;
    }
    if (renamingDroneId) {
      if (!onRenameDrone) {
        cancelInlineRename();
        return;
      }
      setInlineRenameBusy(true);
      try {
        const result = await onRenameDrone(renamingDroneId, newName);
        if (result.ok) {
          setRenamedDroneNameById((prev) => ({ ...prev, [renamingDroneId]: newName }));
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
      return;
    }
    if (isCanvasDraftNodeId(droneId)) {
      const node = getView().nodesByDroneId[droneId];
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
          // Publish membership and positions together so placement cannot create
          // either name as a new card between the two updates.
          flushSync(() => {
            setRenamedChatNodes((prev) => ({ ...prev, [droneId]: { nodeId: nextNodeId, chatName: nextChatName } }));
            getCanvasBoardActions(null).replaceNodeId(droneId, nextNodeId, nextChatName);
            getCanvasBoardActions(chatRef.droneId).replaceNodeId(droneId, nextNodeId, nextChatName);
          });
        } else {
          const node = getView().nodesByDroneId[droneId];
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
    effectiveDroneNameById,
    inlineRenameDraft,
    getView,
    inlineRenamingDroneId,
    nodeMetaById,
    onRenameChat,
    onRenameDrone,
    setMessageError,
    upsertNodes,
  ]);

  /** Deletes the chats behind the selected cards, asking once for all of them. */
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
        if (toRemove.size > 0) {
          // Hidden before the cards go, so placement never sees a listed chat without a position.
          markChatsDeleted([...toRemove].flatMap((nodeId) => parseCanvasChatNodeId(nodeId) ?? []));
          removeNodes([...toRemove]);
        }
      } catch (err: any) {
        setMessageError(err?.message ?? String(err));
      }
    },
    [nodeOrder, onDeleteChats, removeNodes],
  );

  /**
   * Delete on a topic: a drone card leaves the topic with its chats (Shift deletes the drone);
   * a chat is deleted either way, as on its drone's board.
   */
  const deleteTopicSelection = React.useCallback(
    (nodeIds: readonly string[], deleteDrones: boolean) => {
      if (!activeTopicId) return;
      const droneIds = nodeIds.flatMap((nodeId) => parseCanvasDroneNodeId(nodeId) ?? []);
      const leaving = new Set(droneIds);
      const rest = nodeIds.filter((nodeId) =>
        !parseCanvasDroneNodeId(nodeId) && !leaving.has(parseCanvasChatNodeId(nodeId)?.droneId ?? ''));
      if (rest.length > 0) void deleteChatNodes(sortChatNodeIdsForDestructiveDelete([...rest]));
      if (droneIds.length === 0) return;
      if (deleteDrones) {
        if (onDeleteDrones) onDeleteDrones(droneIds);
        else setMessageError('Drone deletion is unavailable.');
        return;
      }
      useDroneCanvasStore.getState().removeDronesFromTopic(activeTopicId, droneIds);
      removeNodes(storedNodeOrder.filter((nodeId) =>
        leaving.has(parseCanvasDroneNodeId(nodeId) ?? parseCanvasChatNodeId(nodeId)?.droneId ?? '')));
    },
    [activeTopicId, deleteChatNodes, onDeleteDrones, removeNodes, storedNodeOrder],
  );

  const getDraftPlacement = React.useCallback(
    (
      anchorWorldX: number,
      anchorWorldY: number,
      options?: { avoidCollisions?: boolean },
    ): { x: number; y: number } => {
      const draftWidth = getNodeWidthPx('Untitled');
      const half = newCardHalfInStore('Untitled');
      const baseX = anchorWorldX - half.x;
      const baseY = anchorWorldY - half.y;
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

      const positions = getView().nodesByDroneId;
      const collides = (x: number, y: number): boolean => {
        for (const meta of nodes) {
          const node = positions[meta.droneId];
          if (!node) continue;
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
    [getView, newCardHalfInStore, nodeWidthByDroneId, nodes],
  );

  const createDraftAtWorldPoint = React.useCallback(
    /** `focus: 'canvas'` keeps the keyboard on the canvas: Q records, S or Tab sends, Enter starts typing. */
    (anchorWorldX: number, anchorWorldY: number, options?: { avoidCollisions?: boolean; focus?: 'canvas' | 'composer' }) => {
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
      if (options?.focus === 'canvas') focusViewport();
      else focusMessageInput();
    },
    [
      focusMessageInput,
      focusViewport,
      getDraftPlacement,
      normalizedDraftRepoLabel,
      setDraftPromptForNode,
      setDraftRepoLabelForNode,
      setSelectedDroneIds,
      upsertNodes,
    ],
  );

  const createDraftNearViewportCenter = React.useCallback(() => {
    const { panX, panY, scale } = getView();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const centerWorld = screenToStorePoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      rect,
      panX,
      panY,
      scale,
    );
    createDraftAtWorldPoint(centerWorld.x, centerWorld.y);
  }, [createDraftAtWorldPoint, getView]);

  const createChatAtWorldPoint = React.useCallback(
    (worldX: number, worldY: number) => {
      if (!boardDroneId || !onCreateChat) return;
      const half = newCardHalfInStore('Untitled');
      pendingChatPlacementRef.current = { x: Math.round(worldX - half.x), y: Math.round(worldY - half.y) };
      void onCreateChat(boardDroneId, newCardSettings).then((ok) => {
        if (!ok) pendingChatPlacementRef.current = null;
      });
    },
    [boardDroneId, newCardHalfInStore, newCardSettings, onCreateChat],
  );

  const requestNewNodeNearViewportCenter = React.useCallback(() => {
    const { panX, panY, scale } = getView();
    if (!droneScope) {
      createDraftNearViewportCenter();
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const center = screenToStorePoint(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, panX, panY, scale);
    createChatAtWorldPoint(center.x, center.y);
  }, [createChatAtWorldPoint, createDraftNearViewportCenter, droneScope, getView]);

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
    if (!topicScope) return;
    const viewport = viewportRef.current;
    const view = getView();
    const rect = viewport?.getBoundingClientRect();
    // A drone added without a drop point lands where the user is looking.
    const anchor = rect
      ? screenToStorePoint(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, view.panX, view.panY, view.scale)
      : { x: 0, y: 0 };
    const planned = planTopicBoardPlacements({
      drones: topicDrones.map((drone) => {
        const label = String(effectiveDroneNameById[drone.id] ?? '').trim() || drone.id;
        return {
          droneId: drone.id,
          label,
          width: getNodeWidthPx(label, DRONE_NODE_CHROME_WIDTH_PX),
          members: boardMembers.filter((member) => parseCanvasChatNodeId(member.nodeId)?.droneId === drone.id),
        };
      }),
      // Positions as they are now; the effect reruns when cards come or go, not when they move.
      nodesById: getView().nodesByDroneId,
      anchor: { x: anchor.x - NODE_MIN_WIDTH_PX / 2, y: anchor.y - CHAT_NODE_HEIGHT_PX / 2 },
      widthOf: (nodeId, label) => getNodeWidthPx(label, parseCanvasDroneNodeId(nodeId) ? DRONE_NODE_CHROME_WIDTH_PX : 0),
    });
    if (planned.length > 0) upsertNodes(planned);
  }, [boardMembers, effectiveDroneNameById, getView, nodeMetaById, topicDrones, topicScope, upsertNodes]);

  React.useEffect(() => {
    if (!droneScope) return;
    const anyPlaced = boardMembers.some((member) => nodeMetaById[member.nodeId]);
    let rootAnchor = pendingChatPlacementRef.current;
    const viewport = viewportRef.current;
    if (!rootAnchor && anyPlaced && viewport) {
      // Later arrivals land where the user is looking, not at the board origin.
      const rect = viewport.getBoundingClientRect();
      const view = getView();
      const center = screenToStorePoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect,
        view.panX,
        view.panY,
        view.scale,
      );
      rootAnchor = { x: center.x - NODE_MIN_WIDTH_PX / 2, y: center.y - CHAT_NODE_HEIGHT_PX / 2 };
    }
    const planned = planDroneBoardPlacements({ members: boardMembers, nodesById: getView().nodesByDroneId, rootAnchor });
    if (planned.length === 0) return;
    if (planned.some((node) => !forkSourceNodeIdByNodeId[node.droneId])) pendingChatPlacementRef.current = null;
    upsertNodes(planned);
  }, [boardMembers, droneScope, forkSourceNodeIdByNodeId, getView, nodeMetaById, upsertNodes]);

  React.useEffect(() => {
    if (selectedDroneIds.length > 0) return;
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
    const positions = getView().nodesByDroneId;
    for (const meta of nodes) {
      const node = positions[meta.droneId];
      if (!node || isCanvasDraftNodeId(node.droneId)) continue;
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
  }, [effectiveDroneNameById, getView, nodes, upsertNodes]);

  React.useEffect(() => {
    setRenamedDroneNameById((prev) => {
      const settled = Object.keys(prev).filter((droneId) => String(droneNameById[droneId] ?? '').trim() === prev[droneId]);
      if (settled.length === 0) return prev;
      const next = { ...prev };
      for (const droneId of settled) delete next[droneId];
      return next;
    });
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
    if (!nodeMetaById[sidebarId]) return;
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
    nodeMetaById,
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
    if (nodeMetaById[inlineRenamingDroneId]) return;
    cancelInlineRename();
  }, [cancelInlineRename, inlineRenamingDroneId, nodeMetaById]);

  React.useEffect(() => {
    if (!inlineRenamingDroneId) return;
    requestAnimationFrame(() => {
      const input = inlineRenameInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, [inlineRenamingDroneId]);

  const activateCanvasNode = React.useCallback((nodeId: string) => {
    if (isCanvasDraftNodeId(nodeId)) return;
    const droneId = parseCanvasDroneNodeId(nodeId);
    if (droneId) {
      onActivateChat?.(droneId, 'default');
      showCanvasChatPanel();
      return;
    }
    const chat = parseCanvasChatNodeId(nodeId);
    // Side chats included: selection opens their chat as the main chat.
    if (!chat) return;
    onActivateChat?.(chat.droneId, chat.chatName);
    // In the full view the main chat is out of sight; it shows in a panel at the canvas's left instead.
    showCanvasChatPanel();
  }, [onActivateChat]);

  React.useEffect(() => {
    const onWindowMouseMove = (event: MouseEvent) => {
      // While the cursor is held, the lock dispatches each event again at its own cursor.
      if (isEdgePanLockedEvent(event)) return;
      // The mouseup can be lost (released over a webview, outside the window, or swallowed by another handler),
      // so a move with the primary button already up ends the drag instead of leaving the node stuck to the cursor.
      // Pans are right-drags (button bit 2); card and marquee drags are left-drags (bit 1).
      const released = panDragRef.current
        ? (event.buttons & 2) === 0
        : (nodeDragRef.current || marqueeDragRef.current) && (event.buttons & 1) === 0;
      if (released) {
        onWindowMouseUp(event);
        return;
      }
      // Preserve the drag threshold even if the pointer returns to its start within one frame.
      const drag = nodeDragRef.current ?? marqueeDragRef.current;
      if (drag && !drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) >= DRAG_MOVE_THRESHOLD_PX) {
        drag.moved = true;
        if (drag === nodeDragRef.current) setMovingNodeIds(new Set(nodeDragRef.current.droneIds));
      }
      if (nodeDragRef.current || panDragRef.current || marqueeDragRef.current) moves.push(event);
    };
    const moves = createFrameBatch((event: MouseEvent) => {
      const nodeDrag = nodeDragRef.current;
      if (nodeDrag) {
        const { panX, panY } = getView();
        const dx = (event.clientX - nodeDrag.startClientX - (panX - nodeDrag.startPanX)) / nodeDrag.scale / cardSpreadRef.current.x;
        const dy = (event.clientY - nodeDrag.startClientY - (panY - nodeDrag.startPanY)) / nodeDrag.scale / cardSpreadRef.current.y;
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
            const pointTarget = resolveFleetAssignmentTargetFromPoint(event.clientX, event.clientY);
            const assignmentTarget = resolveCanvasAssignmentDropTarget(nodeDrag.droneIds, pointTarget);
            setAssignmentHoverNodeId(assignmentTarget.canvasNodeId);
            setAssignmentHoverTargetCount(assignmentTarget.targetDroneIds.length);
            // Repositioning cards and hovering other canvas nodes are local to
            // the canvas. Only advertise a chat drop when the pointer enters it.
            dispatchCanvasAssignmentPreview(pointTarget?.kind === 'chat-pane' ? {
              droneIds: draggedDroneIds,
              overDroneId: assignmentTarget.ownerDroneId,
            } : null);
          }
        } else {
          setAssignmentHoverNodeId(null);
          setAssignmentHoverTargetCount(0);
          dispatchCanvasAssignmentPreview(null);
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
      const { panX, panY } = getView();
      const box = buildSelectionBox(
        marqueeDrag.startClientX + panX - marqueeDrag.startPanX,
        marqueeDrag.startClientY + panY - marqueeDrag.startPanY,
        event.clientX,
        event.clientY,
        rect,
      );
      setSelectionBox(box);

      if (!marqueeDrag.moved) return;

      const hits: string[] = [];
      const view = getView();
      const viewBounds = viewBoundsOf(view.nodesByDroneId, shownNodeIdsRef.current, viewSizeByIdRef.current, cardSpreadRef.current);
      for (const [droneId, bounds] of Object.entries(viewBounds)) {
        if (rectIntersects(box.left, box.top, box.width, box.height,
          bounds.x * view.scale + view.panX, bounds.y * view.scale + view.panY,
          bounds.width * view.scale, bounds.height * view.scale)) hits.push(droneId);
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
    });

    const onWindowMouseUp = (event: MouseEvent) => {
      if (isEdgePanLockedEvent(event)) return;
      moves.flush();
      if (nodeDragRef.current) canvasPerf.gestureEnd('drag');
      if (panDragRef.current) canvasPerf.gestureEnd('pan');
      if (marqueeDragRef.current) canvasPerf.gestureEnd('marquee');
      if (panDragRef.current || marqueeDragRef.current) setCanvasGesture(viewportRef.current, false);
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
      setMovingNodeIds(EMPTY_ID_SET);

      panDragRef.current = null;
      setPanning(false);

      const marqueeDrag = marqueeDragRef.current;
      if (marqueeDrag && !marqueeDrag.moved && !marqueeDrag.additive) {
        clearSelection();
      }
      marqueeDragRef.current = null;
      setSelectionBox(null);
      if (marqueeDrag?.moved) {
        // Read after moves.flush(): React may not have rendered the final
        // rectangle yet. Include existing cards in an additive selection.
        const selected = getView().selectedDroneIds;
        if (selected.length === 1) {
          selectionAnchorRef.current = selected[0];
          activateCanvasNode(selected[0]);
        }
      }
    };

    const onWindowBlur = () => {
      moves.flush();
      if (!nodeDragRef.current && !panDragRef.current && !marqueeDragRef.current) return;
      setCanvasGesture(viewportRef.current, false);
      const nodeDrag = nodeDragRef.current;
      if (nodeDrag?.moved) suppressNodeClickRef.current = true;
      setComposerDropHover(false);
      dispatchCanvasAssignmentPreview(null);
      setAssignmentHoverNodeId(null);
      setAssignmentHoverTargetCount(0);
      nodeDragRef.current = null;
      setDraggingNodeId(null);
      setMovingNodeIds(EMPTY_ID_SET);
      panDragRef.current = null;
      setPanning(false);
      marqueeDragRef.current = null;
      setSelectionBox(null);
    };

    // Capture phase so a child that stops propagation of mouseup cannot leave a drag running.
    window.addEventListener('mousemove', onWindowMouseMove, true);
    window.addEventListener('mouseup', onWindowMouseUp, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      moves.cancel();
      dispatchCanvasAssignmentPreview(null);
      setAssignmentHoverNodeId(null);
      setAssignmentHoverTargetCount(0);
      window.removeEventListener('mousemove', onWindowMouseMove, true);
      window.removeEventListener('mouseup', onWindowMouseUp, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [activateCanvasNode, clearSelection, getView, isOverMessageComposer, moveNodes, onAssignDronesToOwner, setPan, setSelectedDroneIds]);

  const fitViewportToNodes = React.useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = Object.values(viewBoundsOf(getView().nodesByDroneId, nodeOrder, viewSizeById, cardSpread));
    if (!viewport || bounds.length === 0) {
      resetViewport();
      return;
    }
    const fit = fitViewportToBounds(bounds, viewport.clientWidth, viewport.clientHeight);
    if (fit) setViewport(fit.panX, fit.panY, fit.scale);
  }, [cardSpread, getView, nodeOrder, resetViewport, setViewport, viewSizeById]);

  const openMessageBar = React.useCallback(() => {
    if (selectedDroneIds.length === 0) return;
    setMessageError(null);
    focusMessageInput();
  }, [focusMessageInput, selectedDroneIds.length]);

  const sendCanvasPrompt = React.useCallback(async (payload: ChatSendPayload, context: ChatSendContext, overrides: ChatModelOverrides = {}): Promise<boolean> => {
    if (selectedDroneIds.length === 0) return false;
    const regularNodeIds = selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id));
    const draftNodeIds = selectedDroneIds.filter((id) => isCanvasDraftNodeId(id));
    let regularTargets = collectUniqueChatTargets(regularNodeIds, droneById);
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
      const positions = getView().nodesByDroneId;
      const occupiedRects = nodes
        .flatMap((meta) => positions[meta.droneId] ?? [])
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
            const node = getView().nodesByDroneId[draftNodeId];
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
                    agentKey: newCardSettings.agentKey,
                    model: overrides.model !== undefined ? overrides.model ?? '' : newCardSettings.model,
                    reasoning: overrides.reasoning !== undefined ? overrides.reasoning ?? '' : newCardSettings.reasoning,
                    // Only what the agent takes: other access or approvals would be refused.
                    permissionMode: newCardConfiguration.agentPermissionMode,
                    approvalPolicy: newCardConfiguration.approvalPolicy ?? 'ask',
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

              // A drone made on a topic joins it; its card is laid out above its first chat.
              if (activeTopicId && created.length > 0) {
                useDroneCanvasStore.getState().addDronesToTopic(activeTopicId, created.map((item) => item.droneId));
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

      // A just-pasted clone can be messaged (Q right after Ctrl+V) while the server is still copying it:
      // wait for it, and leave out one that was never created.
      const failedCloneTargets = new Set<(typeof regularTargets)[number]>();
      await Promise.all(regularTargets.map(async (target) => {
        const pending = pendingClonesRef.current.get(createCanvasChatNodeId(target.droneId, target.chatName));
        if (pending && !(await pending)) failedCloneTargets.add(target);
      }));
      if (failedCloneTargets.size > 0) {
        errors.push(failedCloneTargets.size === 1 ? 'A pasted chat could not be created.' : `${failedCloneTargets.size} pasted chats could not be created.`);
        regularTargets = regularTargets.filter((target) => !failedCloneTargets.has(target));
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
      // Regular sends preserve focus so canvas recording shortcuts remain
      // available and an asynchronous send cannot pull focus into the input.
      if (!interactionActive && shouldFocusViewport) {
        focusViewport();
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
    droneById,
    draftSpawnCount,
    draggingNodeId,
    focusViewport,
    messageSending,
    nodeHeightByDroneId,
    nodeWidthByDroneId,
    nodes,
    setDraftPromptForNode,
    getView,
    normalizedCreateGroup,
    normalizedCreateRepoPath,
    activeTopicId,
    newCardConfiguration,
    newCardSettings,
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

  const onNodeMouseDown = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      if (inlineRenamingDroneId === droneId) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // A middle click does nothing on a card; keep it from starting autoscroll.
      if (event.button === 1) event.preventDefault();
      if (event.button !== 0) return;
      focusViewportElement();
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();

      const view = getView();
      if (!view.nodesByDroneId[droneId]) return;
      const selectedSet = new Set(selectedDroneIds);
      const dragIds =
        selectedSet.has(droneId) && selectedDroneIds.length > 1
          ? selectedDroneIds.filter((id) => Boolean(view.nodesByDroneId[id]))
          : [droneId];
      const startPositionsById: Record<string, { x: number; y: number }> = {};
      for (const id of dragIds) {
        const dragNode = view.nodesByDroneId[id];
        if (!dragNode) continue;
        startPositionsById[id] = { x: dragNode.x, y: dragNode.y };
      }

      if (!selectedSet.has(droneId) || selectedDroneIds.length === 0) {
        setSelectedDroneIds([droneId]);
      }

      canvasPerf.gestureStart('drag');
      cardHover.clear();
      nodeDragRef.current = {
        droneIds: dragIds,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPositionsById,
        scale: view.scale,
        startPanX: view.panX,
        startPanY: view.panY,
        moved: false,
        selectionBefore: selectedDroneIds,
      };
      setDraggingNodeId(droneId);
      marqueeDragRef.current = null;
      setSelectionBox(null);
    },
    [focusViewportElement, getView, inlineRenamingDroneId, selectedDroneIds, setSelectedDroneIds],
  );

  const onNodeClick = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      focusViewportElement();
      if (suppressNodeClickRef.current) {
        suppressNodeClickRef.current = false;
        return;
      }
      const additive = event.ctrlKey || event.metaKey;
      if (additive || event.shiftKey) {
        setSelectedDroneIds(selectSidebarChatNodes({ currentNodeIds: selectedDroneIds, orderedNodeIds: nodeOrder,
          nodeId: droneId, anchorNodeId: selectionAnchorRef.current, additive, range: event.shiftKey }));
        if (!event.shiftKey) selectionAnchorRef.current = droneId;
        return;
      }
      selectionAnchorRef.current = droneId;
      canvasPerf.action('select');
      setSelectedDroneIds([droneId]);
      activateCanvasNode(droneId);
    },
    [activateCanvasNode, focusViewportElement, nodeOrder, selectedDroneIds, setSelectedDroneIds],
  );

  // Like a browser's back and forward: back leaves this drone's board for the board it was
  // opened from (the global one or a topic), forward returns.
  const returnScopeRef = React.useRef<'global' | 'topic'>('global');
  const openDroneBoard = React.useCallback(() => {
    returnScopeRef.current = topicScope ? 'topic' : 'global';
    setScope('drone');
  }, [setScope, topicScope]);
  const canvasBack = React.useCallback((): boolean => {
    if (!droneScope) return false;
    const state = useDroneCanvasStore.getState();
    const topicOpen = returnScopeRef.current === 'topic' && state.topics.some((topic) => topic.id === state.activeTopicId);
    setScope(topicOpen ? 'topic' : 'global');
    return true;
  }, [droneScope, setScope]);
  const canvasForward = React.useCallback((): boolean => {
    if (droneScope || !boardDrone) return false;
    openDroneBoard();
    return true;
  }, [boardDrone, droneScope, openDroneBoard]);
  const onCanvasMouseUp = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // The mouse's back and forward side buttons; handled here so the app's window doesn't navigate.
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 3) canvasBack();
    else canvasForward();
  }, [canvasBack, canvasForward]);

  const onNodeDoubleClick = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (droneScope || isCanvasDraftNodeId(droneId)) return;
      // Select the card's chat (a drone card: its default chat), then show that drone's board.
      activateCanvasNode(droneId);
      openDroneBoard();
    },
    [activateCanvasNode, droneScope, openDroneBoard],
  );

  const nodeActions = { onNodeMouseDown, onNodeClick, onNodeDoubleClick, hoverCard: cardHover.hover, setInlineRenameDraft, submitInlineRename, cancelInlineRename, focusViewportElement };
  const nodeActionsRef = React.useRef(nodeActions);
  React.useLayoutEffect(() => { nodeActionsRef.current = nodeActions; });

  const onCanvasMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const { panX, panY } = getView();
      viewportRef.current?.focus({ preventScroll: true });
      // Middle-click holds the cursor in the canvas for edge panning; while held, the lock itself releases it.
      if (event.button === 1) {
        event.preventDefault();
        edgePan.lock(event.clientX, event.clientY);
        return;
      }
      if (event.button === 2) {
        event.preventDefault();
        canvasPerf.gestureStart('pan');
        cardHover.clear();
        setCanvasGesture(viewportRef.current, true);
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

      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[data-canvas-node="1"]')) {
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
      canvasPerf.gestureStart('marquee');
      cardHover.clear();
      setCanvasGesture(viewport, true);
      marqueeDragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: panX,
        startPanY: panY,
        additive,
        baseSelectedIds: selectedDroneIds.slice(),
        moved: false,
      };
      setSelectionBox(buildSelectionBox(event.clientX, event.clientY, event.clientX, event.clientY, rect));
    },
    [edgePan.lock, getView, selectedDroneIds, setSelectedDroneIds],
  );

  const onCanvasDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (inlineRenamingDroneId) return;
      const { panX, panY, scale } = getView();
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
      const worldPoint = screenToStorePoint(event.clientX, event.clientY, rect, panX, panY, scale);
      canvasPerf.action('create');
      // The new draft is selected and the keyboard stays on the canvas: Q records into it, S or Tab sends,
      // Enter starts typing.
      if (droneScope) {
        createChatAtWorldPoint(worldPoint.x, worldPoint.y);
        focusViewport();
        return;
      }
      createDraftAtWorldPoint(worldPoint.x, worldPoint.y, { avoidCollisions: false, focus: 'canvas' });
    },
    [createChatAtWorldPoint, createDraftAtWorldPoint, droneScope, focusViewport, inlineRenamingDroneId, getView],
  );

  // Zooming moves cards under the pointer: the steps panel waits until the pointer rests again.
  useCanvasWheelZoom(viewportRef, getView, setViewport, cardHover.clear);
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
      const { panX, panY, scale } = getView();
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
      const origin = screenToStorePoint(clientX, clientY, rect, panX, panY, scale);
      if (activeTopicId) {
        // A drone or chat dropped on a topic adds its drone, which brings every chat with it.
        const droneIds = [...new Set(ids.map((nodeId) => parseCanvasChatNodeId(nodeId)?.droneId ?? parseCanvasDroneNodeId(nodeId) ?? ''))]
          .filter(Boolean);
        if (droneIds.length === 0) return;
        const unplaced = droneIds.filter((droneId) => !nodeMetaById[createCanvasDroneNodeId(droneId)]);
        upsertNodes(unplaced.map((droneId, idx) => {
          const label = String(effectiveDroneNameById[droneId] ?? '').trim() || droneId;
          const width = getNodeWidthPx(label, DRONE_NODE_CHROME_WIDTH_PX);
          return {
            droneId: createCanvasDroneNodeId(droneId),
            label,
            x: origin.x - width / 2,
            y: origin.y - NODE_HEIGHT_PX / 2 + idx * DROP_STACK_SPACING_Y_PX,
          };
        }));
        useDroneCanvasStore.getState().addDronesToTopic(activeTopicId, droneIds);
        setSelectedDroneIds(droneIds.map((droneId) => createCanvasDroneNodeId(droneId)));
        return;
      }
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
    [activeTopicId, droneScope, effectiveDroneNameById, isOverMessageComposer, getView, nodeMetaById, setSelectedDroneIds, upsertNodes],
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
    setCanvasGesture(viewportRef.current, false);
    nodeDragRef.current = null;
    panDragRef.current = null;
    marqueeDragRef.current = null;
    setDraggingNodeId(null);
    setMovingNodeIds(EMPTY_ID_SET);
    setPanning(false);
    setSelectionBox(null);
  }, []);

  React.useLayoutEffect(() => {
    cancelActivePointerInteractions();
    setComposerDropHover(false);
  }, [boardKey, cancelActivePointerInteractions]);

  const copyCanvasNodesForClone = React.useCallback((nodeIds: string[] = selectedDroneIds): number => {
    const sourceNodeIdByDroneId = collectCloneSourceNodeIdByDroneId(nodeIds);
    const drones = collectCloneableDroneIdsFromCanvasSelection(nodeIds)
      .map((droneId) => ({ droneId, nodeId: sourceNodeIdByDroneId[droneId] ?? '' }));
    const chats = collectCloneableChatsFromCanvasSelection(nodeIds);
    if (drones.length + chats.length > 0) {
      const droneNames: Record<string, string> = {};
      for (const { droneId } of [...drones, ...chats]) {
        const name = String(effectiveDroneNameById[droneId] ?? '').trim();
        if (name) droneNames[droneId] = name;
      }
      useChatClipboardStore.getState().copy({ chats, drones, droneNames, view: viewportRef.current?.ownerDocument.defaultView });
    }
    return drones.length + chats.length;
  }, [effectiveDroneNameById, selectedDroneIds]);

  /** Clones what was copied here or in the Chats window. `at` is a client point, e.g. where a menu opened. */
  const pasteCopiedCanvasNodesAsClones = React.useCallback((at?: { x: number; y: number }) => {
    const { panX, panY, scale } = getView();
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
      anchor = screenToStorePoint(
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
      boundsById: readCompactNodeBounds(),
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
      // Clones are selected the moment their cards appear, so Q records into them without waiting for the copy.
      const shownNodeIds: string[] = [];
      const showPasted = (nodeId: string) => {
        if (shownNodeIds.includes(nodeId)) return;
        shownNodeIds.push(nodeId);
        setSelectedDroneIds(shownNodeIds.slice());
      };
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
          if (activeTopicId) useDroneCanvasStore.getState().addDronesToTopic(activeTopicId, [cloneDroneId]);
          pastedNodeIds.push(nodeId);
          showPasted(nodeId);
        }
      };
      const cloneChats = () =>
        runWithConcurrency(copiedChats, CHAT_PASTE_CONCURRENCY, async (source) => {
          const position = positionBySourceNodeId[source.nodeId];
          if (!onCloneChat || !position) return;
          const ownBoard = boardDroneId === source.droneId;
          const placedNodeIds: string[] = [];
          let settle: (created: boolean) => void = () => {};
          const settled = new Promise<boolean>((resolve) => { settle = resolve; });
          const result = await onCloneChat(source.droneId, source.chatName, {
            // Keep keyboard focus on the canvas so another paste works immediately.
            select: false,
            // On a drone board the clone handler owns the card; on the global board it is placed here.
            ...(ownBoard ? { boardPosition: position } : {}),
            onPlaced: (chatName) => {
              const placedNodeId = createCanvasChatNodeId(source.droneId, chatName);
              if (!placedNodeId) return;
              if (!ownBoard) upsertNodes([{ droneId: placedNodeId, label: chatName, ...position }]);
              // A chat cloned into a topic brings its drone along.
              if (activeTopicId) useDroneCanvasStore.getState().addDronesToTopic(activeTopicId, [source.droneId]);
              placedNodeIds.push(placedNodeId);
              pendingClonesRef.current.set(placedNodeId, settled);
              showPasted(placedNodeId);
            },
          }).catch(() => ({ ok: false as const, chatName: undefined }));
          const nodeId = result?.ok && result.chatName ? createCanvasChatNodeId(source.droneId, result.chatName) : '';
          for (const placedNodeId of placedNodeIds) {
            if (pendingClonesRef.current.get(placedNodeId) === settled) pendingClonesRef.current.delete(placedNodeId);
          }
          settle(Boolean(nodeId));
          // A name that was tried but not created leaves the global board and the selection again.
          const abandoned = placedNodeIds.filter((placedNodeId) => placedNodeId !== nodeId);
          if (abandoned.length) {
            if (!ownBoard) removeNodes(abandoned);
            for (const id of abandoned) {
              const index = shownNodeIds.indexOf(id);
              if (index >= 0) shownNodeIds.splice(index, 1);
            }
            setSelectedDroneIds(shownNodeIds.slice());
          }
          if (!nodeId || !result.chatName) return;
          if (!ownBoard && !placedNodeIds.includes(nodeId)) upsertNodes([{ droneId: nodeId, label: result.chatName, ...position }]);
          pastedNodeIds.push(nodeId);
          showPasted(nodeId);
        });
      await Promise.all([cloneDrones(), cloneChats()]);
    })();
  }, [
    activeTopicId,
    boardDroneId,
    droneById,
    readCompactNodeBounds,
    onCloneChat,
    onCloneDrone,
    getView,
    removeNodes,
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

      // Keyboard twins of the mouse back and forward buttons. When there is nowhere to
      // go, the key falls through to whatever else it is bound to.
      if (
        !event.repeat &&
        ((isShortcutMatch(bindings.canvasBack, event.nativeEvent) && canvasBack()) ||
          (isShortcutMatch(bindings.canvasForward, event.nativeEvent) && canvasForward()))
      ) {
        event.preventDefault();
        event.stopPropagation();
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
        canvasPerf.action('copy');
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
          canvasPerf.action('paste');
          pasteCopiedCanvasNodesAsClones();
        }
        return;
      }

      if (isPrimaryMod && !event.altKey && !event.shiftKey && key === 'a') {
        event.preventDefault();
        event.stopPropagation();
        canvasPerf.action('select-all');
        setSelectedDroneIds(nodeOrder.slice());
        return;
      }

      if (key === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        // In the full view Escape steps back out of it: first out of the chat panel, then out of the full view. The
        // selection stays, as when the canvas is left any other way.
        const fullView = useCanvasFullViewStore.getState();
        if (fullView.fullView) {
          if (fullView.chatPanelOpen) closeCanvasChatPanel();
          else leaveCanvasFullView();
          return;
        }
        canvasPerf.action('clear-selection');
        clearSelection();
        return;
      }

      if (key === 'f2' && !isPrimaryMod && !event.altKey && !event.shiftKey) {
        if (selectedDroneIds.length !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        beginInlineRename(selectedDroneIds[0]);
        return;
      }

      // Backspace and Alt+Left go back to the global board; Shift+Backspace and Alt+Right come forward to this drone's.
      const plainBackspace = key === 'backspace' && !event.ctrlKey && !event.metaKey && !event.altKey;
      const altArrow = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        (key === 'arrowleft' || key === 'arrowright');
      if (plainBackspace || altArrow) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey || key === 'arrowright') canvasForward();
        else canvasBack();
        return;
      }

      // Only Delete removes cards: Backspace navigates, as in a browser.
      if (key === 'delete' && selectedDroneIds.length > 0) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        canvasPerf.action('delete');
        cancelActivePointerInteractions();
        setMessageError(null);
        setMessageDraft('');
        if (topicScope) {
          deleteTopicSelection(selectedDroneIds, event.shiftKey);
          return;
        }
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
      canvasBack,
      canvasForward,
      activeComposer,
      beginInlineRename,
      clearSelection,
      copyCanvasNodesForClone,
      createDraftShortcutBinding,
      boardDroneId,
      droneScope,
      nodeOrder,
      openMessageBar,
      cancelActivePointerInteractions,
      deleteChatNodes,
      deleteTopicSelection,
      topicScope,
      createDraftNearViewportCenter,
      focusPrimaryChatInputShortcutBinding,
      pasteCopiedCanvasNodesAsClones,
      removeNodes,
      selectedDroneIds,
      setSelectedDroneIds,
    ],
  );

  const cardById: Record<string, React.ReactElement> = {};
  for (const node of nodes) {
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
    const deleting = Boolean(deletingChatNodeById[node.droneId]);
    const detail = detailByNodeId[node.droneId];
    if (!detail) continue;
    const nodeWidth = detailedWidthByNodeId[node.droneId] ?? DETAILED_CARD_WIDTH_PX;
    const nodeHeight = DETAILED_CARD_HEIGHT_PX;
    // A drone board is one drone's chats: its repository and branch are the same on every card.
    // A chat linked to its drone's card on this canvas shows neither: the drone card does.
    const repoFromDroneCard = Boolean(chatRef && droneNodeByDroneId[chatRef.droneId]);
    const showRepo = Boolean(nodeDroneId) && !droneScope && !repoFromDroneCard;
    const repoLabel = draftNode
      ? String(draftRepoLabelByNodeId[node.droneId] ?? '').trim()
      : showRepo
        ? String(droneRepoById[nodeDroneId!] ?? '').trim()
        : '';
    const repoBranch = !draftNode && showRepo
      ? String(droneById[nodeDroneId!]?.repoBranch ?? '').trim()
      : '';
    const canvasDroneLabel = canvasDroneId
      ? String(effectiveDroneNameById[canvasDroneId] ?? '').trim() || canvasDroneId
      : '';
    const primaryLabel = inlineEditing ? inlineRenameDraft : droneNode ? canvasDroneLabel : chatRef?.chatName ?? node.label;
    cardById[node.droneId] = <CanvasNodeCard
      nodeId={node.droneId}
      detail={detail}
      draftNode={draftNode}
      droneNode={droneNode}
      canvasDroneId={canvasDroneId}
      nodeDroneId={nodeDroneId}
      selected={selected}
      dragging={dragging}
      inlineEditing={inlineEditing}
      assignmentHoverTarget={assignmentHoverTarget}
      assignmentHoverTargetCount={assignmentHoverTarget ? assignmentHoverTargetCount : 0}
      isActiveSidebarChat={isActiveSidebarChat}
      indicatorState={indicatorState}
      deleting={deleting}
      nodeWidth={nodeWidth}
      nodeHeight={nodeHeight}
      repoLabel={repoLabel}
      repoBranch={repoBranch}
      primaryLabel={primaryLabel}
      showCanvasLastMessagePreviews={showCanvasLastMessagePreviews}
      inlineRenameDraft={inlineEditing ? inlineRenameDraft : ''}
      inlineRenameBusy={inlineEditing && inlineRenameBusy}
      runtime={droneById[canvasDroneId ?? '']?.runtime}
      actions={nodeActionsRef}
      nodeElementByDroneIdRef={nodeElementByDroneIdRef}
      inlineRenameInputRef={inlineRenameInputRef}
      inlineRenameSettledRef={inlineRenameSettledRef}
    />;
  }

  const cursorClassName = panning
    ? 'cursor-grabbing'
    : draggingNodeId
      ? 'cursor-grabbing'
      : selectionBox
        ? 'cursor-crosshair'
        : 'cursor-default';

  return (
    <UiPanel
      ref={panelRef}
      surface="alternate"
      flush
      className="relative h-full w-full"
    >
        <UiPanelToolbar aria-label="Canvas controls" className="min-h-0 gap-1.5 px-2 py-1">
          <div className="flex flex-shrink-0 items-center gap-1" role="group" aria-label="Canvas board">
            {boardDrone ? (
              <UiToolbarButton size="xsmall"
                pressed={droneScope}
                onClick={() => (droneScope ? undefined : openDroneBoard())}
                title="Every chat of this drone, laid out for you. New, cloned and side chats appear on their own."
              >
                This drone
              </UiToolbarButton>
            ) : null}
            <UiToolbarButton size="xsmall"
              pressed={!droneScope && !topicScope}
              onClick={() => setScope('global')}
              title="One board shared across drones. Drag drones and chats in from the sidebar."
            >
              Global
            </UiToolbarButton>
            <CanvasTopicSwitcher defaultRepoPath={String(createRepoPath ?? '').trim()} onOpened={focusViewportElement}
              droneNameById={existingDroneNameById} deleteMode={droneDeleteMode} onDeleteDrones={onDeleteDronesConfirmed} />
          </div>
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
            <ChatStepsControl />
            {canvasCost ? (
              <span className="px-1 font-mono text-[11px] tabular-nums text-[var(--muted)]" data-canvas-cost-total
                title="What the chats on this canvas have cost in all. Hover a card for its own.">
                {canvasCost}
              </span>
            ) : null}
            <UiToolbarButton size="xsmall"
              pressed={!hideSideChatWindowsWithCanvas}
              onClick={() => setHideSideChatWindowsWithCanvas(!hideSideChatWindowsWithCanvas)}
              title="Keep floating side chat windows visible while the canvas is open. Off, they stay hidden until the canvas is closed."
            >
              Side chat windows
            </UiToolbarButton>
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center gap-1">
            <CanvasEdgePanControls lock={edgePan} />
            <span className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" aria-hidden="true" />
            <UiToolbarButton size="xsmall" onClick={fitViewportToNodes} disabled={nodes.length === 0} title="Zoom and pan so every node is in view">
              Fit
            </UiToolbarButton>
            <UiToolbarButton size="xsmall" onClick={resetViewport} title="Reset canvas view">
              Reset
            </UiToolbarButton>
            <CanvasZoomLabel boardKey={boardKey} />
          </div>
        </UiPanelToolbar>
        {canvasControlsExpanded && !droneScope ? (
          <UiPanelToolbar
            aria-label="Canvas creation defaults"
            className="flex-wrap overflow-visible px-3 py-2"
          >
            {/* The agent, model, and access for new drones are in the composer's picker. */}
            <UiToolbarButton
              onClick={onOpenCustomAgentModal}
              disabled={controlsDisabled}
              title="Manage custom agents"
            >
              Custom agents
            </UiToolbarButton>
            <div className="flex items-center gap-1.5">
              <span className="text-10 font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Repo
              </span>
              <UiMenuSelect
                variant="toolbar"
                value={normalizedCreateRepoPath}
                onValueChange={changeCreateRepoPath}
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
        className={`relative flex-1 min-h-0 overflow-hidden select-none outline-none dh-canvas-work-ground ${cursorClassName} ${dragOverCanvas ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''}`}
        onKeyDown={onViewportKeyDown}
        onMouseDown={onCanvasMouseDown}
        onMouseUp={onCanvasMouseUp}
        onMouseMove={(event) => {
          cursorClientPointRef.current = { x: event.clientX, y: event.clientY };
        }}
        onMouseLeave={() => {
          cursorClientPointRef.current = null;
        }}
        onDoubleClick={onCanvasDoubleClick}
        // Right-drag pans the canvas, so right-click opens no menu.
        onContextMenu={(event) => event.preventDefault()}
      >
        <CanvasWorldLayer boardDroneId={boardKey}>
          <CanvasEdgesLayer
            boardKey={boardKey}
            nodeIds={nodeOrder}
            sizeById={viewSizeById}
            cardSpread={cardSpread}
            preferredNodeByDroneId={preferredNodeByDroneId}
            droneNodeByDroneId={droneNodeByDroneId}
            chatNodesByDroneId={chatNodesByDroneId}
            fleetParentIdByDroneId={fleetParentIdByDroneId}
            fleetAssignedIdsByDroneId={fleetAssignedIdsByDroneId}
            forkSourceNodeIdByNodeId={edgeForkSourceNodeIdByNodeId}
          />
          <CanvasCardsLayer
            boardKey={boardKey}
            nodeIds={nodeOrder}
            cardById={cardById}
            cardSpread={cardSpread}
            movingNodeIds={movingNodeIds}
          />
        </CanvasWorldLayer>
        <div data-canvas-gesture-shield="" className="absolute inset-0 hidden" aria-hidden="true" />

        <HoveredCard hover={cardHover}>{(focusId) => {
          // Only the card the pointer rests on: its steps in full, off the cards. A selected card shows nothing here,
          // and neither does a draft, which has no steps yet.
          const focus = detailByNodeId[focusId];
          if (!focus || isCanvasDraftNodeId(focusId)) return null;
          const focusChat = parseCanvasChatNodeId(focusId);
          if (focusChat && droneById[focusChat.droneId]?.draftChats?.[focusChat.chatName] === true) return null;
          const focusDroneId = parseCanvasDroneNodeId(focusId);
          const title = focusDroneId
            ? String(effectiveDroneNameById[focusDroneId] ?? '').trim() || focusDroneId
            : parseCanvasChatNodeId(focusId)?.chatName ?? nodeMetaById[focusId]?.label ?? '';
          return <CanvasStepsPanel title={title} card={focus} bottomPx={stepsPanelBottomPx} />;
        }}</HoveredCard>

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
          selectionKey={`canvas:${boardKey ?? 'global'}:${composerDraftNodeId ?? 'messages'}`}
          targets={selectedMessageTargets}
          droneById={droneById}
          hasDrafts={selectedDroneIds.some(isCanvasDraftNodeId)}
          spawnAgentKey={newCardSettings.agentKey}
          onDraftContentChange={(content) => { composerHasAttachmentsRef.current = content.attachments.length > 0; }}
          selectedCount={selectedDroneIds.length}
          selectedLabel={selectedMessageLabel}
          sending={messageSending}
          draft={composerDraft}
          spawnCountEnabled={Boolean(selectedDraftNodeId)}
          spawnCount={draftSpawnCount}
          error={messageError}
          onSpawnCountChange={onDraftSpawnCountChange}
          onSpawnCountBlur={onDraftSpawnCountBlur}
          onDraftChange={(next) => {
            if (composerDraftNodeId) {
              setDraftPromptForNode(composerDraftNodeId, next);
            } else {
              setMessageDraft(next);
            }
            if (messageError) setMessageError(null);
          }}
          onSend={sendCanvasPrompt}
          draftControls={selectedDraftNodeId ? {
            // Above the input, so it can be set before typing or recording.
            meta: <DraftRepoSelect repoPath={normalizedCreateRepoPath} repoEntries={createRepoMenuEntries}
              onRepoChange={changeCreateRepoPath} disabled={controlsDisabled} />,
          } : null}
          runtimePicker={newCardRuntimePicker}
          references={messageReferences}
          onReferencesChange={setMessageReferences}
          referenceDropActive={composerDropHover}
        />

        {nodes.length === 0 ? (
          <CanvasEmptyState droneScope={droneScope} topicName={activeTopic?.name ?? null} />
        ) : null}

        {dragOverCanvas ? (
          <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)]" />
        ) : null}
      </UiPanelBody>
      <CanvasEdgePanOverlay lock={edgePan} />
    </UiPanel>
  );
}
