import React from 'react';
import { useDndMonitor, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import {
  DroneCard,
  SidebarApprovalStatusIndicator,
  SidebarItemStateIndicator,
  SidebarWorkingStatusIndicator,
  sidebarChatDisplayState,
  sidebarDroneDisplayState,
  sidebarDroneStateLabel,
  type DroneInlineRenameResult,
} from '../overview';
import type { DroneSummary } from '../types';
import { createCanvasChatNodeId } from './app-config';
import { droneChatRequiresApproval, normalizedDroneChats } from './chat-node-helpers';
import { createSidebarChatDragData, parseDroneHubDragData, useDroneHubActiveDrag, type SidebarDroneDragData } from './drone-hub-dnd';
import { isDroneStartingOrSeeding } from './helpers';
import { IconChevron, IconColumns, IconEye, IconEyeOff, IconPencil, IconPlus, IconSpinner, IconTrash } from './icons';
import { isSidebarGroupCollapsed } from './is-sidebar-group-collapsed';
import type { DroneSelectionClickOptions } from './drone-selection-helpers';
import { sidebarInlineSectionKey, type SidebarInlineSectionKind } from './sidebar-inline-sections';
import type { SidebarFolderSelectionOptions } from './sidebar-folder-selection';
import { buildSidebarDroneTree, type SidebarDroneTree } from './sidebar-drone-tree';
import { buildSidebarNodeTree, type SidebarNodeTreeModel, type SidebarTreeDroneNode, type SidebarTreeFolderNode } from './sidebar-node-tree';
import {
  planSidebarDrop,
  sidebarNodeAllowsDropInside,
  type SidebarDropTarget,
  type SidebarTreeDropPlacement,
} from './sidebar-drop-plan';
import {
  SIDEBAR_ROOT_PARENT_ID,
  sidebarChatSidebarNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
  sidebarFolderPathFromNodeId,
} from './sidebar-node-order';
import {
  orderSidebarEntries,
  sidebarGroupOrderToken,
  sidebarGroupLegacyOrderToken,
  type SidebarGroupDropPlacement,
} from './sidebar-group-order';
import {
  sidebarDropPlacementFromRects,
  SidebarReorderDropIndicator,
} from './sidebar-reorder-ui';
import { sidebarGroupBaseName } from './sidebar-group-paths';
import type { DroneDeleteMode, SidebarDensityMode } from './settings-types';
import type { SidebarMoveIntent } from '@drone/hub-model/sidebar';
import { useChatApprovalRequired } from './use-drone-hub-runtime-store';
import type { MoveDronesToGroupResult } from './use-group-management';
import type { SidebarGroup } from './use-sidebar-view-model';
import { SidebarContextMenu, type SidebarContextMenuItem } from './SidebarContextMenu';
import { formatShortcutBinding } from './shortcuts';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import {
  sidebarChatLabelClass,
  sidebarChatRowTone,
  sidebarChatStateClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
  sidebarSelectionEdgeClass,
} from '../sidebar/presentation';

type FolderEditorState = {
  mode: 'create' | 'rename';
  parentPath: string | null;
  anchorPath: string | null;
  beforeNodeId: string | null;
  targetPath: string | null;
  value: string;
  error: string | null;
  pending: boolean;
};

type ChatEditorState = {
  mode: 'create' | 'rename';
  droneId: string;
  targetChatName: string | null;
  value: string;
  createAsDraft?: boolean;
  error: string | null;
  pending: boolean;
};

type GroupedSidebarTreeProps = {
  sidebarGroups: SidebarGroup[];
  nodeTreeOverride?: SidebarNodeTreeModel | null;
  displayRootNodeId?: string | null;
  sidebarGroupCreatedAtByName: Record<string, string | null>;
  sidebarDensityMode: SidebarDensityMode;
  sidebarFolderTree: import('./sidebar-folder-tree').SidebarFolderNode[];
  sidebarGroupOrder: string[];
  sidebarDndEnabled: boolean;
  repoScopedGroupPathsByRepoGroup: Record<string, string[]>;
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  onMoveSidebar: (intent: SidebarMoveIntent) => Promise<boolean>;
  droneById: Record<string, DroneSummary>;
  selectedDroneIds: string[];
  selectedDroneSet: Set<string>;
  highlightedDroneIds: Set<string>;
  selectedDrone: string | null;
  activeChatName: string;
  selectedSidebarNodeId: string | null;
  selectedFolderPath: string | null;
  setSelectedSidebarNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  onSelectFolder: (path: string, opts?: SidebarFolderSelectionOptions) => void;
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneContainer: (droneId: string) => void;
  onFocusDroneChat: (droneId: string, chatName: string) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onRenameGroup: (group: string, nextName?: string, opts?: { skipNodeOrderUpdate?: boolean }) => Promise<boolean> | boolean;
  onToggleGroupCollapsed: (group: string) => void;
  collapsedDroneSections: Record<string, boolean>;
  setCollapsedDroneSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onToggleDroneSection: (droneId: string, kind: SidebarInlineSectionKind) => void;
  collapsedGroups: Record<string, boolean>;
  deletingGroups: Record<string, boolean>;
  renamingGroups: Record<string, boolean>;
  hiddenSidebarGroupTokenSet: Set<string>;
  selectedGroupMultiChat: string | null;
  onOpenFolderCreate: (
    parentPath: string | null,
    opts?: { anchorPath?: string | null; beforeNodeId?: string | null; repoGroupPath?: string | null },
  ) => void;
  onStartRenameFolder: (path: string) => void;
  onFolderEditorValueChange: (next: string) => void;
  onSubmitFolderEditor: () => void;
  onBlurFolderEditor: () => void;
  onCancelFolderEditor: () => void;
  folderEditor: FolderEditorState | null;
  folderEditorInputRef: React.RefObject<HTMLInputElement>;
  toggleSidebarGroupHidden: (target: { group: string; kind: 'group' | 'repo' }) => void;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => Promise<boolean> | boolean;
  busyChatNodeIdSet: Set<string>;
  approvalRequiredByChatNodeId: Record<string, boolean>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  deletingDrones: Record<string, boolean>;
  deleteOperationModeById: Record<string, DroneDeleteMode>;
  deleteMode: DroneDeleteMode;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarOptimisticDroneIdSet: Set<string>;
  uiDroneName: (nameRaw: string) => string;
  onDeleteDroneChat: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  onCloneDrone: (drone: DroneSummary) => void;
  onAddDroneToGroup: (drone: DroneSummary) => void;
  onCreateGroupBeforeDrone: (drone: DroneSummary) => void;
  onCreateDroneChat: (
    drone: DroneSummary,
    chatName: string,
    opts?: { draft?: boolean },
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onRenameDroneChat: (
    droneId: string,
    chatName: string,
    newName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  chatEditor: ChatEditorState | null;
  chatEditorInputRef: React.RefObject<HTMLInputElement>;
  onOpenCreateDroneChat: (drone: DroneSummary) => void;
  onStartRenameDroneChat: (droneId: string, chatName: string) => void;
  onChatEditorValueChange: (next: string) => void;
  onChatEditorCreateAsDraftChange: (next: boolean) => void;
  onSubmitChatEditor: () => void;
  onBlurChatEditor: () => void;
  onCancelChatEditor: () => void;
  onRenameDrone: (
    droneId: string,
    newName: string,
  ) => Promise<DroneInlineRenameResult> | DroneInlineRenameResult;
  inlineRenameDroneRequest: { droneId: string; key: number } | null;
  onSetDroneBaseImage: (droneId: string) => void;
  pinnedDroneIdSet: ReadonlySet<string>;
  pinningDroneIds: ReadonlySet<string>;
  onSetDronePinned: (droneId: string, pinned: boolean) => Promise<void>;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onPrepareDroneDragStart: (droneId: string, draggedDroneIds?: readonly string[]) => void;
  onReparentDronesToParent: (
    parentDroneId: string | null,
    droneIds: string[],
    opts?: { targetGroup?: string | null },
  ) => Promise<{ ok: boolean; error?: string | null; reparentedIds?: string[]; rollbackOptimistic?: () => void }>;
  actionsEnabled?: boolean;
};

type TreeDropPlacement = SidebarTreeDropPlacement;

type GroupedSidebarTreeContextValue = GroupedSidebarTreeProps & {
  nodeTree: SidebarNodeTreeModel;
  droneTreeByGroupPath: Record<string, SidebarDroneTree>;
  visibleDroneOrder: string[];
  dragOverTreeTarget: { nodeId: string; placement: TreeDropPlacement } | null;
  dragOverFolderBodyId: string | null;
  dragOverChat: { key: string; placement: SidebarGroupDropPlacement } | null;
  deletingChats: Record<string, boolean>;
  handleDeleteChat: (droneId: string, chatName: string) => Promise<void>;
  shouldSuppressClick: () => boolean;
};

const GroupedSidebarTreeContext = React.createContext<GroupedSidebarTreeContextValue | null>(null);

function useGroupedSidebarTreeContext(): GroupedSidebarTreeContextValue {
  const value = React.useContext(GroupedSidebarTreeContext);
  if (!value) throw new Error('GroupedSidebarTree context missing');
  return value;
}

function groupedFolderDragData(args: {
  groupId?: string | null;
  nodeId: string;
  folderPath: string;
  groupKind: 'group' | 'repo';
  label: string;
}): {
  type: 'sidebar-folder';
  groupId?: string | null;
  folderNodeId: string;
  folderPath: string;
  groupKind: 'group' | 'repo';
  label: string;
} {
  const folderNodeId = String(args.nodeId ?? '').trim();
  const folderPath = String(args.folderPath ?? '').trim();
  const label = String(args.label ?? '').trim();
  const groupKind = args.groupKind === 'repo' ? 'repo' : 'group';
  return {
    type: 'sidebar-folder',
    groupId: args.groupId ?? null,
    folderNodeId,
    folderPath,
    groupKind,
    label: label || sidebarGroupBaseName(folderPath) || folderPath,
  };
}

function collectSidebarTreeDroneIds(nodeTree: SidebarNodeTreeModel, rootNodeId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (nodeId: string) => {
    const node = nodeTree.nodesById[nodeId];
    if (!node) return;
    if (node.kind === 'drone') {
      if (!seen.has(node.droneId)) {
        seen.add(node.droneId);
        out.push(node.droneId);
      }
    }
    for (const childId of nodeTree.childIdsByParent[nodeId] ?? []) {
      visit(childId);
    }
  };
  visit(rootNodeId);
  return out;
}

type SidebarGroupStateSummary = {
  approval: number;
  unread: number;
  working: number;
};

function SidebarGroupStateCount({
  count,
  indicator,
  label,
  toneClassName,
}: {
  count: number;
  indicator: React.ReactNode;
  label: string;
  toneClassName: string;
}) {
  return (
    <span
      className={`inline-flex h-3 items-center gap-1 ${toneClassName}`}
      title={`${count} ${label}`}
      aria-label={`${count} ${label}`}
    >
      <span className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center leading-none">
        {indicator}
      </span>
      <span className="relative top-px inline-flex h-3 min-w-[2ch] items-center leading-none tabular-nums">
        {count}
      </span>
    </span>
  );
}

function SidebarGroupStateCounts({ summary }: { summary: SidebarGroupStateSummary }) {
  if (summary.approval <= 0 && summary.unread <= 0 && summary.working <= 0) return null;
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1.5 font-mono text-[.5625rem] leading-none">
      {summary.approval > 0 ? (
        <SidebarGroupStateCount
          count={summary.approval}
          indicator={<SidebarApprovalStatusIndicator />}
          label="awaiting approval"
          toneClassName="text-[var(--yellow)]"
        />
      ) : null}
      {summary.unread > 0 ? (
        <SidebarGroupStateCount
          count={summary.unread}
          indicator={<SidebarItemStateIndicator state="idle" unread />}
          label="unread"
          toneClassName="text-[var(--green)]"
        />
      ) : null}
      {summary.working > 0 ? (
        <SidebarGroupStateCount
          count={summary.working}
          indicator={<SidebarWorkingStatusIndicator />}
          label="working"
          toneClassName="text-[var(--yellow)]"
        />
      ) : null}
    </span>
  );
}

function groupedDroneDragData(args: {
  drone: DroneSummary;
  uiDroneName: (nameRaw: string) => string;
  selectedDroneIds: string[];
  selectedDroneSet: Set<string>;
  visibleDroneOrder: string[];
}): SidebarDroneDragData {
  const selectedDragDroneIds =
    args.selectedDroneSet.has(args.drone.id) && args.selectedDroneIds.length > 0
      ? [
          ...args.visibleDroneOrder.filter((id) => args.selectedDroneSet.has(id)),
          ...args.selectedDroneIds.filter((id) => !args.visibleDroneOrder.includes(id)),
        ]
      : [args.drone.id];
  return {
    type: 'sidebar-drone',
    droneId: args.drone.id,
    droneIds: selectedDragDroneIds,
    groupOrderKey: null,
    label: args.uiDroneName(args.drone.name),
  };
}

function placementFromEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  allowInto: boolean,
): TreeDropPlacement {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const overRect = event.over?.rect ?? null;
  if (!activeRect || !overRect) return allowInto ? 'into' : 'after';
  if (!allowInto) return sidebarDropPlacementFromRects(activeRect, overRect);
  const midY = activeRect.top + activeRect.height / 2;
  const topLimit = overRect.top + overRect.height * 0.28;
  const bottomLimit = overRect.top + overRect.height * 0.72;
  if (midY < topLimit) return 'before';
  if (midY > bottomLimit) return 'after';
  return 'into';
}

function activeRectMidY(event: DragMoveEvent | DragOverEvent | DragEndEvent): number | null {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  if (!activeRect) return null;
  return activeRect.top + activeRect.height / 2;
}

function groupedFolderPathFromNode(node: SidebarTreeFolderNode | null | undefined): string | null {
  if (!node) return null;
  return String(node.groupPath ?? node.path ?? '').trim() || null;
}

function flattenVisibleDroneOrderFromNodeTree(
  nodeTree: SidebarNodeTreeModel,
  collapsedGroups: Record<string, boolean>,
  rootNodeIds: readonly string[] = nodeTree.rootChildIds,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (nodeId: string) => {
    const node = nodeTree.nodesById[nodeId];
    if (!node) return;
    if (node.kind === 'drone' && !seen.has(node.droneId)) {
      seen.add(node.droneId);
      out.push(node.droneId);
    }
    if (node.kind === 'folder') {
      const folderPath = groupedFolderPathFromNode(node);
      if (isSidebarGroupCollapsed(collapsedGroups, folderPath ?? '')) return;
    }
    for (const childId of nodeTree.childIdsByParent[node.id] ?? []) visit(childId);
  };
  for (const nodeId of rootNodeIds) visit(nodeId);
  return out;
}

function resolveFolderBodyInsertionTarget(
  folderNodeIdRaw: string,
  pointerMidY: number | null,
): { nodeId: string; placement: SidebarGroupDropPlacement } | null {
  if (pointerMidY == null || typeof document === 'undefined') return null;
  const folderNodeId = String(folderNodeIdRaw ?? '').trim();
  if (!folderNodeId) return null;
  const bodyEl = document.querySelector<HTMLElement>(`[data-sidebar-folder-body="${CSS.escape(folderNodeId)}"]`);
  if (!bodyEl) return null;
  const childEls = Array.from(bodyEl.querySelectorAll<HTMLElement>(':scope > [data-sidebar-node-id]'));
  if (childEls.length === 0) return null;

  for (const childEl of childEls) {
    const childNodeId = childEl.dataset.sidebarNodeId?.trim();
    if (!childNodeId) continue;
    const anchorEl =
      childEl.querySelector<HTMLElement>(`[data-sidebar-node-anchor-id="${CSS.escape(childNodeId)}"]`) ?? childEl;
    const rect = anchorEl.getBoundingClientRect();
    if (pointerMidY < rect.top + rect.height / 2) {
      return { nodeId: childNodeId, placement: 'before' };
    }
  }

  const lastChildNodeId = childEls[childEls.length - 1]?.dataset.sidebarNodeId?.trim();
  return lastChildNodeId ? { nodeId: lastChildNodeId, placement: 'after' } : null;
}

function chatReorderDropId(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `sidebar-grouped-chat-reorder:${droneId}:${chatName}`;
}

function folderGroupPath(node: SidebarTreeFolderNode | null | undefined): string | null {
  return groupedFolderPathFromNode(node);
}

function TreeDropGuide({ placement }: { placement: SidebarGroupDropPlacement }) {
  return <SidebarReorderDropIndicator placement={placement} />;
}

type GroupedSidebarChatRowProps = { drone: DroneSummary; chatName: string; isOptimistic: boolean };

const GroupedSidebarChatRowDnd = React.memo(function GroupedSidebarChatRowDnd({ drone, chatName, isOptimistic }: GroupedSidebarChatRowProps) {
  const activeDrag = useDroneHubActiveDrag();
  const {
    sidebarDensityMode,
    uiDroneName,
    sidebarDndEnabled,
    busyChatNodeIdSet,
    unreadAgentMessageByChatNodeId,
    selectedDrone,
    activeChatName,
    selectedSidebarNodeId,
    setSelectedSidebarNodeId,
    onFocusDroneChat,
    onSelectDroneChat,
    dragOverChat,
    chatEditor,
    chatEditorInputRef,
    onStartRenameDroneChat,
    onOpenCreateDroneChat,
    onChatEditorValueChange,
    onSubmitChatEditor,
    onBlurChatEditor,
    onCancelChatEditor,
    deletingChats,
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    handleDeleteChat,
    shouldSuppressClick,
    actionsEnabled = true,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
  const locallyRequiredApproval = useChatApprovalRequired(chatNodeId);
  const approvalRequired =
    droneChatRequiresApproval(drone, chatName) || locallyRequiredApproval;
  const sidebarChatId = sidebarChatSidebarNodeId(drone.id, chatName);
  const chatDragData = React.useMemo(
    () => createSidebarChatDragData(drone.id, chatName, `${uiDroneName(drone.name)} / ${chatName}`),
    [chatName, drone.id, drone.name, uiDroneName],
  );
  const chatDndDisabled = !sidebarDndEnabled || !chatDragData || isOptimistic;
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-grouped-chat:${drone.id}:${chatName}`,
    data: chatDragData ?? undefined,
    disabled: chatDndDisabled,
  });
  const chatDropDisabled = chatDndDisabled || activeDrag?.type !== 'sidebar-chat';
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: chatReorderDropId(drone.id, chatName),
    data: {
      type: 'sidebar-chat-reorder',
      droneId: drone.id,
      chatName,
    },
    disabled: chatDropDisabled,
  });
  const active = selectedDrone === drone.id && activeChatName === chatName;
  const selected = selectedSidebarNodeId === sidebarChatId;
  const chatBusy =
    (drone.busyChats ?? []).includes(chatName) || busyChatNodeIdSet.has(chatNodeId);
  const chatUnread =
    !active &&
    ((drone.unreadChats ?? []).includes(chatName) ||
      unreadAgentMessageByChatNodeId[chatNodeId] === true);
  const chatState = sidebarChatDisplayState(drone, chatBusy, approvalRequired);
  const chatStateLabel = sidebarDroneStateLabel(chatState, chatUnread);
  const chatActionsDisabled =
    isOptimistic ||
    Boolean(deletingDrones[drone.id]) ||
    Boolean(renamingDrones[drone.id]) ||
    Boolean(settingBaseImages[drone.id]) ||
    isDroneStartingOrSeeding(drone.hubPhase);
  const draft = drone.draftChats?.[chatName] === true;
  const reorderPreviewClass =
    dragOverChat?.key === `${drone.id}:${chatName}`
      ? dragOverChat.placement === 'before'
        ? 'pt-3'
        : 'pb-3'
      : '';
  const editing = chatEditor?.mode === 'rename' && chatEditor.droneId === drone.id && chatEditor.targetChatName === chatName;

  if (editing) {
    return (
      <div className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${reorderPreviewClass}`}>
        <div className={`flex items-center gap-1 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] ${densityClasses.chatRow}`}>
          <input
            ref={chatEditorInputRef}
            type="text"
            value={chatEditor?.value ?? ''}
            onChange={(event) => onChatEditorValueChange(event.target.value)}
            onBlur={onBlurChatEditor}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmitChatEditor();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancelChatEditor();
              }
            }}
            placeholder="Chat name"
            className="min-w-0 flex-1 rounded border border-[var(--accent-muted)] bg-[var(--panel-overlay-soft)] px-2 py-1 font-mono text-[var(--text-11)] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none"
          />
          {chatEditor?.pending ? <IconSpinner className="opacity-90 text-[var(--accent)]" /> : null}
        </div>
        {chatEditor?.error ? <div className="px-1 text-[var(--text-10)] text-[var(--red)]">{chatEditor.error}</div> : null}
      </div>
    );
  }

  return (
    <div ref={chatDropDisabled ? undefined : setDropNodeRef} className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${reorderPreviewClass}`}>
      <div className="relative flex items-stretch gap-1 group/chat-row">
        {dragOverChat?.key === `${drone.id}:${chatName}` ? <TreeDropGuide placement={dragOverChat.placement} /> : null}
        <button
          ref={chatDndDisabled ? undefined : setDragNodeRef}
          type="button"
          {...(chatDndDisabled ? {} : attributes as unknown as Record<string, unknown>)}
          {...(chatDndDisabled ? {} : listeners as unknown as Record<string, unknown>)}
          onClick={(event) => {
            event.stopPropagation();
            if (shouldSuppressClick()) return;
            setSelectedSidebarNodeId(sidebarChatId);
            onSelectDroneChat(drone.id, chatName);
          }}
          onContextMenu={(event) => {
            if (!actionsEnabled) return;
            event.preventDefault();
            event.stopPropagation();
            onFocusDroneChat(drone.id, chatName);
            setContextMenuPosition({ x: event.clientX, y: event.clientY });
          }}
          className={`relative flex flex-1 items-center gap-1 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ selected, active })} ${isDragging ? 'opacity-35' : ''} ${!sidebarDndEnabled || !chatDragData || isOptimistic ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
          aria-label={`${uiDroneName(drone.name)} / ${chatName}`}
          aria-current={active ? 'page' : undefined}
        >
          {selected ? <span className={sidebarSelectionEdgeClass} /> : null}
          <span
            className={sidebarChatStateClass}
            title={chatStateLabel}
            role="img"
            aria-label={chatStateLabel}
          >
            <SidebarItemStateIndicator
              state={chatState}
              unread={chatUnread}
              showReadyAnchor
              emphasized={selected}
            />
          </span>
          <span className={sidebarChatLabelClass}>{chatName}</span>
          {draft ? (
            <span className="flex-shrink-0 rounded border border-[var(--accent-muted)] px-1 py-0.5 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)]">
              Draft
            </span>
          ) : null}
        </button>
      </div>
      {contextMenuPosition ? (
        <SidebarContextMenu
          x={contextMenuPosition.x}
          y={contextMenuPosition.y}
          label={`Actions for ${chatName}`}
          items={[
            {
              id: 'create-chat',
              label: 'Create chat',
              icon: <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />,
              disabled: chatActionsDisabled,
              onSelect: () => onOpenCreateDroneChat(drone),
            },
            {
              id: 'rename-chat',
              label: 'Rename chat',
              shortcut: 'F2',
              separatorBefore: true,
              icon: <IconPencil className="h-3.5 w-3.5 text-[var(--info)]" />,
              disabled: chatName === 'default' || chatActionsDisabled,
              onSelect: () => onStartRenameDroneChat(drone.id, chatName),
            },
            {
              id: 'delete-chat',
              label: 'Delete chat',
              separatorBefore: true,
              icon: deletingChats[`${drone.id}:${chatName}`] ? (
                <IconSpinner className="h-3.5 w-3.5" />
              ) : (
                <IconTrash className="h-3.5 w-3.5" />
              ),
              disabled:
                chatName === 'default' ||
                chatActionsDisabled ||
                Boolean(deletingChats[`${drone.id}:${chatName}`]),
              tone: 'danger',
              onSelect: () => void handleDeleteChat(drone.id, chatName),
            },
          ]}
          onClose={() => setContextMenuPosition(null)}
        />
      ) : null}
    </div>
  );
});

