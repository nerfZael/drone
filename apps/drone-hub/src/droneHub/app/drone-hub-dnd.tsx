import React from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { createCanvasChatNodeId, createCanvasDroneNodeId } from './app-config';
import type { SidebarGroupOrderKind } from './sidebar-group-order';
import { expandDroneIdsToChatNodeIds, orderChatNodeIdsBySidebar } from '../canvas/chat-node-utils';
import { DroneCard } from '../overview';
import { IconFolder } from './icons';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { sidebarChatNodeId } from '@drone/hub-model/sidebar';

export type SidebarFolderDragData = {
  type: 'sidebar-folder';
  groupId?: string | null;
  folderNodeId: string;
  folderPath: string;
  groupKind: SidebarGroupOrderKind;
  label: string;
};

export type SidebarDragGroupRef = {
  groupId?: string | null;
  group: string;
  kind: SidebarGroupOrderKind;
};

export type SidebarGroupDragData = {
  type: 'sidebar-group';
  groupRef: SidebarDragGroupRef;
  groupLabel: string;
  droneIds: string[];
};

export type SidebarDroneDragData = {
  type: 'sidebar-drone';
  droneId: string;
  droneIds: string[];
  groupOrderKey: string | null;
  label: string;
};

export type SidebarPinnedDroneDragData = {
  type: 'sidebar-pinned-drone';
  droneId: string;
  label: string;
};

export type SidebarChatDragData = {
  type: 'sidebar-chat';
  droneId: string;
  chatName: string;
  nodeId: string;
  chatNames?: string[];
  sidebarNodeIds?: string[];
  label: string;
};

export type SidebarChatFolderDragData = {
  type: 'sidebar-chat-folder';
  droneId: string;
  path: string;
  sidebarNodeId: string;
  label: string;
};

export type DroneHubDragData =
  | SidebarFolderDragData
  | SidebarGroupDragData
  | SidebarDroneDragData
  | SidebarPinnedDroneDragData
  | SidebarChatDragData
  | SidebarChatFolderDragData;

export function resolveSidebarDroneDragIds(args: {
  draggedDroneId: string;
  selectedDroneIds: readonly string[];
  additive: boolean;
}): string[] {
  const draggedDroneId = String(args.draggedDroneId ?? '').trim();
  if (!draggedDroneId) return [];
  const selectedDroneIds = Array.from(
    new Set(args.selectedDroneIds.map((id) => String(id ?? '').trim()).filter(Boolean)),
  );
  if (selectedDroneIds.includes(draggedDroneId)) return selectedDroneIds;
  return args.additive ? [...selectedDroneIds, draggedDroneId] : [draggedDroneId];
}

