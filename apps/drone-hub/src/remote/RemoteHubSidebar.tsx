import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createCanvasChatNodeId } from '../droneHub/app/app-config';
import { DroneSidebar, type DroneSidebarReadOnlyMode } from '../droneHub/app/DroneSidebar';
import { IconPlus } from '../droneHub/app/icons';
import { useDroneHubUiStore } from '../droneHub/app/use-drone-hub-ui-store';
import { useSidebarViewModel } from '../droneHub/app/use-sidebar-view-model';
import type { DroneSummary, RepoSummary } from '../droneHub/types';
import { REMOTE_HUB_CAPABILITIES } from './remote-capabilities';

type RemoteHubSidebarProps = {
  drones: DroneSummary[];
  selectedDroneId: string | null;
  activeChatName: string;
  onSelectDrone: (droneId: string) => void;
  onSelectChat: (chatName: string) => void;
  onOpenCreateDrone?: () => void;
  fillContainer?: boolean;
};

const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_DRONE_SET = new Set<string>();
const NOOP = () => {};
const REMOTE_DRONE_SIDEBAR_CAPABILITIES = {
  actions: REMOTE_HUB_CAPABILITIES.sidebarActions,
  collapsedRailActions: false,
  collapseControl: false,
  createDrones: false,
  dragAndDrop: REMOTE_HUB_CAPABILITIES.sidebarDnd,
  headerActions: false,
  repoFooter: false,
  sidebarOptions: true,
} as const;