const GroupedSidebarChatRowStatic = React.memo(function GroupedSidebarChatRowStatic({ drone, chatName }: GroupedSidebarChatRowProps) {
  const {
    sidebarDensityMode,
    uiDroneName,
    busyChatNodeIdSet,
    unreadAgentMessageByChatNodeId,
    selectedDrone,
    activeChatName,
    selectedSidebarNodeId,
    setSelectedSidebarNodeId,
    onSelectDroneChat,
    shouldSuppressClick,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
  const locallyRequiredApproval = useChatApprovalRequired(chatNodeId);
  const approvalRequired =
    droneChatRequiresApproval(drone, chatName) || locallyRequiredApproval;
  const sidebarChatId = sidebarChatSidebarNodeId(drone.id, chatName);
  const active = selectedDrone === drone.id && activeChatName === chatName;
  const selected = selectedSidebarNodeId === sidebarChatId;
  const chatBusy =
    (drone.busyChats ?? []).includes(chatName) || busyChatNodeIdSet.has(chatNodeId);
  const chatUnread =
    !active &&
    ((drone.unreadChats ?? []).includes(chatName) ||
      unreadAgentMessageByChatNodeId[chatNodeId] === true);
  const chatState = sidebarChatDisplayState(drone, chatBusy, approvalRequired);
  const chatStateLabel = sidebarDroneStateLabel(chatState, chatUnread);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="relative flex items-stretch gap-1 group/chat-row">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (shouldSuppressClick()) return;
            setSelectedSidebarNodeId(sidebarChatId);
            onSelectDroneChat(drone.id, chatName);
          }}
          className={`relative flex flex-1 items-center gap-1 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ selected, active })}`}
          aria-label={`${uiDroneName(drone.name)} / ${chatName}`}
          aria-current={active ? 'page' : undefined}
        >
          {selected ? <span className={sidebarSelectionEdgeClass} /> : null}
          <span
            className={sidebarChatStateClass}
            title={chatStateLabel}
            role="img"
            aria-label={chatStateLabel}
          >
            <SidebarItemStateIndicator
              state={chatState}
              unread={chatUnread}
              showReadyAnchor
              emphasized={selected}
            />
          </span>
          <span className={sidebarChatLabelClass}>{chatName}</span>
        </button>
      </div>
    </div>
  );
});

