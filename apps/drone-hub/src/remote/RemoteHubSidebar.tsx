import React from 'react';
import { createCanvasChatNodeId } from '../droneHub/app/app-config';
import { SidebarDroneTreeList } from '../droneHub/app/SidebarDroneTreeList';
import { buildSidebarDroneTree } from '../droneHub/app/sidebar-drone-tree';
import type { DroneSummary } from '../droneHub/types';
import { REMOTE_HUB_CAPABILITIES } from './remote-capabilities';

type RemoteHubSidebarProps = {
  drones: DroneSummary[];
  selectedDroneId: string | null;
  activeChatName: string;
  onSelectDrone: (droneId: string) => void;
  onSelectChat: (chatName: string) => void;
};

const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_DRONE_SET = new Set<string>();

export function RemoteHubSidebar({
  drones,
  selectedDroneId,
  activeChatName,
  onSelectDrone,
  onSelectChat,
}: RemoteHubSidebarProps) {
  const [collapsedDroneSections, setCollapsedDroneSections] = React.useState<Record<string, boolean>>({});

  const droneById = React.useMemo(() => {
    const next: Record<string, DroneSummary> = {};
    for (const drone of drones) {
      const droneId = String(drone?.id ?? '').trim();
      if (droneId) next[droneId] = drone;
    }
    return next;
  }, [drones]);

  const tree = React.useMemo(() => buildSidebarDroneTree(drones), [drones]);
  const selectedDroneIds = React.useMemo(() => (selectedDroneId ? [selectedDroneId] : []), [selectedDroneId]);
  const selectedDroneSet = React.useMemo(() => new Set(selectedDroneIds), [selectedDroneIds]);
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

  const selectDroneCard = React.useCallback(
    (droneId: string) => {
      const drone = droneById[droneId];
      onSelectDrone(droneId);
      const chats = Array.isArray(drone?.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
      if (!chats.includes(activeChatName)) onSelectChat(chats[0] ?? 'default');
    },
    [activeChatName, droneById, onSelectChat, onSelectDrone],
  );

  const selectDroneChat = React.useCallback(
    (droneId: string, chatName: string) => {
      onSelectDrone(droneId);
      onSelectChat(chatName);
    },
    [onSelectChat, onSelectDrone],
  );

  const noop = React.useCallback(() => {}, []);
  const noopDeleteChat = React.useCallback(async () => ({ ok: false, error: 'Remote Hub cannot delete chats.' }), []);
  const noopCreateChat = React.useCallback(async () => ({ ok: false, error: 'Remote Hub cannot create chats.' }), []);
  const noopRenameChat = React.useCallback(async () => ({ ok: false, error: 'Remote Hub cannot rename chats.' }), []);
  const noopReparent = React.useCallback(async () => ({ ok: false, error: 'Remote Hub cannot move drones.' }), []);
  const openDroneError = React.useCallback((drone: DroneSummary, message: string) => {
    window.alert(`${drone.name}: ${message}`);
  }, []);

  if (drones.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-[var(--muted)]">No container drones available.</div>;
  }

  return (
    <SidebarDroneTreeList
      droneById={droneById}
      tree={tree}
      sidebarDensityMode="default"
      draftSidebarPlaceholderId=""
      selectedDroneIds={selectedDroneIds}
      selectedDroneSet={selectedDroneSet}
      selectedDrone={selectedDroneId}
      activeChatName={activeChatName}
      busyChatNodeIdSet={busyChatNodeIdSet}
      unreadAgentMessageByChatNodeId={EMPTY_RECORD}
      deletingDrones={EMPTY_RECORD}
      renamingDrones={EMPTY_RECORD}
      settingBaseImages={EMPTY_RECORD}
      movingDroneGroups={false}
      sidebarDndEnabled={REMOTE_HUB_CAPABILITIES.sidebarDnd}
      sidebarOptimisticDroneIdSet={EMPTY_DRONE_SET}
      collapsedDroneSections={collapsedDroneSections}
      setCollapsedDroneSections={setCollapsedDroneSections}
      uiDroneName={(name) => name}
      onToggleSection={noop}
      onSelectDroneCard={selectDroneCard}
      onSelectDroneChat={selectDroneChat}
      onDeleteDroneChat={noopDeleteChat}
      onOpenCloneModal={noop}
      onCreateDroneChat={noopCreateChat}
      onRenameDroneChat={noopRenameChat}
      onRenameDrone={noop}
      onSetDroneBaseImage={noop}
      onDeleteDrone={noop}
      onOpenDroneErrorModal={openDroneError}
      onPrepareDroneDragStart={noop}
      onReparentDronesToParent={noopReparent}
      groupOrderKey="remote"
      groupName={null}
      showGroup
      actionsEnabled={REMOTE_HUB_CAPABILITIES.sidebarActions}
    />
  );
}