function remoteSidebarRepos(drones: DroneSummary[]): RepoSummary[] {
  const paths = Array.from(
    new Set(drones.map((drone) => String(drone.repoPath ?? '').trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  return paths.map((path) => ({ path, addedAt: null, remoteUrl: null, github: null }));
}

function remoteDroneCountByRepoPath(drones: DroneSummary[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const drone of drones) {
    const repoPath = String(drone.repoPath ?? '').trim();
    if (!repoPath) continue;
    out.set(repoPath, (out.get(repoPath) ?? 0) + 1);
  }
  return out;
}

function remoteRegistryGroupNames(drones: DroneSummary[]): string[] {
  return Array.from(
    new Set(drones.map((drone) => String(drone.group ?? '').trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

const REMOTE_SIDEBAR_MODE: DroneSidebarReadOnlyMode = 'static-tree';

function RemoteHubSidebarComponent({
  drones,
  selectedDroneId,
  activeChatName,
  onSelectDrone,
  onSelectChat,
  onOpenCreateDrone,
  fillContainer,
}: RemoteHubSidebarProps) {
  const sidebarState = useDroneHubUiStore(
    useShallow((state) => ({
      activeRepoPath: state.activeRepoPath,
      collapsedGroups: state.collapsedGroups,
      hiddenSidebarGroups: state.hiddenSidebarGroups,
      selectedDroneIds: state.selectedDroneIds,
      setCollapsedGroups: state.setCollapsedGroups,
      setSelectedChat: state.setSelectedChat,
      setSelectedDrone: state.setSelectedDrone,
      setSelectedDroneIds: state.setSelectedDroneIds,
      showRecentDronesOnly: state.showRecentDronesOnly,
      showHiddenSidebarGroups: state.showHiddenSidebarGroups,
      sidebarDroneOrderByGroup: state.sidebarDroneOrderByGroup,
      sidebarGroupOrder: state.sidebarGroupOrder,
    })),
  );
  const { setCollapsedGroups, setSelectedChat, setSelectedDrone, setSelectedDroneIds } =
    sidebarState;

  React.useEffect(() => {
    setSelectedDrone(selectedDroneId);
    setSelectedDroneIds((prev) => {
      if (!selectedDroneId) return prev.length === 0 ? prev : [];
      return prev.length === 1 && prev[0] === selectedDroneId ? prev : [selectedDroneId];
    });
  }, [selectedDroneId, setSelectedDrone, setSelectedDroneIds]);

  React.useEffect(() => {
    setSelectedChat(activeChatName || 'default');
  }, [activeChatName, setSelectedChat]);

  const droneById = React.useMemo(() => {
    const next: Record<string, DroneSummary> = {};
    for (const drone of drones) {
      const droneId = String(drone?.id ?? '').trim();
      if (droneId) next[droneId] = drone;
    }
    return next;
  }, [drones]);

  const repos = React.useMemo(() => remoteSidebarRepos(drones), [drones]);
  const droneCountByRepoPath = React.useMemo(() => remoteDroneCountByRepoPath(drones), [drones]);
  const registryGroupNames = React.useMemo(() => remoteRegistryGroupNames(drones), [drones]);
  const registeredRepoPaths = React.useMemo(() => repos.map((repo) => repo.path), [repos]);
  const busyChatNodeIdSet = React.useMemo(() => {
    const next = new Set<string>();
    for (const drone of drones) {
      for (const chatName of drone.busyChats ?? []) {
        const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
        if (chatNodeId) next.add(chatNodeId);
      }
    }
    return next;
  }, [drones]);

  const viewModel = useSidebarViewModel({
    selectedDroneIds: sidebarState.selectedDroneIds,
    viewMode: 'grouped',
    sidebarGroupingMode: 'repos',
    collapsedGroups: sidebarState.collapsedGroups,
    deletingGroups: EMPTY_RECORD,
    sidebarGroupOrder: sidebarState.sidebarGroupOrder,
    sidebarDroneOrderByGroup: sidebarState.sidebarDroneOrderByGroup,
    hiddenSidebarGroups: sidebarState.hiddenSidebarGroups,
    showHiddenSidebarGroups: sidebarState.showHiddenSidebarGroups,
    drones,
    startupSeedByDrone: EMPTY_RECORD,
    optimisticallyDeletedDrones: EMPTY_RECORD,
    activeRepoPath: sidebarState.activeRepoPath,
    showRecentDronesOnly: sidebarState.showRecentDronesOnly,
    registryGroupNames,
    registeredRepoPaths,
  });

  const selectDroneCard = React.useCallback(
    (droneId: string) => {
      const drone = droneById[droneId];
      onSelectDrone(droneId);
      setSelectedDrone(droneId);
      setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === droneId ? prev : [droneId]));
      const chats =
        Array.isArray(drone?.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
      const nextChat = chats.includes(activeChatName) ? activeChatName : (chats[0] ?? 'default');
      onSelectChat(nextChat);
      setSelectedChat(nextChat);
    },
    [
      activeChatName,
      droneById,
      onSelectChat,
      onSelectDrone,
      setSelectedChat,
      setSelectedDrone,
      setSelectedDroneIds,
    ],
  );

  const selectDroneChat = React.useCallback(
    (droneId: string, chatName: string) => {
      onSelectDrone(droneId);
      onSelectChat(chatName);
      setSelectedDrone(droneId);
      setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === droneId ? prev : [droneId]));
      setSelectedChat(chatName);
    },
    [onSelectChat, onSelectDrone, setSelectedChat, setSelectedDrone, setSelectedDroneIds],
  );

  const toggleGroupCollapsed = React.useCallback(
    (group: string) => {
      const groupKey = String(group ?? '').trim();
      if (!groupKey) return;
      setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
    },
    [setCollapsedGroups],
  );

  const noopDeleteChat = React.useCallback(
    async () => ({ ok: false, error: 'Remote Hub cannot delete chats.' }),
    [],
  );
  const noopCreateChat = React.useCallback(
    async () => ({ ok: false, error: 'Remote Hub cannot create chats.' }),
    [],
  );
  const noopRenameChat = React.useCallback(
    async () => ({ ok: false, error: 'Remote Hub cannot rename chats.' }),
    [],
  );
  const noopReparent = React.useCallback(
    async () => ({ ok: false, error: 'Remote Hub cannot move drones.' }),
    [],
  );
  const noopMoveGroup = React.useCallback(
    async () => ({ ok: false, error: 'Remote Hub cannot move drones.' }),
    [],
  );
  const noopCreateGroup = React.useCallback(
    async () => ({ ok: false, error: 'Remote Hub cannot create groups.' }),
    [],
  );
  const noopBool = React.useCallback(() => false, []);
  const openDroneError = React.useCallback((drone: DroneSummary, message: string) => {
    window.alert(`${drone.name}: ${message}`);
  }, []);
  const headerAccessory = onOpenCreateDrone ? (
    <button
      type="button"
      onClick={onOpenCreateDrone}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
      title="Create new drone"
      aria-label="Create new drone"
    >
      <IconPlus className="opacity-80" />
    </button>
  ) : null;

  return (
    <DroneSidebar
      dronesError={null}
      groupMoveError={null}
      dronesLoading={false}
      sidebarDronesFilteredByRepo={viewModel.sidebarDronesFilteredByRepo}
      sidebarVisibleDrones={viewModel.sidebarVisibleDrones}
      sidebarDrones={viewModel.sidebarDrones}
      sidebarOptimisticDroneIdSet={EMPTY_DRONE_SET}
      selectedDroneSet={viewModel.selectedDroneSet}
      busyChatNodeIdSet={busyChatNodeIdSet}
      unreadAgentMessageByChatNodeId={EMPTY_RECORD}
      deletingDrones={EMPTY_RECORD}
      renamingDrones={EMPTY_RECORD}
      settingBaseImages={EMPTY_RECORD}
      movingDroneGroups={false}
      sidebarGroups={viewModel.sidebarGroups}
      sidebarHiddenGroupCount={viewModel.sidebarHiddenGroupCount}
      collapsedGroups={sidebarState.collapsedGroups}
      deletingGroups={EMPTY_RECORD}
      renamingGroups={EMPTY_RECORD}
      sidebarHasUngroupedGroup={viewModel.sidebarHasUngroupedGroup}
      repos={repos}
      reposLoading={false}
      reposError={null}
      dronesCount={drones.length}
      droneCountByRepoPath={droneCountByRepoPath}
      uiDroneName={viewModel.uiDroneName}
      draftSidebarPlaceholder={null}
      onOpenDraftChatComposer={NOOP}
      onOpenCreateModal={NOOP}
      onOpenKanbanBoard={NOOP}
      onOpenPlaybookRuns={NOOP}
      onSelectDroneCard={selectDroneCard}
      onSelectDroneChat={selectDroneChat}
      onDeleteDroneChat={noopDeleteChat}
      onOpenCloneModal={NOOP}
      onCreateDroneChat={noopCreateChat}
      onRenameDroneChat={noopRenameChat}
      onRenameDrone={NOOP}
      onSetDroneBaseImage={NOOP}
      onDeleteDrone={NOOP}
      onOpenDroneErrorModal={openDroneError}
      onReparentDronesToParent={noopReparent}
      onMoveDronesToGroup={noopMoveGroup}
      onCreateGroup={noopCreateGroup}
      onCreateGroupAndMove={noopMoveGroup}
      onToggleGroupCollapsed={toggleGroupCollapsed}
      onRenameGroup={noopBool}
      onOpenGroupMultiChat={NOOP}
      onOpenVisibleMultiChat={NOOP}
      onDeleteGroup={noopBool}
      onPrepareDroneDragStart={NOOP}
      onOpenReposModal={NOOP}
      capabilities={REMOTE_DRONE_SIDEBAR_CAPABILITIES}
      sidebarGroupingModeOverride="repos"
      viewModeOverride="grouped"
      fillContainer={fillContainer}
      readOnlyMode={REMOTE_SIDEBAR_MODE}
      headerAccessory={headerAccessory}
    />
  );
}

export const RemoteHubSidebar = React.memo(RemoteHubSidebarComponent);
