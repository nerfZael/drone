import React from 'react';
import { useDndMonitor, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary, RepoSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { IconAutoMinimize, IconBoard, IconChevron, IconColumns, IconEye, IconEyeOff, IconFolder, IconList, IconPencil, IconPlus, IconPlusDouble, IconSettings, IconSidebarCollapse, IconSidebarExpand, IconSpinner, IconTrash, SkeletonLine } from './icons';
import { SidebarDroneTreeList, sidebarInlineSectionKey, type SidebarInlineSectionKind } from './SidebarDroneTreeList';
import {
  sidebarDropPlacementFromRects,
  SidebarReorderDropIndicator,
} from './sidebar-reorder-ui';
import { buildSidebarDroneTree } from './sidebar-drone-tree';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';
import {
  orderSidebarGroups,
  reorderSidebarGroupOrder,
  sidebarGroupOrderToken,
  type SidebarGroupDropPlacement,
  type SidebarGroupOrderKind,
} from './sidebar-group-order';
import {
  draggedDroneIdsFromData,
  parseDroneHubDragData,
  useDroneHubActiveDrag,
  type SidebarDragGroupRef,
  type SidebarGroupDragData,
} from './drone-hub-dnd';
import { SIDEBAR_VISIBLE_MULTI_CHAT_GROUP, type SidebarGroup } from './use-sidebar-view-model';
import type { MoveDronesToGroupResult } from './use-group-management';

const SIDEBAR_EXPANDED_WIDTH_PX = 280;
const SIDEBAR_COLLAPSED_RAIL_WIDTH_PX = 40;
const AUTO_MINIMIZE_COLLAPSE_DELAY_MS = 90;
const AUTO_MINIMIZE_EXPAND_DELAY_MS = 120;
const AUTO_MINIMIZE_REOPEN_GUARD_MS = 220;
type SidebarIconButtonProps = {
  title: string;
  ariaLabel?: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
  ariaPressed?: boolean;
  disabled?: boolean;
  tabIndex?: number;
};

function SidebarIconButton({
  title,
  ariaLabel,
  onClick,
  className,
  children,
  ariaPressed,
  disabled,
  tabIndex,
}: SidebarIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center w-7 h-7 rounded transition-all ${className}`}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={ariaPressed}
      disabled={disabled}
      tabIndex={tabIndex}
    >
      {children}
    </button>
  );
}

type DraftSidebarPlaceholder = {
  name: string;
  repoPath: string;
  group: string | null;
};

const DRAFT_SIDEBAR_PLACEHOLDER_ID = '__draft-sidebar-placeholder__';

function repoPathToLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

type SidebarGroupSectionProps = {
  groupRef: SidebarDragGroupRef;
  groupLabel: string;
  groupToken: string;
  kind: SidebarGroupOrderKind;
  actualItems: DroneSummary[];
  placeholderOnly: boolean;
  isVirtualGroup: boolean;
  hoveredRepoPath: string;
  hoveredGroupName: string;
  collapsed: boolean;
  isDeletingGroup: boolean;
  isRenamingGroup: boolean;
  isDropTarget: boolean;
  isReorderTarget: boolean;
  isReorderDragging: boolean;
  isHiddenGroup: boolean;
  canRenameGroup: boolean;
  pinGroupActionsVisible: boolean;
  selectedGroupMultiChat: string | null;
  dragOverSidebarGroup: { token: string; placement: SidebarGroupDropPlacement } | null;
  showMoveDropZone: boolean;
  sharedDroneTreeListProps: Omit<React.ComponentProps<typeof SidebarDroneTreeList>, 'tree'>;
  groupTree: ReturnType<typeof buildSidebarDroneTree>;
  onToggleGroupCollapsed: (group: string) => void;
  onRenameGroup: (group: string) => void;
  toggleSidebarGroupHidden: (target: SidebarDragGroupRef) => void;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => void;
};

function stopGroupHeaderActionInteraction(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function SidebarGroupSection({
  groupRef,
  groupLabel,
  groupToken,
  kind,
  actualItems,
  placeholderOnly,
  isVirtualGroup,
  hoveredRepoPath,
  hoveredGroupName,
  collapsed,
  isDeletingGroup,
  isRenamingGroup,
  isDropTarget,
  isReorderTarget,
  isReorderDragging,
  isHiddenGroup,
  canRenameGroup,
  pinGroupActionsVisible,
  selectedGroupMultiChat,
  dragOverSidebarGroup,
  showMoveDropZone,
  sharedDroneTreeListProps,
  groupTree,
  onToggleGroupCollapsed,
  onRenameGroup,
  toggleSidebarGroupHidden,
  onOpenGroupMultiChat,
  onDeleteGroup,
}: SidebarGroupSectionProps) {
  const groupDragData = React.useMemo<SidebarGroupDragData | null>(() => {
    const droneIds = Array.from(
      new Set(
        actualItems
          .map((item) => String(item?.id ?? '').trim())
          .filter(Boolean),
      ),
    );
    if (droneIds.length === 0) return null;
    return {
      type: 'sidebar-group',
      groupRef,
      groupLabel,
      droneIds,
    };
  }, [actualItems, groupLabel, groupRef]);
  const { attributes, listeners, setNodeRef: setDraggableNodeRef } = useDraggable({
    id: `sidebar-group:${groupToken}`,
    data: groupDragData ?? undefined,
    disabled: !groupDragData,
  });
  const { setNodeRef: setReorderDropNodeRef } = useDroppable({
    id: `sidebar-group-reorder:${groupToken}`,
    data: {
      type: 'sidebar-group-reorder',
      groupRef,
    },
    disabled: !groupDragData,
  });
  const { setNodeRef: setMoveDropNodeRef } = useDroppable({
    id: `sidebar-group-move:${groupToken}`,
    data: {
      type: 'sidebar-group-move',
      group: groupRef.group,
      kind: groupRef.kind,
    },
    disabled: isVirtualGroup,
  });
  const setHeaderNodeRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setDraggableNodeRef(node);
      setReorderDropNodeRef(node);
    },
    [setDraggableNodeRef, setReorderDropNodeRef],
  );
  const actionsVisibleClass = pinGroupActionsVisible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none group-hover/group-header:opacity-100 group-hover/group-header:pointer-events-auto';
  const countVisibleClass = pinGroupActionsVisible
    ? 'opacity-0 pointer-events-none'
    : 'opacity-100 group-hover/group-header:opacity-0 group-hover/group-header:pointer-events-none';

  return (
    <div
      data-drone-sidebar-group={groupRef.group}
      data-drone-sidebar-group-kind={kind}
      data-drone-sidebar-group-name={hoveredGroupName || undefined}
      data-drone-sidebar-repo-path={hoveredRepoPath || undefined}
      className={`relative rounded-md border bg-[rgba(0,0,0,.15)] overflow-hidden transition-colors ${
        isDropTarget ? 'border-[var(--accent-muted)] ring-1 ring-[var(--accent-muted)]' : 'border-[var(--border-subtle)]'
      } ${isReorderDragging ? 'opacity-70' : isHiddenGroup ? 'opacity-75' : ''}`}
    >
      {isReorderTarget && dragOverSidebarGroup ? (
        <SidebarReorderDropIndicator placement={dragOverSidebarGroup.placement} />
      ) : null}
      <div
        ref={setHeaderNodeRef}
        className={`group/group-header w-full px-3 py-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] transition-colors ${
          isDropTarget ? 'bg-[var(--accent-subtle)]' : 'hover:bg-[var(--hover)]'
        } ${groupDragData ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
        {...(attributes as unknown as Record<string, unknown>)}
        {...(listeners as unknown as Record<string, unknown>)}
      >
        <button
          type="button"
          onClick={() => onToggleGroupCollapsed(groupRef.group)}
          className="flex items-center gap-2 min-w-0 text-left flex-1"
          title={collapsed ? 'Expand group' : 'Collapse group'}
        >
          <IconChevron down={!collapsed} className="text-[var(--muted-dim)]" />
          <IconFolder className="text-[var(--muted-dim)] opacity-50" />
          <span
            className="text-[11px] font-semibold text-[var(--fg-secondary)] truncate tracking-wide uppercase"
            style={{ fontFamily: 'var(--display)' }}
          >
            {groupLabel}
          </span>
        </button>
        <div
          data-group-drag-block="true"
          className={`flex items-center justify-end flex-shrink-0 transition-[min-width] duration-150 ${
            pinGroupActionsVisible
              ? canRenameGroup
                ? 'min-w-[184px]'
                : 'min-w-[154px]'
              : canRenameGroup
                ? 'min-w-[92px] group-hover/group-header:min-w-[184px]'
                : 'min-w-[72px] group-hover/group-header:min-w-[154px]'
          }`}
          onPointerDown={stopGroupHeaderActionInteraction}
          onMouseDown={stopGroupHeaderActionInteraction}
        >
          <div className="w-full flex items-center justify-end gap-2">
            <div
              className={`text-[10px] font-mono text-[var(--muted-dim)] transition-opacity duration-150 ${countVisibleClass}`}
            >
              {actualItems.length} drone{actualItems.length !== 1 ? 's' : ''}
            </div>
            <div className={`flex items-center justify-end gap-1 ${actionsVisibleClass}`}>
              {canRenameGroup ? (
                <button
                  type="button"
                  onClick={() => onRenameGroup(groupRef.group)}
                  disabled={isDeletingGroup || isRenamingGroup}
                  aria-busy={isRenamingGroup}
                  className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                    isDeletingGroup || isRenamingGroup
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[rgba(167,139,250,.08)] border-[rgba(167,139,250,.18)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.12)]'
                  }`}
                  title={isRenamingGroup ? `Renaming group "${groupLabel}"…` : `Rename group "${groupLabel}"`}
                  aria-label={isRenamingGroup ? `Renaming group "${groupLabel}"` : `Rename group "${groupLabel}"`}
                >
                  {isRenamingGroup ? <IconSpinner className="opacity-90" /> : <IconPencil className="opacity-90" />}
                </button>
              ) : null}
              {!placeholderOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => toggleSidebarGroupHidden(groupRef)}
                    disabled={isDeletingGroup || isRenamingGroup}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                      isDeletingGroup || isRenamingGroup
                        ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                        : isHiddenGroup
                          ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.18)]'
                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]'
                    }`}
                    title={isHiddenGroup ? `Unhide "${groupLabel}"` : `Hide "${groupLabel}"`}
                    aria-label={isHiddenGroup ? `Unhide "${groupLabel}"` : `Hide "${groupLabel}"`}
                  >
                    {isHiddenGroup ? <IconEye className="opacity-90" /> : <IconEyeOff className="opacity-90" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenGroupMultiChat(groupRef.group)}
                    disabled={isDeletingGroup}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                      isDeletingGroup
                        ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                        : selectedGroupMultiChat === groupRef.group
                          ? 'opacity-100 pointer-events-auto bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                    }`}
                    title={`Open "${groupLabel}" multi-chat`}
                    aria-label={`Open "${groupLabel}" multi-chat`}
                  >
                    <IconColumns className="opacity-90" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onDeleteGroup(groupRef.group, actualItems.length, {
                        kind,
                        label: groupLabel,
                        repoPath: isVirtualGroup ? hoveredRepoPath || null : null,
                      })
                    }
                    disabled={isDeletingGroup || isRenamingGroup}
                    aria-busy={isDeletingGroup}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                      isDeletingGroup || isRenamingGroup
                        ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                        : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
                    }`}
                    title={
                      isDeletingGroup
                        ? `Deleting group "${groupLabel}"…`
                        : isVirtualGroup
                          ? `Delete all drones in "${groupLabel}"`
                          : `Delete group "${groupLabel}" (and all drones inside)`
                    }
                    aria-label={
                      isDeletingGroup
                        ? `Deleting group "${groupLabel}"`
                        : isVirtualGroup
                          ? `Delete all drones in "${groupLabel}"`
                          : `Delete group "${groupLabel}" (and all drones inside)`
                    }
                  >
                    {isDeletingGroup ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {!collapsed ? (
        <div ref={setMoveDropNodeRef} className="px-1.5 py-1.5 flex flex-col gap-0.5">
          <SidebarDroneTreeList
            {...sharedDroneTreeListProps}
            tree={groupTree}
            showGroup={false}
            groupOrderKey={groupToken}
            groupName={groupRef.group}
          />
        </div>
      ) : showMoveDropZone && !isVirtualGroup ? (
        <div
          ref={setMoveDropNodeRef}
          className={`px-3 py-2 text-[10px] font-semibold tracking-wide uppercase transition-colors ${
            isDropTarget ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--muted-dim)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Drop here to move into {groupLabel}
        </div>
      ) : null}
    </div>
  );
}

