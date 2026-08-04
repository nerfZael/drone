import React from 'react';
import { createPortal } from 'react-dom';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  buildRepoSidebarModel,
  resolvePinnedSidebarDrones,
} from '@drone/hub-model/sidebar';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary, RepoSummary } from '../types';
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
import { IconPin } from '../overview/icons';
import {
  UiActionMenu,
  type UiActionMenuEntry,
  UiNavigationRow,
  UiPanelStatusStrip,
  UiPanelToolbar,
  UiToolbarButton,
  UiToolbarIconButton,
} from '../../ui/components';
import {
  IconChevron,
  IconChevronDown,
  IconChevronLeft,
  IconColumns,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconFolderGit,
  IconFolderOutline,
  IconList,
  IconMore,
  IconPencil,
  IconPlus,
  IconSettings,
  IconSidebarCollapse,
  IconSidebarExpand,
  IconSpinner,
  SkeletonLine,
} from './icons';
import { DesktopDevicePicker } from './DesktopDevicePicker';
import { SidebarDroneTreeList, type SidebarDroneTreeListSharedProps } from './SidebarDroneTreeList';
import { GroupedSidebarTree } from './GroupedSidebarTree';
import { createCanvasChatNodeId } from './app-config';
import { droneChatRequiresApproval, normalizedDroneChats } from './chat-node-helpers';
import { SidebarReorderDropIndicator } from './sidebar-reorder-ui';
import { buildSidebarDroneTree } from './sidebar-drone-tree';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';
import {
  migrateSidebarGroupEntryOrderMapToIds,
  migrateSidebarGroupOrderToIds,
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
  removeSidebarRepoScopedNodeOrderByGroupPrefix,
  SIDEBAR_ROOT_PARENT_ID,
  sidebarChatSidebarNodeId,
  sidebarChatRefFromNodeId,
  sidebarDroneIdFromNodeId,
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
import { sidebarInlineSectionKey, type SidebarInlineSectionKind } from './sidebar-inline-sections';
import { useSidebarOptimisticGroups } from './use-sidebar-optimistic-groups';
import type { MoveDronesToGroupResult } from './use-group-management';
import type { DroneDeleteMode, SidebarDensityMode, SidebarGroupingMode } from './settings-types';
import { isSidebarGroupCollapsed } from './is-sidebar-group-collapsed';
import {
  sidebarChatLabelClass,
  sidebarChatRowTone,
  sidebarChatStateClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
  sidebarSelectionEdgeClass,
} from '../sidebar/presentation';
import { useSidebarReadModel } from './use-sidebar-read-model';
import { buildSidebarRepositoryNavigationModel } from './sidebar-repository-navigation';
import {
  useSidebarInteractions,
  type ChatEditorState,
  type FolderEditorState,
} from './use-sidebar-interactions';
import { useSidebarRootDnd } from './use-sidebar-root-dnd';
import { useDroneHubRuntimeStore } from './use-drone-hub-runtime-store';
import { isDroneStartingOrSeeding } from './helpers';
import { AddDroneToGroupDialog } from './AddDroneToGroupDialog';
import {
  resolveSidebarFolderDroneSelection,
  type SidebarFolderSelectionOptions,
} from './sidebar-folder-selection';
import {
  PinnedDroneReorderItem,
  usePinnedDroneReorder,
} from './pinned-drone-reorder';
import { allocateUntitledDisplayName } from './name-helpers';
import {
  markSidebarGroupDraftRequestHandled,
  SIDEBAR_GROUP_DRAFT_REQUEST_EVENT,
} from './sidebar-group-draft-events';
import {
  resolveSidebarDroneDraftLocation,
  resolveSidebarGroupDraftLocation,
} from './sidebar-group-draft-location';

const SIDEBAR_EXPANDED_WIDTH_PX = 308;
const SIDEBAR_COLLAPSED_RAIL_WIDTH_PX = 40;
const GROUP_HEADER_SINGLE_CLICK_DELAY_MS = 180;
const AUTO_MINIMIZE_COLLAPSE_DELAY_MS = 90;
const AUTO_MINIMIZE_EXPAND_DELAY_MS = 120;
const AUTO_MINIMIZE_REOPEN_GUARD_MS = 220;
const SIDEBAR_DND_IDLE_DISABLE_DELAY_MS = 1500;
const SIDEBAR_DENSITY_MODE_ORDER: SidebarDensityMode[] = ['compact', 'default', 'comfortable'];

function PinnedSidebarPlacementSlot({
  placement,
  topTarget,
  bottomTarget,
  children,
}: {
  placement: 'top' | 'bottom';
  topTarget: HTMLDivElement | null;
  bottomTarget: HTMLDivElement | null;
  children: React.ReactNode;
}) {
  if (placement === 'top') return topTarget ? createPortal(children, topTarget) : null;
  return bottomTarget ? createPortal(children, bottomTarget) : null;
}

function pinnedDroneRepoLabel(repoPathRaw: string, navigationLabel?: string): string {
  const navigationName = String(navigationLabel ?? '').trim();
  if (navigationName) return navigationName;
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

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

function SidebarRepositoryStateCount({
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

type DraftSidebarPlaceholder = {
  name: string;
  repoPath: string;
  group: string | null;
  starting: boolean;
};

const DRAFT_SIDEBAR_PLACEHOLDER_ID = '__draft-sidebar-placeholder__';

function readOnlyDroneChats(drone: DroneSummary): string[] {
  return normalizedDroneChats(drone, { includeDefaultWhenEmpty: true });
}

function ReadOnlySidebarGroups({
  sidebarGroups,
  sidebarDensityMode,
  selectedDrone,
  selectedDroneSet,
  highlightedDroneIds,
  activeChatName,
  selectedSidebarNodeId,
  collapsedDroneSections,
  collapsedGroups,
  uiDroneName,
  onSelectDroneCard,
  onSelectDroneContainer,
  onSelectDroneChat,
  onToggleDroneSection,
  onToggleGroupCollapsed,
}: {
  sidebarGroups: SidebarGroup[];
  sidebarDensityMode: SidebarDensityMode;
  selectedDrone: string | null;
  selectedDroneSet: Set<string>;
  highlightedDroneIds: Set<string>;
  activeChatName: string;
  selectedSidebarNodeId: string | null;
  collapsedDroneSections: Record<string, boolean>;
  collapsedGroups: Record<string, boolean>;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneContainer: (droneId: string) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onToggleDroneSection: (droneId: string, kind: SidebarInlineSectionKind) => void;
  onToggleGroupCollapsed: (group: string) => void;
}) {
  const lastToggleRef = React.useRef<{ groupKey: string; timestamp: number } | null>(null);
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const approvalRequiredByChatNodeId = useDroneHubRuntimeStore(
    (state) => state.approvalRequiredByChatNodeId,
  );
  const visibleDroneOrder = React.useMemo(
    () =>
      sidebarGroups.flatMap((group) => {
        const groupKey = String(group.group ?? '').trim();
        if (isSidebarGroupCollapsed(collapsedGroups, groupKey)) return [];
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
        const collapsed = isSidebarGroupCollapsed(collapsedGroups, groupKey);
        return (
          <section key={`${group.kind}:${group.group}`} className="flex flex-col gap-0.5">
            <UiNavigationRow
              density="compact"
              className={densityClasses.folderRow}
              label={
                <span className={`${sidebarFolderLabelClass} ${densityClasses.folderLabel}`}>
                  {group.label}
                </span>
              }
              expandable={Boolean(groupKey)}
              open={!collapsed}
              onOpenChange={() => {
                if (groupKey) toggleGroupCollapsed(groupKey);
              }}
              title={group.group}
            />
            {!collapsed ? (
              <div className="flex flex-col gap-0">
                {group.items.map((drone) => {
                  const droneId = String(drone?.id ?? '').trim();
                  const chats = readOnlyDroneChats(drone);
                  const busy =
                    Boolean(drone?.busy) ||
                    (Array.isArray(drone?.busyChats) && drone.busyChats.length > 0);
                  const displayName = uiDroneName(drone.name) || drone.name || droneId;
                  const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
                  const hasChatSection = chats.length > 1;
                  const selected = hasChatSection
                    ? selectedSidebarNodeId === sidebarDroneNodeId(droneId)
                    : selectedDroneSet.has(droneId);
                  const chatSectionExpanded = collapsedDroneSections[sidebarInlineSectionKey(droneId, 'chats')] !== true;
                  const hasActiveChildChat = selectedDrone === droneId && !hasOnlyDefaultChat;
                  const defaultChatNodeId = createCanvasChatNodeId(droneId, 'default');
                  const showChatRows = hasChatSection && chatSectionExpanded;
                  return (
                    <div key={droneId || displayName} data-sidebar-drone-unit="true" className="flex flex-col gap-0.5">
                      <DroneCard
                        drone={drone}
                        density={sidebarDensityMode}
                        displayName={displayName}
                        selected={selected}
                        highlighted={highlightedDroneIds.has(droneId)}
                        active={
                          selectedDrone === droneId &&
                          ((hasOnlyDefaultChat && activeChatName === 'default') ||
                            (hasActiveChildChat && !chatSectionExpanded))
                        }
                        activeIndicatorStyle="edge"
                        disclosureExpanded={hasChatSection ? chatSectionExpanded : undefined}
                        disclosureLabel={
                          hasChatSection
                            ? `${chatSectionExpanded ? 'Collapse' : 'Expand'} chats for ${displayName}`
                            : undefined
                        }
                        busy={busy && hasOnlyDefaultChat}
                        approvalRequired={
                          hasOnlyDefaultChat &&
                          (droneChatRequiresApproval(drone, 'default') ||
                            Boolean(approvalRequiredByChatNodeId[defaultChatNodeId]))
                        }
                        unreadAgentMessage={false}
                        onClick={(rowOpts) => {
                          if (hasChatSection) {
                            onSelectDroneContainer(droneId);
                            onToggleDroneSection(droneId, 'chats');
                            return;
                          }
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
                        <div
                          data-sidebar-guide-selected={hasActiveChildChat ? 'true' : undefined}
                          className={`${densityClasses.chatIndent} dh-sidebar-drone-chat-body flex flex-col gap-0.5 border-l`}
                        >
                          {chats.map((chatName) => {
                            const active = selectedDrone === droneId && activeChatName === chatName;
                            const chatNodeId = createCanvasChatNodeId(droneId, chatName);
                            const chatBusy =
                              Array.isArray(drone?.busyChats) && drone.busyChats.includes(chatName);
                            const chatUnread =
                              !active &&
                              (drone?.unreadChats ?? []).includes(chatName);
                            const chatState = sidebarChatDisplayState(
                              drone,
                              chatBusy,
                              droneChatRequiresApproval(drone, chatName) ||
                                Boolean(approvalRequiredByChatNodeId[chatNodeId]),
                            );
                            const chatStateLabel = sidebarDroneStateLabel(chatState, chatUnread);
                            return (
                              <UiNavigationRow
                                key={chatName}
                                density="compact"
                                className={`${densityClasses.chatRow} ${
                                  active
                                    ? 'text-[var(--sidebar-drone-fg)]'
                                    : 'text-[var(--sidebar-subitem-fg)]'
                                }`}
                                style={{ paddingLeft: 4 }}
                                label={<span className={sidebarChatLabelClass}>{chatName}</span>}
                                status={
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
                                      emphasized={active}
                                    />
                                  </span>
                                }
                                current={active}
                                onClick={() => {
                                  if (droneId) onSelectDroneChat(droneId, chatName);
                                }}
                                aria-label={`${displayName} / ${chatName}`}
                              />
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
    if (isSidebarGroupCollapsed(collapsedGroups, folderPath)) return;
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
  selectedSidebarNodeId,
  busyChatNodeIdSet,
  unreadAgentMessageByChatNodeId,
  disabledDroneReasonById,
  droneStatusHintById,
  collapsedDroneSections,
  collapsedGroups,
  uiDroneName,
  onSelectDroneCard,
  onSelectDroneContainer,
  onSelectDroneChat,
  onToggleDroneSection,
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
  selectedSidebarNodeId: string | null;
  busyChatNodeIdSet: Set<string>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  disabledDroneReasonById: Record<string, string>;
  droneStatusHintById: Record<string, string>;
  collapsedDroneSections: Record<string, boolean>;
  collapsedGroups: Record<string, boolean>;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneContainer: (droneId: string) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onToggleDroneSection: (droneId: string, kind: SidebarInlineSectionKind) => void;
  onToggleGroupCollapsed: (group: string) => void;
}) {
  const densityClasses = sidebarDensityClasses(sidebarDensityMode);
  const approvalRequiredByChatNodeId = useDroneHubRuntimeStore(
    (state) => state.approvalRequiredByChatNodeId,
  );
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
    const hasChatSection = chats.length > 1;
    const chatSectionExpanded = collapsedDroneSections[sidebarInlineSectionKey(drone.id, 'chats')] !== true;
    const hasActiveChildChat = selectedDrone === drone.id && !hasOnlyDefaultChat;
    const selected = hasChatSection
      ? selectedSidebarNodeId === node.id
      : selectedDroneSet.has(drone.id);
    const disabledReason = String(disabledDroneReasonById[drone.id] ?? '').trim();
    const defaultChatNodeId = createCanvasChatNodeId(drone.id, 'default');
    const defaultChatBusy =
      (Array.isArray(drone.busyChats) && drone.busyChats.includes('default')) ||
      busyChatNodeIdSet.has(defaultChatNodeId);
    const busy = Boolean(drone.busy) || defaultChatBusy;
    const childIds = nodeTree.childIdsByParent[node.id] ?? [];
    return (
      <div key={node.id} data-sidebar-drone-unit="true" className="flex flex-col gap-0.5">
        <DroneCard
          drone={drone}
          density={sidebarDensityMode}
          displayName={uiDroneName(drone.name)}
          selected={selected}
          disabled={Boolean(disabledReason) && !hasChatSection}
          disabledReason={disabledReason || undefined}
          highlighted={highlightedDroneIds.has(drone.id)}
          active={
            selectedDrone === drone.id &&
            ((hasOnlyDefaultChat && activeChatName === 'default') ||
              (hasActiveChildChat && !chatSectionExpanded))
          }
          activeIndicatorStyle="edge"
          disclosureExpanded={hasChatSection ? chatSectionExpanded : undefined}
          disclosureLabel={
            hasChatSection
              ? `${chatSectionExpanded ? 'Collapse' : 'Expand'} chats for ${uiDroneName(drone.name)}`
              : undefined
          }
          busy={busy && hasOnlyDefaultChat}
          approvalRequired={
            hasOnlyDefaultChat &&
            (droneChatRequiresApproval(drone, 'default') ||
              Boolean(approvalRequiredByChatNodeId[defaultChatNodeId]))
          }
          statusHint={droneStatusHintById[drone.id]}
          unreadAgentMessage={
            hasOnlyDefaultChat && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true
          }
          onClick={(rowOpts) => {
            if (hasChatSection) {
              onSelectDroneContainer(drone.id);
              onToggleDroneSection(drone.id, 'chats');
              return;
            }
            onSelectDroneCard(drone.id, { ...rowOpts, orderedDroneIds: visibleDroneOrder });
          }}
          draggable={false}
          dragging={false}
        />
        {hasChatSection && chatSectionExpanded ? (
          <div
            data-sidebar-guide-selected={hasActiveChildChat ? 'true' : undefined}
            className={`${densityClasses.chatIndent} dh-sidebar-drone-chat-body flex flex-col gap-0.5 border-l`}
          >
            {chats.map((chatName) => {
              const active = selectedDrone === drone.id && activeChatName === chatName;
              const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
              const chatBusy =
                (Array.isArray(drone.busyChats) && drone.busyChats.includes(chatName)) ||
                busyChatNodeIdSet.has(chatNodeId);
              const chatUnread =
                !active &&
                ((drone.unreadChats ?? []).includes(chatName) ||
                  unreadAgentMessageByChatNodeId[chatNodeId] === true);
              const chatState = sidebarChatDisplayState(
                drone,
                chatBusy,
                droneChatRequiresApproval(drone, chatName) ||
                  Boolean(approvalRequiredByChatNodeId[chatNodeId]),
              );
              const chatStateLabel = sidebarDroneStateLabel(chatState, chatUnread);
              return (
                <button
                  key={chatName}
                  type="button"
                  disabled={Boolean(disabledReason)}
                  className={`relative flex items-center gap-1 rounded border text-left transition-colors ${densityClasses.chatRow} ${sidebarChatRowTone({ active, disabled: Boolean(disabledReason) })}`}
                  onClick={() => {
                    if (!disabledReason) onSelectDroneChat(drone.id, chatName);
                  }}
                  title={disabledReason || undefined}
                  aria-label={`${uiDroneName(drone.name)} / ${chatName}`}
                  aria-current={active ? 'page' : undefined}
                >
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
                      emphasized={active}
                    />
                  </span>
                  <span className={sidebarChatLabelClass}>{chatName}</span>
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
    const collapsed = isSidebarGroupCollapsed(collapsedGroups, folderPath);
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
          <IconChevron
            down={!collapsed}
            className={`${densityClasses.icon} flex-shrink-0 text-[var(--muted-dim)]`}
          />
          <span className={`${sidebarFolderLabelClass} ${densityClasses.folderLabel}`}>
            {node.label}
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
    <div className="flex flex-col gap-0">
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
  const actionRailWidthClass = canRenameGroup
    ? 'group-hover/group-header:w-[92px]'
    : 'group-hover/group-header:w-[60px]';
  const pinnedActionRailWidthClass = canRenameGroup ? 'w-[92px]' : 'w-[60px]';
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
          <span className={`${sidebarFolderLabelClass} text-[var(--text-11)] font-normal`}>
            {groupLabel}
          </span>
        </button>
        <div
          className={`relative flex-shrink-0 transition-[width] duration-150 ${
            pinGroupActionsVisible ? pinnedActionRailWidthClass : `w-0 ${actionRailWidthClass}`
          }`}
        >
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
              </>
            ) : null}
          </div>
        </div>
      </div>
      {!collapsed ? (
        <div ref={setMoveDropNodeRef} className="px-1.5 py-1.5 flex flex-col gap-0">
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
    opts?: { anchorPath?: string | null; beforeNodeId?: string | null; repoGroupPath?: string | null },
  ) => void;
  onStartRenameFolder: (group: string) => void;
  onFolderEditorValueChange: (next: string) => void;
  onSubmitFolderEditor: () => void;
  onBlurFolderEditor: () => void;
  onCancelFolderEditor: () => void;
  toggleSidebarGroupHidden: (target: SidebarDragGroupRef) => void;
  onOpenGroupMultiChat: (group: string) => void;
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
}: SidebarFolderTreeNodeProps) {
  const groupRef = React.useMemo<SidebarDragGroupRef>(
    () => ({ groupId: node.groupId, group: node.path, kind: 'group' }),
    [node.groupId, node.path],
  );
  const groupToken = React.useMemo(() => sidebarGroupOrderToken(groupRef), [groupRef]);
  const groupLabel = sidebarFolderDisplayLabel(node);
  const collapsed = isSidebarGroupCollapsed(collapsedGroups, node.path);
  const isDeletingGroup = Boolean(deletingGroups[node.path]);
  const isRenamingGroup = Boolean(renamingGroups[node.path]);
  const isDropTarget = dragOverGroup === node.path;
  const isReorderDragging = draggingSidebarGroup === groupToken;
  const isHiddenGroup = hiddenSidebarGroupTokenSet.has(groupToken);
  const isSelected = selectedFolderPath === node.path;
  const canRenameGroup = !isUngroupedGroupName(node.path);
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
              onSelectFolder(node.path);
              onToggleGroupCollapsed(node.path);
            }}
            {...(attributes as unknown as Record<string, unknown>)}
            {...(listeners as unknown as Record<string, unknown>)}
            title={collapsed ? `Expand ${groupLabel}` : `Collapse ${groupLabel}`}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <IconChevron down={!collapsed} className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-dim)]" />
              {showEditorInline && folderEditor ? (
                <input
                  ref={folderEditorInputRef}
                  value={folderEditor.value}
                  onChange={(event) => onFolderEditorValueChange(event.target.value)}
                  onBlur={onBlurFolderEditor}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
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
                  className="min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 text-[var(--text-11)] text-[var(--fg)] shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                  style={{ border: 0, outline: 'none', boxShadow: 'none' }}
                />
              ) : (
                <span className={`${sidebarFolderLabelClass} text-[var(--text-11)]`} title={node.path}>
                  {groupLabel}
                </span>
              )}
            </div>
          </button>
          <div
            className={`relative flex-shrink-0 transition-[width] duration-150 ${
              pinGroupActionsVisible ? 'w-[92px]' : 'w-0 group-hover/folder-row:w-[92px]'
            }`}
          >
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
            />
          ))}
          {showCreateInline && folderEditor ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-medium)] border border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1.5">
              <IconChevron className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)] opacity-80" />
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
  allDrones: DroneSummary[];
  sidebarDronesFilteredByRepo: DroneSummary[];
  sidebarDrones: DroneSummary[];
  pinnedDroneIds: string[];
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
  sidebarGroupIdByName: Record<string, string>;
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
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onDeleteDroneChat: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  onCloneDrone: (drone: DroneSummary) => void;
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
  onRenameDrone: (
    droneId: string,
    newName: string,
  ) => Promise<DroneInlineRenameResult> | DroneInlineRenameResult;
  onSetDroneBaseImage: (droneId: string) => void;
  onSetDronePinned: (droneId: string, pinned: boolean) => Promise<boolean>;
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
  onPrepareDroneDragStart: (droneId: string, draggedDroneIds?: readonly string[]) => void;
  onOpenReposModal: () => void;
  onSetDroneSelectionFromFolder: (
    droneIds: readonly string[],
    opts?: { preserveActive?: boolean },
  ) => void;
  onRenderedNodeTreeChange?: (nodeTree: SidebarNodeTreeModel | null) => void;
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
  allDrones,
  sidebarDronesFilteredByRepo,
  sidebarDrones,
  pinnedDroneIds,
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
  sidebarGroupIdByName,
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
  onSelectDroneCard,
  onSelectDroneChat,
  onDeleteDroneChat,
  onCloneDrone,
  onCreateDroneChat,
  onRenameDroneChat,
  onRenameDrone,
  onSetDroneBaseImage,
  onSetDronePinned,
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
  onSetDroneSelectionFromFolder,
  onRenderedNodeTreeChange,
  capabilities,
  sidebarGroupingModeOverride,
  fillContainer,
  readOnlyMode = 'read-only',
  headerAccessory,
  readOnlyDisabledDroneReasonById = {},
  readOnlyDroneStatusHintById = {},
}: DroneSidebarProps) {
  const [pinnedSidebarTopTarget, setPinnedSidebarTopTarget] =
    React.useState<HTMLDivElement | null>(null);
  const [pinnedSidebarBottomTarget, setPinnedSidebarBottomTarget] =
    React.useState<HTMLDivElement | null>(null);
  const approvalRequiredByChatNodeId = useDroneHubRuntimeStore(
    (state) => state.approvalRequiredByChatNodeId,
  );
  const sidebarCapabilities = React.useMemo(
    () => resolveDroneSidebarCapabilities(capabilities),
    [capabilities],
  );
  const {
    sidebarCollapsed,
    selectedDroneIds,
    appView,
    sidebarGroupingMode,
    sidebarDensityMode,
    activeRepoPath,
    pinnedSidebarPlacement,
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
    setAppView,
    setSidebarGroupingMode,
    setSidebarDensityMode,
    setSidebarDockSide,
    setPinnedSidebarPlacement,
    setCollapsedGroups,
    setSidebarGroupOrder,
    setSidebarRepoScopedGroupByPath,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setPinnedDroneIds,
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
    setSettingsActiveTab,
  } = useDroneSidebarUiState();
  React.useEffect(() => {
    if (Object.keys(sidebarGroupIdByName).length === 0) return;
    setSidebarGroupOrder((current) => migrateSidebarGroupOrderToIds(current, sidebarGroupIdByName));
    setHiddenSidebarGroups((current) => migrateSidebarGroupOrderToIds(current, sidebarGroupIdByName));
    setSidebarDroneOrderByGroup((current) =>
      migrateSidebarGroupEntryOrderMapToIds(current, sidebarGroupIdByName),
    );
  }, [
    setSidebarDroneOrderByGroup,
    setSidebarGroupOrder,
    setHiddenSidebarGroups,
    sidebarGroupIdByName,
  ]);
  const activeDrag = useDroneHubActiveDrag();
  const collapseTimerRef = React.useRef<number | null>(null);
  const expandTimerRef = React.useRef<number | null>(null);
  const sidebarDndIdleTimerRef = React.useRef<number | null>(null);
  const lastAutoCollapsedAtRef = React.useRef<number>(0);
  const sidebarDockDragStartXRef = React.useRef<number | null>(null);
  const [addToGroupTarget, setAddToGroupTarget] = React.useState<{
    droneId: string;
    droneName: string;
    currentGroup: string | null;
  } | null>(null);
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
  const [pinningDroneIds, setPinningDroneIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [pinError, setPinError] = React.useState<string | null>(null);
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
  const pinnedDroneIdSet = React.useMemo(() => new Set(pinnedDroneIds), [pinnedDroneIds]);
  const setPinned = React.useCallback(
    async (droneId: string, pinned: boolean) => {
      setPinError(null);
      setPinningDroneIds((current) => new Set(current).add(droneId));
      try {
        const saved = await onSetDronePinned(droneId, pinned);
        if (!saved) {
          setPinError(`Could not ${pinned ? 'pin' : 'unpin'} the drone. Please try again.`);
        }
      } catch {
        setPinError(`Could not ${pinned ? 'pin' : 'unpin'} the drone. Please try again.`);
      } finally {
        setPinningDroneIds((current) => {
          const next = new Set(current);
          next.delete(droneId);
          return next;
        });
      }
    },
    [onSetDronePinned],
  );
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
      sidebarGroupIdByName,
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
    sidebarGroupIdByName,
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
      if (!ok || opts?.kind === 'repo') return ok;
      if (scopedRepoPath) {
        const repoGroupPath = `repo:${scopedRepoPath}`;
        setSidebarRepoScopedGroupByPath((prev) =>
          removeSidebarRepoScopedGroupMapKeysByPrefix(prev, group, repoGroupPath),
        );
        setSidebarNodeOrderByParent((prev) =>
          removeSidebarRepoScopedNodeOrderByGroupPrefix(prev, repoGroupPath, group),
        );
        return ok;
      }
      setSidebarRepoScopedGroupByPath((prev) =>
        removeSidebarRepoScopedGroupMapKeysByPrefix(prev, group),
      );
      return ok;
    },
    [
      activeRepoPath,
      onDeleteGroup,
      setSidebarNodeOrderByParent,
      setSidebarRepoScopedGroupByPath,
    ],
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
  const addToGroupOptions = React.useMemo(
    () =>
      optimisticSidebarGroups
        .filter((group) => group.kind === 'group' && !isUngroupedGroupName(group.group))
        .map((group) => String(group.group ?? '').trim())
        .filter(Boolean),
    [optimisticSidebarGroups],
  );
  const openAddDroneToGroup = React.useCallback(
    (drone: DroneSummary) => {
      const droneId = String(drone.id ?? '').trim();
      if (!droneId) return;
      setAddToGroupTarget({
        droneId,
        droneName: uiDroneName(drone.name) || drone.name || droneId,
        currentGroup: String(drone.group ?? '').trim() || null,
      });
    },
    [uiDroneName],
  );
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
        sidebarGroupIdByName,
      }),
    [
      renderSidebarGroups,
      repoScopedGroupPathsByRepoGroup,
      sidebarDroneOrderByGroup,
      sidebarFolderTree,
      sidebarGroupOrder,
      sidebarNodeOrderByParent,
      sidebarGroupCreatedAtByName,
      sidebarGroupIdByName,
    ],
  );
  const renderedSidebarNodeTreeRef = React.useRef<SidebarNodeTreeModel | null>(null);
  const getRenderedSidebarNodeTree = React.useCallback(
    () => renderedSidebarNodeTreeRef.current,
    [],
  );
  const inlineRenameRequestSequenceRef = React.useRef(0);
  const [inlineRenameDroneRequest, setInlineRenameDroneRequest] = React.useState<{
    droneId: string;
    key: number;
  } | null>(null);
  const requestInlineDroneRename = React.useCallback(
    (droneIdRaw: string): boolean => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId || !sidebarDroneById[droneId]) return false;
      inlineRenameRequestSequenceRef.current += 1;
      setInlineRenameDroneRequest({
        droneId,
        key: inlineRenameRequestSequenceRef.current,
      });
      return true;
    },
    [sidebarDroneById],
  );
  React.useEffect(() => {
    if (!inlineRenameDroneRequest) return;
    const requestKey = inlineRenameDroneRequest.key;
    const id = window.setTimeout(() => {
      setInlineRenameDroneRequest((current) =>
        current?.key === requestKey ? null : current,
      );
    }, 0);
    return () => window.clearTimeout(id);
  }, [inlineRenameDroneRequest]);
  const {
    blurChatEditor,
    blurFolderEditor,
    chatEditor,
    chatEditorInputRef,
    closeChatEditor,
    closeFolderEditor,
    collapsedDroneSections,
    folderEditor,
    folderEditorInputRef,
    clearGroupedFolderSelection,
    handleGroupedSelectDroneCard,
    handleGroupedSelectDroneContainer,
    handleGroupedSelectDroneChat,
    handleGroupedFocusDroneChat,
    handleGroupedSelectFolder,
    moveFolderIntoGroup,
    openDroneChatCreate,
    openFolderCreate,
    selectedFolderPath,
    selectedSidebarNodeId,
    setCollapsedDroneSections,
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
    runOptimisticRenameGroup,
    selectedDrone,
    setSidebarRepoScopedGroupByPath,
    setSidebarNodeOrderByParent,
    getRenderedSidebarNodeTree,
    sidebarDroneById,
    visibleSidebarFolderPathSet,
  });
  const handleGroupedSelectFolderWithDrones = React.useCallback(
    (path: string, opts?: SidebarFolderSelectionOptions) => {
      const folderDroneIds = collectSidebarFolderDroneIds(staticReadOnlyNodeTree, path);
      const next = resolveSidebarFolderDroneSelection({
        selectedDroneIds,
        folderDroneIds,
        options: opts,
      });
      const toggledOff =
        Boolean(opts?.toggle) &&
        folderDroneIds.length > 0 &&
        folderDroneIds.every((droneId) => selectedDroneIds.includes(droneId));
      if (toggledOff) {
        clearGroupedFolderSelection(path);
      } else {
        handleGroupedSelectFolder(path);
      }
      onSetDroneSelectionFromFolder(next, { preserveActive: Boolean(opts?.toggle) });
    },
    [
      clearGroupedFolderSelection,
      handleGroupedSelectFolder,
      selectedDroneIds,
      onSetDroneSelectionFromFolder,
      staticReadOnlyNodeTree,
    ],
  );
  const selectGroupedDroneContainer = React.useCallback(
    (droneId: string) => {
      handleGroupedSelectDroneContainer(droneId);
      onSetDroneSelectionFromFolder([]);
    },
    [handleGroupedSelectDroneContainer, onSetDroneSelectionFromFolder],
  );
  const focusGroupedDroneChat = React.useCallback(
    (droneId: string, chatName: string) => {
      handleGroupedFocusDroneChat(droneId, chatName);
      onSetDroneSelectionFromFolder([]);
    },
    [handleGroupedFocusDroneChat, onSetDroneSelectionFromFolder],
  );
  const handleGroupedPrepareDroneDragStart = React.useCallback(
    (droneId: string, draggedDroneIds?: readonly string[]) => {
      clearGroupedFolderSelection();
      setSelectedSidebarNodeId(sidebarDroneNodeId(droneId));
      onPrepareDroneDragStart(droneId, draggedDroneIds);
    },
    [clearGroupedFolderSelection, onPrepareDroneDragStart, setSelectedSidebarNodeId],
  );
  const {
    activeDraggedDroneIds,
    dragOverGroup,
    dragOverSidebarGroup,
    dragOverUngrouped,
    draggingSidebarGroup,
  } = useSidebarRootDnd({
    activeDrag,
    isRepoGroupingMode,
    moveFolderIntoGroup,
    runOptimisticMoveDronesToGroup,
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
  const settingsViewActive = appView === 'settings';
  const summarizeSidebarFleet = React.useCallback((drones: readonly DroneSummary[]) => {
    let working = 0;
    let approval = 0;
    let unread = 0;
    for (const drone of drones) {
      const chats = drone.chats.length > 0 ? drone.chats : ['default'];
      const droneApprovalRequired = chats.some((chatName) =>
        droneChatRequiresApproval(drone, chatName) ||
        Boolean(approvalRequiredByChatNodeId[createCanvasChatNodeId(drone.id, chatName)]),
      );
      const droneWorking =
        !droneApprovalRequired &&
        (Boolean(drone.busy) ||
          (drone.busyChats?.length ?? 0) > 0 ||
          chats.some((chatName) => busyChatNodeIdSet.has(sidebarChatSidebarNodeId(drone.id, chatName))) ||
          drone.hubPhase === 'creating' ||
          drone.hubPhase === 'starting' ||
          drone.hubPhase === 'seeding' ||
          Boolean(deletingDrones[drone.id]));
      const inactiveDisplayState = sidebarDroneDisplayState(drone, false, '', false, false);
      const droneUnread =
        !droneWorking &&
        inactiveDisplayState !== 'blocked' &&
        inactiveDisplayState !== 'offline' &&
        ((drone.unreadChats?.length ?? 0) > 0 ||
          chats.some((chatName) =>
            Boolean(unreadAgentMessageByChatNodeId[sidebarChatSidebarNodeId(drone.id, chatName)]),
          ));
      if (droneWorking) working += 1;
      if (droneApprovalRequired) approval += 1;
      if (droneUnread) unread += 1;
    }
    return { working, approval, unread };
  }, [
    approvalRequiredByChatNodeId,
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
      sidebarGroupIdByName,
      repoScopedGroupPathsByRepoGroup,
    });
  }, [
    repoScopedGroupPathsByRepoGroup,
    repos,
    sidebarDroneOrderByGroup,
    sidebarDrones,
    sidebarGroupCreatedAtByName,
    sidebarGroupIdByName,
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
  const globalPinnedDrones = React.useMemo(
    () => resolvePinnedSidebarDrones(allDrones, pinnedDroneIds),
    [allDrones, pinnedDroneIds],
  );
  const globalPinnedDroneIds = React.useMemo(
    () => globalPinnedDrones.map((drone) => drone.id),
    [globalPinnedDrones],
  );
  const pinnedDroneReorderEnabled =
    sidebarDndEnabled &&
    globalPinnedDroneIds.length > 1 &&
    pinningDroneIds.size === 0;
  const pinnedDroneDropTarget = usePinnedDroneReorder({
    enabled: pinnedDroneReorderEnabled,
    visibleDroneIds: globalPinnedDroneIds,
    setPinnedDroneIds,
    onPrepareDroneDragStart,
  });
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
  const selectPinnedDroneCard = React.useCallback(
    (drone: DroneSummary, opts?: DroneSelectionClickOptions) => {
      onSelectDroneCard(drone.id, { ...opts, orderedDroneIds: globalPinnedDroneIds });
    },
    [globalPinnedDroneIds, onSelectDroneCard],
  );
  const createDroneInRepository = React.useCallback(
    (item: (typeof repositoryNavigationItems)[number]) => {
      openRepositoryNavigationItem(item);
      onOpenDraftChatComposer({ repoPath: item.repoPath, group: '' });
    },
    [onOpenDraftChatComposer, openRepositoryNavigationItem],
  );
  const selectedCreateContextDrone = React.useMemo(() => {
    const selectedNodeDroneId =
      sidebarDroneIdFromNodeId(selectedSidebarNodeId ?? '') ??
      String(selectedDrone ?? '').trim();
    return selectedNodeDroneId ? sidebarDroneById[selectedNodeDroneId] ?? null : null;
  }, [selectedDrone, selectedSidebarNodeId, sidebarDroneById]);
  const selectedDroneDraftLocation = React.useMemo(
    () =>
      resolveSidebarDroneDraftLocation({
        selectedFolderPath,
        visibleFolderPaths: visibleSidebarFolderPathSet,
        selectedDrone: selectedCreateContextDrone,
        fallbackRepoPath:
          activeRepositoryNavigationItem?.repoPath ?? activeRepoPath,
      }),
    [
      activeRepoPath,
      activeRepositoryNavigationItem,
      selectedCreateContextDrone,
      selectedFolderPath,
      visibleSidebarFolderPathSet,
    ],
  );
  const openDraftDroneFromSidebarSelection = React.useCallback(() => {
    onOpenDraftChatComposer(selectedDroneDraftLocation);
  }, [onOpenDraftChatComposer, selectedDroneDraftLocation]);
  const openGroupDraftAtNode = React.useCallback((anchorNodeId: string | null): boolean => {
    if (!sidebarCapabilities.actions || isRepoGroupingMode) return false;
    if (sidebarCapabilities.headerActions && (repositoryOverviewOpen || !activeRepositoryNavigationItem)) {
      return false;
    }
    const draftLocation = resolveSidebarGroupDraftLocation({
      selectedSidebarNodeId: anchorNodeId,
      selectedDroneId: selectedCreateContextDrone?.id ?? null,
      nodeTree: getRenderedSidebarNodeTree(),
      visibleFolderPaths: visibleSidebarFolderPathSet,
    });
    openFolderCreate(draftLocation.parentPath, {
      beforeNodeId: draftLocation.beforeNodeId,
      repoGroupPath: activeRepositoryNavigationItem?.id ?? null,
      initialValue: allocateUntitledDisplayName(draftLocation.siblingNames),
      dismissOnBlur: true,
    });
    setSidebarCollapsed(false);
    return true;
  }, [
    activeRepositoryNavigationItem,
    getRenderedSidebarNodeTree,
    isRepoGroupingMode,
    openFolderCreate,
    repositoryOverviewOpen,
    sidebarCapabilities.actions,
    selectedCreateContextDrone,
    sidebarCapabilities.headerActions,
    setSidebarCollapsed,
    visibleSidebarFolderPathSet,
  ]);
  const openGroupDraft = React.useCallback(
    (): boolean => openGroupDraftAtNode(selectedSidebarNodeId),
    [openGroupDraftAtNode, selectedSidebarNodeId],
  );
  const openGroupDraftBeforeDrone = React.useCallback(
    (drone: DroneSummary): void => {
      openGroupDraftAtNode(sidebarDroneNodeId(drone.id));
    },
    [openGroupDraftAtNode],
  );
  React.useEffect(() => {
    const onRequest = (event: Event) => {
      if (event.defaultPrevented) return;
      if (!openGroupDraft()) return;
      markSidebarGroupDraftRequestHandled(event);
    };
    window.addEventListener(SIDEBAR_GROUP_DRAFT_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(SIDEBAR_GROUP_DRAFT_REQUEST_EVENT, onRequest);
  }, [openGroupDraft]);
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
      sidebarGroupIdByName,
      repoScopedGroupPathsByRepoGroup,
    });
  }, [
    activeRepositoryNavigationItem,
    repoScopedGroupPathsByRepoGroup,
    sidebarDroneById,
    sidebarDroneOrderByGroup,
    sidebarGroupCreatedAtByName,
    sidebarGroupIdByName,
    sidebarGroupOrder,
    sidebarNodeOrderByParent,
  ]);
  const activeRepositoryRootNodeId = activeRepositoryNavigationItem
    ? sidebarFolderNodeId(activeRepositoryNavigationItem.id)
    : null;
  const renderedSidebarNodeTree = sidebarCapabilities.headerActions
    ? repositoryOverviewOpen
      ? null
      : activeRepositoryModel?.nodeTree ?? null
    : staticReadOnlyNodeTree;
  React.useLayoutEffect(() => {
    renderedSidebarNodeTreeRef.current = renderedSidebarNodeTree;
    onRenderedNodeTreeChange?.(renderedSidebarNodeTree);
    return () => {
      if (renderedSidebarNodeTreeRef.current === renderedSidebarNodeTree) {
        renderedSidebarNodeTreeRef.current = null;
      }
      onRenderedNodeTreeChange?.(null);
    };
  }, [onRenderedNodeTreeChange, renderedSidebarNodeTree]);
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
      onCloneDrone,
      onAddDroneToGroup: openAddDroneToGroup,
      onCreateDroneChat,
      onRenameDroneChat,
      onRenameDrone,
      inlineRenameDroneRequest,
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
      onCloneDrone,
      openAddDroneToGroup,
      onOpenDroneErrorModal,
      onPrepareDroneDragStart,
      onRenameDrone,
      onRenameDroneChat,
      inlineRenameDroneRequest,
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
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      if (
        !folderEditor &&
        !event.repeat &&
        sidebarCapabilities.actions &&
        event.key === 'Delete'
      ) {
        if (
          event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="menu"]')
        ) return;
        if (!selectedFolderPath || !visibleSidebarFolderPathSet.has(selectedFolderPath)) return;
        if (deletingGroups[selectedFolderPath] || renamingGroups[selectedFolderPath]) return;
        const nodeTree = getRenderedSidebarNodeTree() ?? staticReadOnlyNodeTree;
        const selectedFolder = nodeTree.folderNodeByPath[selectedFolderPath];
        if (!selectedFolder) return;
        if (
          selectedFolder.groupKind === 'group' &&
          isUngroupedGroupName(selectedFolder.groupPath ?? selectedFolderPath)
        ) return;

        event.preventDefault();
        const repoPath = selectedFolder.groupKind === 'repo'
          ? selectedFolder.path.startsWith('repo:') && selectedFolder.path !== 'repo:ungrouped'
            ? selectedFolder.path.slice('repo:'.length)
            : null
          : activeRepoPath;
        const folderPath = selectedFolderPath;
        void handleDeleteGroup(folderPath, selectedFolder.totalDroneCount, {
          kind: selectedFolder.groupKind,
          label: selectedFolder.label,
          repoPath,
        }).then((deleted) => {
          if (deleted) clearGroupedFolderSelection(folderPath);
        });
        return;
      }

      const sidebarHovered = Boolean(
        document.querySelector('[data-drone-sidebar-root="true"]:hover'),
      );
      if (!sidebarHovered) return;

      if (event.key === 'Escape' && folderEditor) {
        event.preventDefault();
        closeFolderEditor();
        return;
      }

      if (folderEditor) return;

      if (sidebarCapabilities.actions && event.key === 'F2') {
        const selectedChatRef = sidebarChatRefFromNodeId(selectedSidebarNodeId ?? '');
        if (selectedChatRef) {
          event.preventDefault();
          if (selectedChatRef.chatName !== 'default') {
            startRenameDroneChat(selectedChatRef.droneId, selectedChatRef.chatName);
          }
          return;
        }
        if (
          !isRepoGroupingMode &&
          selectedFolderPath &&
          visibleSidebarFolderPathSet.has(selectedFolderPath)
        ) {
          event.preventDefault();
          startRenameFolder(selectedFolderPath);
          return;
        }
        const selectedDroneId =
          sidebarDroneIdFromNodeId(selectedSidebarNodeId ?? '') ??
          (!selectedFolderPath ? String(selectedDrone ?? '').trim() : '');
        if (selectedDroneId && requestInlineDroneRename(selectedDroneId)) {
          event.preventDefault();
        }
        return;
      }

      if (!selectedFolderPath || !visibleSidebarFolderPathSet.has(selectedFolderPath)) return;

      if (
        event.key === 'ArrowLeft' &&
        !isSidebarGroupCollapsed(collapsedGroups, selectedFolderPath)
      ) {
        event.preventDefault();
        onToggleGroupCollapsed(selectedFolderPath);
        return;
      }

      if (
        event.key === 'ArrowRight' &&
        isSidebarGroupCollapsed(collapsedGroups, selectedFolderPath)
      ) {
        event.preventDefault();
        onToggleGroupCollapsed(selectedFolderPath);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeRepoPath,
    clearGroupedFolderSelection,
    closeFolderEditor,
    collapsedGroups,
    deletingGroups,
    folderEditor,
    getRenderedSidebarNodeTree,
    handleDeleteGroup,
    isRepoGroupingMode,
    onToggleGroupCollapsed,
    requestInlineDroneRename,
    renamingGroups,
    sidebarCapabilities.actions,
    selectedDrone,
    selectedSidebarNodeId,
    selectedFolderPath,
    staticReadOnlyNodeTree,
    startRenameFolder,
    startRenameDroneChat,
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
  const sidebarOptionsEntries: UiActionMenuEntry[] = [];
  if (sidebarCapabilities.collapseControl) {
    sidebarOptionsEntries.push({
      id: 'dock-side',
      label: sidebarDockActionLabel,
      icon: (
        <IconSidebarExpand
          className={`opacity-65 ${sidebarDockSide === 'right' ? 'rotate-180' : ''}`}
        />
      ),
    });
    sidebarOptionsEntries.push({ kind: 'separator', id: 'dock-separator' });
  }
  sidebarOptionsEntries.push({
    id: 'recent',
    label: 'Recent drones only',
    selectionRole: 'checkbox',
    checked: showRecentDronesOnly,
  });
  if (sidebarCapabilities.actions) {
    sidebarOptionsEntries.push({
      id: 'hidden',
      label: `Show hidden groups${
        sidebarHiddenGroupCount > 0 ? ` (${sidebarHiddenGroupCount})` : ''
      }`,
      selectionRole: 'checkbox',
      checked: showHiddenSidebarGroups,
    });
    sidebarOptionsEntries.push({
      id: 'delete-confirm',
      label: 'Confirm before deleting',
      selectionRole: 'checkbox',
      checked: !autoDelete,
    });
  }
  if (sidebarCapabilities.collapseControl) {
    sidebarOptionsEntries.push({
      id: 'auto-minimize',
      label: 'Auto-minimize sidebar',
      selectionRole: 'checkbox',
      checked: sidebarAutoMinimize,
    });
  }
  return (
    <>
      {sidebarDockDragActive ? (
        <div className="pointer-events-none fixed inset-0 z-[10000]" aria-hidden="true">
          <div
            className={`absolute top-0 h-full border bg-[var(--user-subtle)] border-[var(--user-border)] shadow-[inset_0_0_0_1px_var(--border-subtle)] ${
              sidebarDockPreviewSide === 'right' ? 'right-0' : 'left-0'
            }`}
            style={{ width: SIDEBAR_EXPANDED_WIDTH_PX }}
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
          className={`relative flex h-11 flex-shrink-0 select-none items-center border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] pl-3 pr-2 ${
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
            <button
              type="button"
              onClick={() => {
                setAppView('workspace');
                openRepositoryOverview();
              }}
              className="flex-shrink-0 text-left dh-type-sidebar-brand"
              title="Open project list"
              aria-label="Open project list"
            >
              DRONE HUB
            </button>
            {sidebarCapabilities.headerActions ? (
              <DesktopDevicePicker
                onOpenDeviceSettings={() => {
                  setSettingsActiveTab('devices');
                  setAppView('settings');
                }}
              />
            ) : null}
            {headerAccessory ? (
              <div className="flex items-center gap-1 flex-shrink-0">{headerAccessory}</div>
            ) : null}
          </div>
        </div>

        {pinnedSidebarPlacement === 'top' && globalPinnedDrones.length > 0 ? (
          <div
            ref={setPinnedSidebarTopTarget}
            data-sidebar-pinned-top-slot="true"
            className={`flex-shrink-0 px-2 [--sidebar-selection-edge-offset:-0.5rem] ${
              repositoryOverviewOpen || !activeRepositoryNavigationItem
                ? 'border-b border-[var(--border-subtle)]'
                : ''
            }`}
          />
        ) : null}

        <div
          className="dh-sidebar-scrollbar flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-2 pt-0 pb-1.5 [--sidebar-selection-edge-offset:-0.5rem]"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain',
            touchAction: 'pan-y',
          }}
        >
          {dronesError && (
            <UiPanelStatusStrip tone="danger" className="mx-2 mb-2 rounded border">
              Failed to load drones: {dronesError}
            </UiPanelStatusStrip>
          )}
          {groupMoveError && (
            <UiPanelStatusStrip tone="danger" className="mx-2 mb-2 rounded border">
              Group move failed: {groupMoveError}
            </UiPanelStatusStrip>
          )}
          {pinError && (
            <UiPanelStatusStrip tone="danger" className="mx-2 mb-2 rounded border">
              {pinError}
            </UiPanelStatusStrip>
          )}
          {dronesLoading && sidebarDronesFilteredByRepo.length === 0 && !dronesError && (
            <div
              role="status"
              aria-live="polite"
              aria-label="Loading projects and drones"
              className="px-3 py-3 flex flex-col gap-3"
            >
              <span className="text-[var(--text-10)] text-[var(--sidebar-meta-fg)]">
                Loading projects and drones…
              </span>
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
                          onClick={openDraftDroneFromSidebarSelection}
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
                  onClick={openDraftDroneFromSidebarSelection}
                  className="inline-flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 dh-type-sidebar-action dh-type-sidebar-action--accent transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]"
                  title="Create drone"
                  aria-label="Create drone"
                >
                  <IconPlus className="opacity-90" />
                  <span className="min-w-0 truncate">New drone</span>
                </button>
                {sidebarCapabilities.actions && !isRepoGroupingMode ? (
                  <button
                    type="button"
                    onClick={openGroupDraft}
                    data-sidebar-create-group="true"
                    className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
                    title="Create group (E)"
                    aria-label="Create group"
                  >
                    <IconFolder className="opacity-90" />
                  </button>
                ) : null}
              </div>
            )}
          <div className={`flex flex-col gap-0 ${sidebarListSelectClass}`}>
            <PinnedSidebarPlacementSlot
              placement={pinnedSidebarPlacement}
              topTarget={pinnedSidebarTopTarget}
              bottomTarget={pinnedSidebarBottomTarget}
            >
              {globalPinnedDrones.length > 0 ? (
                <section
                  data-sidebar-pinned-section="true"
                  data-sidebar-pinned-placement={pinnedSidebarPlacement}
                  className={
                    pinnedSidebarPlacement === 'bottom'
                      ? 'border-t border-[var(--border-subtle)]'
                      : undefined
                  }
                  aria-label="Pinned drones"
                >
                <div className="flex min-h-8 items-center gap-1.5 border-b border-[var(--border-subtle)] px-1">
                  <IconPin className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-dim)] opacity-72" />
                  <span className="min-w-0 flex-1 truncate text-[length:var(--text-10-5)] font-normal text-[color:var(--muted-dim)] [font-family:var(--sidebar-font)]">
                    Pinned
                  </span>
                  <button
                    type="button"
                    data-sidebar-pinned-placement-toggle="true"
                    onClick={() =>
                      setPinnedSidebarPlacement((current) =>
                        current === 'top' ? 'bottom' : 'top',
                      )
                    }
                    className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[.25rem] text-[var(--muted-dim)] transition-colors hover:bg-[var(--sidebar-create-hover-bg)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)]"
                    title={
                      pinnedSidebarPlacement === 'top'
                        ? 'Move pinned drones to bottom'
                        : 'Move pinned drones to top'
                    }
                    aria-label={
                      pinnedSidebarPlacement === 'top'
                        ? 'Move pinned drones to bottom'
                        : 'Move pinned drones to top'
                    }
                    aria-pressed={pinnedSidebarPlacement === 'bottom'}
                  >
                    <IconChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        pinnedSidebarPlacement === 'bottom' ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>
                <div className="flex flex-col gap-0.5 pb-1">
                  {globalPinnedDrones.map((drone) => {
                    const droneId = String(drone.id ?? '').trim();
                    const pinnedRepoPath = String(drone.repoPath ?? '').trim();
                    const pinnedRepositoryItem = repositoryNavigationItems.find(
                      (item) => item.repoPath === pinnedRepoPath,
                    );
                    const pinnedDroneIsInActiveRepository =
                      !repositoryOverviewOpen &&
                      activeRepositoryNavigationItem?.repoPath === pinnedRepoPath;
                    const chats = Array.isArray(drone.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
                    const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
                    const defaultChatNodeId = createCanvasChatNodeId(droneId, 'default');
                    const isOptimistic = sidebarOptimisticDroneIdSet.has(droneId);
                    const droneMutationBusy =
                      Boolean(deletingDrones[droneId]) ||
                      Boolean(renamingDrones[droneId]) ||
                      Boolean(settingBaseImages[droneId]);
                    const droneProvisioning = isDroneStartingOrSeeding(drone.hubPhase);
                    const pinnedDragDisabled =
                      !pinnedDroneReorderEnabled || isOptimistic;
                    return (
                      <PinnedDroneReorderItem
                        key={`pinned:${droneId}`}
                        droneId={droneId}
                        label={uiDroneName(drone.name)}
                        disabled={pinnedDragDisabled}
                        dropTarget={pinnedDroneDropTarget}
                      >
                        {(dragProps) => (
                          <DroneCard
                            drone={drone}
                            density={sidebarDensityMode}
                            displayName={uiDroneName(drone.name)}
                            selected={selectedDroneSet.has(droneId)}
                            highlighted={highlightedDroneIds.has(droneId)}
                            active={selectedDrone === droneId && hasOnlyDefaultChat && activeChatName === 'default'}
                            activeIndicatorStyle="edge"
                            busy={hasOnlyDefaultChat && busyChatNodeIdSet.has(defaultChatNodeId)}
                            approvalRequired={
                              hasOnlyDefaultChat &&
                              (droneChatRequiresApproval(drone, 'default') ||
                                Boolean(approvalRequiredByChatNodeId[defaultChatNodeId]))
                            }
                            operationLabel={
                              deletingDrones[droneId]
                                ? ((deleteOperationModeById[droneId] ?? deleteMode) === 'archive' ? 'Archiving' : 'Deleting')
                                : undefined
                            }
                            unreadAgentMessage={hasOnlyDefaultChat && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true}
                            statusHint={pinnedDroneRepoLabel(pinnedRepoPath, pinnedRepositoryItem?.label)}
                            pinned
                            pinBusy={pinningDroneIds.has(droneId)}
                            onTogglePinned={sidebarCapabilities.actions ? () => void setPinned(droneId, false) : undefined}
                            onCreateChat={sidebarCapabilities.actions ? () => openDroneChatCreate(drone) : undefined}
                            onClone={sidebarCapabilities.actions ? () => onCloneDrone(drone) : undefined}
                            onAddToGroup={
                              sidebarCapabilities.actions && pinnedDroneIsInActiveRepository
                                ? () => openAddDroneToGroup(drone)
                                : undefined
                            }
                            onCreateGroup={
                              sidebarCapabilities.actions &&
                              pinnedDroneIsInActiveRepository &&
                              Boolean(sidebarDroneById[droneId])
                                ? () => openGroupDraftBeforeDrone(drone)
                                : undefined
                            }
                            onRename={
                              sidebarCapabilities.actions
                                ? (newName) => onRenameDrone(droneId, newName)
                                : undefined
                            }
                            inlineRenameRequestKey={
                              inlineRenameDroneRequest?.droneId === droneId
                                ? inlineRenameDroneRequest.key
                                : 0
                            }
                            onSetBaseImage={sidebarCapabilities.actions ? () => onSetDroneBaseImage(droneId) : undefined}
                            onDelete={sidebarCapabilities.actions ? () => onDeleteDrone(droneId) : undefined}
                            onErrorClick={onOpenDroneErrorModal}
                            cloneDisabled={
                              isOptimistic ||
                              droneMutationBusy ||
                              String(drone.runtime ?? 'container').trim().toLowerCase() === 'host'
                            }
                            createChatDisabled={isOptimistic || droneMutationBusy || droneProvisioning}
                            addToGroupDisabled={isOptimistic || movingDroneGroups || droneMutationBusy || droneProvisioning}
                            renameDisabled={isOptimistic || droneMutationBusy || droneProvisioning}
                            renameBusy={Boolean(renamingDrones[droneId])}
                            setBaseImageDisabled={isOptimistic || droneMutationBusy || droneProvisioning}
                            setBaseImageBusy={Boolean(settingBaseImages[droneId])}
                            deleteDisabled={isOptimistic || droneMutationBusy}
                            deleteBusy={Boolean(deletingDrones[droneId])}
                            onClick={(rowOpts) => selectPinnedDroneCard(drone, rowOpts)}
                            dragNodeRef={dragProps.dragNodeRef}
                            dragAttributes={dragProps.dragAttributes}
                            dragListeners={dragProps.dragListeners}
                            draggable={dragProps.draggable}
                            dragging={dragProps.dragging}
                          />
                        )}
                      </PinnedDroneReorderItem>
                    );
                  })}
                </div>
                </section>
              ) : null}
            </PinnedSidebarPlacementSlot>
            {sidebarCapabilities.headerActions &&
            !repositoryOverviewOpen &&
            activeRepositoryNavigationItem ? (
              <div
                data-sidebar-active-repository-header="true"
                className={`group/active-repository sticky top-0 z-20 -mx-2 mb-2 flex h-10 w-[calc(100%+1rem)] flex-shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--sidebar-bg)] pr-1.5 transition-colors ${
                  pinnedSidebarPlacement === 'top' && globalPinnedDrones.length > 0
                    ? 'border-t'
                    : ''
                }`}
              >
                <button
                  type="button"
                  onClick={openRepositoryOverview}
                  className="flex h-10 min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                  title="Back to repositories"
                  aria-label="Back to repositories"
                >
                  <span className="relative inline-flex h-4 w-4 flex-shrink-0 items-center justify-end text-[var(--sidebar-action-fg)]">
                    <IconFolderGit className="h-3.5 w-3.5" />
                    <span className="absolute -left-1 top-0.5 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[var(--surface-inset)] transition-colors group-hover/active-repository:bg-[var(--hover)] group-focus-within/active-repository:bg-[var(--hover)]">
                      <IconChevronLeft className="h-2.5 w-2.5" />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--text-12)] font-semibold text-[var(--fg)]">
                      {activeRepositoryNavigationItem.label}
                    </span>
                  </span>
                  <span className="inline-flex flex-shrink-0 items-center gap-1.5 font-mono text-[.5625rem] leading-none">
                    {activeRepositoryNavigationItem.stateSummary.approval > 0 ? (
                      <SidebarRepositoryStateCount
                        count={activeRepositoryNavigationItem.stateSummary.approval}
                        indicator={<SidebarApprovalStatusIndicator />}
                        label="awaiting approval"
                        toneClassName="text-[var(--yellow)]"
                      />
                    ) : null}
                    {activeRepositoryNavigationItem.stateSummary.unread > 0 ? (
                      <SidebarRepositoryStateCount
                        count={activeRepositoryNavigationItem.stateSummary.unread}
                        indicator={<SidebarItemStateIndicator state="idle" unread />}
                        label="unread"
                        toneClassName="text-[var(--green)]"
                      />
                    ) : null}
                    {activeRepositoryNavigationItem.stateSummary.working > 0 ? (
                      <SidebarRepositoryStateCount
                        count={activeRepositoryNavigationItem.stateSummary.working}
                        indicator={<SidebarWorkingStatusIndicator />}
                        label="working"
                        toneClassName="text-[var(--yellow)]"
                      />
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openGroupDraft}
                  disabled={!sidebarCapabilities.actions}
                  data-sidebar-create-group="true"
                  className="group/create-group inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[.25rem] text-[var(--muted)] transition-colors hover:bg-[var(--sidebar-create-hover-bg)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Create group (E)"
                  aria-label="Create group"
                >
                  <span className="relative inline-flex h-4 w-4 items-center justify-center opacity-70 transition-opacity group-hover/create-group:opacity-100 group-focus-visible/create-group:opacity-100">
                    <IconFolderOutline className="h-4 w-4" />
                    <IconPlus className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-[var(--sidebar-bg)]" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openDraftDroneFromSidebarSelection}
                  disabled={!sidebarCapabilities.createDrones}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[.25rem] text-[var(--muted)] transition-colors hover:bg-[var(--sidebar-create-hover-bg)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                  title={`Create drone in ${activeRepositoryNavigationItem.label}`}
                  aria-label={`Create drone in ${activeRepositoryNavigationItem.label}`}
                >
                  <IconPlus className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            {sidebarCapabilities.headerActions && repositoryOverviewOpen ? (
              <div className="flex flex-col py-1 pb-6">
                {repositoryNavigationItems.map((item) => {
                  const containsSelectedDrone = Boolean(selectedDrone) && item.repoPath === selectedDroneRepoPath;
                  const isUngrouped = !item.repoPath;
                  return (
                    <React.Fragment key={item.id}>
                      <div
                        className={`dh-sidebar-row-interactive group/repository-row relative flex min-h-12 w-full items-center rounded-[var(--sidebar-row-radius)] transition-colors ${
                          containsSelectedDrone ? 'dh-sidebar-row-selected' : ''
                        }`}
                      >
                        {containsSelectedDrone ? <span className={sidebarSelectionEdgeClass} /> : null}
                        <button
                          type="button"
                          onClick={() => openRepositoryNavigationItem(item)}
                          className="flex min-h-12 min-w-0 flex-1 items-start gap-2 px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]"
                          title={item.repoPath || item.label}
                          aria-label={`Open ${item.label} repository`}
                        >
                          <span
                            className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center ${
                              containsSelectedDrone
                                ? 'text-[var(--accent)]'
                                : isUngrouped
                                  ? 'text-[var(--sidebar-meta-fg)]'
                                  : 'text-[var(--sidebar-action-fg)]'
                            }`}
                          >
                            {isUngrouped ? (
                              <IconFolderOutline className="h-3.5 w-3.5" />
                            ) : (
                              <IconFolderGit className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-[var(--text-13)] group-hover/repository-row:text-[var(--fg)] ${
                              containsSelectedDrone
                                ? 'font-semibold text-[var(--fg)]'
                                : isUngrouped
                                  ? 'font-medium text-[var(--fg-secondary)]'
                                  : 'font-semibold text-[var(--sidebar-heading-fg)]'
                            }`}>
                              {item.label}
                            </span>
                            <span
                              className="mt-0.5 block truncate font-mono text-[.5625rem] font-normal text-[var(--sidebar-meta-fg)] opacity-55"
                              title={item.repoPath || 'Drones without a repository'}
                            >
                              {item.repoPath || 'Drones without a repository'}
                            </span>
                          </span>
                        </button>
                        <div className="relative mr-0.5 h-7 w-7 flex-shrink-0">
                          <span className="pointer-events-none absolute inset-0 inline-flex items-center justify-end gap-1.5 whitespace-nowrap pr-2 font-mono text-[.5625rem] leading-none transition-opacity duration-150 group-hover/repository-row:opacity-0 group-focus-within/repository-row:opacity-0">
                            {item.stateSummary.approval > 0 ? (
                              <SidebarRepositoryStateCount
                                count={item.stateSummary.approval}
                                indicator={<SidebarApprovalStatusIndicator />}
                                label="awaiting approval"
                                toneClassName="text-[var(--yellow)]"
                              />
                            ) : null}
                            {item.stateSummary.unread > 0 ? (
                              <SidebarRepositoryStateCount
                                count={item.stateSummary.unread}
                                indicator={<SidebarItemStateIndicator state="idle" unread />}
                                label="unread"
                                toneClassName="text-[var(--green)]"
                              />
                            ) : null}
                            {item.stateSummary.working > 0 ? (
                              <SidebarRepositoryStateCount
                                count={item.stateSummary.working}
                                indicator={<SidebarWorkingStatusIndicator />}
                                label="working"
                                toneClassName="text-[var(--yellow)]"
                              />
                            ) : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => createDroneInRepository(item)}
                            disabled={!sidebarCapabilities.createDrones}
                            className="absolute inset-0 inline-flex items-center justify-center rounded-[.25rem] text-[var(--muted)] opacity-0 transition-[color,background-color,opacity] duration-150 hover:bg-[var(--sidebar-create-hover-bg)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)] group-hover/repository-row:opacity-100 group-focus-within/repository-row:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                            title={`Create drone in ${item.label}`}
                            aria-label={`Create drone in ${item.label}`}
                          >
                            <IconPlus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {isUngrouped ? (
                        <div aria-hidden="true" className="mx-1.5 h-px bg-[var(--border-subtle)]" />
                      ) : null}
                    </React.Fragment>
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
                selectedSidebarNodeId={selectedSidebarNodeId}
                busyChatNodeIdSet={busyChatNodeIdSet}
                unreadAgentMessageByChatNodeId={unreadAgentMessageByChatNodeId}
                disabledDroneReasonById={readOnlyDisabledDroneReasonById}
                droneStatusHintById={readOnlyDroneStatusHintById}
                collapsedDroneSections={collapsedDroneSections}
                collapsedGroups={collapsedGroups}
                uiDroneName={uiDroneName}
                onSelectDroneCard={onSelectDroneCard}
                onSelectDroneContainer={selectGroupedDroneContainer}
                onSelectDroneChat={onSelectDroneChat}
                onToggleDroneSection={toggleDroneSection}
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
                selectedSidebarNodeId={selectedSidebarNodeId}
                collapsedDroneSections={collapsedDroneSections}
                collapsedGroups={collapsedGroups}
                uiDroneName={uiDroneName}
                onSelectDroneCard={onSelectDroneCard}
                onSelectDroneContainer={selectGroupedDroneContainer}
                onSelectDroneChat={onSelectDroneChat}
                onToggleDroneSection={toggleDroneSection}
                onToggleGroupCollapsed={onToggleGroupCollapsed}
              />
            ) : (
              <>
                <div className="flex flex-col gap-0">
                  <>
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
                      onSelectDroneContainer={selectGroupedDroneContainer}
                      onFocusDroneChat={focusGroupedDroneChat}
                      onSelectDroneChat={handleGroupedSelectDroneChat}
                      onMoveDronesToGroup={runOptimisticMoveDronesToGroup}
                      onRenameGroup={runOptimisticRenameGroup}
                      onToggleGroupCollapsed={onToggleGroupCollapsed}
                      collapsedDroneSections={collapsedDroneSections}
                      setCollapsedDroneSections={setCollapsedDroneSections}
                      onToggleDroneSection={toggleDroneSection}
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
                      approvalRequiredByChatNodeId={approvalRequiredByChatNodeId}
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
                      onCloneDrone={onCloneDrone}
                      onAddDroneToGroup={openAddDroneToGroup}
                      onCreateGroupBeforeDrone={openGroupDraftBeforeDrone}
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
                      inlineRenameDroneRequest={inlineRenameDroneRequest}
                      onSetDroneBaseImage={onSetDroneBaseImage}
                      pinnedDroneIdSet={pinnedDroneIdSet}
                      pinningDroneIds={pinningDroneIds}
                      onSetDronePinned={setPinned}
                      onDeleteDrone={onDeleteDrone}
                      onOpenDroneErrorModal={onOpenDroneErrorModal}
                      onPrepareDroneDragStart={handleGroupedPrepareDroneDragStart}
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
              </>
            )}
          </div>
        </div>

        {pinnedSidebarPlacement === 'bottom' ? (
          <div
            ref={setPinnedSidebarBottomTarget}
            data-sidebar-pinned-bottom-slot="true"
            className="flex-shrink-0 px-2 [--sidebar-selection-edge-offset:-0.5rem]"
          />
        ) : null}

        {sidebarCapabilities.repoFooter ||
        sidebarCapabilities.sidebarOptions ||
        sidebarCapabilities.collapseControl ? (
          <UiPanelToolbar
            aria-label="Sidebar footer"
            className="border-b-0 border-t border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-1.5"
          >
            {sidebarCapabilities.repoFooter ? (
              <UiToolbarButton
                onClick={onOpenReposModal}
                leadingIcon={<IconFolderGit className="h-3 w-3 text-[var(--accent)] opacity-80" />}
                className="min-w-0 flex-1 justify-start"
                title={`Manage repositories (${repos.length})`}
                aria-label="Manage repositories"
              >
                Repositories {repositoryNavigationItems.length || ''}
              </UiToolbarButton>
            ) : null}
            {sidebarCapabilities.sidebarOptions ? (
              <UiActionMenu
                label="Sidebar options"
                icon={<IconMore className="opacity-85" />}
                entries={sidebarOptionsEntries}
                portal={false}
                onSelect={(id) => {
                  if (id === 'dock-side') toggleSidebarDockSide();
                  else if (id === 'recent') setShowRecentDronesOnly((prev) => !prev);
                  else if (id === 'hidden') setShowHiddenSidebarGroups((prev) => !prev);
                  else if (id === 'delete-confirm') setAutoDelete((prev) => !prev);
                  else if (id === 'auto-minimize') setSidebarAutoMinimize((prev) => !prev);
                }}
                panelClassName="w-[240px]"
              />
            ) : null}
            {sidebarCapabilities.repoFooter ? (
              <UiToolbarIconButton
                onClick={() => setAppView('settings')}
                label="Open settings"
                icon={<IconSettings className="opacity-70" />}
                tone="accent"
                pressed={settingsViewActive}
              />
            ) : null}
            {sidebarCapabilities.collapseControl ? (
              <UiToolbarIconButton
                onClick={collapseSidebarWithGuard}
                label="Collapse sidebar"
                icon={<IconSidebarCollapse className={sidebarDirectionalIconClass} />}
              />
            ) : null}
          </UiPanelToolbar>
        ) : null}
      </aside>

      {addToGroupTarget ? (
        <AddDroneToGroupDialog
          target={addToGroupTarget}
          groups={addToGroupOptions}
          onCreateGroupAndMove={runOptimisticCreateGroupAndMove}
          onMoveToGroup={runOptimisticMoveDronesToGroup}
          onClose={() => setAddToGroupTarget(null)}
        />
      ) : null}

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
        <UiToolbarIconButton
          onClick={() => setSidebarCollapsed(false)}
          label="Expand sidebar"
          icon={<IconSidebarExpand className={sidebarDirectionalIconClass} />}
          tone="accent"
          disabled={!collapsedRailInteractive}
          tabIndex={collapsedRailInteractive ? 0 : -1}
        />
        {sidebarCapabilities.collapsedRailActions && sidebarCapabilities.createDrones ? (
          <UiToolbarIconButton
            onClick={() => {
              setSidebarCollapsed(false);
              openDraftDroneFromSidebarSelection();
            }}
            label="Create drone"
            icon={<IconPlus className="opacity-80" />}
            tone="accent"
            disabled={!collapsedRailInteractive}
            tabIndex={collapsedRailInteractive ? 0 : -1}
          />
        ) : null}
        {sidebarCapabilities.collapsedRailActions &&
        sidebarCapabilities.actions &&
        !repositoryOverviewOpen &&
        !isRepoGroupingMode ? (
          <UiToolbarIconButton
            onClick={() => {
              setSidebarCollapsed(false);
              openGroupDraft();
            }}
            label="Create group"
            icon={<IconFolder className="opacity-80" />}
            tone="accent"
            title="Create group (E)"
            disabled={!collapsedRailInteractive}
            tabIndex={collapsedRailInteractive ? 0 : -1}
          />
        ) : null}
        {sidebarCapabilities.collapsedRailActions && sidebarCapabilities.headerActions ? (
          <UiToolbarIconButton
            onClick={() => {
              setAppView('settings');
            }}
            label="Open settings"
            icon={<IconSettings className="opacity-80" />}
            tone="accent"
            pressed={settingsViewActive}
            disabled={!collapsedRailInteractive}
            tabIndex={collapsedRailInteractive ? 0 : -1}
          />
        ) : null}
      </div>
    </>
  );
}
