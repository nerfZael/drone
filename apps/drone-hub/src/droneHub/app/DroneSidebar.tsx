import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary, RepoSummary } from '../types';
import { dropdownMenuItemBaseClass, dropdownPanelBaseClass, useDropdownDismiss } from '../../ui/dropdown';
import { IconAutoMinimize, IconBoard, IconChevron, IconColumns, IconDrone, IconEye, IconEyeOff, IconFolder, IconList, IconMore, IconPencil, IconPlus, IconPlusDouble, IconSettings, IconSidebarCollapse, IconSidebarExpand, IconSpinner, IconTrash, IconTreeView, SkeletonLine } from './icons';
import { SidebarDroneTreeList, type SidebarDroneTreeListSharedProps } from './SidebarDroneTreeList';
import { GroupedSidebarTree } from './GroupedSidebarTree';
import { SidebarReorderDropIndicator } from './sidebar-reorder-ui';
import { buildSidebarDroneTree } from './sidebar-drone-tree';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';
import {
  orderSidebarGroups,
  sidebarGroupOrderToken,
  type SidebarGroupDropPlacement,
  type SidebarGroupOrderKind,
} from './sidebar-group-order';
import {
  buildSidebarFolderTree,
  flattenSidebarFolderTree,
  sidebarFolderDisplayLabel,
  type SidebarFolderNode,
} from './sidebar-folder-tree';
import { buildSidebarNodeTree } from './sidebar-node-tree';
import {
  groupSidebarRepoScopedGroupsByRepoGroup,
  removeSidebarRepoScopedGroupMapKeysByPrefix,
  rewriteSidebarRepoScopedGroupMapKeysByPrefix,
} from './sidebar-repo-scoped-groups';
import {
  sidebarChatSidebarNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
} from './sidebar-node-order';
import { useDroneHubActiveDrag, type SidebarDragGroupRef, type SidebarGroupDragData } from './drone-hub-dnd';
import { SIDEBAR_VISIBLE_MULTI_CHAT_GROUP, type SidebarGroup } from './use-sidebar-view-model';
import { useSidebarOptimisticGroups } from './use-sidebar-optimistic-groups';
import type { MoveDronesToGroupResult } from './use-group-management';
import type { SidebarDensityMode } from './settings-types';
import { useSidebarReadModel } from './use-sidebar-read-model';
import {
  useSidebarInteractions,
  type ChatEditorState,
  type FolderEditorState,
} from './use-sidebar-interactions';
import { useSidebarRootDnd } from './use-sidebar-root-dnd';

const SIDEBAR_EXPANDED_WIDTH_PX = 280;
const SIDEBAR_COLLAPSED_RAIL_WIDTH_PX = 40;
const AUTO_MINIMIZE_COLLAPSE_DELAY_MS = 90;
const AUTO_MINIMIZE_EXPAND_DELAY_MS = 120;
const AUTO_MINIMIZE_REOPEN_GUARD_MS = 220;
const SIDEBAR_DENSITY_MODE_ORDER: SidebarDensityMode[] = ['compact', 'default', 'comfortable'];
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