function dragActivatorUsesAdditiveSelection(event: Event): boolean {
  const modifiers = event as Event & { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
  return Boolean(modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey);
}

const DroneHubActiveDragContext = React.createContext<DroneHubDragData | null>(null);

function isSidebarDragGroupRef(value: unknown): value is SidebarDragGroupRef {
  if (!value || typeof value !== 'object') return false;
  const group = String((value as SidebarDragGroupRef).group ?? '').trim();
  const kind = (value as SidebarDragGroupRef).kind;
  return Boolean(group) && (kind === 'group' || kind === 'repo');
}

export function parseDroneHubDragData(value: unknown): DroneHubDragData | null {
  if (!value || typeof value !== 'object') return null;
  const type = String((value as DroneHubDragData).type ?? '').trim();
  if (type === 'sidebar-folder') {
    const groupIdRaw = (value as SidebarFolderDragData).groupId;
    const groupId = typeof groupIdRaw === 'string' && groupIdRaw.trim()
      ? groupIdRaw.trim()
      : null;
    const folderNodeId = String((value as SidebarFolderDragData).folderNodeId ?? '').trim();
    const folderPath = String((value as SidebarFolderDragData).folderPath ?? '').trim();
    const groupKind = (value as SidebarFolderDragData).groupKind;
    const label = String((value as SidebarFolderDragData).label ?? '').trim();
    if (!folderNodeId || !folderPath || !label) return null;
    if (groupKind !== 'group' && groupKind !== 'repo') return null;
    return { type: 'sidebar-folder', groupId, folderNodeId, folderPath, groupKind, label };
  }
  if (type === 'sidebar-group') {
    const groupRef = (value as SidebarGroupDragData).groupRef;
    const groupLabel = String((value as SidebarGroupDragData).groupLabel ?? '').trim();
    const droneIds = Array.isArray((value as SidebarGroupDragData).droneIds)
      ? (value as SidebarGroupDragData).droneIds
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      : [];
    if (!isSidebarDragGroupRef(groupRef) || !groupLabel) return null;
    return { type: 'sidebar-group', groupRef, groupLabel, droneIds };
  }
  if (type === 'sidebar-drone') {
    const droneId = String((value as SidebarDroneDragData).droneId ?? '').trim();
    const droneIds = Array.isArray((value as SidebarDroneDragData).droneIds)
      ? (value as SidebarDroneDragData).droneIds
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      : [];
    const label = String((value as SidebarDroneDragData).label ?? '').trim();
    const groupOrderKeyRaw = (value as SidebarDroneDragData).groupOrderKey;
    const groupOrderKey =
      typeof groupOrderKeyRaw === 'string' && groupOrderKeyRaw.trim() ? groupOrderKeyRaw.trim() : null;
    if (!droneId || droneIds.length === 0 || !label) return null;
    return { type: 'sidebar-drone', droneId, droneIds, groupOrderKey, label };
  }
  if (type === 'sidebar-pinned-drone') {
    const droneId = String((value as SidebarPinnedDroneDragData).droneId ?? '').trim();
    const label = String((value as SidebarPinnedDroneDragData).label ?? '').trim();
    if (!droneId || !label) return null;
    return { type: 'sidebar-pinned-drone', droneId, label };
  }
  if (type === 'sidebar-chat') {
    const droneId = String((value as SidebarChatDragData).droneId ?? '').trim();
    const chatName = String((value as SidebarChatDragData).chatName ?? '').trim() || 'default';
    const nodeId = String((value as SidebarChatDragData).nodeId ?? '').trim();
    const label = String((value as SidebarChatDragData).label ?? '').trim();
    const rawChatNames = (value as SidebarChatDragData).chatNames;
    const rawSidebarNodeIds = (value as SidebarChatDragData).sidebarNodeIds;
    const chatNames = Array.isArray(rawChatNames)
      ? rawChatNames.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [chatName];
    const sidebarNodeIds = Array.isArray(rawSidebarNodeIds)
      ? rawSidebarNodeIds.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
    if (!droneId || !nodeId || !label) return null;
    return { type: 'sidebar-chat', droneId, chatName, nodeId, chatNames, sidebarNodeIds, label };
  }
  if (type === 'sidebar-chat-folder') {
    const source = value as SidebarChatFolderDragData;
    const droneId = String(source.droneId ?? '').trim();
    const path = String(source.path ?? '').trim();
    const sidebarNodeId = String(source.sidebarNodeId ?? '').trim();
    const label = String(source.label ?? '').trim();
    if (!droneId || !path || !sidebarNodeId || !label) return null;
    return { type: 'sidebar-chat-folder', droneId, path, sidebarNodeId, label };
  }
  return null;
}

export function draggedDroneIdsFromData(data: DroneHubDragData | null): string[] {
  if (!data) return [];
  if (data.type === 'sidebar-folder') return [];
  if (data.type === 'sidebar-chat') return [];
  if (data.type === 'sidebar-chat-folder') return [];
  if (data.type === 'sidebar-pinned-drone') return [];
  return Array.from(new Set(data.droneIds.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

export function draggedCanvasChatNodeIdsFromData(
  data: DroneHubDragData | null,
  sidebarOrderedChatNodeIds: string[],
): string[] {
  if (!data) return [];
  if (data.type === 'sidebar-folder') return [];
  if (data.type === 'sidebar-chat') {
    return (data.chatNames?.length ? data.chatNames : [data.chatName])
      .map((chatName) => createCanvasChatNodeId(data.droneId, chatName));
  }
  if (data.type === 'sidebar-chat-folder') return [];
  if (data.type === 'sidebar-pinned-drone') return [];
  if (data.type === 'sidebar-drone') {
    return orderChatNodeIdsBySidebar(
      expandDroneIdsToChatNodeIds(data.droneIds, sidebarOrderedChatNodeIds),
      sidebarOrderedChatNodeIds,
    );
  }
  return orderChatNodeIdsBySidebar(
    expandDroneIdsToChatNodeIds(data.droneIds, sidebarOrderedChatNodeIds),
    sidebarOrderedChatNodeIds,
  );
}

export function draggedCanvasNodeIdsFromData(data: DroneHubDragData | null): string[] {
  if (!data) return [];
  if (data.type === 'sidebar-chat') {
    return (data.chatNames?.length ? data.chatNames : [data.chatName])
      .map((chatName) => createCanvasChatNodeId(data.droneId, chatName));
  }
  if (data.type === 'sidebar-chat-folder') return [];
  if (data.type === 'sidebar-pinned-drone') {
    const nodeId = createCanvasDroneNodeId(data.droneId);
    return nodeId ? [nodeId] : [];
  }
  if (data.type !== 'sidebar-drone') return [];
  return Array.from(
    new Set(
      data.droneIds
        .map((droneId) => createCanvasDroneNodeId(droneId))
        .filter(Boolean),
    ),
  );
}

function dragPreviewLabel(data: DroneHubDragData): { title: string; detail: string } {
  if (data.type === 'sidebar-folder') {
    return { title: data.label, detail: 'Folder' };
  }
  if (data.type === 'sidebar-chat') {
    const chatNames = data.chatNames?.length ? data.chatNames : [data.chatName];
    return { title: chatNames.length > 1 ? `${chatNames.length} chats` : data.label, detail: 'Chat' };
  }
  if (data.type === 'sidebar-chat-folder') {
    return { title: data.label, detail: 'Chat group' };
  }
  if (data.type === 'sidebar-drone' || data.type === 'sidebar-pinned-drone') {
    const count = data.type === 'sidebar-drone' ? data.droneIds.length : 1;
    return {
      title: count > 1 ? `${count} drones` : data.label,
      detail: count > 1 ? 'Sidebar selection' : 'Drone',
    };
  }
  const count = data.droneIds.length;
  return {
    title: data.groupLabel,
    detail: count > 0 ? `${count} drone${count === 1 ? '' : 's'}` : 'Folder',
  };
}

function ActiveDragPreview({ data }: { data: DroneHubDragData }) {
  if (data.type === 'sidebar-folder' || data.type === 'sidebar-chat-folder') {
    return (
      <div className="pointer-events-none w-[240px] rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--panel-overlay)] px-2 py-1.5 shadow-[0_18px_44px_var(--shadow-color)]">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-dim)] opacity-80" />
          <span className="min-w-0 flex-1 truncate text-[var(--text-11)] font-medium text-[var(--fg-secondary)]">
            {data.label}
          </span>
        </div>
      </div>
    );
  }
  if (data.type === 'sidebar-chat') {
    return (
      <div className="pointer-events-none w-[240px] rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--panel-overlay)] px-2 py-1.5 shadow-[0_18px_44px_var(--shadow-color)]">
        <div className="flex items-center gap-1.5 text-[var(--text-11)] text-[var(--fg-secondary)]">
          <span className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center">
            <span className="h-1.5 w-1.5 rounded-full border border-[var(--muted-dim)] opacity-70" />
          </span>
          <span className="min-w-0 flex-1 truncate [font-family:var(--sidebar-font)]">{data.label}</span>
        </div>
      </div>
    );
  }
  if (data.type === 'sidebar-drone' || data.type === 'sidebar-pinned-drone') {
    const droneIds = data.type === 'sidebar-drone' ? data.droneIds : [data.droneId];
    return (
      <div className="pointer-events-none w-[260px] rounded-[var(--radius-medium)] shadow-[0_18px_44px_var(--shadow-color)]">
        <DroneCard
          drone={{
            id: data.droneId,
            name: data.label,
            createdAt: new Date().toISOString(),
            repoAttached: false,
            repoPath: '',
            group: null,
            containerPort: 0,
            hostPort: null,
            statusOk: true,
            statusError: null,
            chats: ['default'],
            hubPhase: null,
            hubMessage: null,
            busy: false,
          }}
          displayName={droneIds.length > 1 ? `${droneIds.length} drones` : data.label}
          selected={true}
          dragging={false}
          draggable={false}
          onClick={() => {}}
        />
      </div>
    );
  }
  const preview = dragPreviewLabel(data);
  return (
    <div className="pointer-events-none rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--panel-overlay)] px-3 py-2 shadow-[0_18px_44px_var(--shadow-color)]">
      <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">{preview.title}</div>
      <div className="text-[var(--text-10)] text-[var(--muted-dim)]">{preview.detail}</div>
    </div>
  );
}

export function DroneHubDndProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const pointerSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );
  const sensors = enabled ? pointerSensors : [];
  const [activeDrag, setActiveDrag] = React.useState<DroneHubDragData | null>(null);
  const suppressClicksUntilRef = React.useRef(0);

  const clearActiveDrag = React.useCallback(() => {
    setActiveDrag(null);
  }, []);

  const onDragStart = React.useCallback((event: DragStartEvent) => {
    if (!enabled) return;
    let dragData = parseDroneHubDragData(event.active.data.current);
    if (dragData?.type === 'sidebar-drone') {
      const selectedDroneIds = useDroneHubUiStore.getState().selectedDroneIds;
      const draggedWasSelected = selectedDroneIds.includes(dragData.droneId);
      const resolvedDroneIds = resolveSidebarDroneDragIds({
        draggedDroneId: dragData.droneId,
        selectedDroneIds,
        additive: dragActivatorUsesAdditiveSelection(event.activatorEvent),
      });
      const resolvedDroneIdSet = new Set(resolvedDroneIds);
      const initialDroneIds = dragData.droneIds;
      const orderedResolvedDroneIds = draggedWasSelected
        ? [
            ...initialDroneIds.filter((id) => resolvedDroneIdSet.has(id)),
            ...resolvedDroneIds.filter((id) => !initialDroneIds.includes(id)),
          ]
        : resolvedDroneIds;
      dragData = {
        ...dragData,
        droneIds: orderedResolvedDroneIds,
      };
      // DndContext invokes this callback before useDndMonitor subscribers, so
      // update the shared data ref to give every drop handler the resolved set.
      event.active.data.current = dragData;
    }
    setActiveDrag(dragData);
  }, [enabled]);

  const finishDrag = React.useCallback(() => {
    suppressClicksUntilRef.current = Date.now() + 180;
    clearActiveDrag();
  }, [clearActiveDrag]);

  const onDragEnd = React.useCallback((event: DragEndEvent) => {
    void event;
    finishDrag();
  }, [finishDrag]);

  React.useEffect(() => {
    const suppressPostDragClick = (event: MouseEvent) => {
      if (Date.now() >= suppressClicksUntilRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('click', suppressPostDragClick, true);
    return () => window.removeEventListener('click', suppressPostDragClick, true);
  }, []);

  React.useEffect(() => {
    if (!activeDrag) return;
    window.addEventListener('pointerup', clearActiveDrag);
    window.addEventListener('dragend', clearActiveDrag);
    window.addEventListener('drop', clearActiveDrag);
    window.addEventListener('blur', clearActiveDrag);
    return () => {
      window.removeEventListener('pointerup', clearActiveDrag);
      window.removeEventListener('dragend', clearActiveDrag);
      window.removeEventListener('drop', clearActiveDrag);
      window.removeEventListener('blur', clearActiveDrag);
    };
  }, [activeDrag, clearActiveDrag]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={enabled ? onDragStart : undefined}
      onDragCancel={finishDrag}
      onDragEnd={onDragEnd}
    >
      <DroneHubActiveDragContext.Provider value={activeDrag}>
        {children}
        <DragOverlay dropAnimation={null}>
          {activeDrag ? <ActiveDragPreview data={activeDrag} /> : null}
        </DragOverlay>
      </DroneHubActiveDragContext.Provider>
    </DndContext>
  );
}

export function useDroneHubActiveDrag(): DroneHubDragData | null {
  return React.useContext(DroneHubActiveDragContext);
}

export function createSidebarChatDragData(
  droneIdRaw: string,
  chatNameRaw: string,
  label: string,
  selectedChatNames: readonly string[] = [],
): SidebarChatDragData | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const nodeId = createCanvasChatNodeId(droneId, chatName);
  const safeLabel = String(label ?? '').trim();
  const chatNames = [...new Set([...selectedChatNames, chatName].map((item) => String(item ?? '').trim()).filter(Boolean))];
  if (!droneId || !nodeId || !safeLabel) return null;
  return {
    type: 'sidebar-chat',
    droneId,
    chatName,
    nodeId,
    chatNames,
    sidebarNodeIds: chatNames.map((name) => sidebarChatNodeId(droneId, name)),
    label: safeLabel,
  };
}
