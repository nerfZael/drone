import React from 'react';
import { useDndMonitor, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { isUngroupedGroupName } from '../../domain';
import {
  DroneCard,
  SidebarItemStateIndicator,
  sidebarChatDisplayState,
  sidebarDroneStateLabel,
} from '../overview';
import type { DroneSummary } from '../types';
import { createCanvasChatNodeId } from './app-config';
import { droneChatRequiresApproval, normalizedDroneChats } from './chat-node-helpers';
import { createSidebarChatDragData, parseDroneHubDragData, useDroneHubActiveDrag, type SidebarDroneDragData } from './drone-hub-dnd';
import { isDroneStartingOrSeeding } from './helpers';
import { IconColumns, IconEye, IconEyeOff, IconFolder, IconPencil, IconPlus, IconSpinner, IconTrash } from './icons';
import { canReorderSidebarDroneSelectionAtParent } from './sidebar-drone-drop';
import type { DroneSelectionClickOptions } from './drone-selection-helpers';
import type { SidebarFolderSelectionOptions } from './sidebar-folder-selection';
import { buildSidebarDroneTree, type SidebarDroneTree } from './sidebar-drone-tree';
import { buildSidebarNodeTree, type SidebarNodeTreeModel, type SidebarTreeDroneNode, type SidebarTreeFolderNode, type SidebarTreeNode } from './sidebar-node-tree';
import {
  moveSidebarNodeIdsBetweenParents,
  removeDroneIdsFromSidebarNodeOrderByParent,
  reorderSidebarNodeParentOrder,
  SIDEBAR_ROOT_PARENT_ID,
  sidebarChatSidebarNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
  sidebarFolderPathFromNodeId,
} from './sidebar-node-order';
import {
  orderSidebarEntries,
  reorderSidebarEntryOrder,
  reorderSidebarGroupOrder,
  sidebarGroupOrderToken,
  type SidebarGroupDropPlacement,
} from './sidebar-group-order';
import {
  normalizeSidebarReorderTarget,
  sidebarDropPlacementFromRects,
  SidebarReorderDropIndicator,
} from './sidebar-reorder-ui';
import { isSameOrDescendantSidebarGroupPath, joinSidebarGroupPath, sidebarGroupBaseName } from './sidebar-group-paths';
import type { DroneDeleteMode, SidebarDensityMode } from './settings-types';
import { useChatApprovalRequired } from './use-drone-hub-runtime-store';
import type { MoveDronesToGroupResult } from './use-group-management';
import type { SidebarGroup } from './use-sidebar-view-model';
import {
  sidebarChatLabelClass,
  sidebarChatRowTone,
  sidebarChatStateClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
  sidebarSelectionEdgeClass,
} from '../sidebar/presentation';

const GROUPED_FOLDER_SINGLE_CLICK_DELAY_MS = 180;

type FolderEditorState = {
  mode: 'create' | 'rename';
  parentPath: string | null;
  anchorPath: string | null;
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
  setSidebarGroupOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setSidebarNodeOrderByParent: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  setSidebarChatOrderByDrone: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
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
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onRenameGroup: (group: string, nextName?: string, opts?: { skipNodeOrderUpdate?: boolean }) => Promise<boolean> | boolean;
  onToggleGroupCollapsed: (group: string) => void;
  collapsedGroups: Record<string, boolean>;
  deletingGroups: Record<string, boolean>;
  renamingGroups: Record<string, boolean>;
  hiddenSidebarGroupTokenSet: Set<string>;
  selectedGroupMultiChat: string | null;
  onOpenFolderCreate: (
    parentPath: string | null,
    opts?: { anchorPath?: string | null; repoGroupPath?: string | null },
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
  onOpenCloneModal: (drone: DroneSummary) => void;
  onAddDroneToGroup: (drone: DroneSummary) => void;
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
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  pinnedDroneIdSet: ReadonlySet<string>;
  pinningDroneIds: ReadonlySet<string>;
  onSetDronePinned: (droneId: string, pinned: boolean) => Promise<void>;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onPrepareDroneDragStart: (droneId: string) => void;
  onReparentDronesToParent: (
    parentDroneId: string | null,
    droneIds: string[],
    opts?: { targetGroup?: string | null },
  ) => Promise<{ ok: boolean; error?: string | null; reparentedIds?: string[]; rollbackOptimistic?: () => void }>;
  actionsEnabled?: boolean;
};

type TreeDropPlacement = SidebarGroupDropPlacement | 'into';

type GroupedSidebarTreeContextValue = GroupedSidebarTreeProps & {
  nodeTree: SidebarNodeTreeModel;
  displayDepthOffset: number;
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
  nodeId: string;
  folderPath: string;
  groupKind: 'group' | 'repo';
  label: string;
}): {
  type: 'sidebar-folder';
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
      if (folderPath && collapsedGroups[folderPath]) return;
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

function folderTargetGroupPath(node: SidebarTreeFolderNode | null | undefined): string | null {
  if (!node) return null;
  if (node.groupKind === 'repo' && !node.groupPath) return null;
  return folderGroupPath(node);
}

function isVirtualRepoRootNode(node: SidebarTreeNode | null | undefined): node is SidebarTreeFolderNode {
  return Boolean(node && node.kind === 'folder' && node.groupKind === 'repo' && !node.groupPath);
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
    movingDroneGroups,
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
    onChatEditorValueChange,
    onSubmitChatEditor,
    onBlurChatEditor,
    onCancelChatEditor,
    deletingChats,
    handleDeleteChat,
    shouldSuppressClick,
    actionsEnabled = true,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
  const locallyRequiredApproval = useChatApprovalRequired(chatNodeId);
  const approvalRequired =
    droneChatRequiresApproval(drone, chatName) || locallyRequiredApproval;
  const sidebarChatId = sidebarChatSidebarNodeId(drone.id, chatName);
  const chatDragData = React.useMemo(
    () => createSidebarChatDragData(drone.id, chatName, `${uiDroneName(drone.name)} / ${chatName}`),
    [chatName, drone.id, drone.name, uiDroneName],
  );
  const chatDndDisabled = !sidebarDndEnabled || !chatDragData || movingDroneGroups || isOptimistic;
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
  const chatBusy = busyChatNodeIdSet.has(chatNodeId);
  const chatUnread = !active && unreadAgentMessageByChatNodeId[chatNodeId] === true;
  const chatState = sidebarChatDisplayState(drone, chatBusy, approvalRequired);
  const chatStateLabel = sidebarDroneStateLabel(chatState, chatUnread);
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
        <div className={`flex items-center gap-1.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] ${densityClasses.chatRow}`}>
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
          className={`relative flex flex-1 items-center gap-1.5 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ selected, active })} ${isDragging ? 'opacity-35' : ''} ${!sidebarDndEnabled || movingDroneGroups || isOptimistic ? '' : 'cursor-grab touch-none active:cursor-grabbing'} ${actionsEnabled && chatName !== 'default' ? 'group-hover/chat-row:pr-14 group-focus-within/chat-row:pr-14' : ''}`}
          title={`${uiDroneName(drone.name)} / ${chatName}`}
        >
          {selected || active ? <span className={sidebarSelectionEdgeClass} /> : null}
          <span
            className={sidebarChatStateClass}
            title={chatStateLabel}
            role="img"
            aria-label={chatStateLabel}
          >
            <SidebarItemStateIndicator state={chatState} unread={chatUnread} />
          </span>
          <span className={sidebarChatLabelClass}>{chatName}</span>
          {draft ? (
            <span className="flex-shrink-0 rounded border border-[var(--accent-muted)] px-1 py-0.5 text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)]">
              Draft
            </span>
          ) : null}
        </button>
        {actionsEnabled && chatName !== 'default' ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStartRenameDroneChat(drone.id, chatName);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              className={`inline-flex ${densityClasses.chatDeleteWidth} flex-shrink-0 items-center justify-center rounded border bg-[var(--info-subtle)] border-[var(--info-border)] text-[var(--info)] opacity-0 pointer-events-none transition-opacity group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto hover:bg-[var(--info-subtle)]`}
              title={`Rename chat "${chatName}"`}
              aria-label={`Rename chat "${chatName}"`}
            >
              <IconPencil className="opacity-90" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleDeleteChat(drone.id, chatName);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              disabled={Boolean(deletingChats[`${drone.id}:${chatName}`])}
              className={`inline-flex ${densityClasses.chatDeleteWidth} flex-shrink-0 items-center justify-center rounded border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] opacity-0 pointer-events-none transition-opacity group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto disabled:opacity-50`}
              title={`Delete chat "${chatName}"`}
              aria-label={`Delete chat "${chatName}"`}
            >
              {deletingChats[`${drone.id}:${chatName}`] ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
            </button>
          </div>
        ) : null}
      </div>
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
  const chatBusy = busyChatNodeIdSet.has(chatNodeId);
  const chatUnread = !active && unreadAgentMessageByChatNodeId[chatNodeId] === true;
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
          className={`relative flex flex-1 items-center gap-1.5 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ selected, active })}`}
          title={`${uiDroneName(drone.name)} / ${chatName}`}
        >
          {selected || active ? <span className={sidebarSelectionEdgeClass} /> : null}
          <span
            className={sidebarChatStateClass}
            title={chatStateLabel}
            role="img"
            aria-label={chatStateLabel}
          >
            <SidebarItemStateIndicator state={chatState} unread={chatUnread} />
          </span>
          <span className={sidebarChatLabelClass}>{chatName}</span>
        </button>
      </div>
    </div>
  );
});

