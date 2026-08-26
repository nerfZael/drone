import React from 'react';
import { useDndMonitor, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { isUngroupedGroupName } from '../../domain';
import {
  DroneCard,
  SidebarApprovalStatusIndicator,
  SidebarItemStateIndicator,
  SidebarMutedStatusIndicator,
  SidebarWorkingStatusIndicator,
  sidebarChatDisplayState,
  sidebarDroneDisplayState,
  sidebarDroneStateLabel,
  type DroneInlineRenameResult,
} from '../overview';
import type { DroneSummary } from '../types';
import { IconClone } from '../overview/icons';
import { createCanvasChatNodeId } from './app-config';
import { droneChatRequiresApproval, normalizedDroneChats } from './chat-node-helpers';
import { createSidebarChatDragData, parseDroneHubDragData, useDroneHubActiveDrag, type SidebarDroneDragData } from './drone-hub-dnd';
import { isDroneContainerStopped, isDroneStartingOrSeeding } from './helpers';
import { IconChevron, IconColumns, IconFolderGit, IconFolderOutline, IconPencil, IconPlus, IconSpinner, IconTrash } from './icons';
import { isSidebarGroupCollapsed } from './is-sidebar-group-collapsed';
import type { DroneSelectionClickOptions } from './drone-selection-helpers';
import { sidebarInlineSectionKey, type SidebarInlineSectionKind } from './sidebar-inline-sections';
import {
  isSidebarFolderRowSelected,
  sidebarFolderCollapseKey,
  type SidebarFolderSelectionOptions,
} from './sidebar-folder-selection';
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
import {
  buildSidebarChatTree,
  normalizeSidebarChatGroupPath,
  resolveEffectiveSidebarChatMuteSets,
  sidebarChatGroupBaseName,
  sidebarChatGroupNodeId,
  sidebarChatGroupParentPath,
  sidebarChatNodeId,
  sidebarChatTreeChatNamesInGroup,
  type SidebarChatTreeFolderNode,
  type SidebarChatTreeModel,
  type SidebarChatTreeNode,
} from '@drone/hub-model/sidebar';
import { useChatApprovalRequired } from './use-drone-hub-runtime-store';
import type {
  DeleteDronesInGroupOptions,
  DeleteGroupOptions,
  GroupMutationScope,
  MoveDronesToGroupResult,
} from './use-group-management';
import type { SidebarGroup } from './use-sidebar-view-model';
import { SidebarContextMenu, type SidebarContextMenuItem } from './SidebarContextMenu';
import { formatShortcutBinding } from './shortcuts';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { resolveEffectiveSidebarMuteSets, sidebarFolderMuteId } from './sidebar-mute';
import {
  sidebarGroupMutationKey,
  sidebarRepoPathFromGroupPath,
} from './sidebar-repository-scope';
import {
  sidebarChatLabelClass,
  sidebarChatRowTone,
  sidebarChatStateClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
  sidebarRepositoryLabelClass,
  sidebarRepositoryRowClass,
  sidebarSelectionEdgeClass,
} from '../sidebar/presentation';
import { clearSidebarChatNodeSelection, selectSidebarChatNodes } from './sidebar-chat-selection';
import {
  buildSidebarChatDeleteConfirmation,
  buildSidebarChatGroupDeleteConfirmation,
  type DeleteDroneChatOptions,
} from './sidebar-chat-delete-confirmation';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import {
  droneActionState,
  type DroneOperationsById,
} from './drone-operation-state';

type FolderEditorState = {
  mode: 'create' | 'rename';
  parentPath: string | null;
  anchorPath: string | null;
  beforeNodeId: string | null;
  targetPath: string | null;
  targetNodeId: string | null;
  value: string;
  error: string | null;
  pending: boolean;
  repoGroupPath: string | null;
  targetGroupId: string | null;
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
    opts?: {
      anchorPath?: string | null;
      beforeNodeId?: string | null;
      parentCollapseKey?: string | null;
      repoGroupPath?: string | null;
    },
  ) => void;
  onStartRenameFolder: (
    path: string,
    scope?: GroupMutationScope & {
      folderNodeId?: string | null;
      repoGroupPath?: string | null;
    },
  ) => void;
  onFolderEditorValueChange: (next: string) => void;
  onSubmitFolderEditor: () => void;
  onBlurFolderEditor: () => void;
  onCancelFolderEditor: () => void;
  folderEditor: FolderEditorState | null;
  folderEditorInputRef: React.RefObject<HTMLInputElement>;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: DeleteGroupOptions,
  ) => Promise<boolean> | boolean;
  onDeleteDronesInGroup: (
    group: string,
    opts?: DeleteDronesInGroupOptions,
  ) => Promise<boolean> | boolean;
  onOpenDraftDrone: (opts?: { repoPath?: string | null; group?: string | null }) => void;
  busyChatNodeIdSet: Set<string>;
  approvalRequiredByChatNodeId: Record<string, boolean>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  droneOperations: DroneOperationsById;
  deleteOperationModeById: Record<string, DroneDeleteMode>;
  deleteMode: DroneDeleteMode;
  movingDroneGroups: boolean;
  sidebarOptimisticDroneIdSet: Set<string>;
  uiDroneName: (nameRaw: string) => string;
  onDeleteDroneChat: (
    droneId: string,
    chatName: string,
    opts?: DeleteDroneChatOptions,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  onCloneDrone: (drone: DroneSummary) => void;
  onAddDroneToGroup: (drone: DroneSummary) => void;
  onCreateGroupBeforeDrone: (drone: DroneSummary) => void;
  onCreateDroneChat: (
    drone: DroneSummary,
    chatName: string,
    opts?: { draft?: boolean },
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onCloneDroneChat: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  cloningChatKeys: Record<string, true>;
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
  onStartDroneContainer: (droneId: string) => void;
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
  repositoryRootView?: boolean;
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
  handleDeleteChat: (droneId: string, chatName: string) => Promise<boolean>;
  shouldSuppressClick: () => boolean;
  mutedSidebarGroupIdSet: ReadonlySet<string>;
  effectiveMutedSidebarGroupIdSet: ReadonlySet<string>;
  effectiveMutedDroneIdSet: ReadonlySet<string>;
  mutedDroneIdSet: ReadonlySet<string>;
  mutedChatIdSet: ReadonlySet<string>;
  effectiveMutedChatGroupIdSet: ReadonlySet<string>;
  effectiveMutedChatIdSet: ReadonlySet<string>;
  selectedChatNodeIdSet: ReadonlySet<string>;
  chatSelectionAnchorByDrone: Readonly<Record<string, string>>;
  chatTreeByDrone: Readonly<Record<string, SidebarChatTreeModel>>;
  chatTreeEditor: { mode: 'create' | 'rename'; droneId: string; parentPath: string | null; path: string | null; value: string; error: string | null } | null;
  setChatTreeEditor: React.Dispatch<React.SetStateAction<{ mode: 'create' | 'rename'; droneId: string; parentPath: string | null; path: string | null; value: string; error: string | null } | null>>;
  selectChatNode: (droneId: string, chatName: string, event: Pick<React.MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => void;
  deleteSelectedChats: (droneId: string, fallbackChatName: string) => Promise<void>;
  createChatGroup: (droneId: string, parentPath?: string | null) => void;
  renameChatGroup: (droneId: string, path: string) => void;
  deleteChatGroup: (droneId: string, path: string) => void;
  deleteChatsInGroup: (droneId: string, path: string) => Promise<void>;
  createChatInGroup: (drone: DroneSummary, path: string) => Promise<void>;
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
  repositoryRootView = false,
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
      const collapseKey = sidebarFolderCollapseKey(node, repositoryRootView);
      if (isSidebarGroupCollapsed(collapsedGroups, collapseKey)) return;
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

type GroupedSidebarChatRowProps = {
  drone: DroneSummary;
  chatName: string;
  isOptimistic: boolean;
  parentPath?: string | null;
  depth?: number;
};

const GroupedSidebarChatRowDnd = React.memo(function GroupedSidebarChatRowDnd({ drone, chatName, isOptimistic, parentPath = null, depth = 0 }: GroupedSidebarChatRowProps) {
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
    onSelectDroneChat,
    dragOverChat,
    chatEditor,
    chatEditorInputRef,
    onStartRenameDroneChat,
    onOpenCreateDroneChat,
    onCloneDroneChat,
    cloningChatKeys,
    onChatEditorValueChange,
    onSubmitChatEditor,
    onBlurChatEditor,
    onCancelChatEditor,
    deletingChats,
    droneOperations,
    handleDeleteChat,
    shouldSuppressClick,
    effectiveMutedDroneIdSet,
    mutedChatIdSet,
    effectiveMutedChatIdSet,
    onMoveSidebar,
    chatTreeByDrone,
    selectedChatNodeIdSet,
    selectChatNode,
    deleteSelectedChats,
    createChatGroup,
    actionsEnabled = true,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const chatRenameErrorId = React.useId();
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
  const locallyRequiredApproval = useChatApprovalRequired(chatNodeId);
  const approvalRequired =
    droneChatRequiresApproval(drone, chatName) || locallyRequiredApproval;
  const sidebarChatId = sidebarChatSidebarNodeId(drone.id, chatName);
  const chatTreeNodeId = sidebarChatNodeId(drone.id, chatName);
  const multiSelected = selectedChatNodeIdSet.has(chatTreeNodeId);
  const selectedChatNames = React.useMemo(() => {
    if (!multiSelected) return [chatName];
    const tree = chatTreeByDrone[drone.id];
    if (!tree) return [chatName];
    const names: string[] = [];
    const visit = (nodeId: string) => {
      const node = tree.nodesById[nodeId];
      if (!node) return;
      if (node.kind === 'chat' && selectedChatNodeIdSet.has(node.id)) names.push(node.chatName);
      for (const childId of tree.childIdsByParent[nodeId] ?? []) visit(childId);
    };
    for (const nodeId of tree.rootChildIds) visit(nodeId);
    return names.length ? names : [chatName];
  }, [chatName, chatTreeByDrone, drone.id, multiSelected, selectedChatNodeIdSet]);
  const chatDragData = React.useMemo(
    () => createSidebarChatDragData(drone.id, chatName, `${uiDroneName(drone.name)} / ${chatName}`, selectedChatNames),
    [chatName, drone.id, drone.name, selectedChatNames, uiDroneName],
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
      type: 'sidebar-chat-tree-node',
      droneId: drone.id,
      chatName,
      nodeId: chatTreeNodeId,
      parentPath,
      kind: 'chat',
    },
    disabled: chatDropDisabled,
  });
  const active = selectedDrone === drone.id && activeChatName === chatName;
  const selected = selectedSidebarNodeId === sidebarChatId || multiSelected;
  const muted = effectiveMutedDroneIdSet.has(drone.id) || effectiveMutedChatIdSet.has(sidebarChatId);
  const directlyMuted = mutedChatIdSet.has(sidebarChatId);
  const chatBusy =
    (drone.busyChats ?? []).includes(chatName) || busyChatNodeIdSet.has(chatNodeId);
  const chatUnread =
    !active &&
    ((drone.unreadChats ?? []).includes(chatName) ||
      unreadAgentMessageByChatNodeId[chatNodeId] === true);
  const chatState = sidebarChatDisplayState(drone, chatBusy, approvalRequired);
  const chatStateLabel = muted ? 'Muted' : sidebarDroneStateLabel(chatState, chatUnread);
  const actionState = droneActionState(droneOperations, drone.id);
  const chatActionsDisabled =
    isOptimistic ||
    actionState.busy ||
    isDroneStartingOrSeeding(drone.hubPhase);
  const draft = drone.draftChats?.[chatName] === true;
  const canCreateChatGroups = normalizedDroneChats(drone).length > 1;
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
        <div className="relative flex items-stretch gap-1 group/chat-row">
          <div
            className={`relative flex flex-1 items-center gap-1 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ selected, active })}`}
          >
            {selected ? <span className={sidebarSelectionEdgeClass} /> : null}
            <span
              className={sidebarChatStateClass}
              title={chatStateLabel}
              role="img"
              aria-label={chatStateLabel}
            >
              {muted ? (
                <SidebarMutedStatusIndicator />
              ) : (
                <SidebarItemStateIndicator
                  state={chatState}
                  unread={chatUnread}
                  showReadyAnchor
                  emphasized={selected}
                />
              )}
            </span>
            <input
              ref={chatEditorInputRef}
              type="text"
              value={chatEditor?.value ?? ''}
              onChange={(event) => onChatEditorValueChange(event.target.value)}
              onBlur={onBlurChatEditor}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSubmitChatEditor();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelChatEditor();
                }
              }}
              readOnly={chatEditor?.pending}
              aria-label="Chat name"
              aria-invalid={Boolean(chatEditor?.error)}
              aria-describedby={chatEditor?.error ? chatRenameErrorId : undefined}
              title={chatEditor?.error || 'Rename chat'}
              className={`${sidebarChatLabelClass} appearance-none rounded-none border-0 bg-transparent p-0 shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${
                chatEditor?.error ? 'text-[var(--red)]' : ''
              }`}
              style={{ border: 0, outline: 'none', boxShadow: 'none' }}
            />
            {chatEditor?.error ? (
              <span id={chatRenameErrorId} role="alert" className="sr-only">
                {chatEditor.error}
              </span>
            ) : null}
            {chatEditor?.pending ? <IconSpinner className="opacity-90 text-[var(--accent)]" /> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={chatDropDisabled ? undefined : setDropNodeRef} data-sidebar-chat-depth={depth} className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${reorderPreviewClass}`}>
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
            selectChatNode(drone.id, chatName, event);
            const deselecting = (event.ctrlKey || event.metaKey) && multiSelected;
            setSelectedSidebarNodeId(deselecting ? null : sidebarChatId);
            if (!event.ctrlKey && !event.metaKey) onSelectDroneChat(drone.id, chatName);
          }}
          onContextMenu={(event) => {
            if (!actionsEnabled) return;
            event.preventDefault();
            event.stopPropagation();
            setContextMenuPosition({ x: event.clientX, y: event.clientY });
          }}
          className={`relative flex flex-1 items-center gap-1 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ selected, active })} ${contextMenuPosition ? 'dh-sidebar-row-context-target' : ''} ${isDragging ? 'opacity-35' : ''} ${!sidebarDndEnabled || !chatDragData || isOptimistic ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
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
            {muted ? (
              <SidebarMutedStatusIndicator />
            ) : (
              <SidebarItemStateIndicator
                state={chatState}
                unread={chatUnread}
                showReadyAnchor
                emphasized={selected}
              />
            )}
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
              id: 'mute-chat',
              label: directlyMuted ? 'Unmute chat' : 'Mute chat',
              icon: <SidebarMutedStatusIndicator className="h-3.5 w-3.5" />,
              onSelect: () => void onMoveSidebar({
                kind: 'set-muted',
                targetKind: 'chat',
                targetId: sidebarChatId,
                muted: !directlyMuted,
              }),
            },
            {
              id: 'create-chat',
              label: 'Create chat',
              separatorBefore: true,
              icon: <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />,
              disabled: chatActionsDisabled,
              onSelect: () => onOpenCreateDroneChat(drone),
            },
            ...(canCreateChatGroups ? [{
              id: 'create-chat-group',
              label: 'Create group',
              icon: <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />,
              disabled: chatActionsDisabled,
              onSelect: () => createChatGroup(drone.id, parentPath),
            } satisfies SidebarContextMenuItem] : []),
            {
              id: 'clone-chat',
              label: 'Clone chat',
              icon: cloningChatKeys[`${drone.id}:${chatName}`] ? (
                <IconSpinner className="h-3.5 w-3.5" />
              ) : (
                <IconClone className="h-3.5 w-3.5 text-[var(--accent)]" />
              ),
              disabled:
                chatActionsDisabled ||
                chatBusy ||
                Boolean(cloningChatKeys[`${drone.id}:${chatName}`]),
              onSelect: () => void onCloneDroneChat(drone.id, chatName),
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
              label: selectedChatNames.length > 1 ? `Delete ${selectedChatNames.length} chats` : 'Delete chat',
              separatorBefore: true,
              icon: deletingChats[`${drone.id}:${chatName}`] ? (
                <IconSpinner className="h-3.5 w-3.5" />
              ) : (
                <IconTrash className="h-3.5 w-3.5" />
              ),
              disabled:
                selectedChatNames.every((name) => name === 'default') ||
                chatActionsDisabled ||
                selectedChatNames.some((name) => Boolean(deletingChats[`${drone.id}:${name}`])),
              tone: 'danger',
              onSelect: () => void deleteSelectedChats(drone.id, chatName),
            },
          ]}
          onClose={() => setContextMenuPosition(null)}
        />
      ) : null}
    </div>
  );
});