export type DroneSidebarProps = {
  dronesError: string | null | undefined;
  groupMoveError: string | null;
  dronesLoading: boolean;
  sidebarDronesFilteredByRepo: DroneSummary[];
  sidebarVisibleDrones: DroneSummary[];
  sidebarDrones: DroneSummary[];
  sidebarOptimisticDroneIdSet: Set<string>;
  selectedDroneSet: Set<string>;
  busyChatNodeIdSet: Set<string>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  deletingDrones: Record<string, boolean>;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarGroups: SidebarGroup[];
  sidebarHiddenGroupCount: number;
  collapsedGroups: Record<string, boolean>;
  deletingGroups: Record<string, boolean>;
  renamingGroups: Record<string, boolean>;
  sidebarHasUngroupedGroup: boolean;
  repos: RepoSummary[];
  reposLoading: boolean;
  reposError: string | null | undefined;
  dronesCount: number;
  droneCountByRepoPath: Map<string, number>;
  uiDroneName: (nameRaw: string) => string;
  draftSidebarPlaceholder: DraftSidebarPlaceholder | null;
  onOpenDraftChatComposer: () => void;
  onOpenCreateModal: () => void;
  onOpenKanbanBoard: () => void;
  onOpenPlaybookRuns: () => void;
  onSelectDroneCard: (droneId: string, opts?: { toggle?: boolean; range?: boolean }) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onDeleteDroneChat: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  onOpenCloneModal: (drone: DroneSummary) => void;
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onCreateGroupAndMove: (
    group: string,
    droneIds: string[],
  ) => Promise<{ ok: boolean; error: string | null }>;
  onToggleGroupCollapsed: (group: string) => void;
  onRenameGroup: (group: string) => void;
  onOpenGroupMultiChat: (group: string) => void;
  onOpenVisibleMultiChat: () => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => void;
  onPrepareDroneDragStart: (droneId: string) => void;
  onOpenReposModal: () => void;
};