const GroupedSidebarChatRow = React.memo(function GroupedSidebarChatRow(props: GroupedSidebarChatRowProps) {
  const { sidebarDndEnabled } = useGroupedSidebarTreeContext();
  return sidebarDndEnabled ? <GroupedSidebarChatRowDnd {...props} /> : <GroupedSidebarChatRowStatic {...props} />;
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
    unreadAgentMessageByChatNodeId,
    deletingDrones,
    deleteOperationModeById,
    deleteMode,
    renamingDrones,
    settingBaseImages,
    chatEditor,
    selectedSidebarNodeId,
    selectedFolderPath,
    setSelectedSidebarNodeId,
    onSelectDroneCard,
    selectedDrone,
    activeChatName,
    onOpenCloneModal,
    onAddDroneToGroup,
    onOpenCreateDroneChat,
    onChatEditorValueChange,
    onChatEditorCreateAsDraftChange,
    onSubmitChatEditor,
    onBlurChatEditor,
    onCancelChatEditor,
    chatEditorInputRef,
    onRenameDrone,
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
  const dragDisabled = !sidebarDndEnabled || movingDroneGroups || isOptimistic;
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
  const showCreateChatEditor = chatEditor?.mode === 'create' && chatEditor.droneId === drone.id;
  const defaultChatNodeId = createCanvasChatNodeId(drone.id, 'default');
  const locallyRequiredDefaultChatApproval = useChatApprovalRequired(defaultChatNodeId);
  const defaultChatApprovalRequired =
    droneChatRequiresApproval(drone, 'default') || locallyRequiredDefaultChatApproval;
  const showBusy =
    !isDroneStartingOrSeeding(drone.hubPhase) && hasOnlyDefaultChat && busyChatNodeIdSet.has(defaultChatNodeId);
  const showUnread = hasOnlyDefaultChat && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true;
  const childDroneIds = (nodeTree.childIdsByParent[node.id] ?? [])
    .map((childNodeId) => nodeTree.nodesById[childNodeId])
    .filter((child): child is SidebarTreeDroneNode => Boolean(child && child.kind === 'drone'));
  const selected = selectedDroneSet.has(drone.id) || selectedSidebarNodeId === node.id;
  const showOpenDefaultChatIndicator =
    hasOnlyDefaultChat && selectedDrone === drone.id && activeChatName === 'default';
  const hasActiveChildChat = selectedDrone === drone.id && !hasOnlyDefaultChat;
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
    <div className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${nested ? densityClasses.nestedDroneIndent : ''} ${reorderPreviewClass}`}>
      <div ref={droneDropDisabled ? undefined : setDropNodeRef} data-sidebar-node-anchor-id={node.id} className="relative">
        {dragOverTreeTarget?.nodeId === node.id &&
        (dragOverTreeTarget.placement === 'before' || dragOverTreeTarget.placement === 'after') ? (
          <TreeDropGuide placement={dragOverTreeTarget.placement} />
        ) : null}
        <div>
          <DroneCard
            drone={drone}
            density={sidebarDensityMode}
            displayName={uiDroneName(drone.name)}
            selected={selected}
            highlighted={highlightedDroneIds.has(drone.id)}
            active={showOpenDefaultChatIndicator}
            activeIndicatorStyle="edge"
            selectionTone={hasActiveChildChat ? 'muted' : 'accent'}
            showSelectionEdge={!hasActiveChildChat}
            busy={showBusy}
            approvalRequired={hasOnlyDefaultChat && defaultChatApprovalRequired}
            operationLabel={
              deletingDrones[drone.id]
                ? ((deleteOperationModeById[drone.id] ?? deleteMode) === 'archive' ? 'Archiving' : 'Deleting')
                : undefined
            }
            unreadAgentMessage={showUnread}
            onClick={(rowOpts) => {
              if (shouldSuppressClick()) return;
              setSelectedSidebarNodeId(node.id);
              onSelectDroneCard(drone.id, { ...rowOpts, orderedDroneIds: visibleDroneOrder });
            }}
            dragNodeRef={dragDisabled ? undefined : setDragNodeRef}
            draggable={!dragDisabled}
            dragging={isDragging}
            dragAttributes={dragDisabled ? undefined : attributes as unknown as Record<string, unknown>}
            dragListeners={dragDisabled ? undefined : listeners as unknown as Record<string, unknown>}
            onCreateChat={actionsEnabled ? () => onOpenCreateDroneChat(drone) : undefined}
            onClone={actionsEnabled ? () => onOpenCloneModal(drone) : undefined}
            onAddToGroup={actionsEnabled ? () => onAddDroneToGroup(drone) : undefined}
            onRename={actionsEnabled ? () => onRenameDrone(drone.id) : undefined}
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
              isOptimistic ||
              Boolean(deletingDrones[drone.id]) ||
              Boolean(renamingDrones[drone.id]) ||
              Boolean(settingBaseImages[drone.id]) ||
              isDroneStartingOrSeeding(drone.hubPhase)
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
      {chats.length > 1 || showCreateChatEditor ? (
        <div ref={chatTailDropDisabled ? undefined : setChatTailDropNodeRef} className={`${densityClasses.chatBlockIndent} flex flex-col gap-0.5`}>
          {showCreateChatEditor ? (
            <div className="flex flex-col gap-0.5">
              <div className={`flex items-center gap-1.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] ${densityClasses.chatRow}`}>
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
        <div className={`${densityClasses.nestedDroneRail} flex flex-col gap-0.5 border-l border-[var(--border-subtle)]`}>
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

function GroupedSidebarFolderBodyDropZone({
  nodeId,
  disabled,
  className,
  children,
}: {
  nodeId: string;
  disabled: boolean;
  className: string;
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
    <div ref={dropDisabled ? undefined : setNodeRef} data-sidebar-folder-body={nodeId} className={className}>
      {children}
    </div>
  );
}

function GroupedSidebarFolderRow({ node }: { node: SidebarTreeFolderNode }) {
  const clickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDrag = useDroneHubActiveDrag();
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
    selectedGroupMultiChat,
    onDeleteGroup,
    shouldSuppressClick,
    displayDepthOffset,
    actionsEnabled = true,
  } = useGroupedSidebarTreeContext();
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const folderPath = folderGroupPath(node) ?? node.path;
  const isVirtualGroup = node.groupKind === 'repo' && !node.groupPath;
  const allowVirtualRepoReorderDrop =
    isVirtualGroup && activeDrag?.type === 'sidebar-folder' && activeDrag.groupKind === 'repo';
  const groupRef = React.useMemo(
    () => ({ group: folderPath, kind: node.groupKind }),
    [folderPath, node.groupKind],
  );
  const groupToken = React.useMemo(() => sidebarGroupOrderToken(groupRef), [groupRef]);
  const collapsed = Boolean(collapsedGroups[folderPath]);
  const folderDroneIds = React.useMemo(() => collectSidebarTreeDroneIds(nodeTree, node.id), [node.id, nodeTree]);
  const folderDroneSelected = folderDroneIds.length > 0 && folderDroneIds.every((droneId) => selectedDroneSet.has(droneId));
  const isSelected = selectedSidebarNodeId === node.id || selectedFolderPath === folderPath || folderDroneSelected;
  const isHiddenGroup = hiddenSidebarGroupTokenSet.has(groupToken);
  const showEditorInline = folderEditor?.targetPath === folderPath && folderEditor.mode === 'rename';
  const showCreateInline = (folderEditor?.anchorPath ?? folderEditor?.parentPath) === folderPath && folderEditor?.mode === 'create';
  const childIds = nodeTree.childIdsByParent[node.id] ?? [];
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
        : groupedFolderDragData({ nodeId: node.id, folderPath, groupKind: node.groupKind, label: node.label }),
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
  const clearClickTimer = React.useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);
  React.useEffect(() => clearClickTimer, [clearClickTimer]);
  const runFolderSingleClick = React.useCallback((opts?: SidebarFolderSelectionOptions) => {
    if (shouldSuppressClick()) return;
    if (isSelected && !opts?.selectDrones) {
      onSelectFolder(folderPath, opts);
      onToggleGroupCollapsed(folderPath);
      return;
    }
    setSelectedSidebarNodeId(node.id);
    onSelectFolder(folderPath, opts);
  }, [folderPath, isSelected, node.id, onSelectFolder, onToggleGroupCollapsed, setSelectedSidebarNodeId, shouldSuppressClick]);
  const scheduleFolderSingleClick = React.useCallback((opts?: SidebarFolderSelectionOptions) => {
    clearClickTimer();
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      runFolderSingleClick(opts);
    }, GROUPED_FOLDER_SINGLE_CLICK_DELAY_MS);
  }, [clearClickTimer, runFolderSingleClick]);
  const handleFolderDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (
        event.target instanceof Element &&
        (event.target.closest('[data-sidebar-folder-actions="true"]') || event.target.closest('input,textarea,select'))
      ) {
        return;
      }
      if (shouldSuppressClick()) return;
      event.preventDefault();
      clearClickTimer();
      setSelectedSidebarNodeId(node.id);
      onSelectFolder(folderPath);
      onToggleGroupCollapsed(folderPath);
    },
    [clearClickTimer, folderPath, node.id, onSelectFolder, onToggleGroupCollapsed, setSelectedSidebarNodeId, shouldSuppressClick],
  );

  return (
    <div className={`flex flex-col gap-0.5 transition-[margin] duration-150 ${reorderPreviewClass}`}>
      <div ref={setHeaderRef} data-sidebar-node-anchor-id={node.id} className="relative">
        {dragOverTreeTarget?.nodeId === node.id &&
        (dragOverTreeTarget.placement === 'before' || dragOverTreeTarget.placement === 'after') ? (
          <TreeDropGuide placement={dragOverTreeTarget.placement} />
        ) : null}
        <div
          className={`group/folder-row relative flex items-center gap-1 rounded-[var(--radius-medium)] pr-1 transition-colors ${densityClasses.folderRow} ${
            intoState
              ? 'bg-[var(--accent-subtle)] ring-1 ring-[var(--accent-muted)]'
              : isSelected
                ? 'border border-[var(--border)] bg-[var(--surface-soft)]'
                : 'border border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-soft)]'
          } ${isDragging ? 'opacity-60' : isHiddenGroup ? 'opacity-70' : ''}`}
          style={{ paddingLeft: `${Math.max(0, node.depth - displayDepthOffset) * densityClasses.folderDepthPaddingPx}px` }}
          onDoubleClick={handleFolderDoubleClick}
        >
          {showEditorInline && folderEditor ? (
            <div className={`min-w-0 flex-1 rounded text-left ${densityClasses.folderPaddingX}`}>
              <div className="flex min-w-0 items-center gap-1.5">
                <IconFolder className={`flex-shrink-0 ${densityClasses.icon}`} />
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
                  className={`min-w-0 flex-1 rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--panel-raised)] text-[var(--fg)] shadow-[var(--glow-accent)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] ${densityClasses.folderInput}`}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`min-w-0 flex-1 rounded text-left ${densityClasses.folderPaddingX}`}
              onClick={(event) => {
                if (event.detail > 1) return;
                const toggle = event.metaKey || event.ctrlKey;
                scheduleFolderSingleClick({
                  selectDrones: toggle || event.shiftKey,
                  toggle,
                });
              }}
              {...(folderDndDisabled ? {} : attributes as unknown as Record<string, unknown>)}
              {...(folderDndDisabled ? {} : listeners as unknown as Record<string, unknown>)}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <IconFolder className={`flex-shrink-0 ${densityClasses.icon}`} />
                <span className={`${sidebarFolderLabelClass} ${densityClasses.folderLabel}`} title={folderPath}>
                  {node.label}
                </span>
              </div>
            </button>
          )}
          <div
            className={`relative ml-2 flex flex-shrink-0 items-center justify-end transition-[min-width] duration-150 ${
              actionsEnabled ? (isVirtualGroup ? 'group-hover/folder-row:min-w-[72px]' : 'group-hover/folder-row:min-w-[112px]') : ''
            }`}
          >
            {actionsEnabled ? <div data-sidebar-folder-actions="true" className="absolute inset-y-0 right-0 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover/folder-row:opacity-100">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFolderCreate(
                    isVirtualGroup ? null : folderPath,
                    isVirtualGroup
                      ? { anchorPath: folderPath, repoGroupPath: node.repoGroupPath }
                      : node.repoGroupPath
                        ? { repoGroupPath: node.repoGroupPath }
                        : undefined,
                  );
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]`}
                title={isVirtualGroup ? `New top-level folder from "${node.label}"` : `New subfolder in "${node.label}"`}
              >
                <IconPlus className="opacity-90" />
              </button>
              {!isVirtualGroup ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartRenameFolder(folderPath);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  disabled={Boolean(deletingGroups[folderPath]) || Boolean(renamingGroups[folderPath])}
                  className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border bg-[var(--accent-subtle)] border-[var(--accent-border)] text-[var(--accent)] transition-colors hover:bg-[var(--accent-subtle)] disabled:opacity-50`}
                  title={`Rename folder "${node.label}"`}
                >
                  {renamingGroups[folderPath] ? <IconSpinner className="opacity-90" /> : <IconPencil className="opacity-90" />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleSidebarGroupHidden(groupRef);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border transition-colors ${
                  isHiddenGroup
                    ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--muted)]'
                }`}
                title={isHiddenGroup ? `Unhide "${node.label}"` : `Hide "${node.label}"`}
              >
                {isHiddenGroup ? <IconEye className="opacity-90" /> : <IconEyeOff className="opacity-90" />}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenGroupMultiChat(folderPath);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border transition-colors ${
                  selectedGroupMultiChat === folderPath
                    ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]'
                }`}
                title={`Open "${node.label}" multi-chat`}
              >
                <IconColumns className="opacity-90" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteGroup(folderPath, node.totalDroneCount, {
                    kind: node.groupKind,
                    label: node.label,
                    repoPath:
                      isVirtualGroup && node.path.startsWith('repo:') && node.path !== 'repo:ungrouped'
                        ? node.path.slice('repo:'.length)
                        : null,
                  });
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                disabled={Boolean(deletingGroups[folderPath]) || Boolean(renamingGroups[folderPath])}
                className={`inline-flex ${densityClasses.folderActionButton} items-center justify-center rounded border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] transition-colors hover:bg-[var(--red-subtle)] disabled:opacity-50`}
                title={`Delete folder "${node.label}"`}
              >
                {deletingGroups[folderPath] ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
              </button>
            </div> : null}
          </div>
        </div>
      </div>
      {!collapsed ? (
        <GroupedSidebarFolderBodyDropZone
          nodeId={node.id}
          disabled={!sidebarDndEnabled || isVirtualGroup}
          className={`${densityClasses.folderBody} ${intoState ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]' : 'border-[var(--border-subtle)]'}`}
        >
          {actionsEnabled && showCreateInline ? (
            <div className={`flex items-center gap-2 rounded-[var(--radius-medium)] border border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)] shadow-[var(--glow-accent)] ${densityClasses.folderCreateBody}`}>
              <IconFolder className={`${densityClasses.icon} flex-shrink-0 text-[var(--accent)] opacity-80`} />
              <input
                ref={folderEditorInputRef}
                value={folderEditor?.value ?? ''}
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
                placeholder={folderEditor?.parentPath ? 'Subfolder name' : 'Folder name'}
                className={`min-w-0 flex-1 rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--panel-raised)] text-[var(--fg)] shadow-[var(--glow-accent)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] ${densityClasses.folderInput}`}
              />
            </div>
          ) : null}
          {(!actionsEnabled || !showCreateInline) && childIds.length === 0 ? (
            isVirtualGroup && node.totalDroneCount === 0 ? (
              <div className={densityClasses.emptyHint}>
                <IconFolder className={densityClasses.icon} />
                <span className="truncate">No drones in this repo yet.</span>
              </div>
            ) : actionsEnabled ? (
              <button
                type="button"
                onClick={() =>
                  onOpenFolderCreate(
                    isVirtualGroup ? null : folderPath,
                    isVirtualGroup
                      ? { anchorPath: folderPath, repoGroupPath: node.repoGroupPath }
                      : node.repoGroupPath
                        ? { repoGroupPath: node.repoGroupPath }
                        : undefined,
                  )
                }
                className={densityClasses.emptyHint}
                title={isVirtualGroup ? `Create a top-level folder from "${node.label}"` : `Create a subfolder in "${node.label}"`}
              >
                <IconPlus className="opacity-85" />
                <span className="truncate">
                  {isVirtualGroup ? 'Create a top-level folder' : 'Empty folder. Create a subfolder or drop drones here.'}
                </span>
              </button>
            ) : (
              <div className={densityClasses.emptyHint}>
                <IconFolder className={densityClasses.icon} />
                <span className="truncate">No drones in this folder.</span>
              </div>
            )
          ) : null}
          {childIds.map((childId) => (
            <div key={childId} data-sidebar-node-id={childId}>
              <GroupedSidebarNodeEntry nodeId={childId} groupPath={folderPath} />
            </div>
          ))}
          {showCreateInline && folderEditor?.error ? <div className="text-[var(--text-10)] text-[var(--red)]">{folderEditor.error}</div> : null}
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
    setSidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    setSidebarChatOrderByDrone,
    droneById,
    selectedDroneIds,
    selectedDroneSet,
    onMoveDronesToGroup,
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
  const displayDepthOffset = React.useMemo(() => {
    if (!displayRootNodeId) return 0;
    const displayRoot = nodeTree.nodesById[displayRootNodeId];
    return displayRoot?.kind === 'folder' ? displayRoot.depth + 1 : 0;
  }, [displayRootNodeId, nodeTree]);
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
        sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: groupPath, kind: 'group' })] ?? [],
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

  const normalizeTreeReorderTarget = React.useCallback(
    (targetNodeIdRaw: string, placement: TreeDropPlacement): { nodeId: string; placement: TreeDropPlacement } => {
      const targetNodeId = String(targetNodeIdRaw ?? '').trim();
      if (!targetNodeId || placement === 'into') return { nodeId: targetNodeId, placement };
      const targetNode = nodeTree.nodesById[targetNodeId];
      if (!targetNode) return { nodeId: targetNodeId, placement };
      const siblingIds = nodeTree.childIdsByParent[targetNode.parentId] ?? [];
      const normalized = normalizeSidebarReorderTarget(siblingIds, targetNodeId, placement);
      return {
        nodeId: normalized.overId || targetNodeId,
        placement: normalized.placement,
      };
    },
    [nodeTree],
  );

  const normalizeChatReorderTarget = React.useCallback(
    (
      droneIdRaw: string,
      chatNameRaw: string,
      placement: SidebarGroupDropPlacement,
    ): { chatName: string; placement: SidebarGroupDropPlacement } => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim() || 'default';
      const drone = droneById[droneId];
      if (!drone) return { chatName, placement };
      const currentChats = orderSidebarEntries(
        normalizedDroneChats(drone),
        sidebarChatOrderByDrone[droneId] ?? [],
        (chat) => chat,
      );
      const normalized = normalizeSidebarReorderTarget(currentChats, chatName, placement);
      return {
        chatName: normalized.overId || chatName,
        placement: normalized.placement,
      };
    },
    [droneById, sidebarChatOrderByDrone],
  );

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

  const moveFolder = React.useCallback(
    async (sourcePathRaw: string, targetParentPathRaw: string | null) => {
      const sourcePath = String(sourcePathRaw ?? '').trim();
      const targetParentPath = String(targetParentPathRaw ?? '').trim() || null;
      if (!sourcePath) return false;
      if (targetParentPath && (targetParentPath === sourcePath || isSameOrDescendantSidebarGroupPath(targetParentPath, sourcePath))) {
        return false;
      }
      const nextPath = joinSidebarGroupPath([targetParentPath, sidebarGroupBaseName(sourcePath)]);
      if (!nextPath || nextPath === sourcePath) return true;
      return Boolean(await onRenameGroup(sourcePath, nextPath, { skipNodeOrderUpdate: true }));
    },
    [onRenameGroup],
  );

  const completeDroneTreeMove = React.useCallback(
    async (args: {
      movingDroneIds: string[];
      targetParentNode: SidebarTreeNode | null;
      targetFolderPath: string | null;
    }) => {
      const movingDroneIds = Array.from(
        new Set(args.movingDroneIds.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)),
      );
      if (movingDroneIds.length === 0) return true;

      const targetParentDroneId = args.targetParentNode?.kind === 'drone' ? args.targetParentNode.droneId : null;
      if (
        !canReorderSidebarDroneSelectionAtParent(
          droneById,
          movingDroneIds,
          targetParentDroneId,
        )
      ) {
        return false;
      }
      const needsParentChange = movingDroneIds.some(
        (droneId) =>
          (String(droneById[droneId]?.fleetParentId ?? '').trim() || null) !==
          targetParentDroneId,
      );
      let rollbackParentChange: (() => void) | undefined;
      if (needsParentChange) {
        const reparentResult = await props.onReparentDronesToParent(
          targetParentDroneId,
          movingDroneIds,
          { targetGroup: args.targetFolderPath },
        );
        if (!reparentResult.ok) {
          if (reparentResult.error) window.alert(reparentResult.error);
          return false;
        }
        rollbackParentChange = reparentResult.rollbackOptimistic;
      }

      if (targetParentDroneId) return true;

      const normalizedTargetGroup = (() => {
        const group = String(args.targetFolderPath ?? '').trim();
        return !group || isUngroupedGroupName(group) ? null : group;
      })();
      const needsGroupMove = movingDroneIds.some((droneId) => {
        const currentGroup = String(droneById[droneId]?.group ?? '').trim();
        const normalizedCurrentGroup = !currentGroup || isUngroupedGroupName(currentGroup) ? null : currentGroup;
        return normalizedCurrentGroup !== normalizedTargetGroup;
      });
      if (!needsGroupMove) return true;

      const moveResult = await onMoveDronesToGroup(normalizedTargetGroup ?? 'Ungrouped', movingDroneIds);
      if (!moveResult.ok) {
        rollbackParentChange?.();
      }
      return moveResult.ok;
    },
    [droneById, onMoveDronesToGroup, props],
  );

  const updateTreeDragState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const active = parseDroneHubDragData(event.active.data.current);
      const activeRaw = event.active.data.current as Record<string, unknown> | undefined;
      const overData = event.over?.data.current as Record<string, unknown> | undefined;
      const activeFolderNode =
        activeRaw?.type === 'sidebar-folder'
          ? nodeTree.nodesById[
              String(activeRaw.folderNodeId ?? '').trim() || sidebarFolderNodeId(String(activeRaw.folderPath ?? '').trim())
            ]
          : null;
      const draggingVirtualRepoRoot = isVirtualRepoRootNode(activeFolderNode);

      if (draggingVirtualRepoRoot && overData?.type === 'sidebar-tree-node' && typeof overData.nodeId === 'string') {
        const targetNodeId = String(overData.nodeId ?? '').trim();
        const targetNode = nodeTree.nodesById[targetNodeId];
        if (isVirtualRepoRootNode(targetNode) && targetNode.id !== activeFolderNode.id) {
          const dropTarget = normalizeTreeReorderTarget(targetNodeId, placementFromEvent(event, false));
          setDragOverChat(null);
          setDragOverFolderBodyId(null);
          setDragOverTreeTarget(dropTarget);
          return;
        }
      }

      if (draggingVirtualRepoRoot) {
        clearDragState();
        return;
      }

      if (active?.type === 'sidebar-chat' && overData?.type === 'sidebar-chat-reorder') {
        const overDroneId = String(overData.droneId ?? '').trim();
        const overChatName = String(overData.chatName ?? '').trim() || 'default';
        if (overDroneId && overDroneId === active.droneId && overChatName !== active.chatName) {
          const dropTarget = normalizeChatReorderTarget(
            overDroneId,
            overChatName,
            sidebarDropPlacementFromRects(
              event.active.rect.current.translated ?? event.active.rect.current.initial,
              event.over?.rect ?? null,
            ),
          );
          setDragOverTreeTarget(null);
          setDragOverFolderBodyId(null);
          setDragOverChat({
            key: `${overDroneId}:${dropTarget.chatName}`,
            placement: dropTarget.placement,
          });
          return;
        }
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-tree-drone-tail' &&
        typeof overData.nodeId === 'string'
      ) {
        const targetNodeId = String(overData.nodeId ?? '').trim();
        if (nodeTree.nodesById[targetNodeId]?.kind === 'drone') {
          const dropTarget = normalizeTreeReorderTarget(targetNodeId, 'after');
          setDragOverChat(null);
          setDragOverFolderBodyId(null);
          setDragOverTreeTarget(dropTarget);
          return;
        }
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-chat-reorder' &&
        typeof overData.droneId === 'string'
      ) {
        const targetNodeId = sidebarDroneNodeId(String(overData.droneId ?? '').trim());
        if (nodeTree.nodesById[targetNodeId]?.kind === 'drone') {
          const dropTarget = normalizeTreeReorderTarget(targetNodeId, 'after');
          setDragOverChat(null);
          setDragOverFolderBodyId(null);
          setDragOverTreeTarget(dropTarget);
          return;
        }
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-tree-node' &&
        typeof overData.nodeId === 'string'
      ) {
        const targetNodeId = String(overData.nodeId ?? '').trim();
        const targetNode = nodeTree.nodesById[targetNodeId];
        if (active?.type === 'sidebar-drone' && targetNode?.kind === 'drone') {
          const targetParentNode = nodeTree.nodesById[targetNode.parentId];
          const targetParentDroneId =
            targetParentNode?.kind === 'drone' ? targetParentNode.droneId : null;
          if (
            !canReorderSidebarDroneSelectionAtParent(
              droneById,
              active.droneIds,
              targetParentDroneId,
            )
          ) {
            clearDragState();
            return;
          }
        }
        const allowInto = targetNode?.kind === 'folder' && !isVirtualRepoRootNode(targetNode);
        const dropTarget = normalizeTreeReorderTarget(targetNodeId, placementFromEvent(event, allowInto));
        setDragOverChat(null);
        setDragOverFolderBodyId(null);
        setDragOverTreeTarget(dropTarget);
        return;
      }

      if (
        (active?.type === 'sidebar-drone' || activeRaw?.type === 'sidebar-folder') &&
        overData?.type === 'sidebar-tree-folder-body' &&
        typeof overData.nodeId === 'string'
      ) {
        const folderNodeId = String(overData.nodeId ?? '').trim();
        const insertionTarget = resolveFolderBodyInsertionTarget(folderNodeId, activeRectMidY(event));
        setDragOverChat(null);
        setDragOverTreeTarget(insertionTarget);
        setDragOverFolderBodyId(insertionTarget ? null : folderNodeId);
        return;
      }

      clearDragState();
    },
    [clearDragState, droneById, nodeTree, normalizeChatReorderTarget, normalizeTreeReorderTarget],
  );

  const dndMonitorHandlers = React.useMemo(
    () =>
      props.sidebarDndEnabled
        ? {
            onDragStart: (event: DragEndEvent) => {
              const active = parseDroneHubDragData(event.active.data.current);
              if (active?.type === 'sidebar-drone') onPrepareDroneDragStart(active.droneId);
            },
            onDragMove: updateTreeDragState,
            onDragOver: updateTreeDragState,
            onDragCancel: () => {
              suppressClicksUntilRef.current = Date.now() + 180;
              clearDragState();
            },
            onDragEnd: (event: DragEndEvent) => {
      suppressClicksUntilRef.current = Date.now() + 180;
      const active = parseDroneHubDragData(event.active.data.current);
      const activeRaw = event.active.data.current as Record<string, unknown> | undefined;
      const overData = event.over?.data.current as Record<string, unknown> | undefined;
      const activeFolderNode =
        activeRaw?.type === 'sidebar-folder'
          ? nodeTree.nodesById[
              String(activeRaw.folderNodeId ?? '').trim() || sidebarFolderNodeId(String(activeRaw.folderPath ?? '').trim())
            ]
          : null;

      if (isVirtualRepoRootNode(activeFolderNode)) {
        if (overData?.type === 'sidebar-tree-node' && typeof overData.nodeId === 'string') {
          const targetNodeId = String(overData.nodeId ?? '').trim();
          const targetNode = nodeTree.nodesById[targetNodeId];
          if (isVirtualRepoRootNode(targetNode) && targetNode.id !== activeFolderNode.id) {
            const fallbackTreeTarget = normalizeTreeReorderTarget(targetNodeId, placementFromEvent(event, false));
            const resolvedTreeTarget = dragOverTreeTarget ?? fallbackTreeTarget;
            const resolvedTargetNode = nodeTree.nodesById[resolvedTreeTarget.nodeId];
            const placement = resolvedTreeTarget.placement;
            if (isVirtualRepoRootNode(resolvedTargetNode) && (placement === 'before' || placement === 'after')) {
              props.setSidebarGroupOrder((prev) =>
                reorderSidebarGroupOrder(
                  prev,
                  props.sidebarGroups,
                  { group: activeFolderNode.path, kind: 'repo' },
                  { group: resolvedTargetNode.path, kind: 'repo' },
                  placement,
                ),
              );
            }
          }
        }
        clearDragState();
        return;
      }

      if (active?.type === 'sidebar-chat' && overData?.type === 'sidebar-chat-reorder') {
        const overDroneId = String(overData.droneId ?? '').trim();
        const overChatName = String(overData.chatName ?? '').trim() || 'default';
        if (overDroneId === active.droneId && overChatName && overChatName !== active.chatName) {
          const currentChats = orderSidebarEntries(
            normalizedDroneChats(droneById[active.droneId]),
            sidebarChatOrderByDrone[active.droneId] ?? [],
            (chat) => chat,
          );
          const fallbackTarget = normalizeChatReorderTarget(
            overDroneId,
            overChatName,
            sidebarDropPlacementFromRects(
              event.active.rect.current.translated ?? event.active.rect.current.initial,
              event.over?.rect ?? null,
            ),
          );
          const prefix = `${overDroneId}:`;
          const targetChatName =
            dragOverChat?.key.startsWith(prefix)
              ? String(dragOverChat.key.slice(prefix.length) || overChatName)
              : fallbackTarget.chatName;
          const placement = dragOverChat?.key.startsWith(prefix) ? dragOverChat.placement : fallbackTarget.placement;
          setSidebarChatOrderByDrone((prev) => ({
            ...prev,
            [active.droneId]: reorderSidebarEntryOrder(
              prev[active.droneId] ?? [],
              currentChats,
              active.chatName,
              targetChatName,
              placement,
            ),
          }));
          clearDragState();
          return;
        }
      }

      if (
        active?.type === 'sidebar-drone' &&
        (
          overData?.type === 'sidebar-tree-node' ||
          overData?.type === 'sidebar-tree-folder-body' ||
          overData?.type === 'sidebar-chat-reorder' ||
          overData?.type === 'sidebar-tree-drone-tail'
        )
      ) {
        const chatTargetNodeId =
          overData?.type === 'sidebar-chat-reorder' ? sidebarDroneNodeId(String(overData.droneId ?? '').trim()) : null;
        const hoveredNodeId = chatTargetNodeId ?? String(overData.nodeId ?? '').trim();
        const folderBodyInsertionTarget =
          overData?.type === 'sidebar-tree-folder-body'
            ? resolveFolderBodyInsertionTarget(hoveredNodeId, activeRectMidY(event))
            : null;
        const targetNodeId = folderBodyInsertionTarget?.nodeId ?? hoveredNodeId;
        const targetNode = nodeTree.nodesById[targetNodeId];
        const hoveredFolderNode = overData?.type === 'sidebar-tree-folder-body' ? nodeTree.nodesById[hoveredNodeId] : null;
        if (!targetNode) {
          if (overData?.type === 'sidebar-tree-folder-body' && hoveredFolderNode?.kind === 'folder') {
            const targetParentId = hoveredFolderNode.id;
            const targetParentNode = nodeTree.nodesById[targetParentId];
            const targetFolderPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
            const sourceNode = nodeTree.nodesById[sidebarDroneNodeId(active.droneId)] as SidebarTreeDroneNode | undefined;
            const sourceParentId = sourceNode?.parentId ?? targetParentId;
            const movingDroneIds = active.droneIds.slice();
            const previousNodeOrderByParent = sidebarNodeOrderByParent;
            const movingNodeIds = movingDroneIds.map(sidebarDroneNodeId);
            const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
            const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
            const nextSourceVisible = sourceVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
            const nextTargetVisible = targetVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
            setSidebarNodeOrderByParent(
              moveSidebarNodeIdsBetweenParents({
                map: removeDroneIdsFromSidebarNodeOrderByParent(sidebarNodeOrderByParent, movingDroneIds),
                sourceParentId,
                targetParentId,
                sourceVisibleChildIds: nextSourceVisible,
                targetVisibleChildIds: nextTargetVisible,
                movingNodeIds,
                overNodeId: null,
                placement: 'into',
              }),
            );
            void completeDroneTreeMove({
              movingDroneIds,
              targetParentNode,
              targetFolderPath,
            }).then((ok) => {
              if (!ok) {
                setSidebarNodeOrderByParent(previousNodeOrderByParent);
              }
            });
          }
          clearDragState();
          return;
        }

        const movingDroneIds = active.droneIds.slice();
        const allowIntoTarget = targetNode.kind === 'folder' && !isVirtualRepoRootNode(targetNode);
        const fallbackTreeTarget =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? normalizeTreeReorderTarget(targetNodeId, 'after')
            : overData.type === 'sidebar-tree-folder-body'
              ? {
                  nodeId: targetNodeId,
                  placement: (folderBodyInsertionTarget?.placement ?? 'into') as TreeDropPlacement,
                }
              : normalizeTreeReorderTarget(targetNodeId, placementFromEvent(event, allowIntoTarget));
        const resolvedTreeTarget =
          overData.type === 'sidebar-tree-folder-body' ? fallbackTreeTarget : dragOverTreeTarget ?? fallbackTreeTarget;
        const resolvedTargetNodeId = resolvedTreeTarget.nodeId;
        const resolvedTargetNode = nodeTree.nodesById[resolvedTargetNodeId];
        if (!resolvedTargetNode) {
          clearDragState();
          return;
        }
        const placement = resolvedTreeTarget.placement;
        const targetParentId =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? resolvedTargetNode.parentId
            : overData.type === 'sidebar-tree-folder-body'
              ? folderBodyInsertionTarget
                ? resolvedTargetNode.parentId
                : placement === 'into' && resolvedTargetNode.kind === 'folder'
                  ? resolvedTargetNode.id
                  : resolvedTargetNode.parentId
              : placement === 'into' && resolvedTargetNode.kind === 'folder'
                ? resolvedTargetNode.id
                : resolvedTargetNode.parentId;
        const targetParentNode = targetParentId === SIDEBAR_ROOT_PARENT_ID ? null : nodeTree.nodesById[targetParentId];
        const targetFolderPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
        const sourceNode = nodeTree.nodesById[sidebarDroneNodeId(active.droneId)] as SidebarTreeDroneNode | undefined;
        const sourceParentId = sourceNode?.parentId ?? targetParentId;
        const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
        const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
        if (movingDroneIds.length === 1 && sourceParentId === targetParentId && placement !== 'into') {
          const nextNodeOrderByParent = reorderSidebarNodeParentOrder(
            sidebarNodeOrderByParent,
            sourceParentId,
            sourceVisibleChildIds,
            sidebarDroneNodeId(active.droneId),
            resolvedTargetNode.id,
            placement as SidebarGroupDropPlacement,
          );
          setSidebarNodeOrderByParent(
            nextNodeOrderByParent,
          );
          clearDragState();
          return;
        }

        const movingNodeIds = movingDroneIds.map(sidebarDroneNodeId);
        const nextSourceVisible = sourceVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
        const nextTargetVisible = targetVisibleChildIds.filter((entry) => !movingNodeIds.includes(entry));
        const previousNodeOrderByParent = sidebarNodeOrderByParent;
        setSidebarNodeOrderByParent(
          moveSidebarNodeIdsBetweenParents({
            map: removeDroneIdsFromSidebarNodeOrderByParent(sidebarNodeOrderByParent, movingDroneIds),
            sourceParentId,
            targetParentId,
            sourceVisibleChildIds: nextSourceVisible,
            targetVisibleChildIds: nextTargetVisible,
            movingNodeIds,
            overNodeId: placement === 'into' ? null : resolvedTargetNode.id,
            placement,
          }),
        );
        void completeDroneTreeMove({
          movingDroneIds,
          targetParentNode,
          targetFolderPath,
        }).then((ok) => {
          if (!ok) {
            setSidebarNodeOrderByParent(previousNodeOrderByParent);
          }
        });
        clearDragState();
        return;
      }

      if (
        activeRaw?.type === 'sidebar-folder' &&
        (
          overData?.type === 'sidebar-tree-node' ||
          overData?.type === 'sidebar-tree-folder-body' ||
          overData?.type === 'sidebar-chat-reorder' ||
          overData?.type === 'sidebar-tree-drone-tail'
        )
      ) {
        const sourceFolderPath = String(activeRaw.folderPath ?? '').trim();
        const sourceNodeId = String(activeRaw.folderNodeId ?? '').trim() || sidebarFolderNodeId(sourceFolderPath);
        const sourceNode = nodeTree.nodesById[sourceNodeId];
        const chatTargetNodeId =
          overData?.type === 'sidebar-chat-reorder' ? sidebarDroneNodeId(String(overData.droneId ?? '').trim()) : null;
        const hoveredNodeId = chatTargetNodeId ?? String(overData.nodeId ?? '').trim();
        const folderBodyInsertionTarget =
          overData?.type === 'sidebar-tree-folder-body'
            ? resolveFolderBodyInsertionTarget(hoveredNodeId, activeRectMidY(event))
            : null;
        const targetNodeId = folderBodyInsertionTarget?.nodeId ?? hoveredNodeId;
        const targetNode = nodeTree.nodesById[targetNodeId];
        const hoveredFolderNode = overData?.type === 'sidebar-tree-folder-body' ? nodeTree.nodesById[hoveredNodeId] : null;
        if (!sourceNode || !targetNode || targetNode.id === sourceNodeId) {
          if (sourceNode && overData?.type === 'sidebar-tree-folder-body' && hoveredFolderNode?.kind === 'folder') {
            const sourceParentId = sourceNode.parentId;
            const targetParentId = hoveredFolderNode.id;
            const targetParentNode = nodeTree.nodesById[targetParentId];
            const targetParentPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
            const previousNodeOrderByParent = sidebarNodeOrderByParent;
            const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
            const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
            const movedFolderPath = joinSidebarGroupPath([targetParentPath, sidebarGroupBaseName(sourceFolderPath)]);
            if (movedFolderPath) {
              setSidebarNodeOrderByParent(
                moveSidebarNodeIdsBetweenParents({
                  map: sidebarNodeOrderByParent,
                  sourceParentId,
                  targetParentId,
                  sourceVisibleChildIds,
                  targetVisibleChildIds,
                  movingNodeIds: [sidebarFolderNodeId(movedFolderPath)],
                  overNodeId: null,
                  placement: 'into',
                }),
              );
            }
            void moveFolder(sourceFolderPath, targetParentPath).then((ok) => {
              if (!ok) {
                setSidebarNodeOrderByParent(previousNodeOrderByParent);
              }
            });
          }
          clearDragState();
          return;
        }

        const fallbackTreeTarget =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? normalizeTreeReorderTarget(targetNodeId, 'after')
            : overData.type === 'sidebar-tree-folder-body'
              ? {
                  nodeId: targetNodeId,
                  placement: (folderBodyInsertionTarget?.placement ?? 'into') as TreeDropPlacement,
                }
              : normalizeTreeReorderTarget(
                  targetNodeId,
                  placementFromEvent(
                    event,
                    targetNode.kind === 'folder' && !isVirtualRepoRootNode(targetNode),
                  ),
                );
        const resolvedTreeTarget =
          overData.type === 'sidebar-tree-folder-body' ? fallbackTreeTarget : dragOverTreeTarget ?? fallbackTreeTarget;
        const resolvedTargetNodeId = resolvedTreeTarget.nodeId;
        const resolvedTargetNode = nodeTree.nodesById[resolvedTargetNodeId];
        if (!resolvedTargetNode) {
          clearDragState();
          return;
        }
        const placement = resolvedTreeTarget.placement;
        const sourceParentId = sourceNode.parentId;
        const targetParentId =
          overData.type === 'sidebar-chat-reorder' || overData.type === 'sidebar-tree-drone-tail'
            ? resolvedTargetNode.parentId
            : overData.type === 'sidebar-tree-folder-body' && folderBodyInsertionTarget
              ? resolvedTargetNode.parentId
              : placement === 'into' && resolvedTargetNode.kind === 'folder'
                ? resolvedTargetNode.id
                : resolvedTargetNode.parentId;
        const sourceVisibleChildIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
        const targetVisibleChildIds = nodeTree.childIdsByParent[targetParentId] ?? [];
        if (sourceParentId === targetParentId && placement !== 'into') {
          const nextNodeOrderByParent = reorderSidebarNodeParentOrder(
            sidebarNodeOrderByParent,
            sourceParentId,
            sourceVisibleChildIds,
            sourceNodeId,
            resolvedTargetNodeId,
            placement as SidebarGroupDropPlacement,
          );
          setSidebarNodeOrderByParent(
            nextNodeOrderByParent,
          );
          clearDragState();
          return;
        }

        const targetParentNode = targetParentId === SIDEBAR_ROOT_PARENT_ID ? null : nodeTree.nodesById[targetParentId];
        const targetParentPath = targetParentNode?.kind === 'folder' ? folderTargetGroupPath(targetParentNode) : null;
        const movedFolderPath = joinSidebarGroupPath([targetParentPath, sidebarGroupBaseName(sourceFolderPath)]);
        const previousNodeOrderByParent = sidebarNodeOrderByParent;
        if (movedFolderPath) {
          setSidebarNodeOrderByParent(
            moveSidebarNodeIdsBetweenParents({
              map: sidebarNodeOrderByParent,
              sourceParentId,
              targetParentId,
              sourceVisibleChildIds,
              targetVisibleChildIds,
              movingNodeIds: [sidebarFolderNodeId(movedFolderPath)],
              overNodeId: placement === 'into' ? null : resolvedTargetNodeId,
              placement,
            }),
          );
        }
        void moveFolder(sourceFolderPath, targetParentPath).then((ok) => {
          if (!ok) {
            setSidebarNodeOrderByParent(previousNodeOrderByParent);
          }
        });
        clearDragState();
        return;
      }

      clearDragState();
    },
          }
        : {},
    [
      clearDragState,
      completeDroneTreeMove,
      dragOverChat,
      dragOverTreeTarget,
      droneById,
      moveFolder,
      nodeTree,
      normalizeChatReorderTarget,
      normalizeTreeReorderTarget,
      onPrepareDroneDragStart,
      props,
      setSidebarChatOrderByDrone,
      setSidebarNodeOrderByParent,
      sidebarChatOrderByDrone,
      sidebarNodeOrderByParent,
      updateTreeDragState,
    ],
  );
  useDndMonitor(dndMonitorHandlers);

  const contextValue = React.useMemo<GroupedSidebarTreeContextValue>(
    () => ({
      ...props,
      nodeTree,
      displayDepthOffset,
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
      props.busyChatNodeIdSet,
      props.chatEditor,
      props.chatEditorInputRef,
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
      props.onOpenCloneModal,
      props.onOpenCreateDroneChat,
      props.onOpenDroneErrorModal,
      props.onOpenFolderCreate,
      props.onOpenGroupMultiChat,
      props.onPrepareDroneDragStart,
      props.onRenameDrone,
      props.onRenameDroneChat,
      props.onRenameGroup,
      props.onReparentDronesToParent,
      props.onSelectDroneCard,
      props.onSelectDroneChat,
      props.onSelectFolder,
      props.onSetDroneBaseImage,
      props.onSetDronePinned,
      props.onStartRenameDroneChat,
      props.onStartRenameFolder,
      props.onSubmitChatEditor,
      props.onSubmitFolderEditor,
      props.onToggleGroupCollapsed,
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
      props.setSidebarChatOrderByDrone,
      props.setSidebarGroupOrder,
      props.setSidebarNodeOrderByParent,
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
      displayDepthOffset,
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
      {displayedRootChildIds.map((nodeId) => (
        <GroupedSidebarNodeEntry key={nodeId} nodeId={nodeId} groupPath={null} />
      ))}
    </GroupedSidebarTreeContext.Provider>
  );
}