const GroupedSidebarChatRowStatic = React.memo(function GroupedSidebarChatRowStatic({ drone, chatName, depth = 0 }: GroupedSidebarChatRowProps) {
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
    effectiveMutedDroneIdSet,
    effectiveMutedChatIdSet,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
  const locallyRequiredApproval = useChatApprovalRequired(chatNodeId);
  const approvalRequired =
    droneChatRequiresApproval(drone, chatName) || locallyRequiredApproval;
  const sidebarChatId = sidebarChatSidebarNodeId(drone.id, chatName);
  const active = selectedDrone === drone.id && activeChatName === chatName;
  const selected = selectedSidebarNodeId === sidebarChatId;
  const muted = effectiveMutedDroneIdSet.has(drone.id) || effectiveMutedChatIdSet.has(sidebarChatId);
  const chatBusy =
    (drone.busyChats ?? []).includes(chatName) || busyChatNodeIdSet.has(chatNodeId);
  const chatUnread =
    !active &&
    ((drone.unreadChats ?? []).includes(chatName) ||
      unreadAgentMessageByChatNodeId[chatNodeId] === true);
  const chatState = sidebarChatDisplayState(drone, chatBusy, approvalRequired);
  const chatStateLabel = muted ? 'Muted' : sidebarDroneStateLabel(chatState, chatUnread);
  return (
    <div className="flex flex-col gap-0.5" data-sidebar-chat-depth={depth}>
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
            {muted ? (
              <SidebarMutedStatusIndicator />
            ) : (
              <SidebarItemStateIndicator
                state={chatState}
                unread={chatUnread}
                showReadyAnchor
                emphasized={selected}
              />
            )}
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

function chatGroupCollapseKey(droneId: string, path: string): string {
  return `chat-group:${droneId}:${path}`;
}

const GroupedSidebarChatFolderRow = React.memo(function GroupedSidebarChatFolderRow({
  drone,
  node,
  tree,
  isOptimistic,
  depth,
}: {
  drone: DroneSummary;
  node: SidebarChatTreeFolderNode;
  tree: SidebarChatTreeModel;
  isOptimistic: boolean;
  depth: number;
}) {
  const {
    sidebarDensityMode,
    sidebarDndEnabled,
    selectedSidebarNodeId,
    setSelectedSidebarNodeId,
    collapsedDroneSections,
    setCollapsedDroneSections,
    chatTreeEditor,
    setChatTreeEditor,
    createChatGroup,
    renameChatGroup,
    deleteChatGroup,
    deleteChatsInGroup,
    createChatInGroup,
    deletingChats,
    mutedChatIdSet,
    effectiveMutedChatGroupIdSet,
    onMoveSidebar,
    actionsEnabled = true,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const activeDrag = useDroneHubActiveDrag();
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{ x: number; y: number } | null>(null);
  const collapseKey = chatGroupCollapseKey(drone.id, node.path);
  const collapsed = collapsedDroneSections[collapseKey] === true;
  const selected = selectedSidebarNodeId === node.id;
  const dndDisabled = !sidebarDndEnabled || isOptimistic;
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-chat-folder:${node.id}`,
    data: {
      type: 'sidebar-chat-folder',
      droneId: drone.id,
      path: node.path,
      sidebarNodeId: node.id,
      label: node.label,
    },
    disabled: dndDisabled,
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `sidebar-chat-tree-node:${node.id}`,
    data: {
      type: 'sidebar-chat-tree-node',
      droneId: drone.id,
      nodeId: node.id,
      parentPath: sidebarChatGroupParentPath(node.path),
      path: node.path,
      kind: 'folder',
    },
    disabled: !sidebarDndEnabled ||
      (activeDrag?.type !== 'sidebar-chat' && activeDrag?.type !== 'sidebar-chat-folder'),
  });
  const setNodeRef = React.useCallback((element: HTMLDivElement | null) => {
    if (!dndDisabled) setDragNodeRef(element);
    if (sidebarDndEnabled) setDropNodeRef(element);
  }, [dndDisabled, setDragNodeRef, setDropNodeRef, sidebarDndEnabled]);
  const editing = chatTreeEditor?.mode === 'rename' &&
    chatTreeEditor.droneId === drone.id && chatTreeEditor.path === node.path;
  const creating = chatTreeEditor?.mode === 'create' &&
    chatTreeEditor.droneId === drone.id && chatTreeEditor.parentPath === node.path;
  const canCreateNestedGroups = Object.values(tree.nodesById)
    .filter((entry) => entry.kind === 'chat').length > 1;
  const deletableChatNames = sidebarChatTreeChatNamesInGroup(tree, node.id)
    .filter((chatName) => chatName !== 'default');
  const deletingGroupChats = deletableChatNames.some((chatName) =>
    Boolean(deletingChats[`${drone.id}:${chatName}`]));
  const directlyMuted = mutedChatIdSet.has(node.id);
  const muted = effectiveMutedChatGroupIdSet.has(node.id);
  const submitRename = () => {
    if (!editing) return;
    const name = normalizeSidebarChatGroupPath(chatTreeEditor.value);
    if (!name || name.includes('/')) {
      setChatTreeEditor({ ...chatTreeEditor, error: 'Use a single group name.' });
      return;
    }
    const parent = sidebarChatGroupParentPath(node.path);
    const newPath = [parent, name].filter(Boolean).join('/');
    if (newPath === node.path) {
      setChatTreeEditor(null);
      return;
    }
    if (tree.nodesById[sidebarChatGroupNodeId(drone.id, newPath)]) {
      setChatTreeEditor({ ...chatTreeEditor, error: 'A group with that name already exists.' });
      return;
    }
    void onMoveSidebar({
      kind: 'chat-group-rename',
      droneId: drone.id,
      path: node.path,
      newPath,
    }).then((ok) => {
      if (ok) {
        const oldPrefix = chatGroupCollapseKey(drone.id, node.path);
        const newPrefix = chatGroupCollapseKey(drone.id, newPath);
        setCollapsedDroneSections((current) => Object.fromEntries(
          Object.entries(current).map(([key, value]) => [
            key === oldPrefix || key.startsWith(`${oldPrefix}/`)
              ? `${newPrefix}${key.slice(oldPrefix.length)}`
              : key,
            value,
          ]),
        ));
        setChatTreeEditor(null);
      } else {
        setChatTreeEditor((current) => current?.path === node.path
          ? { ...current, error: 'Could not rename the group.' }
          : current);
      }
    });
  };
  return (
    <div className="flex flex-col gap-0">
      <div ref={setNodeRef} className={`relative flex items-center gap-1 ${isDragging ? 'opacity-35' : ''}`}>
        {editing ? (
          <div className={`relative flex min-w-0 flex-1 items-center gap-1.5 rounded text-[var(--sidebar-subitem-fg)] ${densityClasses.folderRow} ${densityClasses.folderPaddingX} ${selected ? 'dh-sidebar-row-selected' : ''}`}>
            {selected ? <span className={sidebarSelectionEdgeClass} /> : null}
            <IconChevron
              down={!collapsed}
              strokeWidth={1.25}
              className={`flex-shrink-0 ${densityClasses.folderChevron}`}
            />
            <input
              autoFocus
              value={chatTreeEditor.value}
              onChange={(event) => setChatTreeEditor({ ...chatTreeEditor, value: event.target.value, error: null })}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={() => setChatTreeEditor(null)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') setChatTreeEditor(null);
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitRename();
                }
              }}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 outline-none"
              aria-label="Group name"
            />
          </div>
        ) : (
          <button
            type="button"
            {...(dndDisabled ? {} : attributes as unknown as Record<string, unknown>)}
            {...(dndDisabled ? {} : listeners as unknown as Record<string, unknown>)}
            onClick={() => {
              setSelectedSidebarNodeId(node.id);
              setCollapsedDroneSections((prev) => ({ ...prev, [collapseKey]: !collapsed }));
            }}
            onKeyDown={(event) => {
              if (event.key === 'F2' && actionsEnabled) {
                event.preventDefault();
                event.stopPropagation();
                renameChatGroup(drone.id, node.path);
                return;
              }
              if (event.key === 'Delete' && actionsEnabled) {
                event.preventDefault();
                event.stopPropagation();
                deleteChatGroup(drone.id, node.path);
                return;
              }
              if (!dndDisabled) listeners?.onKeyDown?.(event);
            }}
            onContextMenu={(event) => {
              if (!actionsEnabled) return;
              event.preventDefault();
              event.stopPropagation();
              setSelectedSidebarNodeId(node.id);
              setContextMenuPosition({ x: event.clientX, y: event.clientY });
            }}
            className={`dh-sidebar-row-interactive relative flex min-w-0 flex-1 items-center gap-1.5 rounded border border-transparent text-left text-[var(--sidebar-subitem-fg)] hover:text-[var(--sidebar-fg)] ${densityClasses.folderRow} ${densityClasses.folderPaddingX} ${selected ? 'dh-sidebar-row-selected' : ''} ${dndDisabled ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
            aria-expanded={!collapsed}
            aria-selected={selected}
            aria-label={`${node.label}${muted ? ', muted' : ''}`}
          >
            {selected ? <span className={sidebarSelectionEdgeClass} /> : null}
            <IconChevron
              down={!collapsed}
              strokeWidth={1.25}
              className={`flex-shrink-0 ${densityClasses.folderChevron}`}
            />
            <span className={`${sidebarFolderLabelClass} ${densityClasses.folderLabel}`}>{node.label}</span>
            {muted ? <SidebarMutedStatusIndicator /> : null}
          </button>
        )}
      </div>
      {chatTreeEditor?.error && editing ? <div className="pl-8 text-[var(--text-9)] text-[var(--red)]">{chatTreeEditor.error}</div> : null}
      {!collapsed ? (
        <div className={densityClasses.folderBody}>
          {creating ? <GroupedSidebarChatGroupEditor droneId={drone.id} parentPath={node.path} depth={depth + 1} /> : null}
          {(tree.childIdsByParent[node.id] ?? []).map((childId) => (
            <GroupedSidebarChatTreeEntry
              key={childId}
              drone={drone}
              node={tree.nodesById[childId]!}
              tree={tree}
              isOptimistic={isOptimistic}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
      {contextMenuPosition ? (
        <SidebarContextMenu
          x={contextMenuPosition.x}
          y={contextMenuPosition.y}
          label={`Actions for ${node.label}`}
          items={[
            { id: 'create-chat', label: 'Create chat', icon: <IconPlus className="h-3.5 w-3.5" />, onSelect: () => void createChatInGroup(drone, node.path) },
            ...(canCreateNestedGroups ? [{ id: 'create-group', label: 'Create group', icon: <IconPlus className="h-3.5 w-3.5" />, onSelect: () => createChatGroup(drone.id, node.path) } satisfies SidebarContextMenuItem] : []),
            { id: 'rename-group', label: 'Rename group', separatorBefore: true, icon: <IconPencil className="h-3.5 w-3.5" />, onSelect: () => renameChatGroup(drone.id, node.path) },
            {
              id: 'mute-group',
              label: directlyMuted ? 'Unmute group' : 'Mute group',
              icon: <SidebarMutedStatusIndicator className="h-3.5 w-3.5" />,
              onSelect: () => void onMoveSidebar({
                kind: 'set-muted',
                targetKind: 'chat',
                targetId: node.id,
                muted: !directlyMuted,
              }),
            },
            {
              id: 'delete-chats',
              label: 'Delete chats in group',
              separatorBefore: true,
              icon: deletingGroupChats
                ? <IconSpinner className="h-3.5 w-3.5" />
                : <IconTrash className="h-3.5 w-3.5" />,
              disabled: deletableChatNames.length === 0 || deletingGroupChats,
              tone: 'danger',
              onSelect: () => void deleteChatsInGroup(drone.id, node.path),
            },
            { id: 'delete-group', label: 'Delete group', icon: <IconTrash className="h-3.5 w-3.5" />, tone: 'danger', onSelect: () => deleteChatGroup(drone.id, node.path) },
          ]}
          onClose={() => setContextMenuPosition(null)}
        />
      ) : null}
    </div>
  );
});

function GroupedSidebarChatGroupEditor({ droneId, parentPath, depth }: { droneId: string; parentPath: string | null; depth: number }) {
  const { chatTreeByDrone, chatTreeEditor, setChatTreeEditor, onMoveSidebar } = useGroupedSidebarTreeContext();
  if (!chatTreeEditor || chatTreeEditor.mode !== 'create' || chatTreeEditor.droneId !== droneId || chatTreeEditor.parentPath !== parentPath) return null;
  const submit = () => {
    const name = normalizeSidebarChatGroupPath(chatTreeEditor.value);
    if (!name || name.includes('/')) {
      setChatTreeEditor({ ...chatTreeEditor, error: 'Use a single group name.' });
      return;
    }
    const path = [parentPath, name].filter(Boolean).join('/');
    if (chatTreeByDrone[droneId]?.nodesById[sidebarChatGroupNodeId(droneId, path)]) {
      setChatTreeEditor({ ...chatTreeEditor, error: 'A group with that name already exists.' });
      return;
    }
    void onMoveSidebar({ kind: 'chat-group-create', droneId, path }).then((ok) => {
      if (ok) setChatTreeEditor(null);
      else setChatTreeEditor((current) => current?.mode === 'create' && current.droneId === droneId
        ? { ...current, error: 'Could not create the group.' }
        : current);
    });
  };
  return (
    <div data-sidebar-chat-depth={depth} className="flex flex-col gap-0.5 px-1 py-0.5">
      <div className="flex min-h-7 items-center gap-1">
        <IconChevron className="h-3.5 w-3.5 text-[var(--muted-dim)] opacity-72" strokeWidth={1.25} />
        <input
          autoFocus
          value={chatTreeEditor.value}
          onChange={(event) => setChatTreeEditor({ ...chatTreeEditor, value: event.target.value, error: null })}
          onBlur={() => setChatTreeEditor(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setChatTreeEditor(null);
            if (event.key === 'Enter') { event.preventDefault(); submit(); }
          }}
          placeholder="Group name"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[var(--text-11)] outline-none"
        />
      </div>
      {chatTreeEditor.error ? <span className="text-[var(--text-9)] text-[var(--red)]">{chatTreeEditor.error}</span> : null}
    </div>
  );
}

function GroupedSidebarChatTreeEntry({ drone, node, tree, isOptimistic, depth }: { drone: DroneSummary; node: SidebarChatTreeNode; tree: SidebarChatTreeModel; isOptimistic: boolean; depth: number }) {
  return node.kind === 'folder'
    ? <GroupedSidebarChatFolderRow drone={drone} node={node} tree={tree} isOptimistic={isOptimistic} depth={depth} />
    : <GroupedSidebarChatRow drone={drone} chatName={node.chatName} parentPath={node.parentId === tree.rootId ? null : (tree.nodesById[node.parentId] as SidebarChatTreeFolderNode | undefined)?.path ?? null} depth={depth} isOptimistic={isOptimistic} />;
}

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
    droneOperations,
    deleteOperationModeById,
    deleteMode,
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
    onCloneDroneChat,
    cloningChatKeys,
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
    onStartDroneContainer,
    pinnedDroneIdSet,
    pinningDroneIds,
    onSetDronePinned,
    onDeleteDrone,
    onOpenDroneErrorModal,
    dragOverTreeTarget,
    nodeTree,
    shouldSuppressClick,
    effectiveMutedDroneIdSet,
    mutedDroneIdSet,
    mutedChatIdSet,
    effectiveMutedChatIdSet,
    onMoveSidebar,
    chatTreeByDrone,
    chatTreeEditor,
    createChatGroup,
    actionsEnabled = true,
    repositoryRootView = false,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const drone = droneById[node.droneId];
  if (!drone) return null;
  const actionState = droneActionState(droneOperations, drone.id);
  const muted = effectiveMutedDroneIdSet.has(drone.id);
  const directlyMuted = mutedDroneIdSet.has(drone.id);
  const isOptimistic = sidebarOptimisticDroneIdSet.has(drone.id);
  const dragDisabled = !sidebarDndEnabled || isOptimistic || actionState.busy;
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
  const chatTree = chatTreeByDrone[drone.id] ?? buildSidebarChatTree({ droneId: drone.id, chatNames: chats });
  const chatTailDropDisabled = !sidebarDndEnabled;
  const { setNodeRef: setChatTailDropNodeRef, isOver: isChatTailOver } = useDroppable({
    id: `sidebar-tree-drone-tail:${node.id}`,
    data: activeDrag?.type === 'sidebar-chat' || activeDrag?.type === 'sidebar-chat-folder'
      ? { type: 'sidebar-chat-tree-root', droneId: drone.id }
      : { type: 'sidebar-tree-drone-tail', nodeId: node.id, parentId: node.parentId },
    disabled: chatTailDropDisabled,
  });
  const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
  const defaultChatDirectlyMuted =
    hasOnlyDefaultChat && mutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, 'default'));
  const defaultChatMuted =
    hasOnlyDefaultChat && effectiveMutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, 'default'));
  const hasChatGroups = chatTree.rootChildIds.some((id) => chatTree.nodesById[id]?.kind === 'folder');
  const hasChatSection = chats.length > 1 || hasChatGroups || chatTreeEditor?.droneId === drone.id;
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
      if (effectiveMutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName))) continue;
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
    effectiveMutedChatIdSet,
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
  const canStartContainer = actionsEnabled && isDroneContainerStopped(drone);
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
              actionState.startingContainer
                ? 'Starting'
                : actionState.deleting
                ? ((deleteOperationModeById[drone.id] ?? deleteMode) === 'archive' ? 'Archiving' : 'Deleting')
                : undefined
            }
            chatStateSummary={hasOnlyDefaultChat ? undefined : chatStateSummary}
            unreadAgentMessage={showUnread}
            onClick={(rowOpts) => {
              if (shouldSuppressClick()) return;
              if (hasChatSection) {
                onSelectDroneContainer(drone.id);
                onSelectDroneCard(drone.id, { ...rowOpts, orderedDroneIds: visibleDroneOrder });
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
            onCreateChatGroup={actionsEnabled && chats.length > 1 ? () => createChatGroup(drone.id) : undefined}
            onCloneChat={
              actionsEnabled && hasOnlyDefaultChat
                ? () => void onCloneDroneChat(drone.id, 'default')
                : undefined
            }
            onClone={actionsEnabled ? () => onCloneDrone(drone) : undefined}
            onAddToGroup={actionsEnabled && !repositoryRootView ? () => onAddDroneToGroup(drone) : undefined}
            onCreateGroup={actionsEnabled && !repositoryRootView ? () => onCreateGroupBeforeDrone(drone) : undefined}
            onRename={actionsEnabled ? (newName) => onRenameDrone(drone.id, newName) : undefined}
            inlineRenameRequestKey={
              inlineRenameDroneRequest?.droneId === drone.id
                ? inlineRenameDroneRequest.key
                : 0
            }
            onSetBaseImage={actionsEnabled ? () => onSetDroneBaseImage(drone.id) : undefined}
            onStartContainer={
              canStartContainer ? () => onStartDroneContainer(drone.id) : undefined
            }
            pinned={pinnedDroneIdSet.has(drone.id)}
            muted={muted || defaultChatMuted}
            collapsedChatMuted={defaultChatMuted}
            pinBusy={pinningDroneIds.has(drone.id)}
            onTogglePinned={
              actionsEnabled
                ? () => void onSetDronePinned(drone.id, !pinnedDroneIdSet.has(drone.id))
                : undefined
            }
            onToggleMuted={
              actionsEnabled
                ? (nextMuted) => void onMoveSidebar({
                    kind: 'set-muted',
                    targetKind: 'drone',
                    targetId: drone.id,
                    muted: nextMuted,
                  })
                : undefined
            }
            onUnmuteCollapsedChat={
              defaultChatDirectlyMuted
                ? () => void onMoveSidebar({
                    kind: 'set-muted',
                    targetKind: 'chat',
                    targetId: sidebarChatSidebarNodeId(drone.id, 'default'),
                    muted: false,
                  })
                : undefined
            }
            onDelete={actionsEnabled ? handleDeleteDrone : undefined}
            onErrorClick={onOpenDroneErrorModal}
            cloneDisabled={
              isOptimistic ||
              actionState.busy ||
              String(drone.runtime ?? 'container').trim().toLowerCase() === 'host'
            }
            cloneChatBusy={Boolean(cloningChatKeys[`${drone.id}:default`])}
            cloneChatDisabled={
              showBusy ||
              Boolean(cloningChatKeys[`${drone.id}:default`]) ||
              isOptimistic ||
              actionState.busy ||
              isDroneStartingOrSeeding(drone.hubPhase)
            }
            createChatDisabled={
              isOptimistic ||
              actionState.busy ||
              isDroneStartingOrSeeding(drone.hubPhase)
            }
            addToGroupDisabled={
              isOptimistic ||
              movingDroneGroups ||
              actionState.busy ||
              isDroneStartingOrSeeding(drone.hubPhase)
            }
            renameDisabled={actionState.busy}
            renameBusy={actionState.renaming}
            setBaseImageDisabled={
              isOptimistic ||
              actionState.busy ||
              isDroneStartingOrSeeding(drone.hubPhase)
            }
            setBaseImageBusy={actionState.settingBaseImage}
            startContainerDisabled={
              isOptimistic ||
              actionState.busy
            }
            startContainerBusy={actionState.startingContainer}
            deleteDisabled={
              isOptimistic ||
              actionState.busy
            }
            deleteBusy={actionState.deleting}
          />
        </div>
      </div>
      {(hasChatSection && chatSectionExpanded) || showCreateChatEditor ? (
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
          {chatTreeEditor?.mode === 'create' && chatTreeEditor.droneId === drone.id && !chatTreeEditor.parentPath ? (
            <GroupedSidebarChatGroupEditor droneId={drone.id} parentPath={null} depth={0} />
          ) : null}
          {chatTree.rootChildIds.map((childId) => (
            <GroupedSidebarChatTreeEntry
              key={childId}
              drone={drone}
              node={chatTree.nodesById[childId]!}
              tree={chatTree}
              isOptimistic={isOptimistic}
              depth={0}
            />
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
    onOpenDraftDrone,
    onStartRenameFolder,
    onOpenGroupMultiChat,
    onDeleteGroup,
    onDeleteDronesInGroup,
    droneById,
    busyChatNodeIdSet,
    approvalRequiredByChatNodeId,
    unreadAgentMessageByChatNodeId,
    droneOperations,
    shouldSuppressClick,
    mutedSidebarGroupIdSet,
    effectiveMutedSidebarGroupIdSet,
    effectiveMutedDroneIdSet,
    effectiveMutedChatIdSet,
    onMoveSidebar,
    actionsEnabled = true,
    repositoryRootView = false,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const folderRenameErrorId = React.useId();
  const folderPath = folderGroupPath(node) ?? node.path;
  const isVirtualGroup = node.groupKind === 'repo' && !node.groupPath;
  const repoPath = sidebarRepoPathFromGroupPath(node.repoGroupPath);
  const mutationKey = sidebarGroupMutationKey(folderPath, node.repoGroupPath);
  const allowVirtualRepoReorderDrop =
    isVirtualGroup && activeDrag?.type === 'sidebar-folder' && activeDrag.groupKind === 'repo';
  const groupRef = React.useMemo(
    () => ({ groupId: node.groupId, group: folderPath, kind: node.groupKind }),
    [folderPath, node.groupId, node.groupKind],
  );
  const groupToken = React.useMemo(() => sidebarGroupOrderToken(groupRef), [groupRef]);
  const groupMuteId = sidebarFolderMuteId(node);
  const directlyMuted = mutedSidebarGroupIdSet.has(groupMuteId);
  const muted = effectiveMutedSidebarGroupIdSet.has(node.id);
  const collapseKey = sidebarFolderCollapseKey(node, repositoryRootView);
  const collapsed = isSidebarGroupCollapsed(collapsedGroups, collapseKey);
  const folderTitle = isVirtualGroup
    ? node.path === 'repo:ungrouped'
      ? 'Drones without a repository'
      : node.path.slice('repo:'.length)
    : folderPath;
  const folderDroneIds = React.useMemo(() => collectSidebarTreeDroneIds(nodeTree, node.id), [node.id, nodeTree]);
  const stateSummary = React.useMemo<SidebarGroupStateSummary>(() => {
    const summary: SidebarGroupStateSummary = { approval: 0, unread: 0, working: 0 };
    if (muted) return summary;
    for (const droneId of folderDroneIds) {
      if (effectiveMutedDroneIdSet.has(droneId)) continue;
      const drone = droneById[droneId];
      if (!drone) continue;
      const chats = normalizedDroneChats(drone, { includeDefaultWhenEmpty: true });
      const approval = chats.some((chatName) => {
        if (effectiveMutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName))) return false;
        const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
        return (
          droneChatRequiresApproval(drone, chatName) ||
          Boolean(approvalRequiredByChatNodeId[chatNodeId])
        );
      });
      const working =
        !approval &&
        ((drone.busyChats ?? []).some(
            (chatName) => !effectiveMutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName)),
          ) ||
          chats.some((chatName) =>
            !effectiveMutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName)) &&
            busyChatNodeIdSet.has(createCanvasChatNodeId(drone.id, chatName)),
          ) ||
          drone.hubPhase === 'creating' ||
          drone.hubPhase === 'starting' ||
          drone.hubPhase === 'seeding' ||
          droneActionState(droneOperations, drone.id).deleting);
      const inactiveDisplayState = sidebarDroneDisplayState(drone, false, '', false, false);
      const unread =
        !working &&
        inactiveDisplayState !== 'blocked' &&
        inactiveDisplayState !== 'offline' &&
        ((drone.unreadChats ?? []).some(
          (chatName) => !effectiveMutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName)),
        ) ||
          chats.some((chatName) =>
            Boolean(
              !effectiveMutedChatIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName)) &&
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
    droneOperations,
    droneById,
    folderDroneIds,
    unreadAgentMessageByChatNodeId,
    muted,
    effectiveMutedDroneIdSet,
    effectiveMutedChatIdSet,
  ]);
  const folderDroneSelected = folderDroneIds.length > 0 && folderDroneIds.every((droneId) => selectedDroneSet.has(droneId));
  const isSelected = isSidebarFolderRowSelected({
    folderNodeId: node.id,
    folderPath,
    selectedSidebarNodeId,
    selectedFolderPath,
  });
  const isHiddenGroup = hiddenSidebarGroupTokenSet.has(groupToken);
  const showEditorInline =
    !isVirtualGroup &&
    folderEditor?.targetPath === folderPath &&
    (!folderEditor?.targetNodeId || folderEditor.targetNodeId === node.id) &&
    folderEditor?.mode === 'rename';
  const showCreateInline =
    (folderEditor?.anchorPath ?? folderEditor?.parentPath) === folderPath &&
    (!folderEditor?.repoGroupPath || folderEditor.repoGroupPath === node.repoGroupPath) &&
    folderEditor?.mode === 'create';
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
      !isVirtualGroup && folderDroneSelected && folderDroneIds.length > 0
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
    onSelectFolder(folderPath, { ...opts, folderNodeId: node.id });
    if (!opts?.selectDrones) {
      onToggleGroupCollapsed(collapseKey);
    }
  }, [collapseKey, folderPath, node.id, onSelectFolder, onToggleGroupCollapsed, setSelectedSidebarNodeId, shouldSuppressClick]);
  const handleFolderDelete = React.useCallback(() => {
    void onDeleteGroup(folderPath, node.totalDroneCount, {
      kind: node.groupKind,
      label: node.label,
      groupId: node.groupId,
      ...(repoPath != null ? { repoPath } : {}),
    });
  }, [folderPath, node.groupId, node.groupKind, node.label, node.totalDroneCount, onDeleteGroup, repoPath]);
  const handleFolderDronesDelete = React.useCallback(() => {
    void onDeleteDronesInGroup(folderPath, {
      label: node.label,
      groupId: node.groupId,
      ...(repoPath != null ? { repoPath } : {}),
    });
  }, [folderPath, node.groupId, node.label, onDeleteDronesInGroup, repoPath]);
  const multiChatTarget = node.repoGroupPath && node.groupPath ? node.path : folderPath;
  const contextMenuItems: SidebarContextMenuItem[] = [
    {
      id: 'new-drone',
      label: 'New drone',
      icon: <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />,
      onSelect: () => onOpenDraftDrone({
        ...(repoPath != null ? { repoPath } : {}),
        group: isVirtualGroup ? '' : folderPath,
      }),
    },
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
            ? {
                anchorPath: folderPath,
                parentCollapseKey: collapseKey,
                repoGroupPath: node.repoGroupPath,
              }
            : node.repoGroupPath
              ? { parentCollapseKey: collapseKey, repoGroupPath: node.repoGroupPath }
              : { parentCollapseKey: collapseKey },
        ),
    },
    ...(!isVirtualGroup
      ? [{
          id: 'rename',
          label: 'Rename',
          shortcut: 'F2',
          separatorBefore: true,
          icon: renamingGroups[mutationKey] ? (
            <IconSpinner className="h-3.5 w-3.5 text-[var(--info)]" />
          ) : (
            <IconPencil className="h-3.5 w-3.5 text-[var(--info)]" />
          ),
          disabled: Boolean(deletingGroups[mutationKey]) || Boolean(renamingGroups[mutationKey]),
          onSelect: () => onStartRenameFolder(folderPath, {
            folderNodeId: node.id,
            groupId: node.groupId,
            repoGroupPath: node.repoGroupPath,
            ...(repoPath != null ? { repoPath } : {}),
          }),
        } satisfies SidebarContextMenuItem]
      : []),
    {
      id: 'mute',
      label: directlyMuted
        ? `Unmute ${isVirtualGroup ? 'repository' : 'group'}`
        : `Mute ${isVirtualGroup ? 'repository' : 'group'}`,
      separatorBefore: true,
      icon: <SidebarMutedStatusIndicator className="h-3.5 w-3.5" />,
      onSelect: () => void onMoveSidebar({
        kind: 'set-muted',
        targetKind: 'group',
        targetId: groupMuteId,
        muted: !directlyMuted,
      }),
    },
    {
      id: 'multi-chat',
      label: 'Open multi-chat',
      shortcut: shortcutBindings.openHoveredGroupMultiChat
        ? formatShortcutBinding(shortcutBindings.openHoveredGroupMultiChat)
        : undefined,
      separatorBefore: true,
      disabled: node.totalDroneCount === 0,
      icon: <IconColumns className="h-3.5 w-3.5 text-[var(--accent)]" />,
      onSelect: () => onOpenGroupMultiChat(multiChatTarget),
    },
    ...(!isVirtualGroup
      ? [
          {
            id: 'delete-drones',
            label: 'Delete drones in group',
            separatorBefore: true,
            icon: deletingGroups[mutationKey] ? (
              <IconSpinner className="h-3.5 w-3.5" />
            ) : (
              <IconTrash className="h-3.5 w-3.5" />
            ),
            disabled:
              node.totalDroneCount === 0 ||
              Boolean(deletingGroups[mutationKey]) ||
              Boolean(renamingGroups[mutationKey]),
            tone: 'danger',
            onSelect: handleFolderDronesDelete,
          } satisfies SidebarContextMenuItem,
          {
            id: 'delete',
            label: 'Delete group',
            shortcut: 'Delete',
            icon: deletingGroups[mutationKey] ? (
              <IconSpinner className="h-3.5 w-3.5" />
            ) : (
              <IconTrash className="h-3.5 w-3.5" />
            ),
            disabled: Boolean(deletingGroups[mutationKey]) || Boolean(renamingGroups[mutationKey]),
            tone: 'danger',
            onSelect: handleFolderDelete,
          } satisfies SidebarContextMenuItem,
        ]
      : []),
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
          className={`dh-sidebar-row-interactive group/folder-row relative flex items-center gap-1 rounded-[var(--sidebar-row-radius)] pr-0.5 transition-colors ${densityClasses.folderRow} ${isVirtualGroup ? sidebarRepositoryRowClass : ''} ${
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
            if (!isSelected) onSelectFolder(folderPath, { folderNodeId: node.id });
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
                  aria-invalid={Boolean(folderEditor.error)}
                  aria-describedby={folderEditor.error ? folderRenameErrorId : undefined}
                  title={folderEditor.error || 'Rename group'}
                  className={`min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 leading-tight shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${
                    folderEditor.error ? 'text-[var(--red)]' : 'text-[var(--fg)]'
                  } ${densityClasses.folderInput}`}
                  style={{ border: 0, outline: 'none', boxShadow: 'none' }}
                />
                {folderEditor.error ? (
                  <span id={folderRenameErrorId} role="alert" className="sr-only">
                    {folderEditor.error}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`min-w-0 flex-1 rounded text-left ${densityClasses.folderPaddingX} ${
                isSelected ? 'focus-visible:outline-none' : ''
              }`}
              aria-expanded={!collapsed}
              aria-selected={isSelected}
              aria-label={`${node.label}${muted ? ', muted' : ''}`}
              {...(folderDndDisabled ? {} : attributes as unknown as Record<string, unknown>)}
              {...(folderDndDisabled ? {} : listeners as unknown as Record<string, unknown>)}
              onClick={(event) => {
                const toggle = event.metaKey || event.ctrlKey;
                handleFolderClick({
                  selectDrones: toggle || event.shiftKey,
                  toggle,
                  folderNodeId: node.id,
                });
              }}
              onKeyDown={(event) => {
                if (
                  event.key !== 'Delete' ||
                  event.repeat ||
                  !actionsEnabled ||
                  isVirtualGroup ||
                  !isSelected ||
                  deletingGroups[mutationKey] ||
                  renamingGroups[mutationKey] ||
                  (node.groupKind === 'group' && isUngroupedGroupName(node.groupPath ?? folderPath))
                ) {
                  if (!folderDndDisabled) listeners?.onKeyDown?.(event);
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                handleFolderDelete();
              }}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <IconChevron
                  down={!collapsed}
                  strokeWidth={1.25}
                  className={`flex-shrink-0 ${densityClasses.folderChevron}`}
                />
                {isVirtualGroup ? (
                  node.path === 'repo:ungrouped' ? (
                    <IconFolderOutline className="h-3.5 w-3.5 flex-shrink-0 text-[var(--sidebar-meta-fg)]" />
                  ) : (
                    <IconFolderGit className="h-3.5 w-3.5 flex-shrink-0 text-[var(--sidebar-action-fg)]" />
                  )
                ) : null}
                <span
                  className={`${isVirtualGroup ? sidebarRepositoryLabelClass : sidebarFolderLabelClass} ${densityClasses.folderLabel}`}
                  title={folderTitle}
                >
                  {node.label}
                </span>
                {muted ? <SidebarMutedStatusIndicator /> : collapsed ? <SidebarGroupStateCounts summary={stateSummary} /> : null}
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
          className={`${densityClasses.folderBody} dh-sidebar-folder-body [--sidebar-selection-edge-offset:-1px] ${intoState ? 'bg-[var(--accent-subtle)]' : ''}`}
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
  const confirmDelete = useAppConfirmDialog();
  const mutedSidebarGroupIds = useDroneHubUiStore((state) => state.mutedSidebarGroupIds);
  const mutedDroneIds = useDroneHubUiStore((state) => state.mutedDroneIds);
  const mutedChatIds = useDroneHubUiStore((state) => state.mutedChatIds);
  const sidebarChatGroupPathsByDrone = useDroneHubUiStore((state) => state.sidebarChatGroupPathsByDrone);
  const sidebarChatGroupByChat = useDroneHubUiStore((state) => state.sidebarChatGroupByChat);
  const sidebarChatNodeOrderByParent = useDroneHubUiStore((state) => state.sidebarChatNodeOrderByParent);
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
  const [selectedChatNodeIds, setSelectedChatNodeIds] = React.useState<string[]>([]);
  const [chatSelectionAnchorByDrone, setChatSelectionAnchorByDrone] = React.useState<Record<string, string>>({});
  const [chatTreeEditor, setChatTreeEditor] = React.useState<{ mode: 'create' | 'rename'; droneId: string; parentPath: string | null; path: string | null; value: string; error: string | null } | null>(null);
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
  const mutedSidebarGroupIdSet = React.useMemo(
    () => new Set(mutedSidebarGroupIds),
    [mutedSidebarGroupIds],
  );
  const mutedChatIdSet = React.useMemo(() => new Set(mutedChatIds), [mutedChatIds]);
  const mutedDroneIdSet = React.useMemo(() => new Set(mutedDroneIds), [mutedDroneIds]);
  const selectedChatNodeIdSet = React.useMemo(() => new Set(selectedChatNodeIds), [selectedChatNodeIds]);
  const chatTreeByDrone = React.useMemo(() => Object.fromEntries(
    Object.values(droneById).map((drone) => [
      drone.id,
      buildSidebarChatTree({
        droneId: drone.id,
        chatNames: orderSidebarEntries(
          normalizedDroneChats(drone),
          sidebarChatOrderByDrone[drone.id] ?? [],
          (chatName) => chatName,
        ),
        groupPaths: sidebarChatGroupPathsByDrone[drone.id] ?? [],
        groupByChat: sidebarChatGroupByChat,
        nodeOrderByParent: sidebarChatNodeOrderByParent,
      }),
    ]),
  ), [droneById, sidebarChatGroupByChat, sidebarChatGroupPathsByDrone, sidebarChatNodeOrderByParent, sidebarChatOrderByDrone]);

  const flattenedChatNodeIds = React.useCallback((droneId: string): string[] => {
    const tree = chatTreeByDrone[droneId];
    if (!tree) return [];
    const out: string[] = [];
    const visit = (nodeId: string) => {
      const node = tree.nodesById[nodeId];
      if (!node) return;
      if (node.kind === 'chat') out.push(node.id);
      for (const childId of tree.childIdsByParent[nodeId] ?? []) visit(childId);
    };
    for (const nodeId of tree.rootChildIds) visit(nodeId);
    return out;
  }, [chatTreeByDrone]);

  React.useEffect(() => {
    const available = new Set(
      Object.values(chatTreeByDrone).flatMap((tree) =>
        Object.values(tree.nodesById)
          .filter((node): node is Extract<SidebarChatTreeNode, { kind: 'chat' }> => node.kind === 'chat')
          .map((node) => node.id)),
    );
    setSelectedChatNodeIds((current) => {
      const next = current.filter((nodeId) => available.has(nodeId));
      return next.length === current.length ? current : next;
    });
  }, [chatTreeByDrone]);

  React.useEffect(() => {
    if (!props.selectedSidebarNodeId || selectedChatNodeIdSet.has(props.selectedSidebarNodeId)) return;
    setSelectedChatNodeIds(clearSidebarChatNodeSelection);
  }, [props.selectedSidebarNodeId, selectedChatNodeIdSet]);

  const selectChatNode = React.useCallback((droneId: string, chatName: string, event: Pick<React.MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => {
    const nodeId = sidebarChatNodeId(droneId, chatName);
    const additive = event.ctrlKey || event.metaKey;
    const ordered = flattenedChatNodeIds(droneId);
    const anchor = chatSelectionAnchorByDrone[droneId];
    setSelectedChatNodeIds((current) => {
      const sameDrone = current.filter((id) => ordered.includes(id));
      return selectSidebarChatNodes({
        currentNodeIds: sameDrone,
        orderedNodeIds: ordered,
        nodeId,
        anchorNodeId: anchor,
        additive,
        range: event.shiftKey,
      });
    });
    if (!event.shiftKey || !anchor) {
      setChatSelectionAnchorByDrone((current) => ({ ...current, [droneId]: nodeId }));
    }
  }, [chatSelectionAnchorByDrone, flattenedChatNodeIds]);

  const createChatGroup = React.useCallback((droneId: string, parentPath: string | null = null) => {
    setChatTreeEditor({ mode: 'create', droneId, parentPath, path: null, value: '', error: null });
    props.setCollapsedDroneSections((prev) => ({
      ...prev,
      [sidebarInlineSectionKey(droneId, 'chats')]: false,
      ...(parentPath ? { [chatGroupCollapseKey(droneId, parentPath)]: false } : {}),
    }));
  }, [props.setCollapsedDroneSections]);
  const renameChatGroup = React.useCallback((droneId: string, path: string) => {
    setChatTreeEditor({ mode: 'rename', droneId, parentPath: sidebarChatGroupParentPath(path), path, value: sidebarChatGroupBaseName(path), error: null });
  }, []);
  const deleteChatGroup = React.useCallback((droneId: string, path: string) => {
    if (!window.confirm(`Delete the group “${sidebarChatGroupBaseName(path)}”? Its chats will move to the parent group.`)) return;
    void props.onMoveSidebar({ kind: 'chat-group-delete', droneId, path }).then((ok) => {
      if (!ok) return;
      const prefix = chatGroupCollapseKey(droneId, path);
      props.setCollapsedDroneSections((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== prefix && !key.startsWith(`${prefix}/`)),
      ));
    });
  }, [props.onMoveSidebar, props.setCollapsedDroneSections]);
  const createChatInGroup = React.useCallback(async (drone: DroneSummary, path: string) => {
    const requested = window.prompt(`New chat in ${sidebarChatGroupBaseName(path)}`, '');
    const name = String(requested ?? '').trim();
    if (!name) return;
    const result = await props.onCreateDroneChat(drone, name);
    if (!result.ok || !result.chatName) {
      if (result.error) window.alert(result.error);
      return;
    }
    const tree = chatTreeByDrone[drone.id];
    await props.onMoveSidebar({
      kind: 'chat-tree-move',
      droneId: drone.id,
      itemKind: 'chat',
      activeNodeId: sidebarChatNodeId(drone.id, result.chatName),
      sourcePath: null,
      sourceSiblingNodeIds: tree?.rootChildIds ?? [],
      targetPath: path,
      targetSiblingNodeIds: tree?.childIdsByParent[sidebarChatGroupNodeId(drone.id, path)] ?? [],
      placement: 'inside',
    });
  }, [chatTreeByDrone, props.onCreateDroneChat, props.onMoveSidebar]);
  const { effectiveMutedSidebarGroupIdSet, effectiveMutedDroneIdSet } = React.useMemo(
    () => resolveEffectiveSidebarMuteSets(nodeTree, mutedSidebarGroupIdSet, mutedDroneIdSet),
    [mutedDroneIdSet, mutedSidebarGroupIdSet, nodeTree],
  );
  const { effectiveMutedChatGroupIdSet, effectiveMutedChatIdSet } = React.useMemo(() => {
    const effectiveGroups = new Set<string>();
    const effectiveChats = new Set<string>();
    for (const tree of Object.values(chatTreeByDrone)) {
      const resolved = resolveEffectiveSidebarChatMuteSets(tree, mutedChatIdSet);
      for (const groupId of resolved.effectiveMutedChatGroupIdSet) effectiveGroups.add(groupId);
      for (const chatId of resolved.effectiveMutedChatIdSet) effectiveChats.add(chatId);
    }
    return {
      effectiveMutedChatGroupIdSet: effectiveGroups,
      effectiveMutedChatIdSet: effectiveChats,
    };
  }, [chatTreeByDrone, mutedChatIdSet]);
  const visibleDroneOrder = React.useMemo(
    () => flattenVisibleDroneOrderFromNodeTree(
      nodeTree,
      props.collapsedGroups,
      displayedRootChildIds,
      props.repositoryRootView === true,
    ),
    [displayedRootChildIds, nodeTree, props.collapsedGroups, props.repositoryRootView],
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
    async (
      droneIdRaw: string,
      chatNameRaw: string,
      opts?: DeleteDroneChatOptions,
    ) => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      if (!droneId || !chatName || chatName === 'default') return false;
      const key = `${droneId}:${chatName}`;
      if (deletingChats[key]) return false;
      setDeletingChats((prev) => ({ ...prev, [key]: true }));
      try {
        const result = await onDeleteDroneChat(droneId, chatName, opts);
        if (!result.ok && result.error) {
          window.alert(result.error);
        } else if (result.ok) {
          const targetId = sidebarChatSidebarNodeId(droneId, chatName);
          await onMoveSidebar({
            kind: 'chat-tree-remove',
            droneId,
            nodeIds: [sidebarChatNodeId(droneId, chatName)],
          });
          if (mutedChatIdSet.has(targetId)) {
            await onMoveSidebar({
              kind: 'set-muted',
              targetKind: 'chat',
              targetId,
              muted: false,
            });
          }
          return true;
        }
        return false;
      } finally {
        setDeletingChats((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [deletingChats, mutedChatIdSet, onDeleteDroneChat, onMoveSidebar],
  );

  const deleteSelectedChats = React.useCallback(async (droneId: string, fallbackChatName: string) => {
    const fallbackNodeId = sidebarChatNodeId(droneId, fallbackChatName);
    const selectedNames = selectedChatNodeIdSet.has(fallbackNodeId) ? flattenedChatNodeIds(droneId)
      .filter((nodeId) => selectedChatNodeIdSet.has(nodeId))
      .map((nodeId) => chatTreeByDrone[droneId]?.nodesById[nodeId])
      .filter((node): node is Extract<SidebarChatTreeNode, { kind: 'chat' }> => node?.kind === 'chat')
      .map((node) => node.chatName) : [];
    const names = (selectedNames.length ? selectedNames : [fallbackChatName]).filter((name) => name !== 'default');
    if (!names.length) return;
    const defaultChatKept = selectedChatNodeIdSet.has(sidebarChatNodeId(droneId, 'default'));
    const drone = droneById[droneId];
    const confirmed = await confirmDelete(buildSidebarChatDeleteConfirmation({
      chatNames: names,
      droneLabel: props.uiDroneName(drone?.name ?? droneId),
      deleteMode: props.deleteMode,
      draftChatNames: names.filter((chatName) => drone?.draftChats?.[chatName] === true),
      defaultChatKept,
    }));
    if (!confirmed) return;
    const deletedIds = new Set<string>();
    for (const chatName of names) {
      if (await handleDeleteChat(droneId, chatName, { confirmed: true })) {
        deletedIds.add(sidebarChatNodeId(droneId, chatName));
      }
    }
    setSelectedChatNodeIds((current) => current.filter((id) => !deletedIds.has(id)));
  }, [chatTreeByDrone, confirmDelete, droneById, flattenedChatNodeIds, handleDeleteChat, props.deleteMode, props.uiDroneName, selectedChatNodeIdSet]);

  const deleteChatsInGroup = React.useCallback(async (droneId: string, path: string) => {
    const tree = chatTreeByDrone[droneId];
    const groupNodeId = sidebarChatGroupNodeId(droneId, path);
    if (!tree?.nodesById[groupNodeId]) return;
    const allChatNames = sidebarChatTreeChatNamesInGroup(tree, groupNodeId);
    const names = allChatNames.filter((chatName) => chatName !== 'default');
    if (!names.length) return;
    const confirmed = await confirmDelete(buildSidebarChatGroupDeleteConfirmation({
      chatCount: names.length,
      groupLabel: sidebarChatGroupBaseName(path),
      droneLabel: props.uiDroneName(droneById[droneId]?.name ?? droneId),
      deleteMode: props.deleteMode,
      draftChatCount: names.filter((chatName) =>
        droneById[droneId]?.draftChats?.[chatName] === true).length,
      defaultChatKept: allChatNames.includes('default'),
    }));
    if (!confirmed) return;
    const deletedIds = new Set<string>();
    for (const chatName of names) {
      if (await handleDeleteChat(droneId, chatName, { confirmed: true })) {
        deletedIds.add(sidebarChatNodeId(droneId, chatName));
      }
    }
    setSelectedChatNodeIds((current) => current.filter((id) => !deletedIds.has(id)));
  }, [chatTreeByDrone, confirmDelete, droneById, handleDeleteChat, props.deleteMode, props.uiDroneName]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const first = selectedChatNodeIds[0];
      if (!first) return;
      if (!props.selectedSidebarNodeId || !selectedChatNodeIdSet.has(props.selectedSidebarNodeId)) return;
      const node = Object.values(chatTreeByDrone).flatMap((tree) => Object.values(tree.nodesById)).find((candidate) => candidate.id === first);
      if (!node || node.kind !== 'chat') return;
      event.preventDefault();
      void deleteSelectedChats(node.droneId, node.chatName);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chatTreeByDrone, deleteSelectedChats, props.selectedSidebarNodeId, selectedChatNodeIds, selectedChatNodeIdSet]);

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

  const createChatTreeMoveIntent = React.useCallback((event: DragMoveEvent | DragOverEvent | DragEndEvent): SidebarMoveIntent | null => {
    const active = parseDroneHubDragData(event.active.data.current);
    if (active?.type !== 'sidebar-chat' && active?.type !== 'sidebar-chat-folder') return null;
    const overData = event.over?.data.current as Record<string, unknown> | undefined;
    if (overData?.type !== 'sidebar-chat-tree-node' && overData?.type !== 'sidebar-chat-tree-root') return null;
    const droneId = String(overData.droneId ?? '').trim();
    if (!droneId || droneId !== active.droneId) return null;
    const tree = chatTreeByDrone[droneId];
    if (!tree) return null;
    const activeNodeId = active.type === 'sidebar-chat'
      ? sidebarChatNodeId(droneId, active.chatName)
      : active.sidebarNodeId;
    const sourceNode = tree.nodesById[activeNodeId];
    if (!sourceNode) return null;
    const sourceParent = sourceNode.parentId === tree.rootId ? null : tree.nodesById[sourceNode.parentId];
    const sourcePath = sourceParent?.kind === 'folder' ? sourceParent.path : null;
    if (overData.type === 'sidebar-chat-tree-root') {
      return {
        kind: 'chat-tree-move',
        droneId,
        itemKind: active.type === 'sidebar-chat' ? 'chat' : 'folder',
        activeNodeId,
        ...(active.type === 'sidebar-chat' ? { activeNodeIds: active.sidebarNodeIds } : {}),
        sourcePath,
        sourceSiblingNodeIds: tree.childIdsByParent[sourceNode.parentId] ?? [],
        targetPath: null,
        targetSiblingNodeIds: tree.rootChildIds,
        placement: 'inside',
      };
    }
    const overNodeId = String(overData.nodeId ?? '').trim();
    const overNode = tree.nodesById[overNodeId];
    if (!overNode || overNode.id === activeNodeId) return null;
    const placement = placementFromEvent(event, overNode.kind === 'folder');
    const intoFolder = placement === 'into' && overNode.kind === 'folder';
    const targetParentId = intoFolder ? overNode.id : overNode.parentId;
    const targetParent = targetParentId === tree.rootId ? null : tree.nodesById[targetParentId];
    const targetPath = targetParent?.kind === 'folder' ? targetParent.path : null;
    return {
      kind: 'chat-tree-move',
      droneId,
      itemKind: active.type === 'sidebar-chat' ? 'chat' : 'folder',
      activeNodeId,
      ...(active.type === 'sidebar-chat' ? { activeNodeIds: active.sidebarNodeIds } : {}),
      sourcePath,
      sourceSiblingNodeIds: tree.childIdsByParent[sourceNode.parentId] ?? [],
      targetPath,
      targetSiblingNodeIds: tree.childIdsByParent[targetParentId] ?? [],
      ...(intoFolder ? {} : { overNodeId }),
      placement: intoFolder ? 'inside' : placement === 'after' ? 'after' : 'before',
    };
  }, [chatTreeByDrone]);

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
              const chatTreeIntent = createChatTreeMoveIntent(event);
              if (chatTreeIntent) {
                void onMoveSidebar(chatTreeIntent);
                clearDragState();
                return;
              }
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
      createChatTreeMoveIntent,
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
      mutedSidebarGroupIdSet,
      effectiveMutedSidebarGroupIdSet,
      effectiveMutedDroneIdSet,
      mutedDroneIdSet,
      mutedChatIdSet,
      effectiveMutedChatGroupIdSet,
      effectiveMutedChatIdSet,
      selectedChatNodeIdSet,
      chatSelectionAnchorByDrone,
      chatTreeByDrone,
      chatTreeEditor,
      setChatTreeEditor,
      selectChatNode,
      deleteSelectedChats,
      createChatGroup,
      renameChatGroup,
      deleteChatGroup,
      deleteChatsInGroup,
      createChatInGroup,
    }),
    [
      props.activeChatName,
      props.approvalRequiredByChatNodeId,
      props.busyChatNodeIdSet,
      props.chatEditor,
      props.chatEditorInputRef,
      props.cloningChatKeys,
      props.collapsedDroneSections,
      props.collapsedGroups,
      props.droneOperations,
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
      props.onDeleteDronesInGroup,
      props.onFolderEditorValueChange,
      props.onMoveDronesToGroup,
      props.onCloneDrone,
      props.onCloneDroneChat,
      props.onCreateGroupBeforeDrone,
      props.onOpenCreateDroneChat,
      props.onOpenDroneErrorModal,
      props.onOpenDraftDrone,
      props.onOpenFolderCreate,
      props.onOpenGroupMultiChat,
      props.onPrepareDroneDragStart,
      props.onRenameDrone,
      props.inlineRenameDroneRequest,
      props.onRenameDroneChat,
      props.onRenameGroup,
      props.onReparentDronesToParent,
      props.onSelectDroneCard,
      props.onSelectDroneContainer,
      props.onSelectDroneChat,
      props.onSelectFolder,
      props.onSetDroneBaseImage,
      props.onStartDroneContainer,
      props.onSetDronePinned,
      props.onStartRenameDroneChat,
      props.onStartRenameFolder,
      props.onSubmitChatEditor,
      props.onSubmitFolderEditor,
      props.onToggleGroupCollapsed,
      props.onToggleDroneSection,
      props.renamingGroups,
      props.repositoryRootView,
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
      mutedSidebarGroupIdSet,
      effectiveMutedSidebarGroupIdSet,
      effectiveMutedDroneIdSet,
      mutedDroneIdSet,
      mutedChatIdSet,
      effectiveMutedChatGroupIdSet,
      effectiveMutedChatIdSet,
      selectedChatNodeIdSet,
      chatSelectionAnchorByDrone,
      chatTreeByDrone,
      chatTreeEditor,
      selectChatNode,
      deleteSelectedChats,
      createChatGroup,
      renameChatGroup,
      deleteChatGroup,
      deleteChatsInGroup,
      createChatInGroup,
    ],
  );

  return (
    <GroupedSidebarTreeContext.Provider value={contextValue}>
      <GroupedSidebarChildEntries
        childIds={displayedRootChildIds}
        groupPath={null}
        showCreateInline={
          props.actionsEnabled !== false &&
          props.repositoryRootView !== true &&
          props.folderEditor?.mode === 'create' &&
          props.folderEditor.parentPath === null
        }
      />
    </GroupedSidebarTreeContext.Provider>
  );
}