export function DroneSidebar({
  dronesError,
  groupMoveError,
  dronesLoading,
  sidebarDronesFilteredByRepo,
  sidebarVisibleDrones,
  sidebarDrones,
  sidebarOptimisticDroneIdSet,
  selectedDroneSet,
  busyChatNodeIdSet,
  unreadAgentMessageByChatNodeId,
  deletingDrones,
  renamingDrones,
  settingBaseImages,
  movingDroneGroups,
  sidebarGroups,
  sidebarHiddenGroupCount,
  collapsedGroups,
  deletingGroups,
  renamingGroups,
  sidebarHasUngroupedGroup,
  repos,
  reposLoading,
  reposError,
  dronesCount,
  droneCountByRepoPath,
  uiDroneName,
  draftSidebarPlaceholder,
  onOpenDraftChatComposer,
  onOpenCreateModal,
  onOpenKanbanBoard,
  onOpenPlaybookRuns,
  onSelectDroneCard,
  onSelectDroneChat,
  onDeleteDroneChat,
  onOpenCloneModal,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
  onMoveDronesToGroup,
  onCreateGroupAndMove,
  onToggleGroupCollapsed,
  onRenameGroup,
  onOpenGroupMultiChat,
  onOpenVisibleMultiChat,
  onDeleteGroup,
  onPrepareDroneDragStart,
  onOpenReposModal,
}: DroneSidebarProps) {
  const {
    sidebarCollapsed,
    selectedDroneIds,
    draftChat,
    appView,
    viewMode,
    sidebarGroupingMode,
    activeRepoPath,
    selectedDrone,
    selectedChat,
    selectedGroupMultiChat,
    kanbanBoardOpen,
    playbookRunsOpen,
    sidebarReposCollapsed,
    sidebarAutoMinimize,
    autoDelete,
    sidebarGroupOrder,
    hiddenSidebarGroups,
    showHiddenSidebarGroups,
    setAppView,
    setViewMode,
    setSidebarGroupingMode,
    setSidebarGroupOrder,
    setHiddenSidebarGroups,
    setShowHiddenSidebarGroups,
    setSidebarReposCollapsed,
    setSidebarAutoMinimize,
    setActiveRepoPath,
    setAutoDelete,
    setSidebarCollapsed,
  } = useDroneSidebarUiState();
  const activeDrag = useDroneHubActiveDrag();
  const [dragOverCreateGroup, setDragOverCreateGroup] = React.useState(false);
  const [createGroupTargetDroneIds, setCreateGroupTargetDroneIds] = React.useState<string[] | null>(null);
  const [createGroupName, setCreateGroupName] = React.useState('');
  const [createGroupInlineError, setCreateGroupInlineError] = React.useState<string | null>(null);
  const [creatingGroupMove, setCreatingGroupMove] = React.useState(false);
  const [collapsedDroneSections, setCollapsedDroneSections] = React.useState<Record<string, boolean>>({});
  const [dragOverGroup, setDragOverGroup] = React.useState<string | null>(null);
  const [dragOverUngrouped, setDragOverUngrouped] = React.useState(false);
  const [dragOverSidebarGroup, setDragOverSidebarGroup] = React.useState<{
    token: string;
    placement: SidebarGroupDropPlacement;
  } | null>(null);
  const createGroupInputRef = React.useRef<HTMLInputElement | null>(null);
  const collapseTimerRef = React.useRef<number | null>(null);
  const expandTimerRef = React.useRef<number | null>(null);
  const lastAutoCollapsedAtRef = React.useRef<number>(0);
  const hiddenSidebarGroupTokenSet = React.useMemo(() => new Set(hiddenSidebarGroups), [hiddenSidebarGroups]);

  const clearCollapseTimer = React.useCallback(() => {
    if (collapseTimerRef.current === null) return;
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  }, []);

  const clearExpandTimer = React.useCallback(() => {
    if (expandTimerRef.current === null) return;
    window.clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
  }, []);

  React.useEffect(
    () => () => {
      clearCollapseTimer();
      clearExpandTimer();
    },
    [clearCollapseTimer, clearExpandTimer],
  );

  React.useEffect(() => {
    if (sidebarAutoMinimize) return;
    clearCollapseTimer();
    clearExpandTimer();
    lastAutoCollapsedAtRef.current = 0;
  }, [clearCollapseTimer, clearExpandTimer, sidebarAutoMinimize]);

  React.useEffect(() => {
    if (!createGroupTargetDroneIds || createGroupTargetDroneIds.length === 0) return;
    const id = window.requestAnimationFrame(() => {
      createGroupInputRef.current?.focus();
      createGroupInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [createGroupTargetDroneIds]);

  const closeCreateGroupInline = React.useCallback(() => {
    if (creatingGroupMove) return;
    setCreateGroupTargetDroneIds(null);
    setCreateGroupName('');
    setCreateGroupInlineError(null);
  }, [creatingGroupMove]);

  const onSubmitCreateGroupInline = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (creatingGroupMove) return;
      const ids = createGroupTargetDroneIds ?? [];
      const group = String(createGroupName ?? '').trim();
      if (!group) {
        setCreateGroupInlineError('Group name is required.');
        return;
      }
      if (ids.length === 0) {
        setCreateGroupInlineError('No drones selected for group move.');
        return;
      }

      setCreatingGroupMove(true);
      setCreateGroupInlineError(null);
      try {
        const result = await onCreateGroupAndMove(group, ids);
        if (!result.ok) {
          setCreateGroupInlineError(result.error || 'Failed to create group.');
          return;
        }
        setCreateGroupTargetDroneIds(null);
        setCreateGroupName('');
      } catch (error: any) {
        const msg = String(error?.message ?? error ?? '').trim();
        setCreateGroupInlineError(msg || 'Failed to create group.');
      } finally {
        setCreatingGroupMove(false);
      }
    },
    [createGroupName, createGroupTargetDroneIds, creatingGroupMove, onCreateGroupAndMove],
  );

  const collapseSidebarWithGuard = React.useCallback(() => {
    clearCollapseTimer();
    clearExpandTimer();
    lastAutoCollapsedAtRef.current = Date.now();
    setSidebarCollapsed(true);
  }, [clearCollapseTimer, clearExpandTimer, setSidebarCollapsed]);

  const queueAutoCollapse = React.useCallback(() => {
    if (!sidebarAutoMinimize || sidebarCollapsed) return;
    clearCollapseTimer();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      collapseSidebarWithGuard();
    }, AUTO_MINIMIZE_COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer, collapseSidebarWithGuard, sidebarAutoMinimize, sidebarCollapsed]);

  const queueAutoExpand = React.useCallback(() => {
    if (!sidebarAutoMinimize || !sidebarCollapsed) return;
    if (Date.now() - lastAutoCollapsedAtRef.current < AUTO_MINIMIZE_REOPEN_GUARD_MS) return;
    clearExpandTimer();
    expandTimerRef.current = window.setTimeout(() => {
      expandTimerRef.current = null;
      setSidebarCollapsed(false);
    }, AUTO_MINIMIZE_EXPAND_DELAY_MS);
  }, [clearExpandTimer, setSidebarCollapsed, sidebarAutoMinimize, sidebarCollapsed]);

  const onSidebarPointerEnter = React.useCallback(() => {
    clearCollapseTimer();
    clearExpandTimer();
  }, [clearCollapseTimer, clearExpandTimer]);

  const onSidebarPointerLeave = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      queueAutoCollapse();
    },
    [queueAutoCollapse],
  );

  const onCollapsedRailPointerEnter = React.useCallback(() => {
    clearCollapseTimer();
    queueAutoExpand();
  }, [clearCollapseTimer, queueAutoExpand]);

  const onCollapsedRailPointerLeave = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      clearExpandTimer();
    },
    [clearExpandTimer],
  );

  const isRepoGroupingMode = sidebarGroupingMode === 'repos';
  const activeDraggedDroneIds = React.useMemo(() => draggedDroneIdsFromData(activeDrag), [activeDrag]);
  const draggingSidebarGroup =
    activeDrag?.type === 'sidebar-group' ? sidebarGroupOrderToken(activeDrag.groupRef) : null;

  const clearSidebarDragState = React.useCallback(() => {
    setDragOverSidebarGroup(null);
    setDragOverGroup(null);
    setDragOverUngrouped(false);
    setDragOverCreateGroup(false);
  }, []);

  const currentPlacementFromEvent = React.useCallback(
    (event: DragMoveEvent | DragOverEvent | DragEndEvent): SidebarGroupDropPlacement =>
      sidebarDropPlacementFromRects(
        event.active.rect.current.translated ?? event.active.rect.current.initial,
        event.over?.rect ?? null,
      ),
    [],
  );

  const resolveMoveTargetGroupFromOverData = React.useCallback((overData: Record<string, unknown> | undefined): string | null => {
    if (!overData) return null;
    if (overData.type === 'sidebar-group-move') {
      return String(overData.group ?? '').trim() || null;
    }
    if (overData.type === 'sidebar-drone-reorder') {
      return String(overData.groupName ?? '').trim() || null;
    }
    return null;
  }, []);

  const updateSidebarDragState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overData = event.over?.data.current as Record<string, unknown> | undefined;
      const draggedDroneIds = draggedDroneIdsFromData(activeData);
      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-reorder' &&
        overData.groupRef &&
        typeof overData.groupRef === 'object'
      ) {
        const target = overData.groupRef as SidebarDragGroupRef;
        const draggedToken = sidebarGroupOrderToken(activeData.groupRef);
        const targetToken = sidebarGroupOrderToken(target);
        if (draggedToken && targetToken && draggedToken !== targetToken) {
          setDragOverGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(false);
          setDragOverSidebarGroup({
            token: targetToken,
            placement: currentPlacementFromEvent(event),
          });
          return;
        }
      }

      if (!isRepoGroupingMode && draggedDroneIds.length > 0) {
        const moveTargetGroup = resolveMoveTargetGroupFromOverData(overData);
        if (moveTargetGroup) {
          if (activeData?.type === 'sidebar-group' && activeData.groupRef.kind === 'group' && activeData.groupRef.group === moveTargetGroup) {
            clearSidebarDragState();
            return;
          }
          setDragOverSidebarGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(false);
          setDragOverGroup(moveTargetGroup);
          return;
        }
        if (overData?.type === 'sidebar-ungrouped-drop' && !sidebarHasUngroupedGroup) {
          setDragOverSidebarGroup(null);
          setDragOverGroup(null);
          setDragOverCreateGroup(false);
          setDragOverUngrouped(true);
          return;
        }
        if (overData?.type === 'sidebar-create-group-drop') {
          setDragOverSidebarGroup(null);
          setDragOverGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(true);
          return;
        }
      }

      clearSidebarDragState();
    },
    [clearSidebarDragState, currentPlacementFromEvent, isRepoGroupingMode, resolveMoveTargetGroupFromOverData, sidebarHasUngroupedGroup],
  );

  useDndMonitor({
    onDragMove: updateSidebarDragState,
    onDragOver: updateSidebarDragState,
    onDragCancel: clearSidebarDragState,
    onDragEnd: (event) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overData = event.over?.data.current as Record<string, unknown> | undefined;
      const draggedDroneIds = draggedDroneIdsFromData(activeData);

      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-reorder' &&
        overData.groupRef &&
        typeof overData.groupRef === 'object'
      ) {
        const target = overData.groupRef as SidebarDragGroupRef;
        const targetToken = sidebarGroupOrderToken(target);
        if (targetToken && targetToken !== sidebarGroupOrderToken(activeData.groupRef)) {
          const placement =
            dragOverSidebarGroup?.token === targetToken
              ? dragOverSidebarGroup.placement
              : currentPlacementFromEvent(event);
          setSidebarGroupOrder((prev) =>
            reorderSidebarGroupOrder(prev, sidebarGroups, activeData.groupRef, target, placement),
          );
          clearSidebarDragState();
          return;
        }
      }

      if (!isRepoGroupingMode && draggedDroneIds.length > 0) {
        const moveTargetGroup = resolveMoveTargetGroupFromOverData(overData);
        if (moveTargetGroup) {
          void onMoveDronesToGroup(moveTargetGroup, draggedDroneIds);
          clearSidebarDragState();
          return;
        }
        if (overData?.type === 'sidebar-ungrouped-drop' && !sidebarHasUngroupedGroup) {
          void onMoveDronesToGroup('Ungrouped', draggedDroneIds);
          clearSidebarDragState();
          return;
        }
        if (overData?.type === 'sidebar-create-group-drop') {
          setCreateGroupTargetDroneIds(draggedDroneIds);
          setCreateGroupInlineError(null);
          clearSidebarDragState();
          return;
        }
      }

      clearSidebarDragState();
    },
  });

  const toggleSidebarGroupHidden = React.useCallback(
    (target: SidebarDragGroupRef) => {
      const token = sidebarGroupOrderToken(target);
      setHiddenSidebarGroups((prev) => {
        const hasToken = prev.includes(token);
        if (hasToken) return prev.filter((item) => item !== token);
        return [...prev, token];
      });
    },
    [setHiddenSidebarGroups],
  );
  const collapsedRailInteractive = sidebarCollapsed;
  const showExternalMoveTargets = !isRepoGroupingMode && activeDraggedDroneIds.length > 0;
  const { setNodeRef: setUngroupedDropNodeRef } = useDroppable({
    id: 'sidebar-ungrouped-drop',
    data: { type: 'sidebar-ungrouped-drop' },
    disabled: !showExternalMoveTargets || sidebarHasUngroupedGroup,
  });
  const { setNodeRef: setCreateGroupDropNodeRef } = useDroppable({
    id: 'sidebar-create-group-drop',
    data: { type: 'sidebar-create-group-drop' },
    disabled: isRepoGroupingMode,
  });
  const sidebarVisibleDroneCount = sidebarVisibleDrones.length;
  const sidebarVisibleMultiChatActive = selectedGroupMultiChat === SIDEBAR_VISIBLE_MULTI_CHAT_GROUP;
  const activeChatName = String(selectedChat ?? '').trim() || 'default';
  const visibleDraftSidebarPlaceholder = React.useMemo(() => {
    if (!draftSidebarPlaceholder) return null;
    const repoPath = String(draftSidebarPlaceholder.repoPath ?? '').trim();
    const activeRepo = String(activeRepoPath ?? '').trim();
    if (activeRepo && activeRepo !== repoPath) return null;
    return {
      ...draftSidebarPlaceholder,
      repoPath,
      group: String(draftSidebarPlaceholder.group ?? '').trim() || null,
    };
  }, [activeRepoPath, draftSidebarPlaceholder]);
  const draftSidebarPlaceholderDrone = React.useMemo<DroneSummary | null>(() => {
    if (!visibleDraftSidebarPlaceholder) return null;
    return {
      id: DRAFT_SIDEBAR_PLACEHOLDER_ID,
      name: visibleDraftSidebarPlaceholder.name,
      group: visibleDraftSidebarPlaceholder.group,
      createdAt: new Date().toISOString(),
      repoAttached: Boolean(visibleDraftSidebarPlaceholder.repoPath),
      repoPath: visibleDraftSidebarPlaceholder.repoPath,
      containerPort: 0,
      hostPort: null,
      statusOk: true,
      statusError: null,
      chats: ['default'],
      hubPhase: null,
      hubMessage: null,
      busy: false,
    };
  }, [visibleDraftSidebarPlaceholder]);
  const renderSidebarGroups = React.useMemo(() => {
    if (!draftSidebarPlaceholderDrone) return sidebarGroups;
    const placeholderGroup =
      sidebarGroupingMode === 'repos'
        ? {
            group: draftSidebarPlaceholderDrone.repoPath
              ? `repo:${draftSidebarPlaceholderDrone.repoPath}`
              : 'repo:ungrouped',
            label: draftSidebarPlaceholderDrone.repoPath
              ? repoPathToLabel(draftSidebarPlaceholderDrone.repoPath)
              : 'Ungrouped',
            kind: 'repo' as const,
          }
        : {
            group: String(draftSidebarPlaceholderDrone.group ?? '').trim() || 'Ungrouped',
            label: String(draftSidebarPlaceholderDrone.group ?? '').trim() || 'Ungrouped',
            kind: 'group' as const,
          };
    if (!showHiddenSidebarGroups && hiddenSidebarGroupTokenSet.has(sidebarGroupOrderToken(placeholderGroup))) {
      return sidebarGroups;
    }
    const next = sidebarGroups.map((group) =>
      group.group === placeholderGroup.group
        ? { ...group, items: [draftSidebarPlaceholderDrone, ...group.items] }
        : group,
    );
    if (next.some((group) => group.group === placeholderGroup.group)) return next;
    next.push({ ...placeholderGroup, items: [draftSidebarPlaceholderDrone] });
    next.sort((a, b) => {
      if (isUngroupedGroupName(a.label) && !isUngroupedGroupName(b.label)) return -1;
      if (!isUngroupedGroupName(a.label) && isUngroupedGroupName(b.label)) return 1;
      return a.label.localeCompare(b.label);
    });
    return orderSidebarGroups(next, sidebarGroupOrder);
  }, [draftSidebarPlaceholderDrone, hiddenSidebarGroupTokenSet, showHiddenSidebarGroups, sidebarGroupOrder, sidebarGroups, sidebarGroupingMode]);
  const flatSidebarDrones = React.useMemo(() => {
    const items = sidebarDronesFilteredByRepo.slice().sort(compareDronesByNewestFirst);
    return draftSidebarPlaceholderDrone ? [draftSidebarPlaceholderDrone, ...items] : items;
  }, [draftSidebarPlaceholderDrone, sidebarDronesFilteredByRepo]);
  const flatSidebarTree = React.useMemo(() => buildSidebarDroneTree(flatSidebarDrones), [flatSidebarDrones]);
  const sidebarDroneById = React.useMemo(() => {
    const out: Record<string, DroneSummary> = {};
    for (const drone of flatSidebarDrones) {
      const droneId = String(drone?.id ?? '').trim();
      if (!droneId) continue;
      out[droneId] = drone;
    }
    return out;
  }, [flatSidebarDrones]);

  const toggleDroneSection = React.useCallback((droneIdRaw: string, kind: SidebarInlineSectionKind) => {
    const key = sidebarInlineSectionKey(droneIdRaw, kind);
    setCollapsedDroneSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  React.useEffect(() => {
    const selectedDroneId = String(selectedDrone ?? '').trim();
    const selectedChatName = String(activeChatName ?? '').trim() || 'default';
    if (!selectedDroneId) return;
    setCollapsedDroneSections((prev) => {
      const next = { ...prev };
      let changed = false;

      if (selectedChatName !== 'default') {
        const chatKey = sidebarInlineSectionKey(selectedDroneId, 'chats');
        if (next[chatKey]) {
          next[chatKey] = false;
          changed = true;
        }
      }

      const visited = new Set<string>();
      let currentDroneId = selectedDroneId;
      while (currentDroneId && !visited.has(currentDroneId)) {
        visited.add(currentDroneId);
        const parentId = String(sidebarDroneById[currentDroneId]?.fleetParentId ?? '').trim();
        if (!parentId || !sidebarDroneById[parentId]) break;
        const childrenKey = sidebarInlineSectionKey(parentId, 'children');
        if (next[childrenKey]) {
          next[childrenKey] = false;
          changed = true;
        }
        currentDroneId = parentId;
      }

      return changed ? next : prev;
    });
  }, [activeChatName, selectedDrone, sidebarDroneById]);
  const sharedDroneTreeListProps = {
    droneById: sidebarDroneById,
    draftSidebarPlaceholderId: DRAFT_SIDEBAR_PLACEHOLDER_ID,
    selectedDroneIds,
    selectedDroneSet,
    selectedDrone,
    activeChatName,
    busyChatNodeIdSet,
    unreadAgentMessageByChatNodeId,
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    movingDroneGroups,
    sidebarOptimisticDroneIdSet,
    collapsedDroneSections,
    uiDroneName,
    onToggleSection: toggleDroneSection,
    onSelectDroneCard,
    onSelectDroneChat,
    onDeleteDroneChat,
    onOpenCloneModal,
    onRenameDrone,
    onSetDroneBaseImage,
    onDeleteDrone,
    onOpenDroneErrorModal,
    onPrepareDroneDragStart,
  } satisfies Omit<React.ComponentProps<typeof SidebarDroneTreeList>, 'tree'>;

  return (
    <>
      <aside
        data-drone-sidebar-root="true"
        className="bg-[var(--panel-alt)] border-r border-[var(--border)] flex flex-col min-h-0 relative dh-dot-grid flex-shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:width]"
        style={{ width: sidebarCollapsed ? 0 : SIDEBAR_EXPANDED_WIDTH_PX }}
        onPointerEnter={onSidebarPointerEnter}
        onPointerLeave={onSidebarPointerLeave}
      >
        <div className="flex-shrink-0 px-3 py-3 border-b border-[var(--border)] relative">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="font-semibold text-[13px] text-[var(--fg)] whitespace-nowrap"
                style={{ fontFamily: 'var(--display)' }}
              >
                Drone Hub
              </span>
              {selectedDroneIds.length > 1 && (
                <span className="text-[10px] text-[var(--accent)] whitespace-nowrap" title={`${selectedDroneIds.length} drones selected`}>
                  {selectedDroneIds.length} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={onOpenDraftChatComposer}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  draftChat
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title="Create drone"
                aria-label="Create drone"
              >
                <IconPlus className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                title="Create multiple drones"
                aria-label="Create multiple drones"
              >
                <IconPlusDouble className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={onOpenVisibleMultiChat}
                disabled={sidebarVisibleDroneCount === 0}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  sidebarVisibleDroneCount === 0
                    ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
                    : sidebarVisibleMultiChatActive
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title={`Open multi-chat for ${sidebarVisibleDroneCount} visible drone${sidebarVisibleDroneCount === 1 ? '' : 's'}`}
                aria-label={`Open multi-chat for ${sidebarVisibleDroneCount} visible drone${sidebarVisibleDroneCount === 1 ? '' : 's'}`}
              >
                <IconColumns className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={onOpenKanbanBoard}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  kanbanBoardOpen
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title="Open task board"
                aria-label="Open task board"
              >
                <IconBoard className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={onOpenPlaybookRuns}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  playbookRunsOpen
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title="Open playbook runs"
                aria-label="Open playbook runs"
              >
                <IconList className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={() => setAppView((prev) => (prev === 'settings' ? 'workspace' : 'settings'))}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  appView === 'settings'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title={appView === 'settings' ? 'Back to workspace' : 'Open settings'}
                aria-label={appView === 'settings' ? 'Back to workspace' : 'Open settings'}
              >
                <IconSettings className="opacity-80" />
              </button>
              <button
                onClick={() => setViewMode((prev) => (prev === 'grouped' ? 'flat' : 'grouped'))}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-semibold text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-all"
                title={viewMode === 'grouped' ? 'Switch to flat list' : 'Switch to grouped folders'}
              >
                <IconList className="opacity-60" />
                {viewMode === 'grouped' ? 'Grp' : 'Flat'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {dronesError && (
            <div className="mx-2 mb-2 p-3 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-xs text-[var(--red)]">
              Failed to load drones: {dronesError}
            </div>
          )}
          {groupMoveError && (
            <div className="mx-2 mb-2 p-2 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-[11px] text-[var(--red)]">
              Group move failed: {groupMoveError}
            </div>
          )}
          {dronesLoading && sidebarDronesFilteredByRepo.length === 0 && !dronesError && (
            <div className="px-3 py-3 flex flex-col gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2 opacity-30">
                  <SkeletonLine w="65%" />
                  <SkeletonLine w="40%" />
                </div>
              ))}
            </div>
          )}
          {!dronesLoading && sidebarDrones.length === 0 && !visibleDraftSidebarPlaceholder && !dronesError && (
            <div className="px-3 py-10 text-center">
              <div
                className="text-[var(--muted-dim)] text-[11px] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                No drones registered
              </div>
              <div className="mt-4 mx-auto max-w-[240px] flex flex-col gap-2">
                <button
                  type="button"
                  onClick={onOpenDraftChatComposer}
                  className="w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                  title="Create new drone"
                  aria-label="Create new drone"
                >
                  <IconPlus className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Create new drone
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onOpenCreateModal}
                  className="w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                  title="Create multiple drones"
                  aria-label="Create multiple drones"
                >
                  <IconPlusDouble className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Create multiple drones
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onOpenKanbanBoard}
                  className={`w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border transition-all ${
                    kanbanBoardOpen
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                  }`}
                  title="Open task board"
                  aria-label="Open task board"
                >
                  <IconBoard className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Open task board
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onOpenPlaybookRuns}
                  className={`w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border transition-all ${
                    playbookRunsOpen
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                  }`}
                  title="Open playbook runs"
                  aria-label="Open playbook runs"
                >
                  <IconList className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Open playbook runs
                  </span>
                </button>
              </div>
              <div className="text-[var(--muted-dim)] text-[10px] mt-4">
                Or run{' '}
                <code className="px-1.5 py-0.5 rounded bg-[rgba(167,139,250,.06)] border border-[rgba(167,139,250,.08)] text-[#C4B5FD] text-[10px]">
                  drone create &lt;name&gt;
                </code>{' '}
                in your terminal.
              </div>
            </div>
          )}
          {!dronesLoading && sidebarDrones.length > 0 && sidebarDronesFilteredByRepo.length === 0 && activeRepoPath && !visibleDraftSidebarPlaceholder && !dronesError && (
            <div className="px-3 py-10 text-center">
              <div
                className="text-[var(--muted-dim)] text-[11px] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                No drones for selected repo
              </div>
              <div className="text-[var(--muted-dim)] text-[10px] mt-2 font-mono truncate" title={activeRepoPath}>
                {activeRepoPath}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-0.5 select-none">
            {viewMode === 'flat' ? (
              <SidebarDroneTreeList {...sharedDroneTreeListProps} tree={flatSidebarTree} />
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                {renderSidebarGroups.map(({ group, label, kind, items }) => {
                  const groupRef = { group, kind };
                  const groupToken = sidebarGroupOrderToken(groupRef);
                  const groupTree = buildSidebarDroneTree(items);
                  const actualItems = items.filter((item) => item.id !== DRAFT_SIDEBAR_PLACEHOLDER_ID);
                  const hasPlaceholder = actualItems.length !== items.length;
                  const placeholderOnly = hasPlaceholder && actualItems.length === 0;
                  const groupLabel = String(label ?? group).trim() || group;
                  const isVirtualGroup = kind === 'repo';
                  const uniqueRepoPaths = Array.from(
                    new Set(
                      items
                        .map((item) => String(item?.repoPath ?? '').trim())
                        .filter(Boolean),
                    ),
                  );
                  const hoveredRepoPath = isVirtualGroup
                    ? group.startsWith('repo:') && group !== 'repo:ungrouped'
                      ? group.slice('repo:'.length)
                      : ''
                    : String(activeRepoPath ?? '').trim() || (uniqueRepoPaths.length === 1 ? uniqueRepoPaths[0] : '');
                  const hoveredGroupName = isVirtualGroup ? '' : groupLabel;
                  const collapsed = !!collapsedGroups[group];
                  const isDeletingGroup = Boolean(deletingGroups[group]);
                  const isRenamingGroup = Boolean(renamingGroups[group]);
                  const isDropTarget = !isVirtualGroup && dragOverGroup === group;
                  const isReorderTarget = dragOverSidebarGroup?.token === groupToken;
                  const isReorderDragging = draggingSidebarGroup === groupToken;
                  const isHiddenGroup = hiddenSidebarGroupTokenSet.has(groupToken);
                  const canRenameGroup = !placeholderOnly && !isVirtualGroup && !isUngroupedGroupName(groupLabel);
                  const pinGroupActionsVisible = isDeletingGroup || isRenamingGroup || selectedGroupMultiChat === group;
                  return (
                    <SidebarGroupSection
                      key={group}
                      groupRef={groupRef}
                      groupLabel={groupLabel}
                      groupToken={groupToken}
                      kind={kind}
                      actualItems={actualItems}
                      placeholderOnly={placeholderOnly}
                      isVirtualGroup={isVirtualGroup}
                      hoveredRepoPath={hoveredRepoPath}
                      hoveredGroupName={hoveredGroupName}
                      collapsed={collapsed}
                      isDeletingGroup={isDeletingGroup}
                      isRenamingGroup={isRenamingGroup}
                      isDropTarget={isDropTarget}
                      isReorderTarget={isReorderTarget}
                      isReorderDragging={isReorderDragging}
                      isHiddenGroup={isHiddenGroup}
                      canRenameGroup={canRenameGroup}
                      pinGroupActionsVisible={pinGroupActionsVisible}
                      selectedGroupMultiChat={selectedGroupMultiChat}
                      dragOverSidebarGroup={dragOverSidebarGroup}
                      showMoveDropZone={showExternalMoveTargets}
                      sharedDroneTreeListProps={sharedDroneTreeListProps}
                      groupTree={groupTree}
                      onToggleGroupCollapsed={onToggleGroupCollapsed}
                      onRenameGroup={onRenameGroup}
                      toggleSidebarGroupHidden={toggleSidebarGroupHidden}
                      onOpenGroupMultiChat={onOpenGroupMultiChat}
                      onDeleteGroup={onDeleteGroup}
                    />
                  );
                })}
                {!isRepoGroupingMode && !sidebarHasUngroupedGroup && showExternalMoveTargets && (
                  <div
                    ref={setUngroupedDropNodeRef}
                    className={`rounded-md border border-dashed px-3 py-2 text-[10px] font-semibold tracking-wide uppercase transition-colors ${
                      dragOverUngrouped
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Drop here to move to Ungrouped
                  </div>
                )}
                </div>
                {!isRepoGroupingMode &&
                  (showExternalMoveTargets ||
                    (createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0)) && (
                  <div
                    ref={setCreateGroupDropNodeRef}
                    className={`mt-1 rounded-md border border-dashed px-3 py-2 transition-colors ${
                      dragOverCreateGroup || (createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0)
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)]'
                    }`}
                  >
                    <div
                      className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]"
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      {createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0
                        ? `Create new group (${createGroupTargetDroneIds.length} drone${createGroupTargetDroneIds.length === 1 ? '' : 's'})`
                        : 'Drop here to create a new group'}
                    </div>
                    {createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0 && (
                      <form className="mt-2 flex flex-col gap-2" onSubmit={onSubmitCreateGroupInline}>
                        <input
                          ref={createGroupInputRef}
                          value={createGroupName}
                          onChange={(event) => setCreateGroupName(event.target.value)}
                          disabled={creatingGroupMove}
                          maxLength={64}
                          placeholder="Group name"
                          className="w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 py-1.5 text-[11px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={creatingGroupMove}
                            className={`inline-flex h-7 items-center rounded px-2 text-[10px] font-semibold tracking-wide uppercase transition-all ${
                              creatingGroupMove
                                ? 'cursor-not-allowed border border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                : 'border border-[var(--accent-muted)] bg-[rgba(167,139,250,.12)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.18)]'
                            }`}
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            {creatingGroupMove ? 'Creating…' : 'Create & move'}
                          </button>
                          <button
                            type="button"
                            onClick={closeCreateGroupInline}
                            disabled={creatingGroupMove}
                            className={`inline-flex h-7 items-center rounded px-2 text-[10px] font-semibold tracking-wide uppercase transition-all ${
                              creatingGroupMove
                                ? 'cursor-not-allowed border border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                : 'border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                            }`}
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            Cancel
                          </button>
                        </div>
                        {createGroupInlineError && (
                          <div className="text-[10px] text-[var(--red)]">
                            {createGroupInlineError}
                          </div>
                        )}
                      </form>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)]">
          <div className="px-2.5 py-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSidebarReposCollapsed((prev) => !prev)}
              className="flex-1 min-w-0 inline-flex items-center gap-2 px-1.5 py-1 rounded text-left text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] transition-all"
              style={{ fontFamily: 'var(--display)' }}
              title={sidebarReposCollapsed ? 'Expand repos list' : 'Collapse repos list'}
              aria-label={sidebarReposCollapsed ? 'Expand repos list' : 'Collapse repos list'}
            >
              <IconChevron down={!sidebarReposCollapsed} className="opacity-70" />
              <IconFolder className="opacity-60 w-3 h-3" />
              <span className="truncate">Repos {repos.length > 0 ? repos.length : ''}</span>
              {activeRepoPath ? (
                <span className="ml-auto px-1.5 py-0.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[9px] text-[var(--accent)]">
                  Filtered
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={onOpenReposModal}
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
              title={`Manage repos (${repos.length})`}
              aria-label="Manage repos"
            >
              <IconSettings className="opacity-70" />
            </button>
          </div>
          {!sidebarReposCollapsed && (
            <div className="max-h-[190px] overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setActiveRepoPath('')}
                className={`w-full text-left px-2.5 py-2 rounded border transition-all ${
                  !activeRepoPath
                    ? 'bg-[var(--selected)] border-[var(--accent-muted)]'
                    : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                }`}
                title="Show drones from all repos"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--fg-secondary)]">All repos</span>
                  <span className="text-[10px] font-mono text-[var(--muted-dim)]">{dronesCount}</span>
                </div>
              </button>
              {repos
                .slice()
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((r) => {
                  const p = String(r.path ?? '').trim();
                  if (!p) return null;
                  const selected = p === activeRepoPath;
                  const base = r.github
                    ? `${r.github.owner}/${r.github.repo}`
                    : p.split(/[\\/]/).filter(Boolean).pop() || p;
                  const droneCount = droneCountByRepoPath.get(p) ?? 0;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setActiveRepoPath((prev) => (prev === p ? '' : p))}
                      className={`w-full text-left px-2.5 py-2 rounded border transition-all ${
                        selected
                          ? 'bg-[var(--selected)] border-[var(--accent-muted)] shadow-[0_0_8px_rgba(167,139,250,.06)]'
                          : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                      }`}
                      title={p}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--fg-secondary)] truncate">{base}</div>
                          <div className="text-[10px] text-[var(--muted-dim)] truncate font-mono mt-0.5">{p}</div>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--muted-dim)] mt-0.5">{droneCount}</span>
                      </div>
                    </button>
                  );
                })}
              {!reposLoading && repos.length === 0 && !reposError && (
                <div className="px-2.5 py-3 text-[10px] text-[var(--muted-dim)]">
                  No repos registered yet.
                </div>
              )}
              {reposError && (
                <div className="px-2.5 py-3 text-[10px] text-[var(--red)]">
                  Failed to load repos.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-3 py-2.5 border-t border-[var(--border)] flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            {(sidebarHiddenGroupCount > 0 || showHiddenSidebarGroups) && (
              <button
                type="button"
                onClick={() => setShowHiddenSidebarGroups((prev) => !prev)}
                className={`inline-flex items-center gap-2 self-start rounded border px-2 py-1 text-[10px] font-semibold tracking-wide uppercase transition-all ${
                  showHiddenSidebarGroups
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title={
                  showHiddenSidebarGroups
                    ? `Hide temporarily revealed groups${sidebarHiddenGroupCount > 0 ? ` (${sidebarHiddenGroupCount})` : ''}`
                    : `Show hidden groups${sidebarHiddenGroupCount > 0 ? ` (${sidebarHiddenGroupCount})` : ''}`
                }
                aria-pressed={showHiddenSidebarGroups}
              >
                {showHiddenSidebarGroups ? <IconEyeOff className="opacity-90" /> : <IconEye className="opacity-90" />}
                <span>
                  {showHiddenSidebarGroups ? 'Hide hidden' : 'Show hidden'}
                  {sidebarHiddenGroupCount > 0 ? ` ${sidebarHiddenGroupCount}` : ''}
                </span>
              </button>
            )}
            <label className="flex items-center gap-2 select-none cursor-pointer group">
              <input
                type="checkbox"
                className="accent-[var(--accent)] w-3.5 h-3.5"
                checked={autoDelete}
                onChange={(e) => setAutoDelete(e.target.checked)}
              />
              <span className="text-[10px] text-[var(--muted-dim)] group-hover:text-[var(--muted)] transition-colors" title="When enabled, delete/archive actions won't ask for confirmation.">
                Skip delete confirm
              </span>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <SidebarIconButton
              onClick={() => setSidebarGroupingMode((prev) => (prev === 'groups' ? 'repos' : 'groups'))}
              aria-pressed={isRepoGroupingMode}
              className={`border ${
                isRepoGroupingMode
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]'
              }`}
              title={isRepoGroupingMode ? 'Show real groups in sidebar' : 'Show repos as virtual groups'}
              ariaLabel={isRepoGroupingMode ? 'Show real groups in sidebar' : 'Show repos as virtual groups'}
            >
              <IconFolder className="opacity-90" />
            </SidebarIconButton>
            <SidebarIconButton
              onClick={() => setSidebarAutoMinimize((prev) => !prev)}
              aria-pressed={sidebarAutoMinimize}
              className={`border ${
                sidebarAutoMinimize
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]'
              }`}
              title={
                sidebarAutoMinimize
                  ? 'Disable auto-minimize sidebar'
                  : 'Enable auto-minimize sidebar'
              }
              ariaLabel={
                sidebarAutoMinimize
                  ? 'Disable auto-minimize sidebar'
                  : 'Enable auto-minimize sidebar'
              }
            >
              <IconAutoMinimize className="opacity-90" />
            </SidebarIconButton>
            <SidebarIconButton
              onClick={collapseSidebarWithGuard}
              className="text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)]"
              title="Collapse sidebar"
              ariaLabel="Collapse sidebar"
            >
              <IconSidebarCollapse />
            </SidebarIconButton>
          </div>
        </div>
      </aside>

      <div
        data-drone-sidebar-root="true"
        className={`flex-shrink-0 bg-[var(--panel-alt)] border-r flex flex-col items-center pt-3 gap-2 overflow-hidden transition-[width,opacity,border-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          sidebarCollapsed
            ? 'opacity-100 border-[var(--border)]'
            : 'opacity-0 border-transparent pointer-events-none'
        }`}
        style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_RAIL_WIDTH_PX : 0 }}
        onPointerEnter={onCollapsedRailPointerEnter}
        onPointerLeave={onCollapsedRailPointerLeave}
        aria-hidden={!sidebarCollapsed}
      >
        <SidebarIconButton
          onClick={() => setSidebarCollapsed(false)}
          className="text-[var(--muted-dim)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)]"
          title="Expand sidebar"
          ariaLabel="Expand sidebar"
          disabled={!collapsedRailInteractive}
          tabIndex={collapsedRailInteractive ? 0 : -1}
        >
          <IconSidebarExpand />
        </SidebarIconButton>
        <SidebarIconButton
          onClick={() => { setSidebarCollapsed(false); onOpenDraftChatComposer(); }}
          className={`border ${
            draftChat
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
          }`}
          title="Create drone"
          ariaLabel="Create drone"
          disabled={!collapsedRailInteractive}
          tabIndex={collapsedRailInteractive ? 0 : -1}
        >
          <IconPlus className="opacity-80" />
        </SidebarIconButton>
        <SidebarIconButton
          onClick={() => { setSidebarCollapsed(false); onOpenCreateModal(); }}
          className="border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
          title="Create multiple drones (S)"
          ariaLabel="Create multiple drones"
          disabled={!collapsedRailInteractive}
          tabIndex={collapsedRailInteractive ? 0 : -1}
        >
          <IconPlusDouble className="opacity-80" />
        </SidebarIconButton>
        <SidebarIconButton
          onClick={() => { setSidebarCollapsed(false); onOpenKanbanBoard(); }}
          className={`border ${
            kanbanBoardOpen
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
          }`}
          title="Open task board"
          ariaLabel="Open task board"
          disabled={!collapsedRailInteractive}
          tabIndex={collapsedRailInteractive ? 0 : -1}
        >
          <IconBoard className="opacity-80" />
        </SidebarIconButton>
        <SidebarIconButton
          onClick={() => { setSidebarCollapsed(false); onOpenPlaybookRuns(); }}
          className={`border ${
            playbookRunsOpen
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
          }`}
          title="Open playbook runs"
          ariaLabel="Open playbook runs"
          disabled={!collapsedRailInteractive}
          tabIndex={collapsedRailInteractive ? 0 : -1}
        >
          <IconList className="opacity-80" />
        </SidebarIconButton>
        <SidebarIconButton
          onClick={() => { setSidebarCollapsed(false); onOpenVisibleMultiChat(); }}
          className={`border ${
            sidebarVisibleDroneCount === 0
              ? 'border-[var(--border-subtle)] text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
              : sidebarVisibleMultiChatActive
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
          }`}
          title={`Open multi-chat for ${sidebarVisibleDroneCount} visible drone${sidebarVisibleDroneCount === 1 ? '' : 's'}`}
          ariaLabel={`Open multi-chat for ${sidebarVisibleDroneCount} visible drone${sidebarVisibleDroneCount === 1 ? '' : 's'}`}
          disabled={!collapsedRailInteractive || sidebarVisibleDroneCount === 0}
          tabIndex={collapsedRailInteractive && sidebarVisibleDroneCount > 0 ? 0 : -1}
        >
          <IconColumns className="opacity-80" />
        </SidebarIconButton>
      </div>
    </>
  );
}
