import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { buildRepoSidebarModel } from '@drone/hub-model/sidebar';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary, RepoSummary } from '../types';
import {
  DroneCard,
  SidebarItemStateIndicator,
  SidebarWorkingStatusIndicator,
  sidebarChatDisplayState,
  sidebarDroneStateLabel,
  sidebarItemStateToneClass,
} from '../overview';
import {
  dropdownMenuItemBaseClass,
  dropdownPanelBaseClass,
  useDropdownDismiss,
} from '../../ui/dropdown';
import {
  IconAutoMinimize,
  IconChevron,
  IconChevronLeft,
  IconClock,
  IconColumns,
  IconDrone,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconFolderGit,
  IconList,
  IconMessageCircle,
  IconMore,
  IconNetwork,
  IconPencil,
  IconPlus,
  IconPlusDouble,
  IconSettings,
  IconSettingsOutline,
  IconSidebarCollapse,
  IconSidebarExpand,
  IconSpinner,
  IconTrash,
  SkeletonLine,
} from './icons';
import { SidebarDroneTreeList, type SidebarDroneTreeListSharedProps } from './SidebarDroneTreeList';
import { GroupedSidebarTree } from './GroupedSidebarTree';
import { createCanvasChatNodeId } from './app-config';
import { SidebarReorderDropIndicator } from './sidebar-reorder-ui';
import { buildSidebarDroneTree } from './sidebar-drone-tree';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';
import {
  orderSidebarEntries,
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
import {
  buildSidebarNodeTree,
  type SidebarNodeTreeModel,
  type SidebarTreeDroneNode,
  type SidebarTreeFolderNode,
  type SidebarTreeNode,
} from './sidebar-node-tree';
import {
  groupSidebarRepoScopedGroupsByRepoGroup,
  removeSidebarRepoScopedGroupMapKeysByPrefix,
  rewriteSidebarRepoScopedGroupMapKeysByPrefix,
} from './sidebar-repo-scoped-groups';
import {
  SIDEBAR_ROOT_PARENT_ID,
  sidebarChatSidebarNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
} from './sidebar-node-order';
import {
  useDroneHubActiveDrag,
  type SidebarDragGroupRef,
  type SidebarGroupDragData,
} from './drone-hub-dnd';
import type { SidebarGroup } from './use-sidebar-view-model';
import type { DroneSelectionClickOptions } from './drone-selection-helpers';
import { useSidebarOptimisticGroups } from './use-sidebar-optimistic-groups';
import type { MoveDronesToGroupResult } from './use-group-management';
import type { DroneDeleteMode, SidebarDensityMode, SidebarGroupingMode } from './settings-types';
import {
  sidebarChatLabelClass,
  sidebarChatRowTone,
  sidebarChatStateClass,
  sidebarCountClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
} from '../sidebar/presentation';
import { useSidebarReadModel } from './use-sidebar-read-model';
import { buildSidebarRepositoryNavigationModel } from './sidebar-repository-navigation';
import {
  useSidebarInteractions,
  type ChatEditorState,
  type FolderEditorState,
} from './use-sidebar-interactions';
import { useSidebarRootDnd } from './use-sidebar-root-dnd';

const SIDEBAR_EXPANDED_WIDTH_PX = 280;
const SIDEBAR_COLLAPSED_RAIL_WIDTH_PX = 40;
const GROUP_HEADER_SINGLE_CLICK_DELAY_MS = 180;
const AUTO_MINIMIZE_COLLAPSE_DELAY_MS = 90;
const AUTO_MINIMIZE_EXPAND_DELAY_MS = 120;
const AUTO_MINIMIZE_REOPEN_GUARD_MS = 220;
const SIDEBAR_DND_IDLE_DISABLE_DELAY_MS = 1500;
const SIDEBAR_DENSITY_MODE_ORDER: SidebarDensityMode[] = ['compact', 'default', 'comfortable'];
export type DroneSidebarCapabilities = {
  actions: boolean;
  createDrones: boolean;
  dragAndDrop: boolean;
  headerActions: boolean;
  repoFooter: boolean;
  sidebarOptions: boolean;
  collapseControl: boolean;
  collapsedRailActions: boolean;
};
export type DroneSidebarReadOnlyMode =
  | 'read-only'
  | 'read-only-chats'
  | 'static-tree'
  | 'grouped-tree';
const DEFAULT_DRONE_SIDEBAR_CAPABILITIES: DroneSidebarCapabilities = {
  actions: true,
  createDrones: true,
  dragAndDrop: true,
  headerActions: true,
  repoFooter: true,
  sidebarOptions: true,
  collapseControl: true,
  collapsedRailActions: true,
};

function resolveDroneSidebarCapabilities(
  capabilities: Partial<DroneSidebarCapabilities> | undefined,
): DroneSidebarCapabilities {
  return {
    ...DEFAULT_DRONE_SIDEBAR_CAPABILITIES,
    ...(capabilities ?? {}),
  };
}

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

function stepSidebarDensityMode(
  current: SidebarDensityMode,
  direction: -1 | 1,
): SidebarDensityMode {
  const currentIndex = SIDEBAR_DENSITY_MODE_ORDER.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 1;
  const nextIndex = Math.max(
    0,
    Math.min(SIDEBAR_DENSITY_MODE_ORDER.length - 1, safeIndex + direction),
  );
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
  starting: boolean;
};

const DRAFT_SIDEBAR_PLACEHOLDER_ID = '__draft-sidebar-placeholder__';

function readOnlyDroneChats(drone: DroneSummary): string[] {
  const chats = Array.isArray(drone?.chats)
    ? drone.chats.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  return chats.length > 0 ? chats : ['default'];
}

function ReadOnlySidebarGroups({
  sidebarGroups,
  sidebarDensityMode,
  selectedDrone,
  selectedDroneSet,
  highlightedDroneIds,
  activeChatName,
  showAllChats,
  collapsedGroups,
  uiDroneName,
  onSelectDroneCard,
  onSelectDroneChat,
  onToggleGroupCollapsed,
}: {
  sidebarGroups: SidebarGroup[];
  sidebarDensityMode: SidebarDensityMode;
  selectedDrone: string | null;
  selectedDroneSet: Set<string>;
  highlightedDroneIds: Set<string>;
  activeChatName: string;
  showAllChats: boolean;
  collapsedGroups: Record<string, boolean>;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onToggleGroupCollapsed: (group: string) => void;
}) {
  const lastToggleRef = React.useRef<{ groupKey: string; timestamp: number } | null>(null);
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const visibleDroneOrder = React.useMemo(
    () =>
      sidebarGroups.flatMap((group) => {
        const groupKey = String(group.group ?? '').trim();
        if (groupKey && collapsedGroups[groupKey]) return [];
        return group.items.map((drone) => String(drone?.id ?? '').trim()).filter(Boolean);
      }),
    [collapsedGroups, sidebarGroups],
  );
  const toggleGroupCollapsed = React.useCallback(
    (groupKey: string) => {
      const now = window.performance.now();
      const lastToggle = lastToggleRef.current;
      if (lastToggle?.groupKey === groupKey && now - lastToggle.timestamp < 350) return;
      lastToggleRef.current = { groupKey, timestamp: now };
      onToggleGroupCollapsed(groupKey);
    },
    [onToggleGroupCollapsed],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {sidebarGroups.map((group) => {
        const groupKey = String(group.group ?? '').trim();
        const collapsed = Boolean(groupKey && collapsedGroups[groupKey]);
        return (
          <section key={`${group.kind}:${group.group}`} className="flex flex-col gap-0.5">
            <button
              type="button"
              className={`relative flex w-full items-center gap-1 rounded-[var(--radius-medium)] border border-transparent px-1.5 pr-2 text-left ${densityClasses.folderRow}`}
              onClick={() => {
                if (groupKey) toggleGroupCollapsed(groupKey);
              }}
              aria-expanded={!collapsed}
              title={group.group}
            >
              <IconFolder className={`${densityClasses.icon} flex-shrink-0 text-[var(--muted-dim)] opacity-80`} />
              <span className={`${sidebarFolderLabelClass} ${densityClasses.folderLabel}`}>
                {group.label}
              </span>
              <span className={sidebarCountClass}>
                {group.items.length}
              </span>
            </button>
            {!collapsed ? (
              <div className="flex flex-col gap-0.5">
                {group.items.map((drone) => {
                  const droneId = String(drone?.id ?? '').trim();
                  const chats = readOnlyDroneChats(drone);
                  const selected = selectedDroneSet.has(droneId);
                  const busy =
                    Boolean(drone?.busy) ||
                    (Array.isArray(drone?.busyChats) && drone.busyChats.length > 0);
                  const displayName = uiDroneName(drone.name) || drone.name || droneId;
                  const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
                  const showChatRows = chats.length > 1 && (showAllChats || selected);
                  return (
                    <div key={droneId || displayName} className="flex flex-col gap-0.5">
                      <DroneCard
                        drone={drone}
                        density={sidebarDensityMode}
                        displayName={displayName}
                        selected={selected}
                        highlighted={highlightedDroneIds.has(droneId)}
                        active={
                          selectedDrone === droneId &&
                          hasOnlyDefaultChat &&
                          activeChatName === 'default'
                        }
                        activeIndicatorStyle="edge"
                        selectionTone="muted"
                        showSelectionEdge={false}
                        busy={busy && hasOnlyDefaultChat}
                        unreadAgentMessage={false}
                        onClick={(rowOpts) => {
                          if (droneId)
                            onSelectDroneCard(droneId, {
                              ...rowOpts,
                              orderedDroneIds: visibleDroneOrder,
                            });
                        }}
                        draggable={false}
                        dragging={false}
                      />
                      {showChatRows ? (
                        <div className={`${densityClasses.chatIndent} flex flex-col gap-0.5`}>
                          {chats.map((chatName) => {
                            const active = selectedDrone === droneId && activeChatName === chatName;
                            const chatBusy =
                              Array.isArray(drone?.busyChats) && drone.busyChats.includes(chatName);
                            const chatState = sidebarChatDisplayState(drone, chatBusy);
                            const chatStateLabel = sidebarDroneStateLabel(chatState, false);
                            const chatStateToneClass = sidebarItemStateToneClass(chatState, false);
                            return (
                              <button
                                key={chatName}
                                type="button"
                                className={`relative flex items-center gap-1.5 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ active })}`}
                                onClick={() => {
                                  if (droneId) onSelectDroneChat(droneId, chatName);
                                }}
                                title={`${displayName} / ${chatName}`}
                              >
                                {active ? (
                                  <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
                                ) : null}
                                <span className={sidebarChatLabelClass}>
                                  {chatName}
                                </span>
                                <span
                                  className={`${sidebarChatStateClass} ${chatStateToneClass}`}
                                  title={chatStateLabel}
                                >
                                  <SidebarItemStateIndicator state={chatState} />
                                  {chatStateLabel}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function staticTreeFolderPath(node: SidebarTreeFolderNode): string {
  return String(node.groupPath ?? node.path ?? '').trim();
}

function flattenReadOnlyTreeDroneOrder(
  nodeTree: SidebarNodeTreeModel,
  collapsedGroups: Record<string, boolean>,
): string[] {
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
      for (const childId of nodeTree.childIdsByParent[node.id] ?? []) visit(childId);
      return;
    }
    const folderPath = staticTreeFolderPath(node);
    if (folderPath && collapsedGroups[folderPath]) return;
    for (const childId of nodeTree.childIdsByParent[node.id] ?? []) visit(childId);
  };
  for (const nodeId of nodeTree.rootChildIds) visit(nodeId);
  return out;
}

function collectSidebarFolderDroneIds(
  nodeTree: SidebarNodeTreeModel,
  folderPathRaw: string,
): string[] {
  const folderPath = String(folderPathRaw ?? '').trim();
  if (!folderPath) return [];
  const folderNode = Object.values(nodeTree.nodesById).find(
    (node): node is SidebarTreeFolderNode => node.kind === 'folder' && node.path === folderPath,
  );
  if (!folderNode) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (nodeId: string) => {
    const node = nodeTree.nodesById[nodeId];
    if (!node) return;
    if (node.kind === 'drone' && !seen.has(node.droneId)) {
      seen.add(node.droneId);
      out.push(node.droneId);
    }
    for (const childId of nodeTree.childIdsByParent[nodeId] ?? []) visit(childId);
  };
  visit(folderNode.id);
  return out;
}

function StaticReadOnlySidebarTree({
  nodeTree,
  sidebarDensityMode,
  droneById,
  sidebarChatOrderByDrone,
  selectedDrone,
  selectedDroneSet,
  highlightedDroneIds,
  activeChatName,
  busyChatNodeIdSet,
  unreadAgentMessageByChatNodeId,
  disabledDroneReasonById,
  droneStatusHintById,
  collapsedGroups,
  uiDroneName,
  onSelectDroneCard,
  onSelectDroneChat,
  onToggleGroupCollapsed,
}: {
  nodeTree: SidebarNodeTreeModel;
  sidebarDensityMode: SidebarDensityMode;
  droneById: Record<string, DroneSummary>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  selectedDrone: string | null;
  selectedDroneSet: Set<string>;
  highlightedDroneIds: Set<string>;
  activeChatName: string;
  busyChatNodeIdSet: Set<string>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  disabledDroneReasonById: Record<string, string>;
  droneStatusHintById: Record<string, string>;
  collapsedGroups: Record<string, boolean>;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onToggleGroupCollapsed: (group: string) => void;
}) {
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const visibleDroneOrder = React.useMemo(
    () => flattenReadOnlyTreeDroneOrder(nodeTree, collapsedGroups),
    [collapsedGroups, nodeTree],
  );

  const renderDrone = (
    node: SidebarTreeDroneNode,
    ancestorNodeIds: Set<string>,
  ): React.ReactNode => {
    const drone = droneById[node.droneId];
    if (!drone) return null;
    const chats = orderSidebarEntries(
      readOnlyDroneChats(drone),
      sidebarChatOrderByDrone[drone.id] ?? [],
      (chat) => chat,
    );
    const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
    const selected = selectedDroneSet.has(drone.id);
    const disabledReason = String(disabledDroneReasonById[drone.id] ?? '').trim();
    const defaultChatNodeId = createCanvasChatNodeId(drone.id, 'default');
    const defaultChatBusy =
      (Array.isArray(drone.busyChats) && drone.busyChats.includes('default')) ||
      busyChatNodeIdSet.has(defaultChatNodeId);
    const busy = Boolean(drone.busy) || defaultChatBusy;
    const childIds = nodeTree.childIdsByParent[node.id] ?? [];
    return (
      <div key={node.id} className="flex flex-col gap-0.5">
        <DroneCard
          drone={drone}
          density={sidebarDensityMode}
          displayName={uiDroneName(drone.name)}
          selected={selected}
          disabled={Boolean(disabledReason)}
          disabledReason={disabledReason || undefined}
          highlighted={highlightedDroneIds.has(drone.id)}
          active={selectedDrone === drone.id && hasOnlyDefaultChat && activeChatName === 'default'}
          activeIndicatorStyle="edge"
          selectionTone="muted"
          showSelectionEdge={false}
          busy={busy && hasOnlyDefaultChat}
          statusHint={droneStatusHintById[drone.id]}
          unreadAgentMessage={
            hasOnlyDefaultChat && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true
          }
          onClick={(rowOpts) =>
            onSelectDroneCard(drone.id, { ...rowOpts, orderedDroneIds: visibleDroneOrder })
          }
          draggable={false}
          dragging={false}
        />
        {chats.length > 1 ? (
          <div className={`${densityClasses.chatIndent} flex flex-col gap-0.5`}>
            {chats.map((chatName) => {
              const active = selectedDrone === drone.id && activeChatName === chatName;
              const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
              const chatBusy =
                (Array.isArray(drone.busyChats) && drone.busyChats.includes(chatName)) ||
                busyChatNodeIdSet.has(chatNodeId);
              const chatUnread = !active && unreadAgentMessageByChatNodeId[chatNodeId] === true;
              const chatState = sidebarChatDisplayState(drone, chatBusy);
              const chatStateLabel = sidebarDroneStateLabel(chatState, chatUnread);
              const chatStateToneClass = sidebarItemStateToneClass(chatState, chatUnread);
              return (
                <button
                  key={chatName}
                  type="button"
                  disabled={Boolean(disabledReason)}
                  className={`relative flex items-center gap-1.5 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ active, disabled: Boolean(disabledReason) })}`}
                  onClick={() => {
                    if (!disabledReason) onSelectDroneChat(drone.id, chatName);
                  }}
                  title={disabledReason || `${uiDroneName(drone.name)} / ${chatName}`}
                >
                  {active ? (
                    <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
                  ) : null}
                  <span className={sidebarChatLabelClass}>{chatName}</span>
                  <span
                    className={`${sidebarChatStateClass} ${chatStateToneClass}`}
                    title={chatStateLabel}
                  >
                    <SidebarItemStateIndicator state={chatState} unread={chatUnread} />
                    {chatStateLabel}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {childIds.length > 0 ? (
          <div className="ml-2.5 flex flex-col gap-0.5 border-l border-[var(--border-subtle)] pl-1.5">
            {childIds.map((childId) => renderNode(childId, ancestorNodeIds))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderFolder = (
    node: SidebarTreeFolderNode,
    ancestorNodeIds: Set<string>,
  ): React.ReactNode => {
    const folderPath = staticTreeFolderPath(node);
    const collapsed = Boolean(folderPath && collapsedGroups[folderPath]);
    const childIds = nodeTree.childIdsByParent[node.id] ?? [];
    return (
      <div key={node.id} className="flex flex-col gap-0.5">
        <button
          type="button"
          className={`relative flex items-center gap-1 rounded-[var(--radius-medium)] border border-transparent pr-2 text-left hover:border-[var(--border-subtle)] hover:bg-[var(--surface-soft)] ${densityClasses.folderRow}`}
          style={{
            paddingLeft: `${Math.max(0, node.depth) * densityClasses.folderDepthPaddingPx + 4}px`,
          }}
          onClick={() => {
            if (folderPath) onToggleGroupCollapsed(folderPath);
          }}
          title={folderPath || node.label}
        >
          <IconFolder
            className={`${densityClasses.icon} flex-shrink-0 text-[var(--muted-dim)] opacity-80`}
          />
          <span className={`${sidebarFolderLabelClass} ${densityClasses.folderLabel}`}>
            {node.label}
          </span>
          <span className={sidebarCountClass}>
            {node.totalDroneCount}
          </span>
        </button>
        {!collapsed && childIds.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {childIds.map((childId) => renderNode(childId, ancestorNodeIds))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderNode = (nodeId: string, ancestorNodeIds: Set<string>): React.ReactNode => {
    if (ancestorNodeIds.has(nodeId)) return null;
    const node: SidebarTreeNode | undefined = nodeTree.nodesById[nodeId];
    if (!node) return null;
    const nextAncestorNodeIds = new Set(ancestorNodeIds);
    nextAncestorNodeIds.add(nodeId);
    return node.kind === 'folder'
      ? renderFolder(node, nextAncestorNodeIds)
      : renderDrone(node, nextAncestorNodeIds);
  };

  return (
    <div className="flex flex-col gap-0.5">
      {nodeTree.rootChildIds.map((nodeId) => renderNode(nodeId, new Set()))}
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

function isHeaderActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('button,a,input,textarea,select,[role="button"],[role="menuitem"]'),
  );
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
  const clickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupDragData = React.useMemo<SidebarGroupDragData | null>(() => {
    const droneIds = Array.from(
      new Set(actualItems.map((item) => String(item?.id ?? '').trim()).filter(Boolean)),
    );
    if (droneIds.length === 0) return null;
    return {
      type: 'sidebar-group',
      groupRef,
      groupLabel,
      droneIds,
    };
  }, [actualItems, groupLabel, groupRef]);
  const sidebarDndEnabled = sharedDroneTreeListProps.sidebarDndEnabled;
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
  } = useDraggable({
    id: `sidebar-group:${groupToken}`,
    data: groupDragData ?? undefined,
    disabled: !sidebarDndEnabled || !groupDragData,
  });
  const { setNodeRef: setReorderDropNodeRef } = useDroppable({
    id: `sidebar-group-reorder:${groupToken}`,
    data: {
      type: 'sidebar-group-reorder',
      groupRef,
    },
    disabled: !sidebarDndEnabled || !groupDragData,
  });
  const { setNodeRef: setMoveDropNodeRef } = useDroppable({
    id: `sidebar-group-move:${groupToken}`,
    data: {
      type: 'sidebar-group-move',
      group: groupRef.group,
      kind: groupRef.kind,
    },
    disabled: !sidebarDndEnabled || isVirtualGroup,
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
  const actionRailWidthClass = canRenameGroup
    ? 'group-hover/group-header:w-[124px]'
    : 'group-hover/group-header:w-[92px]';
  const pinnedActionRailWidthClass = canRenameGroup ? 'w-[124px]' : 'w-[92px]';
  const clearClickTimer = React.useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);
  React.useEffect(() => clearClickTimer, [clearClickTimer]);
  const scheduleToggleGroupCollapsed = React.useCallback(() => {
    clearClickTimer();
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onToggleGroupCollapsed(groupRef.group);
    }, GROUP_HEADER_SINGLE_CLICK_DELAY_MS);
  }, [clearClickTimer, groupRef.group, onToggleGroupCollapsed]);
  const handleGroupHeaderDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest('[data-group-drag-block="true"]'))
        return;
      event.preventDefault();
      clearClickTimer();
      onToggleGroupCollapsed(groupRef.group);
    },
    [clearClickTimer, groupRef.group, onToggleGroupCollapsed],
  );

  return (
    <div
      data-drone-sidebar-group={groupRef.group}
      data-drone-sidebar-group-kind={kind}
      data-drone-sidebar-group-name={hoveredGroupName || undefined}
      data-drone-sidebar-repo-path={hoveredRepoPath || undefined}
      className={`relative rounded-[var(--radius-medium)] border bg-[var(--surface-inset)] overflow-hidden transition-colors ${
        isDropTarget
          ? 'border-[var(--accent-muted)] ring-1 ring-[var(--accent-muted)]'
          : 'border-[var(--border-subtle)]'
      } ${isReorderDragging ? 'opacity-70' : isHiddenGroup ? 'opacity-75' : ''}`}
    >
      {isReorderTarget && dragOverSidebarGroup ? (
        <SidebarReorderDropIndicator placement={dragOverSidebarGroup.placement} />
      ) : null}
      <div
        ref={setHeaderNodeRef}
        className={`group/group-header relative w-full px-3 py-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] transition-colors ${
          isDropTarget ? 'bg-[var(--accent-subtle)]' : 'hover:bg-[var(--hover)]'
        } ${sidebarDndEnabled && groupDragData ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
        onDoubleClick={handleGroupHeaderDoubleClick}
        {...(attributes as unknown as Record<string, unknown>)}
        {...(listeners as unknown as Record<string, unknown>)}
      >
        <button
          type="button"
          onClick={(event) => {
            if (event.detail > 1) return;
            scheduleToggleGroupCollapsed();
          }}
          className="flex items-center gap-2 min-w-0 text-left flex-1"
          title={collapsed ? 'Expand group' : 'Collapse group'}
        >
          <IconChevron down={!collapsed} className="flex-shrink-0 text-[var(--muted-dim)]" />
          <IconFolder className="flex-shrink-0 text-[var(--muted-dim)] opacity-50" />
          <span className={`${sidebarFolderLabelClass} text-[var(--text-11)] font-medium`}>
            {groupLabel}
          </span>
        </button>
        <div
          className={`relative flex-shrink-0 transition-[width] duration-150 ${
            pinGroupActionsVisible ? pinnedActionRailWidthClass : `w-[64px] ${actionRailWidthClass}`
          }`}
        >
          <div
            className={`absolute inset-0 flex items-center justify-end transition-opacity duration-150 ${sidebarCountClass} ${countVisibleClass}`}
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
                    : 'bg-[var(--accent-subtle)] border-[var(--accent-border)] text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                }`}
                title={
                  isRenamingGroup
                    ? `Renaming group "${groupLabel}"…`
                    : `Rename group "${groupLabel}"`
                }
                aria-label={
                  isRenamingGroup
                    ? `Renaming group "${groupLabel}"`
                    : `Rename group "${groupLabel}"`
                }
              >
                {isRenamingGroup ? (
                  <IconSpinner className="opacity-90" />
                ) : (
                  <IconPencil className="opacity-90" />
                )}
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
                        ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                        : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]'
                  }`}
                  title={isHiddenGroup ? `Unhide "${groupLabel}"` : `Hide "${groupLabel}"`}
                  aria-label={isHiddenGroup ? `Unhide "${groupLabel}"` : `Hide "${groupLabel}"`}
                >
                  {isHiddenGroup ? (
                    <IconEye className="opacity-90" />
                  ) : (
                    <IconEyeOff className="opacity-90" />
                  )}
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
                        : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
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
                      : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
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
                  {isDeletingGroup ? (
                    <IconSpinner className="opacity-90" />
                  ) : (
                    <IconTrash className="opacity-90" />
                  )}
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
          className={`px-3 py-2 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-colors ${
            isDropTarget
              ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'text-[var(--muted-dim)]'
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
  const groupRef = React.useMemo<SidebarDragGroupRef>(
    () => ({ group: node.path, kind: 'group' }),
    [node.path],
  );
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
  const showCreateInline =
    (folderEditor?.anchorPath ?? folderEditor?.parentPath) === node.path &&
    folderEditor?.mode === 'create';
  const dragData = React.useMemo<SidebarGroupDragData>(
    () => ({
      type: 'sidebar-group',
      groupRef,
      groupLabel: node.path,
      droneIds: [],
    }),
    [groupRef, node.path],
  );
  const sidebarDndEnabled = sharedDroneTreeListProps.sidebarDndEnabled;
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
  } = useDraggable({
    id: `sidebar-folder:${groupToken}`,
    data: dragData,
    disabled: !sidebarDndEnabled,
  });
  const { setNodeRef: setMoveDropNodeRef } = useDroppable({
    id: `sidebar-group-move:${groupToken}`,
    data: {
      type: 'sidebar-group-move',
      group: node.path,
      kind: 'group',
    },
    disabled: !sidebarDndEnabled,
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
          className={`group/folder-row relative flex min-h-8 items-center gap-1 rounded-[var(--radius-medium)] pr-1 transition-colors ${
            isDropTarget
              ? 'bg-[var(--accent-subtle)] ring-1 ring-[var(--accent-muted)]'
              : isSelected
                ? 'bg-[var(--surface-strong)]'
                : 'hover:bg-[var(--hover)]'
          } ${isReorderDragging ? 'opacity-70' : isHiddenGroup ? 'opacity-70' : ''}`}
          style={{ paddingLeft: `${Math.max(0, node.depth) * 8}px` }}
        >
          <button
            type="button"
            className={`min-w-0 flex-1 rounded px-1 py-1 text-left ${sidebarDndEnabled ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
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
                  className="min-w-0 flex-1 rounded border border-[var(--accent-muted)] bg-[var(--surface-inset-strong)] px-1.5 py-0.5 text-[var(--text-11)] text-[var(--fg)] focus:outline-none"
                />
              ) : (
                <span className={`${sidebarFolderLabelClass} text-[var(--text-11)]`} title={node.path}>
                  {groupLabel}
                </span>
              )}
            </div>
          </button>
          <div className="relative w-[120px] flex-shrink-0">
            <div
              className={`absolute inset-0 flex items-center justify-end pr-1 transition-opacity duration-150 ${sidebarCountClass} ${countVisibleClass}`}
            >
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
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
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
                      : 'bg-[var(--accent-subtle)] border-[var(--accent-border)] text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                  }`}
                  title={`Rename folder "${groupLabel}"`}
                  aria-label={`Rename folder "${groupLabel}"`}
                >
                  {isRenamingGroup ? (
                    <IconSpinner className="opacity-90" />
                  ) : (
                    <IconPencil className="opacity-90" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => toggleSidebarGroupHidden(groupRef)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                  isHiddenGroup
                    ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                    : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]'
                }`}
                title={isHiddenGroup ? `Unhide "${groupLabel}"` : `Hide "${groupLabel}"`}
                aria-label={isHiddenGroup ? `Unhide "${groupLabel}"` : `Hide "${groupLabel}"`}
              >
                {isHiddenGroup ? (
                  <IconEye className="opacity-90" />
                ) : (
                  <IconEyeOff className="opacity-90" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenGroupMultiChat(node.path)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                  selectedGroupMultiChat === node.path
                    ? 'opacity-100 pointer-events-auto bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title={`Open "${groupLabel}" multi-chat`}
                aria-label={`Open "${groupLabel}" multi-chat`}
              >
                <IconColumns className="opacity-90" />
              </button>
              {canDeleteGroup ? (
                <button
                  type="button"
                  onClick={() =>
                    onDeleteGroup(node.path, node.totalDroneCount, {
                      kind: 'group',
                      label: node.path,
                    })
                  }
                  disabled={isDeletingGroup || isRenamingGroup}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                    isDeletingGroup || isRenamingGroup
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                  }`}
                  title={`Delete folder "${groupLabel}"`}
                  aria-label={`Delete folder "${groupLabel}"`}
                >
                  {isDeletingGroup ? (
                    <IconSpinner className="opacity-90" />
                  ) : (
                    <IconTrash className="opacity-90" />
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {!collapsed ? (
        <div className="ml-2 flex flex-col gap-0.5 border-l border-[var(--border-subtle)] pl-1.5">
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
            <div className="flex items-center gap-2 rounded-[var(--radius-medium)] border border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1.5">
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
                className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 py-1 text-[var(--text-11)] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
              />
            </div>
          ) : null}
          {folderEditor?.parentPath === node.path && folderEditor.error ? (
            <div className="text-[var(--text-10)] text-[var(--red)]">{folderEditor.error}</div>
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
        <div
          className={`ml-5 rounded-[var(--radius-medium)] px-2 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide ${isDropTarget ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--muted-dim)]'}`}
          style={{ fontFamily: 'var(--display)' }}
        >
          Drop into {groupLabel}
        </div>
      ) : null}
      {showEditorInline && folderEditor?.error ? (
        <div className="ml-5 text-[var(--text-10)] text-[var(--red)]">{folderEditor.error}</div>
      ) : null}
    </div>
  );
}

export type DroneSidebarProps = {
  dronesError: string | null | undefined;
  groupMoveError: string | null;
  dronesLoading: boolean;
  sidebarDronesFilteredByRepo: DroneSummary[];
  sidebarDrones: DroneSummary[];
  sidebarOptimisticDroneIdSet: Set<string>;
  selectedDroneSet: Set<string>;
  highlightedDroneIds: Set<string>;
  busyChatNodeIdSet: Set<string>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  deletingDrones: Record<string, boolean>;
  deleteOperationModeById: Record<string, DroneDeleteMode>;
  deleteMode: DroneDeleteMode;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarGroups: SidebarGroup[];
  sidebarGroupCreatedAtByName: Record<string, string | null>;
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
  onOpenDraftChatComposer: (opts?: { repoPath?: string | null; group?: string | null }) => void;
  onOpenCreateModal: () => void;
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onDeleteDroneChat: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  onOpenCloneModal: (drone: DroneSummary) => void;
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
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onReparentDronesToParent: (
    parentDroneId: string | null,
    droneIds: string[],
  ) => Promise<{ ok: boolean; error?: string | null; reparentedIds?: string[] }>;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onCreateGroup: (
    group: string,
  ) => Promise<{ ok: boolean; error: string | null }> | { ok: boolean; error: string | null };
  onCreateGroupAndMove: (
    group: string,
    droneIds: string[],
  ) => Promise<{ ok: boolean; error: string | null }>;
  onToggleGroupCollapsed: (group: string) => void;
  onRenameGroup: (group: string, nextName?: string) => Promise<boolean> | boolean;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (
    group: string,
    count: number,
    opts?: { kind?: 'group' | 'repo'; label?: string; repoPath?: string | null },
  ) => Promise<boolean> | boolean;
  onPrepareDroneDragStart: (droneId: string) => void;
  onOpenReposModal: () => void;
  capabilities?: Partial<DroneSidebarCapabilities>;
  sidebarGroupingModeOverride?: SidebarGroupingMode;
  fillContainer?: boolean;
  readOnlyMode?: DroneSidebarReadOnlyMode;
  headerAccessory?: React.ReactNode;
  readOnlyDisabledDroneReasonById?: Record<string, string>;
  readOnlyDroneStatusHintById?: Record<string, string>;
};

export function DroneSidebar({
  dronesError,
  groupMoveError,
  dronesLoading,
  sidebarDronesFilteredByRepo,
  sidebarDrones,
  sidebarOptimisticDroneIdSet,
  selectedDroneSet,
  highlightedDroneIds,
  busyChatNodeIdSet,
  unreadAgentMessageByChatNodeId,
  deletingDrones,
  deleteOperationModeById,
  deleteMode,
  renamingDrones,
  settingBaseImages,
  movingDroneGroups,
  sidebarGroups,
  sidebarGroupCreatedAtByName,
  sidebarHiddenGroupCount,
  collapsedGroups,
  deletingGroups,
  renamingGroups,
  sidebarHasUngroupedGroup,
  repos,
  dronesCount,
  droneCountByRepoPath,
  uiDroneName,
  draftSidebarPlaceholder,
  onOpenDraftChatComposer,
  onOpenCreateModal,
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
  onDeleteGroup,
  onPrepareDroneDragStart,
  onOpenReposModal,
  capabilities,
  sidebarGroupingModeOverride,
  fillContainer,
  readOnlyMode = 'read-only',
  headerAccessory,
  readOnlyDisabledDroneReasonById = {},
  readOnlyDroneStatusHintById = {},
}: DroneSidebarProps) {
  const sidebarCapabilities = React.useMemo(
    () => resolveDroneSidebarCapabilities(capabilities),
    [capabilities],
  );
  const {
    sidebarCollapsed,
    selectedDroneIds,
    settingsActiveTab,
    appView,
    sidebarGroupingMode,
    sidebarDensityMode,
    activeRepoPath,
    selectedDrone,
    selectedChat,
    selectedGroupMultiChat,
    sidebarReposCollapsed,
    sidebarAutoMinimize,
    showRecentDronesOnly,
    autoDelete,
    sidebarDockSide,
    sidebarGroupOrder,
    sidebarRepoScopedGroupByPath,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    hiddenSidebarGroups,
    showHiddenSidebarGroups,
    setSettingsActiveTab,
    setAppView,
    setSidebarGroupingMode,
    setSidebarDensityMode,
    setSidebarDockSide,
    setCollapsedGroups,
    setSidebarGroupOrder,
    setSidebarRepoScopedGroupByPath,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setHiddenSidebarGroups,
    setShowHiddenSidebarGroups,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedChat,
    setSidebarAutoMinimize,
    setShowRecentDronesOnly,
    setActiveRepoPath,
    setAutoDelete,
    setSidebarCollapsed,
  } = useDroneSidebarUiState();
  const activeDrag = useDroneHubActiveDrag();
  const footerOptionsMenuRef = React.useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = React.useRef<number | null>(null);
  const expandTimerRef = React.useRef<number | null>(null);
  const sidebarDndIdleTimerRef = React.useRef<number | null>(null);
  const lastAutoCollapsedAtRef = React.useRef<number>(0);
  const sidebarDockDragStartXRef = React.useRef<number | null>(null);
  const [footerOptionsMenuOpen, setFooterOptionsMenuOpen] = React.useState(false);
  const [repositoryOverviewOpen, setRepositoryOverviewOpen] = React.useState(
    () => !String(activeRepoPath ?? '').trim(),
  );
  const [activeSidebarRepoId, setActiveSidebarRepoId] = React.useState<string | null>(() => {
    const repoPath = String(activeRepoPath ?? '').trim();
    return repoPath ? `repo:${repoPath}` : null;
  });
  const [sidebarInteractionDndEnabled, setSidebarInteractionDndEnabled] = React.useState(false);
  const sidebarDndEnabled =
    sidebarCapabilities.dragAndDrop && (sidebarInteractionDndEnabled || Boolean(activeDrag));
  const [sidebarDockDragActive, setSidebarDockDragActive] = React.useState(false);
  const [sidebarDockDragPreviewSide, setSidebarDockDragPreviewSide] = React.useState<
    'left' | 'right' | null
  >(null);
  const hiddenSidebarGroupTokenSet = React.useMemo(
    () => new Set(hiddenSidebarGroups),
    [hiddenSidebarGroups],
  );
  const effectiveSidebarGroupingMode = sidebarCapabilities.headerActions
    ? 'groups'
    : (sidebarGroupingModeOverride ?? sidebarGroupingMode);
  const isRepoGroupingMode = effectiveSidebarGroupingMode === 'repos';
  React.useEffect(() => {
    if (!sidebarCapabilities.headerActions || sidebarGroupingMode === 'groups') return;
    setSidebarGroupingMode('groups');
  }, [setSidebarGroupingMode, sidebarCapabilities.headerActions, sidebarGroupingMode]);
  const repoScopedGroupPathsByRepoGroup = React.useMemo(
    () => groupSidebarRepoScopedGroupsByRepoGroup(sidebarRepoScopedGroupByPath),
    [sidebarRepoScopedGroupByPath],
  );
  const visibleFolderNodeOrderByParent = React.useMemo(() => {
    const baseSidebarFolderTree = buildSidebarFolderTree(
      sidebarGroups,
      sidebarGroupOrder,
      sidebarGroupCreatedAtByName,
    );
    const nodeTree = buildSidebarNodeTree({
      sidebarFolderTree: baseSidebarFolderTree,
      sidebarGroups,
      sidebarGroupOrder,
      repoScopedGroupPathsByRepoGroup,
      sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent,
      sidebarGroupCreatedAtByName,
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
    sidebarGroupCreatedAtByName,
    sidebarNodeOrderByParent,
  ]);
  const handleRenameGroup = React.useCallback(
    async (group: string, nextName?: string) => {
      const ok = await onRenameGroup(group, nextName);
      const targetGroup = String(nextName ?? '').trim();
      if (!ok || !targetGroup) return ok;
      setSidebarRepoScopedGroupByPath((prev) =>
        rewriteSidebarRepoScopedGroupMapKeysByPrefix(prev, group, targetGroup),
      );
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
      const scopedRepoPath =
        opts?.kind === 'group' || !opts?.kind
          ? String(opts?.repoPath ?? activeRepoPath ?? '').trim()
          : '';
      if (!ok || opts?.kind === 'repo' || scopedRepoPath) return ok;
      setSidebarRepoScopedGroupByPath((prev) =>
        removeSidebarRepoScopedGroupMapKeysByPrefix(prev, group),
      );
      return ok;
    },
    [activeRepoPath, onDeleteGroup, setSidebarRepoScopedGroupByPath],
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
      hubPhase: visibleDraftSidebarPlaceholder.starting ? 'starting' : null,
      hubMessage: visibleDraftSidebarPlaceholder.starting ? 'Starting' : null,
      busy: false,
    };
  }, [visibleDraftSidebarPlaceholder]);
  const draftSidebarPlaceholderNodeId = draftSidebarPlaceholderDrone
    ? sidebarDroneNodeId(DRAFT_SIDEBAR_PLACEHOLDER_ID)
    : null;
  const {
    renderSidebarGroups,
    sidebarFolderTree,
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
    sidebarGroupingMode: effectiveSidebarGroupingMode,
    sidebarGroupCreatedAtByName,
  });
  const staticReadOnlyNodeTree = React.useMemo(
    () =>
      buildSidebarNodeTree({
        sidebarFolderTree,
        sidebarGroups: renderSidebarGroups,
        sidebarGroupOrder,
        repoScopedGroupPathsByRepoGroup,
        sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent,
        sidebarGroupCreatedAtByName,
      }),
    [
      renderSidebarGroups,
      repoScopedGroupPathsByRepoGroup,
      sidebarDroneOrderByGroup,
      sidebarFolderTree,
      sidebarGroupOrder,
      sidebarNodeOrderByParent,
      sidebarGroupCreatedAtByName,
    ],
  );
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
    clearGroupedFolderSelection,
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
    updateChatEditorCreateAsDraft,
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
  const handleGroupedSelectFolderWithDrones = React.useCallback(
    (path: string, opts?: { toggle?: boolean }) => {
      const folderDroneIds = collectSidebarFolderDroneIds(staticReadOnlyNodeTree, path);
      if (folderDroneIds.length === 0) {
        if (!opts?.toggle) {
          handleGroupedSelectFolder(path);
          setSelectedDrone(null);
          setSelectedDroneIds([]);
        }
        return;
      }
      const next = (() => {
        if (!opts?.toggle) return folderDroneIds;
        const folderSet = new Set(folderDroneIds);
        const allSelected = folderDroneIds.every((droneId) => selectedDroneIds.includes(droneId));
        return allSelected
          ? selectedDroneIds.filter((droneId) => !folderSet.has(droneId))
          : [
              ...selectedDroneIds,
              ...folderDroneIds.filter((droneId) => !selectedDroneIds.includes(droneId)),
            ];
      })();
      const toggledOff =
        Boolean(opts?.toggle) &&
        folderDroneIds.every((droneId) => selectedDroneIds.includes(droneId));
      if (toggledOff) {
        clearGroupedFolderSelection(path);
      } else {
        handleGroupedSelectFolder(path);
      }
      setSelectedDroneIds(next);
      setSelectedDrone(next[0] ?? null);
      if (next.length > 0) setSelectedChat('default');
    },
    [
      clearGroupedFolderSelection,
      handleGroupedSelectFolder,
      selectedDroneIds,
      setSelectedChat,
      setSelectedDrone,
      setSelectedDroneIds,
      staticReadOnlyNodeTree,
    ],
  );
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

  const clearSidebarDndIdleTimer = React.useCallback(() => {
    if (sidebarDndIdleTimerRef.current == null) return;
    window.clearTimeout(sidebarDndIdleTimerRef.current);
    sidebarDndIdleTimerRef.current = null;
  }, []);

  const enableSidebarDndForInteraction = React.useCallback(() => {
    clearSidebarDndIdleTimer();
    setSidebarInteractionDndEnabled(true);
  }, [clearSidebarDndIdleTimer]);

  const queueSidebarDndIdleDisable = React.useCallback(() => {
    clearSidebarDndIdleTimer();
    if (activeDrag) return;
    sidebarDndIdleTimerRef.current = window.setTimeout(() => {
      sidebarDndIdleTimerRef.current = null;
      setSidebarInteractionDndEnabled(false);
    }, SIDEBAR_DND_IDLE_DISABLE_DELAY_MS);
  }, [activeDrag, clearSidebarDndIdleTimer]);

  React.useEffect(
    () => () => {
      clearSidebarDndIdleTimer();
    },
    [clearSidebarDndIdleTimer],
  );

  React.useEffect(() => {
    if (!sidebarCapabilities.dragAndDrop) return;
    if (activeDrag) {
      enableSidebarDndForInteraction();
      return;
    }
    const sidebar = document.querySelector('[data-drone-sidebar-root="true"]');
    const sidebarActive =
      sidebar instanceof HTMLElement &&
      (sidebar.matches(':hover') || sidebar.contains(document.activeElement));
    if (!sidebarActive) queueSidebarDndIdleDisable();
  }, [
    activeDrag,
    enableSidebarDndForInteraction,
    queueSidebarDndIdleDisable,
    sidebarCapabilities.dragAndDrop,
  ]);

  const onSidebarPointerEnter = React.useCallback(() => {
    clearCollapseTimer();
    clearExpandTimer();
    enableSidebarDndForInteraction();
  }, [clearCollapseTimer, clearExpandTimer, enableSidebarDndForInteraction]);

  const onSidebarPointerLeave = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      queueAutoCollapse();
      queueSidebarDndIdleDisable();
    },
    [queueAutoCollapse, queueSidebarDndIdleDisable],
  );

  const onSidebarBlurCapture = React.useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      queueSidebarDndIdleDisable();
    },
    [queueSidebarDndIdleDisable],
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
    disabled: !sidebarDndEnabled || !showExternalMoveTargets || sidebarHasUngroupedGroup,
  });
  const { setNodeRef: setCreateGroupDropNodeRef } = useDroppable({
    id: 'sidebar-create-group-drop',
    data: { type: 'sidebar-create-group-drop' },
    disabled: !sidebarDndEnabled || isRepoGroupingMode,
  });
  const devicesSettingsActive = appView === 'settings' && settingsActiveTab === 'devices';
  const settingsTabActive = appView === 'settings' && settingsActiveTab !== 'devices';
  const summarizeSidebarFleet = React.useCallback((drones: readonly DroneSummary[]) => {
    let working = 0;
    let unread = 0;
    for (const drone of drones) {
      const chats = drone.chats.length > 0 ? drone.chats : ['default'];
      const droneWorking =
        Boolean(drone.busy) ||
        (drone.busyChats?.length ?? 0) > 0 ||
        chats.some((chatName) => busyChatNodeIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName))) ||
        drone.hubPhase === 'creating' ||
        drone.hubPhase === 'starting' ||
        drone.hubPhase === 'seeding' ||
        Boolean(deletingDrones[drone.id]);
      const droneUnread =
        (drone.unreadChats?.length ?? 0) > 0 ||
        chats.some((chatName) =>
          Boolean(unreadAgentMessageByChatNodeId[sidebarChatSidebarNodeId(drone.id, chatName)]),
        );
      if (droneWorking) working += 1;
      if (droneUnread) unread += 1;
    }
    return { working, unread };
  }, [
    busyChatNodeIdSet,
    deletingDrones,
    unreadAgentMessageByChatNodeId,
  ]);
  const repositoryNavigationModel = React.useMemo(() => {
    return buildSidebarRepositoryNavigationModel({
      repos,
      drones: sidebarDrones,
      summarize: summarizeSidebarFleet,
      sidebarGroupOrder,
      sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent,
      sidebarGroupCreatedAtByName,
      repoScopedGroupPathsByRepoGroup,
    });
  }, [
    repoScopedGroupPathsByRepoGroup,
    repos,
    sidebarDroneOrderByGroup,
    sidebarDrones,
    sidebarGroupCreatedAtByName,
    sidebarGroupOrder,
    sidebarNodeOrderByParent,
    summarizeSidebarFleet,
  ]);
  const repositoryNavigationItems = repositoryNavigationModel.items;
  const selectedDroneRepoPath = React.useMemo(
    () => String(sidebarDrones.find((drone) => drone.id === selectedDrone)?.repoPath ?? '').trim(),
    [selectedDrone, sidebarDrones],
  );
  const activeRepositoryNavigationItem = React.useMemo(
    () => repositoryNavigationItems.find((item) => item.id === activeSidebarRepoId) ?? null,
    [activeSidebarRepoId, repositoryNavigationItems],
  );
  const openRepositoryOverview = React.useCallback(() => {
    setRepositoryOverviewOpen(true);
    setActiveSidebarRepoId(null);
    setActiveRepoPath('');
  }, [setActiveRepoPath]);
  const openRepositoryNavigationItem = React.useCallback(
    (item: (typeof repositoryNavigationItems)[number]) => {
      setRepositoryOverviewOpen(false);
      setActiveSidebarRepoId(item.id);
      setActiveRepoPath(item.repoPath);
    },
    [setActiveRepoPath],
  );
  const createDroneInRepository = React.useCallback(
    (item: (typeof repositoryNavigationItems)[number]) => {
      openRepositoryNavigationItem(item);
      onOpenDraftChatComposer({ repoPath: item.repoPath, group: '' });
    },
    [onOpenDraftChatComposer, openRepositoryNavigationItem],
  );
  React.useEffect(() => {
    if (
      !activeSidebarRepoId ||
      repositoryNavigationItems.some((item) => item.id === activeSidebarRepoId)
    ) return;
    openRepositoryOverview();
  }, [activeSidebarRepoId, openRepositoryOverview, repositoryNavigationItems]);
  const activeRepositoryModel = React.useMemo(() => {
    if (!activeRepositoryNavigationItem) return null;
    const repoPath = activeRepositoryNavigationItem.repoPath;
    const activeDrones = Object.values(sidebarDroneById).filter(
      (drone) => String(drone.repoPath ?? '').trim() === repoPath,
    );
    return buildRepoSidebarModel({
      drones: activeDrones,
      registeredRepoPaths: repoPath ? [repoPath] : [],
      sidebarGroupOrder,
      sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent,
      sidebarGroupCreatedAtByName,
      repoScopedGroupPathsByRepoGroup,
    });
  }, [
    activeRepositoryNavigationItem,
    repoScopedGroupPathsByRepoGroup,
    sidebarDroneById,
    sidebarDroneOrderByGroup,
    sidebarGroupCreatedAtByName,
    sidebarGroupOrder,
    sidebarNodeOrderByParent,
  ]);
  const activeRepositoryRootNodeId = activeRepositoryNavigationItem
    ? sidebarFolderNodeId(activeRepositoryNavigationItem.id)
    : null;
  const activeRepositoryFolderTree = React.useMemo(
    () =>
      activeRepositoryModel
        ? buildSidebarFolderTree(
            activeRepositoryModel.groups,
            sidebarGroupOrder,
            sidebarGroupCreatedAtByName,
          )
        : null,
    [activeRepositoryModel, sidebarGroupCreatedAtByName, sidebarGroupOrder],
  );
  const sharedDroneTreeListProps = React.useMemo<SidebarDroneTreeListSharedProps>(
    () => ({
      droneById: sidebarDroneById,
      sidebarDensityMode,
      draftSidebarPlaceholderId: DRAFT_SIDEBAR_PLACEHOLDER_ID,
      selectedDroneIds,
      selectedDroneSet,
      highlightedDroneIds,
      selectedDrone,
      activeChatName,
      sidebarDndEnabled,
      busyChatNodeIdSet,
      unreadAgentMessageByChatNodeId,
      deletingDrones,
      deleteOperationModeById,
      deleteMode,
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
      actionsEnabled: sidebarCapabilities.actions,
    }),
    [
      activeChatName,
      busyChatNodeIdSet,
      collapsedDroneSections,
      deleteOperationModeById,
      deleteMode,
      deletingDrones,
      sidebarCapabilities.actions,
      movingDroneGroups,
      onCreateDroneChat,
      onDeleteDrone,
      onDeleteDroneChat,
      onOpenCloneModal,
      onOpenDroneErrorModal,
      onPrepareDroneDragStart,
      onRenameDrone,
      onRenameDroneChat,
      onSelectDroneCard,
      onSelectDroneChat,
      onSetDroneBaseImage,
      renamingDrones,
      runOptimisticReparentDronesToParent,
      selectedDrone,
      selectedDroneIds,
      selectedDroneSet,
      highlightedDroneIds,
      sidebarDndEnabled,
      setCollapsedDroneSections,
      settingBaseImages,
      sidebarDensityMode,
      sidebarDroneById,
      sidebarOptimisticDroneIdSet,
      toggleDroneSection,
      uiDroneName,
      unreadAgentMessageByChatNodeId,
    ],
  );

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
  const toggleSidebarDockSide = React.useCallback(() => {
    setSidebarDockSide((current) => (current === 'right' ? 'left' : 'right'));
  }, [setSidebarDockSide]);
  const resolveSidebarDockSideFromPointerX = React.useCallback(
    (clientX: number): 'left' | 'right' => {
      if (typeof window === 'undefined') return sidebarDockSide;
      return clientX > window.innerWidth / 2 ? 'right' : 'left';
    },
    [sidebarDockSide],
  );
  const onSidebarDockHeaderPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isHeaderActionTarget(event.target)) return;
      sidebarDockDragStartXRef.current = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );
  const onSidebarDockHeaderPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const startX = sidebarDockDragStartXRef.current;
      if (startX == null) return;
      if (!sidebarDockDragActive && Math.abs(event.clientX - startX) < 8) return;
      setSidebarDockDragActive(true);
      setSidebarDockDragPreviewSide(resolveSidebarDockSideFromPointerX(event.clientX));
    },
    [resolveSidebarDockSideFromPointerX, sidebarDockDragActive],
  );
  const onSidebarDockHeaderPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (sidebarDockDragActive) {
        setSidebarDockSide(resolveSidebarDockSideFromPointerX(event.clientX));
      }
      sidebarDockDragStartXRef.current = null;
      setSidebarDockDragActive(false);
      setSidebarDockDragPreviewSide(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [resolveSidebarDockSideFromPointerX, setSidebarDockSide, sidebarDockDragActive],
  );
  const onSidebarDockHeaderPointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      sidebarDockDragStartXRef.current = null;
      setSidebarDockDragActive(false);
      setSidebarDockDragPreviewSide(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const sidebarHovered = Boolean(
        document.querySelector('[data-drone-sidebar-root="true"]:hover'),
      );
      if (!sidebarHovered) return;

      if (event.key === 'Escape' && folderEditor) {
        event.preventDefault();
        closeFolderEditor();
        return;
      }

      if (!selectedFolderPath || !visibleSidebarFolderPathSet.has(selectedFolderPath)) return;
      if (folderEditor) return;

      if (sidebarCapabilities.actions && !isRepoGroupingMode && event.key === 'F2') {
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
    sidebarCapabilities.actions,
    selectedFolderPath,
    startRenameFolder,
    visibleSidebarFolderPathSet,
  ]);
  const sidebarBorderClass = sidebarDockSide === 'right' ? 'border-l' : 'border-r';
  const collapsedRailBorderClass = sidebarDockSide === 'right' ? 'border-l' : 'border-r';
  const sidebarDockDragEnabled = sidebarCapabilities.collapseControl;
  const sidebarPointerInteractionsEnabled =
    sidebarCapabilities.collapseControl || sidebarCapabilities.dragAndDrop;
  const sidebarWidthTransitionClass = sidebarCapabilities.collapseControl
    ? 'transition-[width] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:width]'
    : '';
  const sidebarListSelectClass =
    sidebarCapabilities.dragAndDrop || sidebarCapabilities.actions ? 'select-none' : '';
  const readOnlySidebar =
    !sidebarCapabilities.actions &&
    !sidebarCapabilities.createDrones &&
    !sidebarCapabilities.dragAndDrop &&
    !sidebarCapabilities.headerActions;
  const useReadOnlySidebarBranch = readOnlySidebar && readOnlyMode !== 'grouped-tree';
  const sidebarDockTargetLabel = sidebarDockSide === 'right' ? 'left' : 'right';
  const sidebarDockActionLabel = `Move sidebar to ${sidebarDockTargetLabel}`;
  const sidebarHeaderTitle = `Drag header to dock sidebar left or right.`;
  const sidebarDirectionalIconClass = sidebarDockSide === 'right' ? 'rotate-180' : '';
  const sidebarDockPreviewSide = sidebarDockDragPreviewSide ?? sidebarDockSide;
  const activeRepoDroneCount = activeRepoPath
    ? (droneCountByRepoPath.get(activeRepoPath) ?? 0)
    : dronesCount;
  const selectedRepoHasNoDrones = Boolean(activeRepoPath) && activeRepoDroneCount === 0;
  const recentFilterHidAllDrones =
    showRecentDronesOnly && dronesCount > 0 && sidebarDrones.length === 0;
  const recentFilterHidAllSelectedRepoDrones =
    recentFilterHidAllDrones && Boolean(activeRepoPath) && activeRepoDroneCount > 0;
  const recentFilterHidRepoDrones =
    showRecentDronesOnly &&
    activeRepoDroneCount > 0 &&
    sidebarDronesFilteredByRepo.length === 0 &&
    Boolean(activeRepoPath);
  return (
    <>
      {sidebarDockDragActive ? (
        <div className="pointer-events-none fixed inset-0 z-[10000]" aria-hidden="true">
          <div
            className={`absolute top-0 h-full w-[280px] border bg-[var(--user-subtle)] border-[var(--user-border)] shadow-[inset_0_0_0_1px_var(--border-subtle)] ${
              sidebarDockPreviewSide === 'right' ? 'right-0' : 'left-0'
            }`}
          />
        </div>
      ) : null}
      <aside
        data-drone-sidebar-root="true"
        data-drone-sidebar-shell="expanded"
        data-sidebar-dock-side={sidebarDockSide}
        data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
        className={`bg-[var(--sidebar-bg)] [font-family:var(--sidebar-font)] ${sidebarBorderClass} border-[var(--border)] flex flex-col min-h-0 relative flex-shrink-0 overflow-hidden ${sidebarWidthTransitionClass}`}
        style={{
          width: sidebarCollapsed
            ? 0
            : fillContainer
              ? '100%'
              : `min(${SIDEBAR_EXPANDED_WIDTH_PX}px, 100vw)`,
        }}
        onPointerEnter={sidebarPointerInteractionsEnabled ? onSidebarPointerEnter : undefined}
        onPointerLeave={sidebarPointerInteractionsEnabled ? onSidebarPointerLeave : undefined}
        onPointerDownCapture={
          sidebarCapabilities.dragAndDrop ? enableSidebarDndForInteraction : undefined
        }
        onFocusCapture={
          sidebarCapabilities.dragAndDrop ? enableSidebarDndForInteraction : undefined
        }
        onBlurCapture={sidebarCapabilities.dragAndDrop ? onSidebarBlurCapture : undefined}
        onWheel={sidebarCapabilities.sidebarOptions ? onSidebarWheel : undefined}
      >
        <div
          className={`relative flex h-[3.25rem] flex-shrink-0 select-none items-center border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] px-3.5 ${
            sidebarDockDragEnabled
              ? `touch-none ${sidebarDockDragActive ? 'cursor-grabbing' : 'cursor-grab'}`
              : ''
          }`}
          title={sidebarDockDragEnabled ? sidebarHeaderTitle : undefined}
          onPointerDown={sidebarDockDragEnabled ? onSidebarDockHeaderPointerDown : undefined}
          onPointerMove={sidebarDockDragEnabled ? onSidebarDockHeaderPointerMove : undefined}
          onPointerUp={sidebarDockDragEnabled ? onSidebarDockHeaderPointerUp : undefined}
          onPointerCancel={sidebarDockDragEnabled ? onSidebarDockHeaderPointerCancel : undefined}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate dh-type-sidebar-brand">DRONE HUB</span>
            {headerAccessory ? (
              <div className="flex items-center gap-1 flex-shrink-0">{headerAccessory}</div>
            ) : null}
          </div>
        </div>

        {sidebarCapabilities.headerActions ? (
          <>
            <div
              className="grid min-h-14 flex-shrink-0 grid-cols-3 border-b border-[var(--sidebar-section-border)] bg-[var(--sidebar-section-bg)]"
              role="tablist"
              aria-label="Drone Hub sections"
            >
              {[
                {
                  id: 'drones',
                  label: 'Drones',
                  active: appView === 'workspace',
                  Icon: IconDrone,
                  onClick: () => setAppView('workspace'),
                },
                {
                  id: 'devices',
                  label: 'Devices',
                  active: devicesSettingsActive,
                  Icon: IconNetwork,
                  onClick: () => {
                    setSettingsActiveTab('devices');
                    setAppView('settings');
                  },
                },
                {
                  id: 'settings',
                  label: 'Settings',
                  active: settingsTabActive,
                  Icon: IconSettingsOutline,
                  onClick: () => {
                    if (settingsActiveTab === 'devices') setSettingsActiveTab('general');
                    setAppView('settings');
                  },
                },
              ].map(({ id, label, active: tabActive, Icon, onClick }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tabActive}
                  onClick={onClick}
                  className={`relative flex min-w-0 flex-col items-center justify-center gap-[3px] px-0.5 text-[.625rem] font-medium tracking-[.00625rem] transition-colors ${
                    tabActive
                      ? 'bg-[var(--sidebar-tab-active-bg)] text-[var(--accent-muted)]'
                      : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]'
                  }`}
                >
                  <Icon className={`h-[1.125rem] w-[1.125rem] ${tabActive ? 'text-[var(--accent)] [stroke-width:2.3]' : '[stroke-width:1.9]'}`} />
                  <span className="truncate">{label}</span>
                  {tabActive ? (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-sm bg-[var(--accent)]" />
                  ) : null}
                </button>
              ))}
            </div>
            {!repositoryOverviewOpen && activeRepositoryNavigationItem ? (
              <div className="flex min-h-14 w-full flex-shrink-0 items-center border-b border-[var(--border)] pr-2">
                <button
                  type="button"
                  onClick={openRepositoryOverview}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition-colors hover:bg-[var(--hover)]"
                  title="Back to repositories"
                  aria-label="Back to repositories"
                >
                  <span className="relative inline-flex h-5 w-5 flex-shrink-0 items-center justify-end text-[var(--sidebar-action-fg)]">
                    <IconFolderGit className="h-4 w-4" />
                    <span className="absolute -left-0.5 top-1 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[var(--sidebar-bg)]">
                      <IconChevronLeft className="h-2.5 w-2.5" />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[.8125rem] font-semibold text-[var(--fg)]">
                      {activeRepositoryNavigationItem.label}
                    </span>
                    {activeRepositoryNavigationItem.repoPath ? (
                      <span className="mt-px block truncate font-mono text-[.5rem] text-[var(--muted)]">
                        {activeRepositoryNavigationItem.repoPath}
                      </span>
                    ) : null}
                  </span>
                  <span className="inline-flex flex-shrink-0 items-center gap-1.5 font-mono text-[.5625rem] leading-none">
                    {activeRepositoryNavigationItem.stateSummary.working > 0 ? (
                      <span className="inline-flex h-3 items-center gap-1 text-[var(--yellow)]">
                        <SidebarWorkingStatusIndicator />
                        {activeRepositoryNavigationItem.stateSummary.working}
                      </span>
                    ) : null}
                    {activeRepositoryNavigationItem.stateSummary.unread > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[var(--green)]">
                        <IconMessageCircle className="h-3 w-3 [stroke-width:2.2]" />
                        {activeRepositoryNavigationItem.stateSummary.unread}
                      </span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => createDroneInRepository(activeRepositoryNavigationItem)}
                  disabled={!sidebarCapabilities.createDrones}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[.25rem] text-[var(--muted)] transition-colors hover:bg-[var(--sidebar-create-hover-bg)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                  title={`Create drone in ${activeRepositoryNavigationItem.label}`}
                  aria-label={`Create drone in ${activeRepositoryNavigationItem.label}`}
                >
                  <IconPlus className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        <div
          className="dh-sidebar-scrollbar flex-1 min-h-0 overflow-y-auto px-2 py-1.5"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain',
            touchAction: 'pan-y',
          }}
        >
          {dronesError && (
            <div className="mx-2 mb-2 p-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] text-xs text-[var(--red)]">
              Failed to load drones: {dronesError}
            </div>
          )}
          {groupMoveError && (
            <div className="mx-2 mb-2 p-2 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--text-11)] text-[var(--red)]">
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
          {!dronesLoading &&
            sidebarDrones.length === 0 &&
            !visibleDraftSidebarPlaceholder &&
            !dronesError && (
              <div className="px-3 py-10 text-center">
                <div
                  className="text-[var(--muted-dim)] text-[var(--text-11)] tracking-wide uppercase"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {selectedRepoHasNoDrones
                    ? 'No drones for selected repo'
                    : recentFilterHidAllSelectedRepoDrones
                      ? 'No recent drones for selected repo'
                      : recentFilterHidAllDrones
                        ? 'No recent drones'
                        : 'No drones registered'}
                </div>
                {activeRepoPath ? (
                  <div
                    className="text-[var(--muted-dim)] text-[var(--text-10)] mt-2 font-mono truncate"
                    title={activeRepoPath}
                  >
                    {activeRepoPath}
                  </div>
                ) : null}
                {recentFilterHidAllDrones && !selectedRepoHasNoDrones ? (
                  <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
                    Turn off Recent drones only to show older drones.
                  </div>
                ) : null}
                {!recentFilterHidAllDrones &&
                !selectedRepoHasNoDrones &&
                !sidebarCapabilities.headerActions &&
                (sidebarCapabilities.createDrones || sidebarCapabilities.headerActions) ? (
                  <div className="mx-auto mt-4 flex max-w-[240px] flex-col gap-2">
                    {sidebarCapabilities.createDrones ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenDraftChatComposer()}
                          className="inline-flex h-[30px] w-full items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 text-[var(--text-11)] text-[var(--muted)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
                          title="Create new drone"
                          aria-label="Create new drone"
                        >
                          <IconPlus className="opacity-80" />
                          <span
                            className="font-[var(--weight-semibold)] uppercase tracking-wide"
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            Create new drone
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={onOpenCreateModal}
                          className="inline-flex h-[30px] w-full items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 text-[var(--text-11)] text-[var(--muted)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
                          title="Create multiple drones"
                          aria-label="Create multiple drones"
                        >
                          <IconPlusDouble className="opacity-80" />
                          <span
                            className="font-[var(--weight-semibold)] uppercase tracking-wide"
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            Create multiple drones
                          </span>
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {!recentFilterHidAllDrones &&
                !selectedRepoHasNoDrones &&
                !sidebarCapabilities.headerActions &&
                sidebarCapabilities.createDrones ? (
                  <div className="mt-4 text-[var(--text-10)] text-[var(--muted-dim)]">
                    Or run{' '}
                    <code className="rounded border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--text-10)] text-[var(--code-fg)]">
                      drone create &lt;name&gt;
                    </code>{' '}
                    in your terminal.
                  </div>
                ) : null}
              </div>
            )}
          {!dronesLoading &&
            sidebarDrones.length > 0 &&
            sidebarDronesFilteredByRepo.length === 0 &&
            activeRepoPath &&
            !visibleDraftSidebarPlaceholder &&
            !dronesError && (
              <div className="px-3 py-10 text-center">
                <div
                  className="text-[var(--muted-dim)] text-[var(--text-11)] tracking-wide uppercase"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {recentFilterHidRepoDrones
                    ? 'No recent drones for selected repo'
                    : 'No drones for selected repo'}
                </div>
                {recentFilterHidRepoDrones ? (
                  <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
                    Recent drones only is on.
                  </div>
                ) : null}
                <div
                  className="text-[var(--muted-dim)] text-[var(--text-10)] mt-2 font-mono truncate"
                  title={activeRepoPath}
                >
                  {activeRepoPath}
                </div>
              </div>
            )}
          {sidebarCapabilities.createDrones &&
            !sidebarCapabilities.headerActions &&
            (dronesLoading ||
              sidebarDrones.length > 0 ||
              Boolean(visibleDraftSidebarPlaceholder) ||
              Boolean(activeRepoPath)) && (
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={() => onOpenDraftChatComposer()}
                  className="inline-flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 dh-type-sidebar-action dh-type-sidebar-action--accent transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
                  title="Create drone"
                  aria-label="Create drone"
                >
                  <IconPlus className="opacity-90" />
                  <span className="min-w-0 truncate">New drone</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenCreateModal}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] transition-all hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
                  title="Create multiple drones"
                  aria-label="Create multiple drones"
                >
                  <IconPlusDouble className="opacity-90" />
                </button>
              </div>
            )}
          <div className={`flex flex-col gap-0.5 ${sidebarListSelectClass}`}>
            {sidebarCapabilities.headerActions && repositoryOverviewOpen ? (
              <div className="flex flex-col pb-6">
                {repositoryNavigationItems.map((item) => {
                  const containsSelectedDrone = Boolean(selectedDrone) && item.repoPath === selectedDroneRepoPath;
                  return (
                    <div
                      key={item.id}
                      className={`group flex min-h-14 w-full items-center rounded-[.25rem] border-b border-[var(--surface-soft)] transition-colors ${
                        containsSelectedDrone
                          ? 'bg-[var(--selected)]'
                          : 'hover:bg-[var(--hover)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openRepositoryNavigationItem(item)}
                        className="flex min-h-14 min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]"
                        title={item.repoPath || item.label}
                        aria-label={`Open ${item.label} repository`}
                      >
                        <IconFolderGit className="h-[.9375rem] w-[.9375rem] flex-shrink-0 text-[var(--sidebar-action-fg)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[.75rem] font-semibold text-[var(--fg)]">
                            {item.label}
                          </span>
                          {item.repoPath ? (
                            <span className="mt-px block truncate font-mono text-[.5rem] text-[var(--muted)]">
                              {item.repoPath}
                            </span>
                          ) : null}
                        </span>
                        <span className="inline-flex flex-shrink-0 items-center gap-1.5 font-mono text-[.5625rem] leading-none">
                          {item.stateSummary.working > 0 ? (
                            <span className="inline-flex h-3 items-center gap-1 text-[var(--yellow)]">
                              <SidebarWorkingStatusIndicator />
                              {item.stateSummary.working}
                            </span>
                          ) : null}
                          {item.stateSummary.unread > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[var(--green)]">
                              <IconMessageCircle className="h-3 w-3 [stroke-width:2.2]" />
                              {item.stateSummary.unread}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => createDroneInRepository(item)}
                        disabled={!sidebarCapabilities.createDrones}
                        className="mr-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[.25rem] text-[var(--muted)] opacity-0 transition-[color,background-color,opacity] hover:bg-[var(--sidebar-create-hover-bg)] hover:text-[var(--accent)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)] group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                        title={`Create drone in ${item.label}`}
                        aria-label={`Create drone in ${item.label}`}
                      >
                        <IconPlus className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : useReadOnlySidebarBranch && readOnlyMode === 'static-tree' ? (
              <StaticReadOnlySidebarTree
                nodeTree={staticReadOnlyNodeTree}
                sidebarDensityMode={sidebarDensityMode}
                droneById={sidebarDroneById}
                sidebarChatOrderByDrone={sidebarChatOrderByDrone}
                selectedDrone={selectedDrone}
                selectedDroneSet={selectedDroneSet}
                highlightedDroneIds={highlightedDroneIds}
                activeChatName={activeChatName}
                busyChatNodeIdSet={busyChatNodeIdSet}
                unreadAgentMessageByChatNodeId={unreadAgentMessageByChatNodeId}
                disabledDroneReasonById={readOnlyDisabledDroneReasonById}
                droneStatusHintById={readOnlyDroneStatusHintById}
                collapsedGroups={collapsedGroups}
                uiDroneName={uiDroneName}
                onSelectDroneCard={onSelectDroneCard}
                onSelectDroneChat={onSelectDroneChat}
                onToggleGroupCollapsed={onToggleGroupCollapsed}
              />
            ) : useReadOnlySidebarBranch ? (
              <ReadOnlySidebarGroups
                sidebarGroups={renderSidebarGroups}
                sidebarDensityMode={sidebarDensityMode}
                selectedDrone={selectedDrone}
                selectedDroneSet={selectedDroneSet}
                highlightedDroneIds={highlightedDroneIds}
                activeChatName={activeChatName}
                showAllChats={readOnlyMode === 'read-only-chats'}
                collapsedGroups={collapsedGroups}
                uiDroneName={uiDroneName}
                onSelectDroneCard={onSelectDroneCard}
                onSelectDroneChat={onSelectDroneChat}
                onToggleGroupCollapsed={onToggleGroupCollapsed}
              />
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <>
                    {sidebarCapabilities.actions && !isRepoGroupingMode ? (
                      <>
                        {folderEditor?.mode === 'create' &&
                        folderEditor.parentPath === null &&
                        folderEditor.anchorPath === null ? (
                          <div className="mb-1 flex items-center gap-2 rounded-[var(--radius-medium)] border border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1.5">
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
                              className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 py-1 text-[var(--text-11)] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
                            />
                          </div>
                        ) : null}
                        {folderEditor?.mode === 'create' &&
                        folderEditor.parentPath === null &&
                        folderEditor.anchorPath === null &&
                        folderEditor.error ? (
                          <div className="mb-1 px-1 text-[var(--text-10)] text-[var(--red)]">
                            {folderEditor.error}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    <GroupedSidebarTree
                      sidebarGroups={
                        sidebarCapabilities.headerActions && activeRepositoryModel
                          ? activeRepositoryModel.groups
                          : renderSidebarGroups
                      }
                      nodeTreeOverride={
                        sidebarCapabilities.headerActions ? activeRepositoryModel?.nodeTree : null
                      }
                      displayRootNodeId={
                        sidebarCapabilities.headerActions ? activeRepositoryRootNodeId : null
                      }
                      sidebarGroupCreatedAtByName={sidebarGroupCreatedAtByName}
                      sidebarDensityMode={sidebarDensityMode}
                      sidebarFolderTree={
                        sidebarCapabilities.headerActions && activeRepositoryFolderTree
                          ? activeRepositoryFolderTree
                          : sidebarFolderTree
                      }
                      sidebarGroupOrder={sidebarGroupOrder}
                      sidebarDndEnabled={sidebarDndEnabled}
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
                      highlightedDroneIds={highlightedDroneIds}
                      selectedDrone={selectedDrone}
                      activeChatName={activeChatName}
                      selectedSidebarNodeId={selectedSidebarNodeId}
                      selectedFolderPath={selectedFolderPath}
                      setSelectedSidebarNodeId={setSelectedSidebarNodeId}
                      onSelectFolder={handleGroupedSelectFolderWithDrones}
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
                      deleteOperationModeById={deleteOperationModeById}
                      deleteMode={deleteMode}
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
                      onChatEditorCreateAsDraftChange={updateChatEditorCreateAsDraft}
                      onSubmitChatEditor={submitChatEditor}
                      onBlurChatEditor={blurChatEditor}
                      onCancelChatEditor={closeChatEditor}
                      onRenameDrone={onRenameDrone}
                      onSetDroneBaseImage={onSetDroneBaseImage}
                      onDeleteDrone={onDeleteDrone}
                      onOpenDroneErrorModal={onOpenDroneErrorModal}
                      onPrepareDroneDragStart={onPrepareDroneDragStart}
                      onReparentDronesToParent={runOptimisticReparentDronesToParent}
                      actionsEnabled={sidebarCapabilities.actions}
                    />
                  </>
                  {sidebarCapabilities.dragAndDrop &&
                    !isRepoGroupingMode &&
                    !sidebarHasUngroupedGroup &&
                    showExternalMoveTargets && (
                      <div
                        ref={setUngroupedDropNodeRef}
                        className={`rounded-[var(--radius-medium)] border border-dashed px-3 py-2 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-colors ${
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
                {sidebarCapabilities.actions &&
                  !isRepoGroupingMode &&
                  (showExternalMoveTargets ||
                    (createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0)) && (
                    <div
                      ref={setCreateGroupDropNodeRef}
                      className={`mt-1 rounded-[var(--radius-medium)] border border-dashed px-3 py-2 transition-colors ${
                        dragOverCreateGroup ||
                        (createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0)
                          ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                          : 'border-[var(--border-subtle)] bg-[var(--surface-inset)]'
                      }`}
                    >
                      <div
                        className="text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted-dim)]"
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0
                          ? `Create new folder (${createGroupTargetDroneIds.length} drone${createGroupTargetDroneIds.length === 1 ? '' : 's'})`
                          : 'Drop here to create a new folder'}
                      </div>
                      {createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0 && (
                        <form
                          className="mt-2 flex flex-col gap-2"
                          onSubmit={onSubmitCreateGroupInline}
                        >
                          <input
                            ref={createGroupInputRef}
                            value={createGroupName}
                            onChange={(event) => setCreateGroupName(event.target.value)}
                            disabled={creatingGroupMove}
                            maxLength={64}
                            placeholder="Folder name"
                            className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 py-1.5 text-[var(--text-11)] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={creatingGroupMove}
                              className={`inline-flex h-7 items-center rounded px-2 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                                creatingGroupMove
                                  ? 'cursor-not-allowed border border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {creatingGroupMove ? 'Creating…' : 'Create & move'}
                            </button>
                            <button
                              type="button"
                              onClick={closeCreateGroupInline}
                              disabled={creatingGroupMove}
                              className={`inline-flex h-7 items-center rounded px-2 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
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
                            <div className="text-[var(--text-10)] text-[var(--red)]">
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

        {sidebarCapabilities.repoFooter ||
        sidebarCapabilities.sidebarOptions ||
        sidebarCapabilities.collapseControl ? (
          <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--surface-inset)]">
            <div className="px-2.5 py-1.5 flex items-center gap-1.5">
              {sidebarCapabilities.repoFooter ? (
                <button
                  type="button"
                  onClick={openRepositoryOverview}
                  className="flex-1 min-w-0 inline-flex items-center gap-2 px-1.5 py-1 rounded text-left dh-type-sidebar-action dh-type-sidebar-action--quiet hover:bg-[var(--hover)] transition-all"
                  title="Show repositories"
                  aria-label="Show repositories"
                >
                  <IconFolderGit className="h-3 w-3 text-[var(--accent)] opacity-80" />
                  <span className="truncate">Repositories {repositoryNavigationItems.length || ''}</span>
                </button>
              ) : null}
              <div
                ref={footerOptionsMenuRef}
                className="relative flex flex-shrink-0 items-center gap-1"
              >
                {sidebarCapabilities.sidebarOptions ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFooterOptionsMenuOpen((prev) => !prev);
                    }}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                      footerOptionsMenuOpen
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                    }`}
                    title="Sidebar options"
                    aria-label="Sidebar options"
                    aria-haspopup="menu"
                    aria-expanded={footerOptionsMenuOpen}
                  >
                    <IconMore className="opacity-85" />
                  </button>
                ) : null}
                {sidebarCapabilities.repoFooter ? (
                  <button
                    type="button"
                    onClick={onOpenReposModal}
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
                    title={`Manage repos (${repos.length})`}
                    aria-label="Manage repos"
                  >
                    <IconSettings className="opacity-70" />
                  </button>
                ) : null}
                {sidebarCapabilities.collapseControl ? (
                  <SidebarIconButton
                    onClick={collapseSidebarWithGuard}
                    className="border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--hover)]"
                    title="Collapse sidebar"
                    ariaLabel="Collapse sidebar"
                  >
                    <IconSidebarCollapse className={sidebarDirectionalIconClass} />
                  </SidebarIconButton>
                ) : null}
                {sidebarCapabilities.sidebarOptions && footerOptionsMenuOpen ? (
                  <div
                    className={`absolute right-0 bottom-full mb-2 w-[240px] z-50 ${dropdownPanelBaseClass}`}
                    role="menu"
                  >
                    <div className="py-1">
                      {sidebarCapabilities.collapseControl ? (
                        <button
                          type="button"
                          onClick={() => {
                            setFooterOptionsMenuOpen(false);
                            toggleSidebarDockSide();
                          }}
                          className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                          role="menuitem"
                        >
                          <span>{sidebarDockActionLabel}</span>
                          <IconSidebarExpand
                            className={`opacity-65 ${sidebarDockSide === 'right' ? 'rotate-180' : ''}`}
                          />
                        </button>
                      ) : null}
                      {sidebarCapabilities.collapseControl ? (
                        <div className="my-1 border-t border-[var(--border-subtle)]" />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setShowRecentDronesOnly((prev) => !prev)}
                        className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                        role="menuitemcheckbox"
                        aria-checked={showRecentDronesOnly}
                      >
                        <span>Recent drones only</span>
                        <IconClock
                          className={
                            showRecentDronesOnly ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'
                          }
                        />
                      </button>
                      {sidebarCapabilities.actions ? (
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
                          {showHiddenSidebarGroups ? (
                            <IconEyeOff className="opacity-80 text-[var(--accent)]" />
                          ) : (
                            <IconEye className="opacity-65" />
                          )}
                        </button>
                      ) : null}
                      {sidebarCapabilities.actions ? (
                        <button
                          type="button"
                          onClick={() => setAutoDelete((prev) => !prev)}
                          className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                          role="menuitem"
                        >
                          <span>{autoDelete ? 'Delete confirm off' : 'Delete confirm on'}</span>
                          <IconTrash
                            className={
                              autoDelete ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'
                            }
                          />
                        </button>
                      ) : null}
                      {sidebarCapabilities.collapseControl ? (
                        <button
                          type="button"
                          onClick={() => setSidebarAutoMinimize((prev) => !prev)}
                          className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]`}
                          role="menuitem"
                        >
                          <span>
                            {sidebarAutoMinimize ? 'Disable auto-minimize' : 'Enable auto-minimize'}
                          </span>
                          <IconAutoMinimize
                            className={
                              sidebarAutoMinimize ? 'opacity-80 text-[var(--accent)]' : 'opacity-65'
                            }
                          />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </aside>

      <div
        data-drone-sidebar-root="true"
        data-drone-sidebar-shell="rail"
        data-sidebar-dock-side={sidebarDockSide}
        data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
        className={`flex-shrink-0 bg-[var(--panel-alt)] ${collapsedRailBorderClass} flex flex-col items-center pt-3 gap-2 overflow-hidden transition-[width,opacity,border-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
          <IconSidebarExpand className={sidebarDirectionalIconClass} />
        </SidebarIconButton>
        {sidebarCapabilities.collapsedRailActions && sidebarCapabilities.createDrones ? (
          <SidebarIconButton
            onClick={() => {
              setSidebarCollapsed(false);
              onOpenDraftChatComposer();
            }}
            className="border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
            title="Create drone"
            ariaLabel="Create drone"
            disabled={!collapsedRailInteractive}
            tabIndex={collapsedRailInteractive ? 0 : -1}
          >
            <IconPlus className="opacity-80" />
          </SidebarIconButton>
        ) : null}
        {sidebarCapabilities.collapsedRailActions && sidebarCapabilities.createDrones ? (
          <SidebarIconButton
            onClick={() => {
              setSidebarCollapsed(false);
              onOpenCreateModal();
            }}
            className="border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
            title="Create multiple drones (S)"
            ariaLabel="Create multiple drones"
            disabled={!collapsedRailInteractive}
            tabIndex={collapsedRailInteractive ? 0 : -1}
          >
            <IconPlusDouble className="opacity-80" />
          </SidebarIconButton>
        ) : null}
        {sidebarCapabilities.collapsedRailActions && sidebarCapabilities.headerActions ? (
          <SidebarIconButton
            onClick={() => {
              setSettingsActiveTab('devices');
              setAppView('settings');
            }}
            className={`border ${
              devicesSettingsActive
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
            }`}
            title="Open device settings"
            ariaLabel="Open device settings"
            disabled={!collapsedRailInteractive}
            tabIndex={collapsedRailInteractive ? 0 : -1}
          >
            <IconNetwork className="opacity-80" />
          </SidebarIconButton>
        ) : null}
      </div>
    </>
  );
}