function stepSidebarDensityMode(current: SidebarDensityMode, direction: -1 | 1): SidebarDensityMode {
  const currentIndex = SIDEBAR_DENSITY_MODE_ORDER.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 1;
  const nextIndex = Math.max(0, Math.min(SIDEBAR_DENSITY_MODE_ORDER.length - 1, safeIndex + direction));
  return SIDEBAR_DENSITY_MODE_ORDER[nextIndex] ?? 'default';
}

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
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
  sharedDroneTreeListProps: SidebarDroneTreeListSharedProps;
  groupTree: ReturnType<typeof buildSidebarDroneTree>;
  onToggleGroupCollapsed: (group: string) => void;
  onRenameGroup: (group: string) => void;
  toggleSidebarGroupHidden: (target: SidebarDragGroupRef) => void;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => Promise<boolean> | boolean;
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
  const actionRailWidthClass = canRenameGroup ? 'group-hover/group-header:w-[124px]' : 'group-hover/group-header:w-[92px]';
  const pinnedActionRailWidthClass = canRenameGroup ? 'w-[124px]' : 'w-[92px]';

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
        className={`group/group-header relative w-full px-3 py-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] transition-colors ${
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
          <IconChevron down={!collapsed} className="flex-shrink-0 text-[var(--muted-dim)]" />
          <IconFolder className="flex-shrink-0 text-[var(--muted-dim)] opacity-50" />
          <span
            className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--fg-secondary)] tracking-wide uppercase"
            style={{ fontFamily: 'var(--display)' }}
          >
            {groupLabel}
          </span>
        </button>
        <div
          className={`relative flex-shrink-0 transition-[width] duration-150 ${
            pinGroupActionsVisible ? pinnedActionRailWidthClass : `w-[64px] ${actionRailWidthClass}`
          }`}
        >
          <div
            className={`absolute inset-0 flex items-center justify-end text-[10px] font-mono text-[var(--muted-dim)] transition-opacity duration-150 ${countVisibleClass}`}
          >
            {actualItems.length} drone{actualItems.length !== 1 ? 's' : ''}
          </div>
          <div
            data-group-drag-block="true"
            className={`absolute inset-y-0 right-0 flex items-center justify-end gap-1 ${actionsVisibleClass}`}
            onPointerDown={stopGroupHeaderActionInteraction}
            onMouseDown={stopGroupHeaderActionInteraction}
          >
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

type SidebarFolderTreeNodeProps = {
  node: SidebarFolderNode;
  activeRepoPath: string;
  collapsedGroups: Record<string, boolean>;
  deletingGroups: Record<string, boolean>;
  renamingGroups: Record<string, boolean>;
  hiddenSidebarGroupTokenSet: Set<string>;
  dragOverGroup: string | null;
  dragOverSidebarGroup: { token: string; placement: SidebarGroupDropPlacement } | null;
  draggingSidebarGroup: string | null;
  showMoveDropZone: boolean;
  selectedFolderPath: string | null;
  folderEditor: FolderEditorState | null;
  folderEditorInputRef: React.RefObject<HTMLInputElement>;
  selectedGroupMultiChat: string | null;
  sharedDroneTreeListProps: SidebarDroneTreeListSharedProps;
  onSelectFolder: (path: string) => void;
  onToggleGroupCollapsed: (group: string) => void;
  onOpenFolderCreate: (
    parentPath: string | null,
    opts?: { anchorPath?: string | null; repoGroupPath?: string | null },
  ) => void;
  onStartRenameFolder: (group: string) => void;
  onFolderEditorValueChange: (next: string) => void;
  onSubmitFolderEditor: () => void;
  onBlurFolderEditor: () => void;
  onCancelFolderEditor: () => void;
  toggleSidebarGroupHidden: (target: SidebarDragGroupRef) => void;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => Promise<boolean> | boolean;
};

function SidebarFolderTreeNode({
  node,
  activeRepoPath,
  collapsedGroups,
  deletingGroups,
  renamingGroups,
  hiddenSidebarGroupTokenSet,
  dragOverGroup,
  dragOverSidebarGroup,
  draggingSidebarGroup,
  showMoveDropZone,
  selectedFolderPath,
  folderEditor,
  folderEditorInputRef,
  selectedGroupMultiChat,
  sharedDroneTreeListProps,
  onSelectFolder,
  onToggleGroupCollapsed,
  onOpenFolderCreate,
  onStartRenameFolder,
  onFolderEditorValueChange,
  onSubmitFolderEditor,
  onBlurFolderEditor,
  onCancelFolderEditor,
  toggleSidebarGroupHidden,
  onOpenGroupMultiChat,
  onDeleteGroup,
}: SidebarFolderTreeNodeProps) {
  const groupRef = React.useMemo<SidebarDragGroupRef>(() => ({ group: node.path, kind: 'group' }), [node.path]);
  const groupToken = React.useMemo(() => sidebarGroupOrderToken(groupRef), [groupRef]);
  const groupLabel = sidebarFolderDisplayLabel(node);
  const collapsed = Boolean(collapsedGroups[node.path]);
  const isDeletingGroup = Boolean(deletingGroups[node.path]);
  const isRenamingGroup = Boolean(renamingGroups[node.path]);
  const isDropTarget = dragOverGroup === node.path;
  const isReorderDragging = draggingSidebarGroup === groupToken;
  const isHiddenGroup = hiddenSidebarGroupTokenSet.has(groupToken);
  const isSelected = selectedFolderPath === node.path;
  const canRenameGroup = !isUngroupedGroupName(node.path);
  const canDeleteGroup = !isUngroupedGroupName(node.path);
  const showEditorInline = folderEditor?.targetPath === node.path && folderEditor.mode === 'rename';
  const showCreateInline = (folderEditor?.anchorPath ?? folderEditor?.parentPath) === node.path && folderEditor?.mode === 'create';
  const dragData = React.useMemo<SidebarGroupDragData>(
    () => ({
      type: 'sidebar-group',
      groupRef,
      groupLabel: node.path,
      droneIds: [],
    }),
    [groupRef, node.path],
  );
  const { attributes, listeners, setNodeRef: setDraggableNodeRef } = useDraggable({
    id: `sidebar-folder:${groupToken}`,
    data: dragData,
  });
  const { setNodeRef: setMoveDropNodeRef } = useDroppable({
    id: `sidebar-group-move:${groupToken}`,
    data: {
      type: 'sidebar-group-move',
      group: node.path,
      kind: 'group',
    },
  });
  const setHeaderNodeRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setDraggableNodeRef(element);
      setMoveDropNodeRef(element);
    },
    [setDraggableNodeRef, setMoveDropNodeRef],
  );
  const pinGroupActionsVisible =
    isDeletingGroup || isRenamingGroup || selectedGroupMultiChat === node.path || isSelected;
  const actionsVisibleClass = pinGroupActionsVisible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none group-hover/folder-row:opacity-100 group-hover/folder-row:pointer-events-auto';
  const countVisibleClass = pinGroupActionsVisible
    ? 'opacity-0 pointer-events-none'
    : 'opacity-100 group-hover/folder-row:opacity-0 group-hover/folder-row:pointer-events-none';
  const ownDroneTree = React.useMemo(() => buildSidebarDroneTree(node.ownItems), [node.ownItems]);
  const hoveredRepoPath = String(activeRepoPath ?? '').trim();

  return (
    <div className="flex flex-col gap-0.5">
      <div
        data-drone-sidebar-group={node.path}
        data-drone-sidebar-group-kind="group"
        data-drone-sidebar-group-name={node.path}
        data-drone-sidebar-repo-path={hoveredRepoPath || undefined}
        className="relative"
      >
        <div
          ref={setHeaderNodeRef}
          className={`group/folder-row relative flex min-h-8 items-center gap-1 rounded-md pr-1 transition-colors ${
            isDropTarget
              ? 'bg-[var(--accent-subtle)] ring-1 ring-[var(--accent-muted)]'
              : isSelected
                ? 'bg-[rgba(255,255,255,.04)]'
                : 'hover:bg-[var(--hover)]'
          } ${isReorderDragging ? 'opacity-70' : isHiddenGroup ? 'opacity-70' : ''}`}
          style={{ paddingLeft: `${Math.max(0, node.depth) * 8}px` }}
        >
          <button
            type="button"
            className={`min-w-0 flex-1 rounded px-1 py-1 text-left ${dragData ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
            onClick={() => {
              if (selectedFolderPath === node.path) {
                onToggleGroupCollapsed(node.path);
                return;
              }
              onSelectFolder(node.path);
            }}
            onDoubleClick={() => onToggleGroupCollapsed(node.path)}
            {...(attributes as unknown as Record<string, unknown>)}
            {...(listeners as unknown as Record<string, unknown>)}
            title={collapsed ? `Expand ${groupLabel}` : `Collapse ${groupLabel}`}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-dim)] opacity-80" />
              {showEditorInline && folderEditor ? (
                <input
                  ref={folderEditorInputRef}
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
                  className="min-w-0 flex-1 rounded border border-[var(--accent-muted)] bg-[rgba(0,0,0,.2)] px-1.5 py-0.5 text-[11px] text-[var(--fg)] focus:outline-none"
                />
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--fg-secondary)]"
                  title={node.path}
                >
                  {groupLabel}
                </span>
              )}
            </div>
          </button>
          <div className="relative w-[120px] flex-shrink-0">
            <div className={`absolute inset-0 flex items-center justify-end pr-1 text-[10px] font-mono text-[var(--muted-dim)] transition-opacity duration-150 ${countVisibleClass}`}>
              {node.totalDroneCount}
            </div>
            <div
              className={`absolute inset-y-0 right-0 flex items-center justify-end gap-1 ${actionsVisibleClass}`}
              onPointerDown={stopGroupHeaderActionInteraction}
              onMouseDown={stopGroupHeaderActionInteraction}
            >
              <button
                type="button"
                onClick={() => onOpenFolderCreate(node.path)}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
                title={`New subfolder in "${groupLabel}"`}
                aria-label={`New subfolder in "${groupLabel}"`}
              >
                <IconPlus className="opacity-90" />
              </button>
              {canRenameGroup ? (
                <button
                  type="button"
                  onClick={() => onStartRenameFolder(node.path)}
                  disabled={isDeletingGroup || isRenamingGroup}
                  aria-busy={isRenamingGroup}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                    isDeletingGroup || isRenamingGroup
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[rgba(167,139,250,.08)] border-[rgba(167,139,250,.18)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.12)]'
                  }`}
                  title={`Rename folder "${groupLabel}"`}
                  aria-label={`Rename folder "${groupLabel}"`}
                >
                  {isRenamingGroup ? <IconSpinner className="opacity-90" /> : <IconPencil className="opacity-90" />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => toggleSidebarGroupHidden(groupRef)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                  isHiddenGroup
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
                onClick={() => onOpenGroupMultiChat(node.path)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                  selectedGroupMultiChat === node.path
                    ? 'opacity-100 pointer-events-auto bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title={`Open "${groupLabel}" multi-chat`}
                aria-label={`Open "${groupLabel}" multi-chat`}
              >
                <IconColumns className="opacity-90" />
              </button>
              {canDeleteGroup ? (
                <button
                  type="button"
                  onClick={() => onDeleteGroup(node.path, node.totalDroneCount, { kind: 'group', label: node.path })}
                  disabled={isDeletingGroup || isRenamingGroup}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                    isDeletingGroup || isRenamingGroup
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
                  }`}
                  title={`Delete folder "${groupLabel}"`}
                  aria-label={`Delete folder "${groupLabel}"`}
                >
                  {isDeletingGroup ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {!collapsed ? (
        <div className="ml-2 flex flex-col gap-0.5 border-l border-[rgba(255,255,255,.04)] pl-1.5">
          {node.children.map((child) => (
            <SidebarFolderTreeNode
              key={child.path}
              node={child}
              activeRepoPath={activeRepoPath}
              collapsedGroups={collapsedGroups}
              deletingGroups={deletingGroups}
              renamingGroups={renamingGroups}
              hiddenSidebarGroupTokenSet={hiddenSidebarGroupTokenSet}
              dragOverGroup={dragOverGroup}
              dragOverSidebarGroup={dragOverSidebarGroup}
              draggingSidebarGroup={draggingSidebarGroup}
              showMoveDropZone={showMoveDropZone}
              selectedFolderPath={selectedFolderPath}
              folderEditor={folderEditor}
              folderEditorInputRef={folderEditorInputRef}
              selectedGroupMultiChat={selectedGroupMultiChat}
              sharedDroneTreeListProps={sharedDroneTreeListProps}
              onSelectFolder={onSelectFolder}
              onToggleGroupCollapsed={onToggleGroupCollapsed}
              onOpenFolderCreate={onOpenFolderCreate}
              onStartRenameFolder={onStartRenameFolder}
              onFolderEditorValueChange={onFolderEditorValueChange}
              onSubmitFolderEditor={onSubmitFolderEditor}
              onBlurFolderEditor={onBlurFolderEditor}
              onCancelFolderEditor={onCancelFolderEditor}
              toggleSidebarGroupHidden={toggleSidebarGroupHidden}
              onOpenGroupMultiChat={onOpenGroupMultiChat}
              onDeleteGroup={onDeleteGroup}
            />
          ))}
          {showCreateInline && folderEditor ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1.5">
              <IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)] opacity-80" />
              <input
                ref={folderEditorInputRef}
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
                className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 py-1 text-[11px] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
              />
            </div>
          ) : null}
          {folderEditor?.parentPath === node.path && folderEditor.error ? (
            <div className="text-[10px] text-[var(--red)]">{folderEditor.error}</div>
          ) : null}
          {node.ownItems.length > 0 ? (
            <SidebarDroneTreeList
              {...sharedDroneTreeListProps}
              tree={ownDroneTree}
              showGroup={false}
              groupOrderKey={groupToken}
              groupName={node.path}
            />
          ) : null}
        </div>
      ) : showMoveDropZone ? (
        <div className={`ml-5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${isDropTarget ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--muted-dim)]'}`} style={{ fontFamily: 'var(--display)' }}>
          Drop into {groupLabel}
        </div>
      ) : null}
      {showEditorInline && folderEditor?.error ? <div className="ml-5 text-[10px] text-[var(--red)]">{folderEditor.error}</div> : null}
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
  onCreateDroneChat: (
    drone: DroneSummary,
    chatName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onRenameDroneChat: (
    droneId: string,
    chatName: string,
    newName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onReparentDronesToParent: (
    parentDroneId: string | null,
    droneIds: string[],
  ) => Promise<{ ok: boolean; error?: string | null; reparentedIds?: string[] }>;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onCreateGroup: (group: string) => Promise<{ ok: boolean; error: string | null }> | { ok: boolean; error: string | null };
  onCreateGroupAndMove: (
    group: string,
    droneIds: string[],
  ) => Promise<{ ok: boolean; error: string | null }>;
  onToggleGroupCollapsed: (group: string) => void;
  onRenameGroup: (group: string, nextName?: string) => Promise<boolean> | boolean;
  onOpenGroupMultiChat: (group: string) => void;
  onOpenVisibleMultiChat: () => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => Promise<boolean> | boolean;
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
  onCreateDroneChat,
  onRenameDroneChat,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
  onReparentDronesToParent,
  onMoveDronesToGroup,
  onCreateGroup,
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
    appView,
    viewMode,
    sidebarGroupingMode,
    sidebarDensityMode,
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
    sidebarRepoScopedGroupByPath,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    hiddenSidebarGroups,
    showHiddenSidebarGroups,
    setAppView,
    setViewMode,
    setSidebarGroupingMode,
    setSidebarDensityMode,
    setCollapsedGroups,
    setSidebarGroupOrder,
    setSidebarRepoScopedGroupByPath,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setHiddenSidebarGroups,
    setShowHiddenSidebarGroups,
    setSidebarReposCollapsed,
    setSidebarAutoMinimize,
    setActiveRepoPath,
    setAutoDelete,
    setSidebarCollapsed,
  } = useDroneSidebarUiState();
  const activeDrag = useDroneHubActiveDrag();
  const headerActionsMenuRef = React.useRef<HTMLDivElement | null>(null);
  const footerOptionsMenuRef = React.useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = React.useRef<number | null>(null);
  const expandTimerRef = React.useRef<number | null>(null);
  const lastAutoCollapsedAtRef = React.useRef<number>(0);
  const [headerActionsMenuOpen, setHeaderActionsMenuOpen] = React.useState(false);
  const [footerOptionsMenuOpen, setFooterOptionsMenuOpen] = React.useState(false);
  const hiddenSidebarGroupTokenSet = React.useMemo(() => new Set(hiddenSidebarGroups), [hiddenSidebarGroups]);
  const isRepoGroupingMode = sidebarGroupingMode === 'repos';
  const repoScopedGroupPathsByRepoGroup = React.useMemo(
    () => groupSidebarRepoScopedGroupsByRepoGroup(sidebarRepoScopedGroupByPath),
    [sidebarRepoScopedGroupByPath],
  );
  const visibleFolderNodeOrderByParent = React.useMemo(() => {
    const baseSidebarFolderTree = buildSidebarFolderTree(sidebarGroups, sidebarGroupOrder);
    const nodeTree = buildSidebarNodeTree({
      sidebarFolderTree: baseSidebarFolderTree,
      sidebarGroups,
      sidebarGroupOrder,
      repoScopedGroupPathsByRepoGroup,
      sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent,
    });
    return Object.fromEntries(
      Object.entries(nodeTree.childIdsByParent).map(([parentId, childIds]) => [
        parentId,
        childIds.filter((childId) => nodeTree.nodesById[childId]?.kind === 'folder'),
      ]),
    );
  }, [
    repoScopedGroupPathsByRepoGroup,
    sidebarDroneOrderByGroup,
    sidebarGroupOrder,
    sidebarGroups,
    sidebarNodeOrderByParent,
  ]);
  const handleRenameGroup = React.useCallback(
    async (group: string, nextName?: string) => {
      const ok = await onRenameGroup(group, nextName);
      const targetGroup = String(nextName ?? '').trim();
      if (!ok || !targetGroup) return ok;
      setSidebarRepoScopedGroupByPath((prev) => rewriteSidebarRepoScopedGroupMapKeysByPrefix(prev, group, targetGroup));
      return ok;
    },
    [onRenameGroup, setSidebarRepoScopedGroupByPath],
  );
  const handleDeleteGroup = React.useCallback(
    async (
      group: string,
      count: number,
      opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
    ) => {
      const ok = await onDeleteGroup(group, count, opts);
      if (!ok || opts?.kind === 'repo') return ok;
      setSidebarRepoScopedGroupByPath((prev) => removeSidebarRepoScopedGroupMapKeysByPrefix(prev, group));
      return ok;
    },
    [onDeleteGroup, setSidebarRepoScopedGroupByPath],
  );
  const {
    optimisticSidebarGroups,
    optimisticSidebarDronesFilteredByRepo,
    runOptimisticCreateGroup,
    runOptimisticCreateGroupAndMove,
    runOptimisticRenameGroup,
    runOptimisticMoveDronesToGroup,
    runOptimisticReparentDronesToParent,
  } = useSidebarOptimisticGroups({
    isRepoGroupingMode,
    sidebarGroups,
    sidebarDronesFilteredByRepo,
    collapsedGroups,
    sidebarGroupOrder,
    hiddenSidebarGroups,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    visibleNodeOrderByParent: visibleFolderNodeOrderByParent,
    setCollapsedGroups,
    setSidebarGroupOrder,
    setHiddenSidebarGroups,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    onCreateGroup,
    onCreateGroupAndMove,
    onRenameGroup: handleRenameGroup,
    onMoveDronesToGroup,
    onReparentDronesToParent,
  });
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
  const draftSidebarPlaceholderNodeId = draftSidebarPlaceholderDrone
    ? sidebarDroneNodeId(DRAFT_SIDEBAR_PLACEHOLDER_ID)
    : null;
  const {
    renderSidebarGroups,
    sidebarFolderTree,
    flatSidebarTree,
    sidebarDroneById,
    visibleSidebarFolderPathSet,
  } = useSidebarReadModel({
    draftSidebarPlaceholderDrone,
    hiddenSidebarGroupTokenSet,
    isRepoGroupingMode,
    optimisticSidebarDronesFilteredByRepo,
    optimisticSidebarGroups,
    repoScopedGroupPathsByRepoGroup,
    showHiddenSidebarGroups,
    sidebarGroupOrder,
    sidebarGroupingMode,
  });
  const {
    blurChatEditor,
    blurFolderEditor,
    chatEditor,
    chatEditorInputRef,
    closeChatEditor,
    closeCreateGroupInline,
    closeFolderEditor,
    collapsedDroneSections,
    createGroupInlineError,
    createGroupInputRef,
    createGroupName,
    createGroupTargetDroneIds,
    creatingGroupMove,
    folderEditor,
    folderEditorInputRef,
    handleGroupedSelectDroneCard,
    handleGroupedSelectDroneChat,
    handleGroupedSelectFolder,
    moveFolderIntoGroup,
    onSubmitCreateGroupInline,
    openDroneChatCreate,
    openFolderCreate,
    selectedFolderPath,
    selectedSidebarNodeId,
    setCollapsedDroneSections,
    setCreateGroupInlineError,
    setCreateGroupName,
    setCreateGroupTargetDroneIds,
    setSelectedSidebarNodeId,
    startRenameDroneChat,
    startRenameFolder,
    submitChatEditor,
    submitFolderEditor,
    toggleDroneSection,
    updateChatEditorValue,
    updateFolderEditorValue,
  } = useSidebarInteractions({
    activeChatName,
    collapsedGroups,
    draftSidebarPlaceholderNodeId,
    draftSidebarPlaceholderDroneId: DRAFT_SIDEBAR_PLACEHOLDER_ID,
    isRepoGroupingMode,
    onCreateDroneChat,
    onRenameDroneChat,
    onSelectDroneCard,
    onSelectDroneChat,
    onToggleGroupCollapsed,
    optimisticSidebarDronesFilteredByRepo,
    runOptimisticCreateGroup,
    runOptimisticCreateGroupAndMove,
    runOptimisticRenameGroup,
    selectedDrone,
    setSidebarRepoScopedGroupByPath,
    sidebarDroneById,
    visibleSidebarFolderPathSet,
  });
  const {
    activeDraggedDroneIds,
    dragOverCreateGroup,
    dragOverGroup,
    dragOverSidebarGroup,
    dragOverUngrouped,
    draggingSidebarGroup,
  } = useSidebarRootDnd({
    activeDrag,
    isRepoGroupingMode,
    moveFolderIntoGroup,
    runOptimisticMoveDronesToGroup,
    setCreateGroupInlineError,
    setCreateGroupTargetDroneIds,
    setSidebarGroupOrder,
    sidebarGroupOrder,
    sidebarGroups,
    sidebarHasUngroupedGroup,
  });

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
  useDropdownDismiss(headerActionsMenuRef, headerActionsMenuOpen, setHeaderActionsMenuOpen);
  useDropdownDismiss(footerOptionsMenuRef, footerOptionsMenuOpen, setFooterOptionsMenuOpen);

  React.useEffect(() => {
    if (sidebarAutoMinimize) return;
    clearCollapseTimer();
    clearExpandTimer();
    lastAutoCollapsedAtRef.current = 0;
  }, [clearCollapseTimer, clearExpandTimer, sidebarAutoMinimize]);

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
  const sharedDroneTreeListProps = {
    droneById: sidebarDroneById,
    sidebarDensityMode,
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
    setCollapsedDroneSections,
    uiDroneName,
    onToggleSection: toggleDroneSection,
    onSelectDroneCard,
    onSelectDroneChat,
    onDeleteDroneChat,
    onOpenCloneModal,
    onCreateDroneChat,
    onRenameDroneChat,
    onRenameDrone,
    onSetDroneBaseImage,
    onDeleteDrone,
    onOpenDroneErrorModal,
    onPrepareDroneDragStart,
    onReparentDronesToParent: runOptimisticReparentDronesToParent,
  } satisfies SidebarDroneTreeListSharedProps;

  const onSidebarWheel = React.useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const direction = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      setSidebarDensityMode((current) => stepSidebarDensityMode(current, direction));
    },
    [setSidebarDensityMode],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const sidebarHovered = Boolean(document.querySelector('[data-drone-sidebar-root="true"]:hover'));
      if (!sidebarHovered) return;

      if (event.key === 'Escape' && folderEditor) {
        event.preventDefault();
        closeFolderEditor();
        return;
      }

      if (!selectedFolderPath || !visibleSidebarFolderPathSet.has(selectedFolderPath)) return;
      if (folderEditor) return;

      if (!isRepoGroupingMode && event.key === 'F2') {
        event.preventDefault();
        startRenameFolder(selectedFolderPath);
        return;
      }

      if (event.key === 'ArrowLeft' && !collapsedGroups[selectedFolderPath]) {
        event.preventDefault();
        onToggleGroupCollapsed(selectedFolderPath);
        return;
      }

      if (event.key === 'ArrowRight' && collapsedGroups[selectedFolderPath]) {
        event.preventDefault();
        onToggleGroupCollapsed(selectedFolderPath);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closeFolderEditor,
    collapsedGroups,
    folderEditor,
    isRepoGroupingMode,
    onToggleGroupCollapsed,
    selectedFolderPath,
    startRenameFolder,
    visibleSidebarFolderPathSet,
  ]);

  return (
    <>
      <aside
        data-drone-sidebar-root="true"
        className="bg-[var(--panel-alt)] border-r border-[var(--border)] flex flex-col min-h-0 relative dh-dot-grid flex-shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:width]"
        style={{ width: sidebarCollapsed ? 0 : SIDEBAR_EXPANDED_WIDTH_PX }}
        onPointerEnter={onSidebarPointerEnter}
        onPointerLeave={onSidebarPointerLeave}
        onWheel={onSidebarWheel}
      >
        <div className="flex h-[52px] flex-shrink-0 items-center px-3 border-b border-[var(--border)] relative">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-[rgba(167,139,250,.18)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_12px_rgba(167,139,250,.08)]"
                title="Drone Hub"
                aria-label="Drone Hub"
              >
                <IconDrone />
              </div>
              {selectedDroneIds.length > 1 && (
                <span className="max-w-full truncate text-[10px] text-[var(--accent)]" title={`${selectedDroneIds.length} drones selected`}>
                  {selectedDroneIds.length} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
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
              <div ref={headerActionsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setFooterOptionsMenuOpen(false);
                    setHeaderActionsMenuOpen((prev) => !prev);
                  }}
                  className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                    headerActionsMenuOpen
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                  }`}
                  title="More sidebar actions"
                  aria-label="More sidebar actions"
                  aria-haspopup="menu"
                  aria-expanded={headerActionsMenuOpen}
                >
                  <IconMore className="opacity-85" />
                </button>
                {headerActionsMenuOpen ? (
                  <div className={`absolute right-0 mt-2 w-[220px] z-50 ${dropdownPanelBaseClass}`} role="menu">
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderActionsMenuOpen(false);
                          onOpenPlaybookRuns();
                        }}
                        className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                        role="menuitem"
                      >
                        <span>Playbook runs</span>
                        <IconList className={playbookRunsOpen ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderActionsMenuOpen(false);
                          setAppView((prev) => (prev === 'settings' ? 'workspace' : 'settings'));
                        }}
                        className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                        role="menuitem"
                      >
                        <span>{appView === 'settings' ? 'Back to workspace' : 'Open settings'}</span>
                        <IconSettings className={appView === 'settings' ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1.5">
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
          {(dronesLoading || sidebarDrones.length > 0 || Boolean(visibleDraftSidebarPlaceholder) || Boolean(activeRepoPath)) && (
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <button
                type="button"
                onClick={onOpenDraftChatComposer}
                className="inline-flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] transition-all hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
                style={{ fontFamily: 'var(--display)' }}
                title="Create drone"
                aria-label="Create drone"
              >
                <IconPlus className="opacity-90" />
                <span className="min-w-0 truncate">New drone</span>
              </button>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] transition-all hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
                title="Create multiple drones"
                aria-label="Create multiple drones"
              >
                <IconPlusDouble className="opacity-90" />
              </button>
            </div>
          )}
          <div className="flex flex-col gap-0.5 select-none">
            {viewMode === 'flat' ? (
              <SidebarDroneTreeList {...sharedDroneTreeListProps} tree={flatSidebarTree} />
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <>
                    {!isRepoGroupingMode ? (
                      <>
                      <div className="mb-1 flex items-center gap-2 px-1">
                        <button
                          type="button"
                          onClick={() => openFolderCreate(null)}
                          className="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          <IconPlus className="opacity-80" />
                          New folder
                        </button>
                        {selectedFolderPath ? (
                          <span className="min-w-0 truncate text-[10px] font-mono text-[var(--muted-dim)]" title={selectedFolderPath}>
                            {selectedFolderPath}
                          </span>
                        ) : null}
                      </div>
                      {folderEditor?.mode === 'create' && folderEditor.parentPath === null && folderEditor.anchorPath === null ? (
                        <div className="mb-1 flex items-center gap-2 rounded-md border border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1.5">
                          <IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)] opacity-80" />
                          <input
                            ref={folderEditorInputRef}
                            value={folderEditor.value}
                            onChange={(event) => updateFolderEditorValue(event.target.value)}
                            onBlur={blurFolderEditor}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                submitFolderEditor();
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                closeFolderEditor();
                              }
                            }}
                            maxLength={64}
                            placeholder="Folder name"
                            className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 py-1 text-[11px] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
                          />
                        </div>
                      ) : null}
                      {folderEditor?.mode === 'create' && folderEditor.parentPath === null && folderEditor.anchorPath === null && folderEditor.error ? (
                        <div className="mb-1 px-1 text-[10px] text-[var(--red)]">{folderEditor.error}</div>
                      ) : null}
                      </>
                    ) : null}
                <GroupedSidebarTree
                  sidebarGroups={renderSidebarGroups}
                  sidebarDensityMode={sidebarDensityMode}
                  sidebarFolderTree={sidebarFolderTree}
                  sidebarGroupOrder={sidebarGroupOrder}
                  repoScopedGroupPathsByRepoGroup={repoScopedGroupPathsByRepoGroup}
                  sidebarDroneOrderByGroup={sidebarDroneOrderByGroup}
                  sidebarNodeOrderByParent={sidebarNodeOrderByParent}
                  setSidebarGroupOrder={setSidebarGroupOrder}
                  setSidebarNodeOrderByParent={setSidebarNodeOrderByParent}
                  sidebarChatOrderByDrone={sidebarChatOrderByDrone}
                  setSidebarChatOrderByDrone={setSidebarChatOrderByDrone}
                  droneById={sidebarDroneById}
                  selectedDroneIds={selectedDroneIds}
                  selectedDroneSet={selectedDroneSet}
                  selectedDrone={selectedDrone}
                  activeChatName={activeChatName}
                  selectedSidebarNodeId={selectedSidebarNodeId}
                  selectedFolderPath={selectedFolderPath}
                  setSelectedSidebarNodeId={setSelectedSidebarNodeId}
                  onSelectFolder={handleGroupedSelectFolder}
                  onSelectDroneCard={handleGroupedSelectDroneCard}
                  onSelectDroneChat={handleGroupedSelectDroneChat}
                  onMoveDronesToGroup={runOptimisticMoveDronesToGroup}
                  onRenameGroup={runOptimisticRenameGroup}
                  onToggleGroupCollapsed={onToggleGroupCollapsed}
                  collapsedGroups={collapsedGroups}
                  deletingGroups={deletingGroups}
                  renamingGroups={renamingGroups}
                  hiddenSidebarGroupTokenSet={hiddenSidebarGroupTokenSet}
                  selectedGroupMultiChat={selectedGroupMultiChat}
                  onOpenFolderCreate={openFolderCreate}
                  onStartRenameFolder={startRenameFolder}
                  onFolderEditorValueChange={updateFolderEditorValue}
                  onSubmitFolderEditor={submitFolderEditor}
                  onBlurFolderEditor={blurFolderEditor}
                  onCancelFolderEditor={closeFolderEditor}
                  folderEditor={folderEditor}
                  folderEditorInputRef={folderEditorInputRef}
                  toggleSidebarGroupHidden={toggleSidebarGroupHidden}
                  onOpenGroupMultiChat={onOpenGroupMultiChat}
                  onDeleteGroup={handleDeleteGroup}
                  busyChatNodeIdSet={busyChatNodeIdSet}
                  unreadAgentMessageByChatNodeId={unreadAgentMessageByChatNodeId}
                  deletingDrones={deletingDrones}
                  renamingDrones={renamingDrones}
                  settingBaseImages={settingBaseImages}
                  movingDroneGroups={movingDroneGroups}
                  sidebarOptimisticDroneIdSet={sidebarOptimisticDroneIdSet}
                  uiDroneName={uiDroneName}
                  onDeleteDroneChat={onDeleteDroneChat}
                  onOpenCloneModal={onOpenCloneModal}
                  onCreateDroneChat={onCreateDroneChat}
                  onRenameDroneChat={onRenameDroneChat}
                  chatEditor={chatEditor}
                  chatEditorInputRef={chatEditorInputRef}
                  onOpenCreateDroneChat={openDroneChatCreate}
                  onStartRenameDroneChat={startRenameDroneChat}
                  onChatEditorValueChange={updateChatEditorValue}
                  onSubmitChatEditor={submitChatEditor}
                  onBlurChatEditor={blurChatEditor}
                  onCancelChatEditor={closeChatEditor}
                  onRenameDrone={onRenameDrone}
                  onSetDroneBaseImage={onSetDroneBaseImage}
                  onDeleteDrone={onDeleteDrone}
                  onOpenDroneErrorModal={onOpenDroneErrorModal}
                  onPrepareDroneDragStart={onPrepareDroneDragStart}
                  onReparentDronesToParent={runOptimisticReparentDronesToParent}
                />
                  </>
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
                        ? `Create new folder (${createGroupTargetDroneIds.length} drone${createGroupTargetDroneIds.length === 1 ? '' : 's'})`
                        : 'Drop here to create a new folder'}
                    </div>
                    {createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0 && (
                      <form className="mt-2 flex flex-col gap-2" onSubmit={onSubmitCreateGroupInline}>
                        <input
                          ref={createGroupInputRef}
                          value={createGroupName}
                          onChange={(event) => setCreateGroupName(event.target.value)}
                          disabled={creatingGroupMove}
                          maxLength={64}
                          placeholder="Folder name"
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
            <div ref={footerOptionsMenuRef} className="relative flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setHeaderActionsMenuOpen(false);
                  setFooterOptionsMenuOpen((prev) => !prev);
                }}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  footerOptionsMenuOpen
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                title="Sidebar options"
                aria-label="Sidebar options"
                aria-haspopup="menu"
                aria-expanded={footerOptionsMenuOpen}
              >
                <IconMore className="opacity-85" />
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
              <SidebarIconButton
                onClick={collapseSidebarWithGuard}
                className="border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]"
                title="Collapse sidebar"
                ariaLabel="Collapse sidebar"
              >
                <IconSidebarCollapse />
              </SidebarIconButton>
              {footerOptionsMenuOpen ? (
                <div className={`absolute right-0 bottom-full mb-2 w-[240px] z-50 ${dropdownPanelBaseClass}`} role="menu">
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => setSidebarGroupingMode((prev) => (prev === 'groups' ? 'repos' : 'groups'))}
                      className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                      role="menuitem"
                    >
                      <span>{isRepoGroupingMode ? 'Show real groups' : 'Show repos as groups'}</span>
                      <IconFolder className={!isRepoGroupingMode ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode((prev) => (prev === 'grouped' ? 'flat' : 'grouped'))}
                      className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                      role="menuitem"
                    >
                      <span>{viewMode === 'grouped' ? 'Switch to flat list' : 'Switch to grouped folders'}</span>
                      {viewMode === 'flat' ? <IconList className="opacity-80 text-[var(--accent)]" /> : <IconTreeView className="opacity-65" />}
                    </button>
                    <div className="my-1 border-t border-[var(--border-subtle)]" />
                    <button
                      type="button"
                      onClick={() => setShowHiddenSidebarGroups((prev) => !prev)}
                      className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                      role="menuitem"
                    >
                      <span>
                        {showHiddenSidebarGroups ? 'Hide hidden groups' : 'Show hidden groups'}
                        {sidebarHiddenGroupCount > 0 ? ` (${sidebarHiddenGroupCount})` : ''}
                      </span>
                      {showHiddenSidebarGroups ? <IconEyeOff className="opacity-80 text-[var(--accent)]" /> : <IconEye className="opacity-65" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoDelete((prev) => !prev)}
                      className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                      role="menuitem"
                    >
                      <span>{autoDelete ? 'Delete confirm off' : 'Delete confirm on'}</span>
                      <IconTrash className={autoDelete ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSidebarAutoMinimize((prev) => !prev)}
                      className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                      role="menuitem"
                    >
                      <span>{sidebarAutoMinimize ? 'Disable auto-minimize' : 'Enable auto-minimize'}</span>
                      <IconAutoMinimize className={sidebarAutoMinimize ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'} />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
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
          className="border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
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