const GroupedSidebarChatRow = React.memo(function GroupedSidebarChatRow(props: GroupedSidebarChatRowProps) {
  const { sidebarDndEnabled, actionsEnabled = true } = useGroupedSidebarTreeContext();
  return sidebarDndEnabled || actionsEnabled
    ? <GroupedSidebarChatRowDnd {...props} />
    : <GroupedSidebarChatRowStatic {...props} />;
});

const GroupedSidebarDroneRow = React.memo(function GroupedSidebarDroneRow({ node, groupPath, nested = false }: { node: SidebarTreeDroneNode; groupPath: string | null; nested?: boolean }) {
  const activeDrag = useDroneHubActiveDrag();
  const {
    sidebarDensityMode,
    droneById,
    sidebarOptimisticDroneIdSet,
    movingDroneGroups,
    sidebarDndEnabled,
    uiDroneName,
    selectedDroneIds,
    selectedDroneSet,
    highlightedDroneIds,
    visibleDroneOrder,
    sidebarChatOrderByDrone,
    busyChatNodeIdSet,
    approvalRequiredByChatNodeId,
    unreadAgentMessageByChatNodeId,
    deletingDrones,
    deleteOperationModeById,
    deleteMode,
    renamingDrones,
    settingBaseImages,
    collapsedDroneSections,
    setCollapsedDroneSections,
    onToggleDroneSection,
    chatEditor,
    selectedSidebarNodeId,
    selectedFolderPath,
    setSelectedSidebarNodeId,
    onSelectDroneCard,
    onSelectDroneContainer,
    selectedDrone,
    activeChatName,
    onCloneDrone,
    onAddDroneToGroup,
    onCreateGroupBeforeDrone,
    onOpenCreateDroneChat,
    onChatEditorValueChange,
    onChatEditorCreateAsDraftChange,
    onSubmitChatEditor,
    onBlurChatEditor,
    onCancelChatEditor,
    chatEditorInputRef,
    onRenameDrone,
    inlineRenameDroneRequest,
    onSetDroneBaseImage,
    pinnedDroneIdSet,
    pinningDroneIds,
    onSetDronePinned,
    onDeleteDrone,
    onOpenDroneErrorModal,
    dragOverTreeTarget,
    nodeTree,
    shouldSuppressClick,
    actionsEnabled = true,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const drone = droneById[node.droneId];
  if (!drone) return null;
  const isOptimistic = sidebarOptimisticDroneIdSet.has(drone.id);
  const dragDisabled = !sidebarDndEnabled || isOptimistic;
  const dragData = React.useMemo(
    () =>
      groupedDroneDragData({
        drone,
        uiDroneName,
        selectedDroneIds,
        selectedDroneSet,
        visibleDroneOrder,
      }),
    [drone, selectedDroneIds, selectedDroneSet, uiDroneName, visibleDroneOrder],
  );
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-grouped-drone:${drone.id}`,
    data: dragData,
    disabled: dragDisabled,
  });
  const droneDropDisabled = !sidebarDndEnabled;
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `sidebar-tree-node:${node.id}`,
    data: {
      type: 'sidebar-tree-node',
      nodeId: node.id,
      kind: 'drone',
      parentId: node.parentId,
    },
    disabled: droneDropDisabled,
  });
  const chats = orderSidebarEntries(
    normalizedDroneChats(drone),
    sidebarChatOrderByDrone[drone.id] ?? [],
    (chat) => chat,
  );
  const chatTailDropDisabled = !sidebarDndEnabled || chats.length <= 1;
  const { setNodeRef: setChatTailDropNodeRef, isOver: isChatTailOver } = useDroppable({
    id: `sidebar-tree-drone-tail:${node.id}`,
    data: {
      type: 'sidebar-tree-drone-tail',
      nodeId: node.id,
      parentId: node.parentId,
    },
    disabled: chatTailDropDisabled,
  });
  const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
  const hasChatSection = chats.length > 1;
  const chatSectionExpanded = collapsedDroneSections[sidebarInlineSectionKey(drone.id, 'chats')] !== true;
  const showCreateChatEditor = chatEditor?.mode === 'create' && chatEditor.droneId === drone.id;
  const defaultChatNodeId = createCanvasChatNodeId(drone.id, 'default');
  const locallyRequiredDefaultChatApproval = useChatApprovalRequired(defaultChatNodeId);
  const defaultChatApprovalRequired =
    droneChatRequiresApproval(drone, 'default') || locallyRequiredDefaultChatApproval;
  const showBusy =
    !isDroneStartingOrSeeding(drone.hubPhase) && hasOnlyDefaultChat && busyChatNodeIdSet.has(defaultChatNodeId);
  const showUnread = hasOnlyDefaultChat && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true;
  const chatStateSummary = React.useMemo<SidebarGroupStateSummary>(() => {
    const summary: SidebarGroupStateSummary = { approval: 0, unread: 0, working: 0 };
    if (hasOnlyDefaultChat) return summary;
    for (const chatName of chats) {
      const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
      const approval =
        droneChatRequiresApproval(drone, chatName) ||
        Boolean(approvalRequiredByChatNodeId[chatNodeId]);
      const working =
        !approval &&
        ((drone.busyChats ?? []).includes(chatName) || busyChatNodeIdSet.has(chatNodeId));
      const active = selectedDrone === drone.id && activeChatName === chatName;
      const unread =
        !active &&
        ((drone.unreadChats ?? []).includes(chatName) ||
          unreadAgentMessageByChatNodeId[chatNodeId] === true);
      if (approval) summary.approval += 1;
      if (unread) summary.unread += 1;
      if (working) summary.working += 1;
    }
    if (summary.working > 0) summary.unread = 0;
    return summary;
  }, [
    activeChatName,
    approvalRequiredByChatNodeId,
    busyChatNodeIdSet,
    chats,
    drone,
    hasOnlyDefaultChat,
    selectedDrone,
    unreadAgentMessageByChatNodeId,
  ]);
  const childDroneIds = (nodeTree.childIdsByParent[node.id] ?? [])
    .map((childNodeId) => nodeTree.nodesById[childNodeId])
    .filter((child): child is SidebarTreeDroneNode => Boolean(child && child.kind === 'drone'));
  // Multi-chat parents are selectable containers, while ordinary drone styling
  // continues to follow the actual multi-selection used by drag and bulk actions.
  const selected = hasChatSection
    ? selectedSidebarNodeId === node.id
    : selectedDroneSet.has(drone.id);
  const showOpenDefaultChatIndicator =
    hasOnlyDefaultChat && selectedDrone === drone.id && activeChatName === 'default';
  const hasActiveChildChat = selectedDrone === drone.id && !hasOnlyDefaultChat;
  const showCollapsedActiveChatIndicator = hasActiveChildChat && !chatSectionExpanded;
  const onDeleteDroneRef = React.useRef(onDeleteDrone);
  onDeleteDroneRef.current = onDeleteDrone;
  const handleDeleteDrone = React.useCallback(() => {
    onDeleteDroneRef.current(drone.id);
  }, [drone.id]);
  const reorderPreviewClass =
    dragOverTreeTarget?.nodeId === node.id
      ? dragOverTreeTarget.placement === 'before'
        ? 'pt-3'
        : dragOverTreeTarget.placement === 'after'
          ? 'pb-3'
          : ''
      : isChatTailOver
        ? 'pb-3'
        : '';
  const showChatTailPreview =
    isChatTailOver && (activeDrag?.type === 'sidebar-drone' || activeDrag?.type === 'sidebar-folder');
  const showAfterPreview =
    (dragOverTreeTarget?.nodeId === node.id && dragOverTreeTarget.placement === 'after') || showChatTailPreview;
  return (
    <div
      data-sidebar-drone-unit="true"
      className={`flex flex-col gap-0 transition-[margin] duration-150 ${nested ? densityClasses.nestedDroneIndent : ''} ${reorderPreviewClass}`}
    >
      <div ref={droneDropDisabled ? undefined : setDropNodeRef} data-sidebar-node-anchor-id={node.id} className="relative">
        {dragOverTreeTarget?.nodeId === node.id &&
        (dragOverTreeTarget.placement === 'before' || dragOverTreeTarget.placement === 'after') ? (
          <TreeDropGuide placement={dragOverTreeTarget.placement} />
        ) : null}
        <div className={hasChatSection && groupPath ? '[--sidebar-selection-edge-offset:-1px]' : undefined}>
          <DroneCard
            drone={drone}
            density={sidebarDensityMode}
            displayName={uiDroneName(drone.name)}
            selected={selected}
            highlighted={highlightedDroneIds.has(drone.id)}
            active={showOpenDefaultChatIndicator || showCollapsedActiveChatIndicator}
            activeIndicatorStyle="edge"
            disclosureExpanded={hasChatSection ? chatSectionExpanded : undefined}
            disclosureLabel={
              hasChatSection
                ? `${chatSectionExpanded ? 'Collapse' : 'Expand'} chats for ${uiDroneName(drone.name)}`
                : undefined
            }
            busy={showBusy}
            approvalRequired={hasOnlyDefaultChat && defaultChatApprovalRequired}
            operationLabel={
              deletingDrones[drone.id]
                ? ((deleteOperationModeById[drone.id] ?? deleteMode) === 'archive' ? 'Archiving' : 'Deleting')
                : undefined
            }
            chatStateSummary={hasOnlyDefaultChat ? undefined : chatStateSummary}
            unreadAgentMessage={showUnread}
            onClick={(rowOpts) => {
              if (shouldSuppressClick()) return;
              if (hasChatSection) {
                onSelectDroneContainer(drone.id);
                onToggleDroneSection(drone.id, 'chats');
                return;
              }
              setSelectedSidebarNodeId(node.id);
              onSelectDroneCard(drone.id, { ...rowOpts, orderedDroneIds: visibleDroneOrder });
            }}
            dragNodeRef={dragDisabled ? undefined : setDragNodeRef}
            draggable={!dragDisabled}
            dragging={isDragging}
            dragAttributes={dragDisabled ? undefined : attributes as unknown as Record<string, unknown>}
            dragListeners={dragDisabled ? undefined : listeners as unknown as Record<string, unknown>}
            onCreateChat={
              actionsEnabled
                ? () => {
                    setCollapsedDroneSections((prev) => ({
                      ...prev,
                      [sidebarInlineSectionKey(drone.id, 'chats')]: false,
                    }));
                    onOpenCreateDroneChat(drone);
                  }
                : undefined
            }
            onClone={actionsEnabled ? () => onCloneDrone(drone) : undefined}
            onAddToGroup={actionsEnabled ? () => onAddDroneToGroup(drone) : undefined}
            onCreateGroup={actionsEnabled ? () => onCreateGroupBeforeDrone(drone) : undefined}
            onRename={actionsEnabled ? (newName) => onRenameDrone(drone.id, newName) : undefined}
            inlineRenameRequestKey={
              inlineRenameDroneRequest?.droneId === drone.id
                ? inlineRenameDroneRequest.key
                : 0
            }
            onSetBaseImage={actionsEnabled ? () => onSetDroneBaseImage(drone.id) : undefined}
            pinned={pinnedDroneIdSet.has(drone.id)}
            pinBusy={pinningDroneIds.has(drone.id)}
            onTogglePinned={
              actionsEnabled
                ? () => void onSetDronePinned(drone.id, !pinnedDroneIdSet.has(drone.id))
                : undefined
            }
            onDelete={actionsEnabled ? handleDeleteDrone : undefined}
            onErrorClick={onOpenDroneErrorModal}
            cloneDisabled={
              isOptimistic ||
              Boolean(deletingDrones[drone.id]) ||
              Boolean(renamingDrones[drone.id]) ||
              Boolean(settingBaseImages[drone.id]) ||
              String(drone.runtime ?? 'container').trim().toLowerCase() === 'host'
            }
            createChatDisabled={
              isOptimistic ||
              Boolean(deletingDrones[drone.id]) ||
              Boolean(renamingDrones[drone.id]) ||
              Boolean(settingBaseImages[drone.id]) ||
              isDroneStartingOrSeeding(drone.hubPhase)
            }
            addToGroupDisabled={
              isOptimistic ||
              movingDroneGroups ||
              Boolean(deletingDrones[drone.id]) ||
              Boolean(renamingDrones[drone.id]) ||
              Boolean(settingBaseImages[drone.id]) ||
              isDroneStartingOrSeeding(drone.hubPhase)
            }
            renameDisabled={
              Boolean(deletingDrones[drone.id]) ||
              Boolean(renamingDrones[drone.id]) ||
              Boolean(settingBaseImages[drone.id])
            }
            renameBusy={Boolean(renamingDrones[drone.id])}
            setBaseImageDisabled={
              isOptimistic ||
              Boolean(deletingDrones[drone.id]) ||
              Boolean(renamingDrones[drone.id]) ||
              Boolean(settingBaseImages[drone.id]) ||
              isDroneStartingOrSeeding(drone.hubPhase)
            }
            setBaseImageBusy={Boolean(settingBaseImages[drone.id])}
            deleteDisabled={
              isOptimistic ||
              Boolean(deletingDrones[drone.id]) ||
              Boolean(renamingDrones[drone.id]) ||
              Boolean(settingBaseImages[drone.id])
            }
            deleteBusy={Boolean(deletingDrones[drone.id])}
          />
        </div>
      </div>
      {(chats.length > 1 && chatSectionExpanded) || showCreateChatEditor ? (
        <div
          ref={chatTailDropDisabled ? undefined : setChatTailDropNodeRef}
          data-sidebar-chat-rail="true"
          data-sidebar-guide-selected={hasActiveChildChat ? 'true' : undefined}
          data-sidebar-guide-drop-active={isChatTailOver ? 'true' : undefined}
          className={`${densityClasses.chatIndent} dh-sidebar-drone-chat-body flex flex-col gap-0 border-l [--sidebar-selection-edge-offset:-1px]`}
        >
          {showCreateChatEditor ? (
            <div className="flex flex-col gap-0.5">
              <div className={`flex items-center gap-1 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] ${densityClasses.chatRow}`}>
                <input
                  ref={chatEditorInputRef}
                  type="text"
                  value={chatEditor?.value ?? ''}
                  onChange={(event) => onChatEditorValueChange(event.target.value)}
                  onBlur={onBlurChatEditor}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSubmitChatEditor();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      onCancelChatEditor();
                    }
                  }}
                  placeholder="Chat name"
                  className="min-w-0 flex-1 rounded border border-[var(--accent-muted)] bg-[var(--panel-overlay-soft)] px-2 py-1 font-mono text-[var(--text-11)] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none"
                />
                {chatEditor?.pending ? <IconSpinner className="opacity-90 text-[var(--accent)]" /> : null}
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChatEditorCreateAsDraftChange(chatEditor?.createAsDraft !== true)}
                disabled={chatEditor?.pending}
                className="flex items-center gap-1.5 px-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)] disabled:opacity-50"
              >
                <span
                  className={`h-3 w-3 rounded-sm border ${
                    chatEditor?.createAsDraft === true
                      ? 'border-[var(--accent)] bg-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-soft)]'
                  }`}
                />
                Draft
              </button>
              {chatEditor?.error ? <div className="px-1 text-[var(--text-10)] text-[var(--red)]">{chatEditor.error}</div> : null}
            </div>
          ) : null}
          {chats.map((chatName) => (
            <GroupedSidebarChatRow key={`${drone.id}:${chatName}`} drone={drone} chatName={chatName} isOptimistic={isOptimistic} />
          ))}
        </div>
      ) : null}
      {childDroneIds.length > 0 ? (
        <div className={`${densityClasses.nestedDroneRail} flex flex-col gap-0 border-l border-[var(--border-subtle)]`}>
          {childDroneIds.map((childNode) => (
            <GroupedSidebarDroneRow
              key={childNode.id}
              node={childNode}
              groupPath={groupPath}
              nested={true}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

function GroupedSidebarGroupDraftRow() {
  const {
    folderEditor,
    folderEditorInputRef,
    onFolderEditorValueChange,
    onSubmitFolderEditor,
    onBlurFolderEditor,
    onCancelFolderEditor,
  } = useGroupedSidebarTreeContext();
  if (!folderEditor || folderEditor.mode !== 'create') return null;

  return (
    <div className="flex flex-col gap-0">
      <div className="flex min-h-8 items-center gap-1.5 px-1.5">
        <IconChevron
          strokeWidth={1.25}
          className="h-4 w-4 translate-x-px flex-shrink-0 text-[var(--muted-dim)] opacity-72"
        />
        <input
          ref={folderEditorInputRef}
          data-sidebar-group-draft-input="true"
          value={folderEditor.value}
          onChange={(event) => onFolderEditorValueChange(event.target.value)}
          onBlur={onBlurFolderEditor}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmitFolderEditor();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancelFolderEditor();
            }
          }}
          maxLength={64}
          placeholder={folderEditor.parentPath ? 'Subfolder name' : 'Folder name'}
          aria-label="New group name"
          className="min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 text-[var(--text-11)] text-[var(--fg)] shadow-none outline-none ring-0 placeholder:text-[var(--muted-dim)] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          style={{ border: 0, outline: 'none', boxShadow: 'none' }}
        />
      </div>
      {folderEditor.error ? (
        <div className="px-1 text-[var(--text-10)] text-[var(--red)]">{folderEditor.error}</div>
      ) : null}
    </div>
  );
}

function GroupedSidebarChildEntries({
  childIds,
  groupPath,
  showCreateInline,
}: {
  childIds: string[];
  groupPath: string | null;
  showCreateInline: boolean;
}) {
  const { folderEditor } = useGroupedSidebarTreeContext();
  const beforeNodeId = showCreateInline ? folderEditor?.beforeNodeId ?? null : null;
  const renderDraftFirst =
    showCreateInline && (!beforeNodeId || !childIds.includes(beforeNodeId));

  return (
    <>
      {renderDraftFirst ? <GroupedSidebarGroupDraftRow /> : null}
      {childIds.map((childId) => (
        <React.Fragment key={childId}>
          {showCreateInline && beforeNodeId === childId ? (
            <GroupedSidebarGroupDraftRow />
          ) : null}
          <div data-sidebar-node-id={childId}>
            <GroupedSidebarNodeEntry nodeId={childId} groupPath={groupPath} />
          </div>
        </React.Fragment>
      ))}
    </>
  );
}

function GroupedSidebarFolderBodyDropZone({
  nodeId,
  disabled,
  className,
  selectedDirectChild,
  dropActive,
  children,
}: {
  nodeId: string;
  disabled: boolean;
  className: string;
  selectedDirectChild: boolean;
  dropActive: boolean;
  children: React.ReactNode;
}) {
  const dropDisabled = disabled;
  const { setNodeRef } = useDroppable({
    id: `sidebar-tree-folder-body:${nodeId}`,
    data: {
      type: 'sidebar-tree-folder-body',
      nodeId,
    },
    disabled: dropDisabled,
  });

  return (
    <div
      ref={dropDisabled ? undefined : setNodeRef}
      data-sidebar-folder-body={nodeId}
      data-sidebar-guide-selected={selectedDirectChild ? 'true' : undefined}
      data-sidebar-guide-drop-active={dropActive ? 'true' : undefined}
      className={className}
    >
      {children}
    </div>
  );
}

function GroupedSidebarFolderRow({ node }: { node: SidebarTreeFolderNode }) {
  const activeDrag = useDroneHubActiveDrag();
  const shortcutBindings = useDroneHubUiStore((state) => state.shortcutBindings);
  const {
    sidebarDensityMode,
    collapsedGroups,
    sidebarDndEnabled,
    deletingGroups,
    renamingGroups,
    hiddenSidebarGroupTokenSet,
    selectedSidebarNodeId,
    selectedFolderPath,
    selectedDroneIds,
    selectedDroneSet,
    selectedDrone,
    setSelectedSidebarNodeId,
    onSelectFolder,
    onToggleGroupCollapsed,
    folderEditor,
    folderEditorInputRef,
    onFolderEditorValueChange,
    onSubmitFolderEditor,
    onBlurFolderEditor,
    onCancelFolderEditor,
    nodeTree,
    dragOverTreeTarget,
    dragOverFolderBodyId,
    onOpenFolderCreate,
    onStartRenameFolder,
    toggleSidebarGroupHidden,
    onOpenGroupMultiChat,
    onDeleteGroup,
    droneById,
    busyChatNodeIdSet,
    approvalRequiredByChatNodeId,
    unreadAgentMessageByChatNodeId,
    deletingDrones,
    shouldSuppressClick,
    actionsEnabled = true,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const folderPath = folderGroupPath(node) ?? node.path;
  const isVirtualGroup = node.groupKind === 'repo' && !node.groupPath;
  const allowVirtualRepoReorderDrop =
    isVirtualGroup && activeDrag?.type === 'sidebar-folder' && activeDrag.groupKind === 'repo';
  const groupRef = React.useMemo(
    () => ({ groupId: node.groupId, group: folderPath, kind: node.groupKind }),
    [folderPath, node.groupId, node.groupKind],
  );
  const groupToken = React.useMemo(() => sidebarGroupOrderToken(groupRef), [groupRef]);
  const collapsed = isSidebarGroupCollapsed(collapsedGroups, folderPath);
  const folderDroneIds = React.useMemo(() => collectSidebarTreeDroneIds(nodeTree, node.id), [node.id, nodeTree]);
  const stateSummary = React.useMemo<SidebarGroupStateSummary>(() => {
    const summary: SidebarGroupStateSummary = { approval: 0, unread: 0, working: 0 };
    for (const droneId of folderDroneIds) {
      const drone = droneById[droneId];
      if (!drone) continue;
      const chats = normalizedDroneChats(drone, { includeDefaultWhenEmpty: true });
      const approval = chats.some((chatName) => {
        const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
        return (
          droneChatRequiresApproval(drone, chatName) ||
          Boolean(approvalRequiredByChatNodeId[chatNodeId])
        );
      });
      const working =
        !approval &&
        (Boolean(drone.busy) ||
          (drone.busyChats?.length ?? 0) > 0 ||
          chats.some((chatName) =>
            busyChatNodeIdSet.has(createCanvasChatNodeId(drone.id, chatName)),
          ) ||
          drone.hubPhase === 'creating' ||
          drone.hubPhase === 'starting' ||
          drone.hubPhase === 'seeding' ||
          Boolean(deletingDrones[drone.id]));
      const inactiveDisplayState = sidebarDroneDisplayState(drone, false, '', false, false);
      const unread =
        !working &&
        inactiveDisplayState !== 'blocked' &&
        inactiveDisplayState !== 'offline' &&
        ((drone.unreadChats?.length ?? 0) > 0 ||
          chats.some((chatName) =>
            Boolean(
              unreadAgentMessageByChatNodeId[createCanvasChatNodeId(drone.id, chatName)],
            ),
          ));
      if (approval) summary.approval += 1;
      if (unread) summary.unread += 1;
      if (working) summary.working += 1;
    }
    return summary;
  }, [
    approvalRequiredByChatNodeId,
    busyChatNodeIdSet,
    deletingDrones,
    droneById,
    folderDroneIds,
    unreadAgentMessageByChatNodeId,
  ]);
  const folderDroneSelected = folderDroneIds.length > 0 && folderDroneIds.every((droneId) => selectedDroneSet.has(droneId));
  const isSelected = selectedSidebarNodeId === node.id || selectedFolderPath === folderPath || folderDroneSelected;
  const isHiddenGroup = hiddenSidebarGroupTokenSet.has(groupToken);
  const showEditorInline = folderEditor?.targetPath === folderPath && folderEditor.mode === 'rename';
  const showCreateInline = (folderEditor?.anchorPath ?? folderEditor?.parentPath) === folderPath && folderEditor?.mode === 'create';
  const childIds = nodeTree.childIdsByParent[node.id] ?? [];
  const hasSelectedDirectChild = childIds.some((childId) => {
    const child = nodeTree.nodesById[childId];
    if (!child) return false;
    if (selectedSidebarNodeId === childId) return true;
    return child.kind === 'drone' &&
      (selectedDroneSet.has(child.droneId) || selectedDrone === child.droneId);
  });
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{ x: number; y: number } | null>(null);
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-folder:${node.id}`,
    data:
      folderDroneSelected && folderDroneIds.length > 0
        ? {
            type: 'sidebar-drone',
            droneId: folderDroneIds[0],
            droneIds: selectedDroneIds.length > 0 ? selectedDroneIds : folderDroneIds,
            groupOrderKey: null,
            label: node.label,
          }
        : groupedFolderDragData({ groupId: node.groupId, nodeId: node.id, folderPath, groupKind: node.groupKind, label: node.label }),
    disabled: !sidebarDndEnabled,
  });
  const folderDndDisabled = !sidebarDndEnabled;
  const folderDropDisabled = !sidebarDndEnabled || (isVirtualGroup ? !allowVirtualRepoReorderDrop : false);
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `sidebar-tree-node:${node.id}`,
    data: {
      type: 'sidebar-tree-node',
      nodeId: node.id,
      kind: 'folder',
      parentId: node.parentId,
    },
    disabled: folderDropDisabled,
  });
  const setHeaderRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      if (!folderDndDisabled) setDragNodeRef(element);
      if (!folderDropDisabled) setDropNodeRef(element);
    },
    [folderDndDisabled, folderDropDisabled, setDragNodeRef, setDropNodeRef],
  );
  const intoState =
    dragOverFolderBodyId === node.id ||
    (dragOverTreeTarget?.nodeId === node.id && dragOverTreeTarget.placement === 'into');
  const reorderPreviewClass =
    dragOverTreeTarget?.nodeId === node.id
      ? dragOverTreeTarget.placement === 'before'
        ? 'pt-3'
        : dragOverTreeTarget.placement === 'after'
          ? 'pb-3'
          : ''
      : '';
  const handleFolderClick = React.useCallback((opts?: SidebarFolderSelectionOptions) => {
    if (shouldSuppressClick()) return;
    setSelectedSidebarNodeId(node.id);
    onSelectFolder(folderPath, opts);
    if (!opts?.selectDrones) {
      onToggleGroupCollapsed(folderPath);
    }
  }, [folderPath, node.id, onSelectFolder, onToggleGroupCollapsed, setSelectedSidebarNodeId, shouldSuppressClick]);
  const contextMenuItems: SidebarContextMenuItem[] = [
    {
      id: 'new-group',
      label: isVirtualGroup ? 'New group' : 'New subfolder',
      shortcut: shortcutBindings.createDraftGroup
        ? formatShortcutBinding(shortcutBindings.createDraftGroup)
        : undefined,
      icon: <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />,
      onSelect: () =>
        onOpenFolderCreate(
          isVirtualGroup ? null : folderPath,
          isVirtualGroup
            ? { anchorPath: folderPath, repoGroupPath: node.repoGroupPath }
            : node.repoGroupPath
              ? { repoGroupPath: node.repoGroupPath }
              : undefined,
        ),
    },
    ...(!isVirtualGroup
      ? [{
          id: 'rename',
          label: 'Rename',
          shortcut: 'F2',
          separatorBefore: true,
          icon: renamingGroups[folderPath] ? (
            <IconSpinner className="h-3.5 w-3.5 text-[var(--info)]" />
          ) : (
            <IconPencil className="h-3.5 w-3.5 text-[var(--info)]" />
          ),
          disabled: Boolean(deletingGroups[folderPath]) || Boolean(renamingGroups[folderPath]),
          onSelect: () => onStartRenameFolder(folderPath),
        } satisfies SidebarContextMenuItem]
      : []),
    {
      id: 'visibility',
      label: isHiddenGroup ? 'Unhide group' : 'Hide group',
      separatorBefore: isVirtualGroup,
      icon: isHiddenGroup ? (
        <IconEye className="h-3.5 w-3.5 text-[var(--accent)]" />
      ) : (
        <IconEyeOff className="h-3.5 w-3.5 text-[var(--muted)]" />
      ),
      onSelect: () => toggleSidebarGroupHidden(groupRef),
    },
    {
      id: 'multi-chat',
      label: 'Open multi-chat',
      shortcut: shortcutBindings.openHoveredGroupMultiChat
        ? formatShortcutBinding(shortcutBindings.openHoveredGroupMultiChat)
        : undefined,
      separatorBefore: true,
      icon: <IconColumns className="h-3.5 w-3.5 text-[var(--accent)]" />,
      onSelect: () => onOpenGroupMultiChat(folderPath),
    },
    {
      id: 'delete',
      label: 'Delete group',
      shortcut: 'Delete',
      separatorBefore: true,
      icon: deletingGroups[folderPath] ? (
        <IconSpinner className="h-3.5 w-3.5" />
      ) : (
        <IconTrash className="h-3.5 w-3.5" />
      ),
      disabled: Boolean(deletingGroups[folderPath]) || Boolean(renamingGroups[folderPath]),
      tone: 'danger',
      onSelect: () => {
        void onDeleteGroup(folderPath, node.totalDroneCount, {
          kind: node.groupKind,
          label: node.label,
          repoPath:
            isVirtualGroup && node.path.startsWith('repo:') && node.path !== 'repo:ungrouped'
              ? node.path.slice('repo:'.length)
              : null,
        });
      },
    },
  ];

  return (
    <div
      data-sidebar-folder-node={node.id}
      className={`flex flex-col gap-0 transition-[margin] duration-150 ${reorderPreviewClass}`}
    >
      <div ref={setHeaderRef} data-sidebar-node-anchor-id={node.id} className="relative">
        {dragOverTreeTarget?.nodeId === node.id &&
        (dragOverTreeTarget.placement === 'before' || dragOverTreeTarget.placement === 'after') ? (
          <TreeDropGuide placement={dragOverTreeTarget.placement} />
        ) : null}
        <div
          className={`dh-sidebar-row-interactive group/folder-row relative flex items-center gap-1 rounded-[var(--sidebar-row-radius)] pr-0.5 transition-colors ${densityClasses.folderRow} ${
            showEditorInline
              ? 'border border-transparent'
              : intoState
              ? 'bg-[var(--accent-subtle)] ring-1 ring-[var(--accent-muted)]'
              : isSelected
                ? 'dh-sidebar-row-selected border border-transparent'
                : 'border border-transparent'
          } ${isDragging ? 'opacity-60' : isHiddenGroup ? 'opacity-70' : ''}`}
          onContextMenu={(event) => {
            if (!actionsEnabled || event.target instanceof HTMLInputElement) return;
            event.preventDefault();
            event.stopPropagation();
            if (!isSelected) onSelectFolder(folderPath);
            setSelectedSidebarNodeId(node.id);
            setContextMenuPosition({ x: event.clientX, y: event.clientY });
          }}
        >
          {isSelected ? <span className={sidebarSelectionEdgeClass} /> : null}
          {showEditorInline && folderEditor ? (
            <div className={`min-w-0 flex-1 rounded text-left ${densityClasses.folderPaddingX}`}>
              <div className="flex min-w-0 items-center gap-1.5">
                <IconChevron
                  down={!collapsed}
                  strokeWidth={1.25}
                  className={`flex-shrink-0 ${densityClasses.folderChevron}`}
                />
                <input
                  ref={folderEditorInputRef}
                  value={folderEditor.value}
                  onChange={(event) => onFolderEditorValueChange(event.target.value)}
                  onBlur={onBlurFolderEditor}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSubmitFolderEditor();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      onCancelFolderEditor();
                    }
                  }}
                  maxLength={64}
                  aria-label="Group name"
                  className={`min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 text-[var(--fg)] shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${densityClasses.folderInput}`}
                  style={{ border: 0, outline: 'none', boxShadow: 'none' }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`min-w-0 flex-1 rounded text-left ${densityClasses.folderPaddingX}`}
              aria-expanded={!collapsed}
              aria-selected={isSelected}
              onClick={(event) => {
                const toggle = event.metaKey || event.ctrlKey;
                handleFolderClick({
                  selectDrones: toggle || event.shiftKey,
                  toggle,
                });
              }}
              {...(folderDndDisabled ? {} : attributes as unknown as Record<string, unknown>)}
              {...(folderDndDisabled ? {} : listeners as unknown as Record<string, unknown>)}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <IconChevron
                  down={!collapsed}
                  strokeWidth={1.25}
                  className={`flex-shrink-0 ${densityClasses.folderChevron}`}
                />
                <span className={`${sidebarFolderLabelClass} ${densityClasses.folderLabel}`} title={folderPath}>
                  {node.label}
                </span>
                {collapsed ? <SidebarGroupStateCounts summary={stateSummary} /> : null}
              </div>
            </button>
          )}
        </div>
        {contextMenuPosition ? (
          <SidebarContextMenu
            x={contextMenuPosition.x}
            y={contextMenuPosition.y}
            label={`Actions for ${node.label}`}
            items={contextMenuItems}
            onClose={() => setContextMenuPosition(null)}
          />
        ) : null}
      </div>
      {!collapsed ? (
        <GroupedSidebarFolderBodyDropZone
          nodeId={node.id}
          disabled={!sidebarDndEnabled || isVirtualGroup}
          className={`${densityClasses.folderBody} dh-sidebar-folder-body ${intoState ? 'bg-[var(--accent-subtle)]' : ''}`}
          selectedDirectChild={hasSelectedDirectChild}
          dropActive={intoState}
        >
          <GroupedSidebarChildEntries
            childIds={childIds}
            groupPath={folderPath}
            showCreateInline={actionsEnabled && showCreateInline}
          />
        </GroupedSidebarFolderBodyDropZone>
      ) : null}
      {showEditorInline && folderEditor?.error ? <div className="ml-5 text-[var(--text-10)] text-[var(--red)]">{folderEditor.error}</div> : null}
    </div>
  );
}

function GroupedSidebarNodeEntry({ nodeId, groupPath }: { nodeId: string; groupPath: string | null }) {
  const { nodeTree } = useGroupedSidebarTreeContext();
  const node = nodeTree.nodesById[nodeId];
  if (!node) return null;
  return node.kind === 'folder' ? (
    <GroupedSidebarFolderRow node={node} />
  ) : (
    <GroupedSidebarDroneRow node={node} groupPath={groupPath} />
  );
}

export function GroupedSidebarTree(props: GroupedSidebarTreeProps) {
  const {
    sidebarGroups,
    nodeTreeOverride,
    displayRootNodeId,
    sidebarGroupCreatedAtByName,
    sidebarFolderTree,
    sidebarGroupOrder,
    repoScopedGroupPathsByRepoGroup,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    onMoveSidebar,
    droneById,
    selectedDroneIds,
    selectedDroneSet,
    onRenameGroup,
    onDeleteDroneChat,
    onPrepareDroneDragStart,
  } = props;
  const [dragOverTreeTarget, setDragOverTreeTarget] = React.useState<{ nodeId: string; placement: TreeDropPlacement } | null>(null);
  const [dragOverFolderBodyId, setDragOverFolderBodyId] = React.useState<string | null>(null);
  const [dragOverChat, setDragOverChat] = React.useState<{ key: string; placement: SidebarGroupDropPlacement } | null>(null);
  const [deletingChats, setDeletingChats] = React.useState<Record<string, boolean>>({});
  const suppressClicksUntilRef = React.useRef<number>(0);

  const nodeTree = React.useMemo(
    () =>
      nodeTreeOverride ?? buildSidebarNodeTree({
        sidebarFolderTree,
        sidebarGroups,
        sidebarGroupOrder,
        repoScopedGroupPathsByRepoGroup,
        sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent,
        sidebarGroupCreatedAtByName,
      }),
    [nodeTreeOverride, repoScopedGroupPathsByRepoGroup, sidebarDroneOrderByGroup, sidebarFolderTree, sidebarGroupCreatedAtByName, sidebarGroupOrder, sidebarGroups, sidebarNodeOrderByParent],
  );
  const displayedRootChildIds = React.useMemo(
    () =>
      displayRootNodeId
        ? (nodeTree.childIdsByParent[displayRootNodeId] ?? [])
        : nodeTree.rootChildIds,
    [displayRootNodeId, nodeTree],
  );
  const visibleDroneOrder = React.useMemo(
    () => flattenVisibleDroneOrderFromNodeTree(nodeTree, props.collapsedGroups, displayedRootChildIds),
    [displayedRootChildIds, nodeTree, props.collapsedGroups],
  );

  const orderedGroupItemsByPath = React.useMemo(() => {
    const out: Record<string, DroneSummary[]> = {};
    for (const group of sidebarGroups) {
      if (group.kind !== 'group') continue;
      const groupPath = String(group.group ?? '').trim() || 'Ungrouped';
      out[groupPath] = orderSidebarEntries(
        group.items,
        sidebarDroneOrderByGroup[sidebarGroupOrderToken({ groupId: group.groupId, group: groupPath, kind: 'group' })] ??
          sidebarDroneOrderByGroup[sidebarGroupLegacyOrderToken({ group: groupPath, kind: 'group' })] ?? [],
        (item) => item.id,
        { unorderedPlacement: 'start' },
      );
    }
    return out;
  }, [sidebarDroneOrderByGroup, sidebarGroups]);

  const droneTreeByGroupPath = React.useMemo(() => {
    const out: Record<string, SidebarDroneTree> = {};
    for (const [groupPath, items] of Object.entries(orderedGroupItemsByPath)) {
      out[groupPath] = buildSidebarDroneTree(items);
    }
    return out;
  }, [orderedGroupItemsByPath]);

  const clearDragState = React.useCallback(() => {
    setDragOverTreeTarget(null);
    setDragOverFolderBodyId(null);
    setDragOverChat(null);
  }, []);

  const shouldSuppressClick = React.useCallback(() => Date.now() < suppressClicksUntilRef.current, []);

  const handleDeleteChat = React.useCallback(
    async (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      if (!droneId || !chatName || chatName === 'default') return;
      const key = `${droneId}:${chatName}`;
      if (deletingChats[key]) return;
      setDeletingChats((prev) => ({ ...prev, [key]: true }));
      try {
        const result = await onDeleteDroneChat(droneId, chatName);
        if (!result.ok && result.error) window.alert(result.error);
      } finally {
        setDeletingChats((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [deletingChats, onDeleteDroneChat],
  );

  const sidebarDropTargetFromEvent = React.useCallback(
    (event: DragMoveEvent | DragOverEvent | DragEndEvent): SidebarDropTarget | null => {
      const overData = event.over?.data.current as Record<string, unknown> | undefined;
      if (overData?.type === 'sidebar-chat-reorder') {
        return {
          kind: 'chat',
          droneId: String(overData.droneId ?? '').trim(),
          chatName: String(overData.chatName ?? '').trim() || 'default',
          placement: sidebarDropPlacementFromRects(
            event.active.rect.current.translated ?? event.active.rect.current.initial,
            event.over?.rect ?? null,
          ),
        };
      }
      if (overData?.type === 'sidebar-tree-node') {
        const nodeId = String(overData.nodeId ?? '').trim();
        const node = nodeTree.nodesById[nodeId];
        return node
          ? {
              kind: 'tree-node',
              nodeId,
              placement: placementFromEvent(event, sidebarNodeAllowsDropInside(node)),
            }
          : null;
      }
      if (overData?.type === 'sidebar-tree-folder-body') {
        const folderNodeId = String(overData.nodeId ?? '').trim();
        return folderNodeId
          ? {
              kind: 'folder-body',
              folderNodeId,
              insertionTarget: resolveFolderBodyInsertionTarget(
                folderNodeId,
                activeRectMidY(event),
              ),
            }
          : null;
      }
      if (overData?.type === 'sidebar-tree-drone-tail') {
        const nodeId = String(overData.nodeId ?? '').trim();
        return nodeId ? { kind: 'drone-tail', nodeId } : null;
      }
      return null;
    },
    [nodeTree],
  );

  const createSidebarDropPlan = React.useCallback(
    (
      event: DragMoveEvent | DragOverEvent | DragEndEvent,
      preferred?: {
        treeTarget: { nodeId: string; placement: TreeDropPlacement } | null;
        chatTarget: { key: string; placement: SidebarGroupDropPlacement } | null;
      },
    ) =>
      planSidebarDrop({
        active: parseDroneHubDragData(event.active.data.current),
        target: sidebarDropTargetFromEvent(event),
        nodeTree,
        droneById,
        sidebarChatOrderByDrone,
        preferredTreeTarget: preferred?.treeTarget,
        preferredChatTarget: preferred?.chatTarget,
      }),
    [droneById, nodeTree, sidebarChatOrderByDrone, sidebarDropTargetFromEvent],
  );

  const updateTreeDragState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const plan = createSidebarDropPlan(event);
      setDragOverTreeTarget(plan?.treeTarget ?? null);
      setDragOverFolderBodyId(plan?.folderBodyId ?? null);
      setDragOverChat(plan?.chatTarget ?? null);
    },
    [createSidebarDropPlan],
  );

  const dndMonitorHandlers = React.useMemo(
    () =>
      props.sidebarDndEnabled
        ? {
            onDragStart: (event: DragStartEvent) => {
              const active = parseDroneHubDragData(event.active.data.current);
              if (active?.type === 'sidebar-drone') onPrepareDroneDragStart(active.droneId, active.droneIds);
            },
            onDragMove: updateTreeDragState,
            onDragOver: updateTreeDragState,
            onDragCancel: () => {
              suppressClicksUntilRef.current = Date.now() + 180;
              clearDragState();
            },
            onDragEnd: (event: DragEndEvent) => {
              suppressClicksUntilRef.current = Date.now() + 180;
              const plan = createSidebarDropPlan(event, {
                treeTarget: dragOverTreeTarget,
                chatTarget: dragOverChat,
              });
              if (plan?.intent) void onMoveSidebar(plan.intent);
              clearDragState();
            },
          }
        : {},
    [
      clearDragState,
      createSidebarDropPlan,
      dragOverChat,
      dragOverTreeTarget,
      onMoveSidebar,
      onPrepareDroneDragStart,
      props.sidebarDndEnabled,
      updateTreeDragState,
    ],
  );
  useDndMonitor(dndMonitorHandlers);

  const contextValue = React.useMemo<GroupedSidebarTreeContextValue>(
    () => ({
      ...props,
      nodeTree,
      droneTreeByGroupPath,
      dragOverTreeTarget,
      dragOverFolderBodyId,
      dragOverChat,
      deletingChats,
      handleDeleteChat,
      shouldSuppressClick,
      visibleDroneOrder,
    }),
    [
      props.activeChatName,
      props.approvalRequiredByChatNodeId,
      props.busyChatNodeIdSet,
      props.chatEditor,
      props.chatEditorInputRef,
      props.collapsedDroneSections,
      props.collapsedGroups,
      props.deletingDrones,
      props.deleteOperationModeById,
      props.deleteMode,
      props.deletingGroups,
      props.droneById,
      props.folderEditor,
      props.folderEditorInputRef,
      props.hiddenSidebarGroupTokenSet,
      props.highlightedDroneIds,
      props.movingDroneGroups,
      props.onBlurChatEditor,
      props.onBlurFolderEditor,
      props.onCancelChatEditor,
      props.onCancelFolderEditor,
      props.onChatEditorCreateAsDraftChange,
      props.onChatEditorValueChange,
      props.onCreateDroneChat,
      props.onDeleteDrone,
      props.onDeleteDroneChat,
      props.onDeleteGroup,
      props.onFolderEditorValueChange,
      props.onMoveDronesToGroup,
      props.onCloneDrone,
      props.onCreateGroupBeforeDrone,
      props.onOpenCreateDroneChat,
      props.onOpenDroneErrorModal,
      props.onOpenFolderCreate,
      props.onOpenGroupMultiChat,
      props.onPrepareDroneDragStart,
      props.onRenameDrone,
      props.inlineRenameDroneRequest,
      props.onRenameDroneChat,
      props.onRenameGroup,
      props.onReparentDronesToParent,
      props.onFocusDroneChat,
      props.onSelectDroneCard,
      props.onSelectDroneContainer,
      props.onSelectDroneChat,
      props.onSelectFolder,
      props.onSetDroneBaseImage,
      props.onSetDronePinned,
      props.onStartRenameDroneChat,
      props.onStartRenameFolder,
      props.onSubmitChatEditor,
      props.onSubmitFolderEditor,
      props.onToggleGroupCollapsed,
      props.onToggleDroneSection,
      props.renamingDrones,
      props.renamingGroups,
      props.repoScopedGroupPathsByRepoGroup,
      props.selectedDrone,
      props.selectedDroneIds,
      props.selectedDroneSet,
      props.selectedFolderPath,
      props.selectedGroupMultiChat,
      props.selectedSidebarNodeId,
      props.setSelectedSidebarNodeId,
      props.setCollapsedDroneSections,
      props.onMoveSidebar,
      props.settingBaseImages,
      props.pinnedDroneIdSet,
      props.pinningDroneIds,
      props.sidebarChatOrderByDrone,
      props.sidebarDensityMode,
      props.sidebarDndEnabled,
      props.sidebarDroneOrderByGroup,
      props.sidebarFolderTree,
      props.sidebarGroupOrder,
      props.sidebarGroups,
      props.sidebarNodeOrderByParent,
      props.sidebarOptimisticDroneIdSet,
      props.toggleSidebarGroupHidden,
      props.uiDroneName,
      props.unreadAgentMessageByChatNodeId,
      deletingChats,
      dragOverChat,
      dragOverFolderBodyId,
      dragOverTreeTarget,
      droneTreeByGroupPath,
      handleDeleteChat,
      nodeTree,
      shouldSuppressClick,
      visibleDroneOrder,
    ],
  );

  return (
    <GroupedSidebarTreeContext.Provider value={contextValue}>
      <GroupedSidebarChildEntries
        childIds={displayedRootChildIds}
        groupPath={null}
        showCreateInline={
          props.actionsEnabled !== false &&
          props.folderEditor?.mode === 'create' &&
          props.folderEditor.parentPath === null
        }
      />
    </GroupedSidebarTreeContext.Provider>
  );
}
