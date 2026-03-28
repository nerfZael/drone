import React from 'react';
import { useDndMonitor, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { DroneCard } from '../overview';
import { TypingDots } from '../overview/icons';
import type { DroneSummary } from '../types';
import { createCanvasChatNodeId } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import { isDroneStartingOrSeeding } from './helpers';
import { IconSpinner, IconTrash } from './icons';
import {
  createSidebarChatDragData,
  parseDroneHubDragData,
  type SidebarDroneDragData,
} from './drone-hub-dnd';
import {
  orderSidebarEntries,
  reorderSidebarEntryOrder,
  type SidebarGroupDropPlacement,
} from './sidebar-group-order';
import {
  sidebarDropPlacementFromRects,
  SidebarReorderDropIndicator,
} from './sidebar-reorder-ui';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';
import type { SidebarDroneTree } from './sidebar-drone-tree';

export type SidebarInlineSectionKind = 'chats' | 'children';

export function sidebarInlineSectionKey(droneIdRaw: string, kind: SidebarInlineSectionKind): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `${kind}:${droneId}`;
}

export type SidebarDroneTreeListProps = {
  droneById: Record<string, DroneSummary>;
  tree: SidebarDroneTree;
  draftSidebarPlaceholderId: string;
  selectedDroneIds: string[];
  selectedDroneSet: Set<string>;
  selectedDrone: string | null;
  activeChatName: string;
  busyChatNodeIdSet: Set<string>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  deletingDrones: Record<string, boolean>;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarOptimisticDroneIdSet: Set<string>;
  collapsedDroneSections: Record<string, boolean>;
  uiDroneName: (nameRaw: string) => string;
  onToggleSection: (droneId: string, kind: SidebarInlineSectionKind) => void;
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
  onPrepareDroneDragStart: (droneId: string) => void;
  groupOrderKey?: string | null;
  groupName?: string | null;
  showGroup?: boolean;
};

type SidebarDroneRowProps = {
  drone: DroneSummary;
  selectedDroneIds: string[];
  selectedDroneSet: Set<string>;
  deletingDrones: Record<string, boolean>;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarOptimisticDroneIdSet: Set<string>;
  busy: boolean;
  unread: boolean;
  showGroup?: boolean;
  groupOrderKey?: string | null;
  groupName?: string | null;
  dragOverPlacement: SidebarGroupDropPlacement | null;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneCard: (droneId: string, opts?: { toggle?: boolean; range?: boolean }) => void;
  onOpenCloneModal: (drone: DroneSummary) => void;
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
};

type SidebarChatRowProps = {
  drone: DroneSummary;
  chatName: string;
  selected: boolean;
  unread: boolean;
  busy: boolean;
  deleting: boolean;
  canDelete: boolean;
  movingDroneGroups: boolean;
  isOptimistic: boolean;
  dragOverPlacement: SidebarGroupDropPlacement | null;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onDeleteChatClick: (droneId: string, chatName: string) => void;
};

type SidebarDroneNodeProps = SidebarDroneTreeListProps & {
  droneId: string;
  ancestorDroneIds?: Set<string>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  dragOverDrone: { droneId: string; placement: SidebarGroupDropPlacement } | null;
  dragOverChat: { key: string; placement: SidebarGroupDropPlacement } | null;
  deletingChats: Record<string, boolean>;
  onDeleteChatClick: (droneId: string, chatName: string) => void;
};

const EMPTY_CHAT_ORDER: string[] = [];

function flattenSidebarTreeOrder(tree: SidebarDroneTree): string[] {
  const out: string[] = [];
  const visit = (droneId: string) => {
    const id = String(droneId ?? '').trim();
    if (!id || out.includes(id)) return;
    out.push(id);
    for (const childId of tree.childDroneIdsByParentId[id] ?? []) visit(childId);
  };
  for (const rootId of tree.rootDroneIds) visit(rootId);
  return out;
}

function createDroneReorderDropId(groupOrderKeyRaw: string, droneIdRaw: string): string {
  const groupOrderKey = String(groupOrderKeyRaw ?? '').trim() || 'root';
  const droneId = String(droneIdRaw ?? '').trim();
  return `sidebar-drone-reorder:${groupOrderKey}:${droneId}`;
}

function createChatReorderDropId(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `sidebar-chat-reorder:${droneId}:${chatName}`;
}

function currentPlacementFromEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
): SidebarGroupDropPlacement {
  return sidebarDropPlacementFromRects(
    event.active.rect.current.translated ?? event.active.rect.current.initial,
    event.over?.rect ?? null,
  );
}

function SidebarDroneRow({
  drone,
  selectedDroneIds,
  selectedDroneSet,
  deletingDrones,
  renamingDrones,
  settingBaseImages,
  movingDroneGroups,
  sidebarOptimisticDroneIdSet,
  busy,
  unread,
  showGroup,
  groupOrderKey,
  groupName,
  dragOverPlacement,
  uiDroneName,
  onSelectDroneCard,
  onOpenCloneModal,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
}: SidebarDroneRowProps) {
  const isOptimistic = sidebarOptimisticDroneIdSet.has(drone.id);
  const dragDisabled = movingDroneGroups || isOptimistic;
  const selectedDragDroneIds =
    selectedDroneSet.has(drone.id) && selectedDroneIds.length > 0 ? selectedDroneIds.slice() : [drone.id];
  const dragData = React.useMemo<SidebarDroneDragData>(
    () => ({
      type: 'sidebar-drone',
      droneId: drone.id,
      droneIds: selectedDragDroneIds,
      groupOrderKey: groupOrderKey ?? null,
      label: uiDroneName(drone.name),
    }),
    [drone.id, drone.name, groupOrderKey, selectedDragDroneIds, uiDroneName],
  );
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-drone:${drone.id}`,
    data: dragData,
    disabled: dragDisabled,
  });
  const { setNodeRef } = useDroppable({
    id: groupOrderKey ? createDroneReorderDropId(groupOrderKey, drone.id) : `sidebar-drone-static:${drone.id}`,
    data: groupOrderKey
      ? {
          type: 'sidebar-drone-reorder',
          droneId: drone.id,
          groupOrderKey,
          groupName: groupName ?? null,
        }
      : undefined,
    disabled: !groupOrderKey || dragDisabled,
  });

  return (
    <div className="relative flex items-stretch gap-1" ref={setNodeRef}>
      {dragOverPlacement ? <SidebarReorderDropIndicator placement={dragOverPlacement} /> : null}
      <div className="min-w-0 flex-1">
        <DroneCard
          drone={drone}
          displayName={uiDroneName(drone.name)}
          statusHint={isOptimistic ? 'queued' : undefined}
          selected={selectedDroneSet.has(drone.id)}
          busy={busy}
          unreadAgentMessage={unread}
          showGroup={showGroup}
          onClick={(rowOpts) => onSelectDroneCard(drone.id, rowOpts)}
          dragNodeRef={setDragNodeRef}
          draggable={!dragDisabled}
          dragging={isDragging}
          dragAttributes={attributes as unknown as Record<string, unknown>}
          dragListeners={listeners as unknown as Record<string, unknown>}
          onClone={() => onOpenCloneModal(drone)}
          onRename={() => onRenameDrone(drone.id)}
          onSetBaseImage={() => onSetDroneBaseImage(drone.id)}
          onDelete={() => onDeleteDrone(drone.id)}
          onErrorClick={onOpenDroneErrorModal}
          cloneDisabled={
            isOptimistic ||
            Boolean(deletingDrones[drone.id]) ||
            Boolean(renamingDrones[drone.id]) ||
            Boolean(settingBaseImages[drone.id]) ||
            String(drone.runtime ?? 'container').trim().toLowerCase() === 'host'
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
  );
}

function SidebarChatRow({
  drone,
  chatName,
  selected,
  unread,
  busy,
  deleting,
  canDelete,
  movingDroneGroups,
  isOptimistic,
  dragOverPlacement,
  uiDroneName,
  onSelectDroneChat,
  onDeleteChatClick,
}: SidebarChatRowProps) {
  const chatKey = `${drone.id}:${chatName}`;
  const chatDragData = React.useMemo(
    () => createSidebarChatDragData(drone.id, chatName, `${uiDroneName(drone.name)} / ${chatName}`),
    [chatName, drone.id, drone.name, uiDroneName],
  );
  const { attributes, listeners, isDragging, setNodeRef: setDragNodeRef } = useDraggable({
    id: `sidebar-chat:${chatKey}`,
    data: chatDragData ?? undefined,
    disabled: !chatDragData || movingDroneGroups || isOptimistic,
  });
  const { setNodeRef } = useDroppable({
    id: createChatReorderDropId(drone.id, chatName),
    data: {
      type: 'sidebar-chat-reorder',
      droneId: drone.id,
      chatName,
    },
    disabled: movingDroneGroups || isOptimistic,
  });

  return (
    <div key={chatKey} ref={setNodeRef} className="relative flex items-stretch gap-1 group/chat-row">
      {dragOverPlacement ? <SidebarReorderDropIndicator placement={dragOverPlacement} /> : null}
      <button
        ref={setDragNodeRef}
        type="button"
        {...(attributes as unknown as Record<string, unknown>)}
        {...(listeners as unknown as Record<string, unknown>)}
        onClick={(event) => {
          event.stopPropagation();
          onSelectDroneChat(drone.id, chatName);
        }}
        className={`flex-1 h-7 rounded border px-2 text-left text-[11px] transition-all flex items-center gap-1.5 min-w-0 ${
          selected
            ? 'border-[var(--accent-muted)] bg-[var(--selected)] text-[var(--fg)]'
            : 'border-transparent text-[var(--muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
        } ${movingDroneGroups || isOptimistic ? '' : 'cursor-grab touch-none active:cursor-grabbing'} ${
          isDragging ? 'opacity-35' : ''
        }`}
        title={`${uiDroneName(drone.name)} / ${chatName}`}
      >
        {!busy && unread ? (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--yellow)] flex-shrink-0" />
        ) : (
          <span className="h-1.5 w-1.5 flex-shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono">
          {chatName}
        </span>
        {busy ? (
          <span className="inline-flex items-center flex-shrink-0" title="Agent responding">
            <TypingDots color="var(--yellow)" />
          </span>
        ) : null}
      </button>
      {canDelete ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteChatClick(drone.id, chatName);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          disabled={deleting}
          className={`inline-flex w-7 flex-shrink-0 items-center justify-center rounded border transition-all ${
            deleting
              ? 'bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
              : 'opacity-0 pointer-events-none group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
          }`}
          title={`Delete chat "${chatName}"`}
          aria-label={`Delete chat "${chatName}"`}
        >
          {deleting ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
        </button>
      ) : (
        <span className="w-7 flex-shrink-0" />
      )}
    </div>
  );
}

function SidebarDroneNode({
  droneById,
  tree,
  draftSidebarPlaceholderId,
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
  onToggleSection,
  onSelectDroneCard,
  onSelectDroneChat,
  onDeleteDroneChat,
  onOpenCloneModal,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
  onPrepareDroneDragStart,
  groupOrderKey,
  groupName,
  showGroup,
  droneId,
  ancestorDroneIds,
  sidebarChatOrderByDrone,
  dragOverDrone,
  dragOverChat,
  deletingChats,
  onDeleteChatClick,
}: SidebarDroneNodeProps) {
  if (ancestorDroneIds?.has(droneId)) return null;
  const drone = droneById[droneId];
  if (!drone) return null;
  const nextAncestorDroneIds = new Set(ancestorDroneIds ?? []);
  nextAncestorDroneIds.add(droneId);
  void onDeleteDroneChat;

  if (drone.id === draftSidebarPlaceholderId) {
    return (
      <div key={drone.id} className="w-full text-left px-3 h-8 flex items-center rounded-md border bg-[var(--selected)] border-[var(--accent-muted)] relative">
        <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-[var(--fg)]" title={`${drone.name} · pending draft`}>
            {drone.name}
          </span>
          <span
            className="flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1 py-0.5 text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]"
            style={{ fontFamily: 'var(--display)' }}
            title="Draft"
          >
            draft
          </span>
        </div>
      </div>
    );
  }

  const isOptimistic = sidebarOptimisticDroneIdSet.has(drone.id);
  const chats = orderSidebarEntries(
    normalizedDroneChats(drone),
    sidebarChatOrderByDrone[drone.id] ?? EMPTY_CHAT_ORDER,
    (chat) => chat,
  );
  const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
  const hasChatSection = chats.length > 0 && !hasOnlyDefaultChat;
  const childDroneIds = tree.childDroneIdsByParentId[drone.id] ?? [];
  const hasChildrenSection = childDroneIds.length > 0;
  const defaultChatNodeId = createCanvasChatNodeId(drone.id, 'default');
  const showDroneBusy =
    !isDroneStartingOrSeeding(drone.hubPhase) &&
    hasOnlyDefaultChat &&
    Boolean(defaultChatNodeId && busyChatNodeIdSet.has(defaultChatNodeId));
  const showDroneUnread =
    hasOnlyDefaultChat &&
    Boolean(defaultChatNodeId && unreadAgentMessageByChatNodeId[defaultChatNodeId] === true);

  return (
    <div key={drone.id} className="flex flex-col gap-0.5">
      <SidebarDroneRow
        drone={drone}
        selectedDroneIds={selectedDroneIds}
        selectedDroneSet={selectedDroneSet}
        deletingDrones={deletingDrones}
        renamingDrones={renamingDrones}
        settingBaseImages={settingBaseImages}
        movingDroneGroups={movingDroneGroups}
        sidebarOptimisticDroneIdSet={sidebarOptimisticDroneIdSet}
        busy={showDroneBusy}
        unread={showDroneUnread}
        showGroup={showGroup}
        groupOrderKey={groupOrderKey}
        groupName={groupName}
        dragOverPlacement={dragOverDrone?.droneId === drone.id ? dragOverDrone.placement : null}
        uiDroneName={uiDroneName}
        onSelectDroneCard={onSelectDroneCard}
        onOpenCloneModal={onOpenCloneModal}
        onRenameDrone={onRenameDrone}
        onSetDroneBaseImage={onSetDroneBaseImage}
        onDeleteDrone={onDeleteDrone}
        onOpenDroneErrorModal={onOpenDroneErrorModal}
      />
      {hasChatSection ? (
        <div className="ml-5 mr-1 flex flex-col gap-0.5">
          {chats.map((chatName) => {
            const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
            if (!chatNodeId) return null;
            const chatKey = `${drone.id}:${chatName}`;
            return (
              <SidebarChatRow
                key={chatKey}
                drone={drone}
                chatName={chatName}
                selected={selectedDrone === drone.id && activeChatName === chatName}
                unread={unreadAgentMessageByChatNodeId[chatNodeId] === true}
                busy={busyChatNodeIdSet.has(chatNodeId)}
                deleting={Boolean(deletingChats[chatKey])}
                canDelete={chatName !== 'default'}
                movingDroneGroups={movingDroneGroups}
                isOptimistic={isOptimistic}
                dragOverPlacement={dragOverChat?.key === chatKey ? dragOverChat.placement : null}
                uiDroneName={uiDroneName}
                onSelectDroneChat={onSelectDroneChat}
                onDeleteChatClick={onDeleteChatClick}
              />
            );
          })}
        </div>
      ) : null}
      {hasChildrenSection ? (
        <div className="ml-5 mr-1 flex flex-col gap-0.5">
          {childDroneIds.map((childDroneId) => (
            <SidebarDroneNode
              key={childDroneId}
              droneId={childDroneId}
              ancestorDroneIds={nextAncestorDroneIds}
              droneById={droneById}
              tree={tree}
              draftSidebarPlaceholderId={draftSidebarPlaceholderId}
              selectedDroneIds={selectedDroneIds}
              selectedDroneSet={selectedDroneSet}
              selectedDrone={selectedDrone}
              activeChatName={activeChatName}
              busyChatNodeIdSet={busyChatNodeIdSet}
              unreadAgentMessageByChatNodeId={unreadAgentMessageByChatNodeId}
              deletingDrones={deletingDrones}
              renamingDrones={renamingDrones}
              settingBaseImages={settingBaseImages}
              movingDroneGroups={movingDroneGroups}
              sidebarOptimisticDroneIdSet={sidebarOptimisticDroneIdSet}
              collapsedDroneSections={collapsedDroneSections}
              uiDroneName={uiDroneName}
              onToggleSection={onToggleSection}
              onSelectDroneCard={onSelectDroneCard}
              onSelectDroneChat={onSelectDroneChat}
              onDeleteDroneChat={onDeleteDroneChat}
              onOpenCloneModal={onOpenCloneModal}
              onRenameDrone={onRenameDrone}
              onSetDroneBaseImage={onSetDroneBaseImage}
              onDeleteDrone={onDeleteDrone}
              onOpenDroneErrorModal={onOpenDroneErrorModal}
              onPrepareDroneDragStart={onPrepareDroneDragStart}
              groupOrderKey={groupOrderKey}
              groupName={groupName}
              showGroup={showGroup}
              sidebarChatOrderByDrone={sidebarChatOrderByDrone}
              dragOverDrone={dragOverDrone}
              dragOverChat={dragOverChat}
              deletingChats={deletingChats}
              onDeleteChatClick={onDeleteChatClick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarDroneTreeList({
  droneById,
  tree,
  draftSidebarPlaceholderId,
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
  onToggleSection,
  onSelectDroneCard,
  onSelectDroneChat,
  onDeleteDroneChat,
  onOpenCloneModal,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
  onPrepareDroneDragStart,
  groupOrderKey,
  groupName,
  showGroup,
}: SidebarDroneTreeListProps) {
  const {
    sidebarChatOrderByDrone,
    setSidebarDroneOrderByGroup,
    setSidebarChatOrderByDrone,
  } = useDroneSidebarUiState();
  const [dragOverDrone, setDragOverDrone] = React.useState<{
    droneId: string;
    placement: SidebarGroupDropPlacement;
  } | null>(null);
  const [dragOverChat, setDragOverChat] = React.useState<{
    key: string;
    placement: SidebarGroupDropPlacement;
  } | null>(null);
  const [deletingChats, setDeletingChats] = React.useState<Record<string, boolean>>({});
  const visibleDroneOrder = React.useMemo(() => flattenSidebarTreeOrder(tree), [tree]);

  const clearDragOverState = React.useCallback(() => {
    setDragOverDrone(null);
    setDragOverChat(null);
  }, []);

  const onDeleteChatClick = React.useCallback(
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
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [deletingChats, onDeleteDroneChat],
  );

  const updateDragOverState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const active = parseDroneHubDragData(event.active.data.current);
      const overData = event.over?.data.current;
      if (
        active?.type === 'sidebar-drone' &&
        groupOrderKey &&
        active.groupOrderKey === groupOrderKey &&
        overData?.type === 'sidebar-drone-reorder'
      ) {
        const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
        const overGroupOrderKey = String((overData as { groupOrderKey?: unknown }).groupOrderKey ?? '').trim();
        if (overDroneId && overGroupOrderKey === groupOrderKey && active.droneId !== overDroneId) {
          setDragOverChat(null);
          setDragOverDrone({
            droneId: overDroneId,
            placement: currentPlacementFromEvent(event),
          });
          return;
        }
      }

      if (active?.type === 'sidebar-chat' && overData?.type === 'sidebar-chat-reorder') {
        const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
        const overChatName = String((overData as { chatName?: unknown }).chatName ?? '').trim() || 'default';
        if (
          overDroneId &&
          overDroneId === active.droneId &&
          overChatName &&
          overChatName !== active.chatName
        ) {
          setDragOverDrone(null);
          setDragOverChat({
            key: `${overDroneId}:${overChatName}`,
            placement: currentPlacementFromEvent(event),
          });
          return;
        }
      }

      clearDragOverState();
    },
    [clearDragOverState, groupOrderKey],
  );

  useDndMonitor({
    onDragStart: (event) => {
      const active = parseDroneHubDragData(event.active.data.current);
      if (active?.type === 'sidebar-drone' && visibleDroneOrder.includes(active.droneId)) {
        onPrepareDroneDragStart(active.droneId);
      }
    },
    onDragMove: updateDragOverState,
    onDragOver: updateDragOverState,
    onDragCancel: clearDragOverState,
    onDragEnd: (event) => {
      const active = parseDroneHubDragData(event.active.data.current);
      const overData = event.over?.data.current;

      if (
        active?.type === 'sidebar-drone' &&
        groupOrderKey &&
        active.groupOrderKey === groupOrderKey &&
        overData?.type === 'sidebar-drone-reorder'
      ) {
        const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
        const overGroupOrderKey = String((overData as { groupOrderKey?: unknown }).groupOrderKey ?? '').trim();
        if (overDroneId && overGroupOrderKey === groupOrderKey && active.droneId !== overDroneId) {
          const placement =
            dragOverDrone?.droneId === overDroneId ? dragOverDrone.placement : currentPlacementFromEvent(event);
          setSidebarDroneOrderByGroup((prev) => ({
            ...prev,
            [groupOrderKey]: reorderSidebarEntryOrder(
              prev[groupOrderKey] ?? [],
              visibleDroneOrder,
              active.droneId,
              overDroneId,
              placement,
            ),
          }));
        }
      }

      if (active?.type === 'sidebar-chat' && overData?.type === 'sidebar-chat-reorder') {
        const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
        const overChatName = String((overData as { chatName?: unknown }).chatName ?? '').trim() || 'default';
        if (overDroneId === active.droneId && overChatName && overChatName !== active.chatName) {
          const placement =
            dragOverChat?.key === `${overDroneId}:${overChatName}`
              ? dragOverChat.placement
              : currentPlacementFromEvent(event);
          const currentChats = orderSidebarEntries(
            normalizedDroneChats(droneById[active.droneId]),
            sidebarChatOrderByDrone[active.droneId] ?? EMPTY_CHAT_ORDER,
            (chat) => chat,
          );
          setSidebarChatOrderByDrone((prev) => ({
            ...prev,
            [active.droneId]: reorderSidebarEntryOrder(
              prev[active.droneId] ?? [],
              currentChats,
              active.chatName,
              overChatName,
              placement,
            ),
          }));
        }
      }

      clearDragOverState();
    },
  });

  return (
    <>
      {tree.rootDroneIds.map((droneId) => (
        <SidebarDroneNode
          key={droneId}
          droneId={droneId}
          droneById={droneById}
          tree={tree}
          draftSidebarPlaceholderId={draftSidebarPlaceholderId}
          selectedDroneIds={selectedDroneIds}
          selectedDroneSet={selectedDroneSet}
          selectedDrone={selectedDrone}
          activeChatName={activeChatName}
          busyChatNodeIdSet={busyChatNodeIdSet}
          unreadAgentMessageByChatNodeId={unreadAgentMessageByChatNodeId}
          deletingDrones={deletingDrones}
          renamingDrones={renamingDrones}
          settingBaseImages={settingBaseImages}
          movingDroneGroups={movingDroneGroups}
          sidebarOptimisticDroneIdSet={sidebarOptimisticDroneIdSet}
          collapsedDroneSections={collapsedDroneSections}
          uiDroneName={uiDroneName}
          onToggleSection={onToggleSection}
          onSelectDroneCard={onSelectDroneCard}
          onSelectDroneChat={onSelectDroneChat}
          onDeleteDroneChat={onDeleteDroneChat}
          onOpenCloneModal={onOpenCloneModal}
          onRenameDrone={onRenameDrone}
          onSetDroneBaseImage={onSetDroneBaseImage}
          onDeleteDrone={onDeleteDrone}
          onOpenDroneErrorModal={onOpenDroneErrorModal}
          onPrepareDroneDragStart={onPrepareDroneDragStart}
          groupOrderKey={groupOrderKey}
          groupName={groupName}
          showGroup={showGroup}
          sidebarChatOrderByDrone={sidebarChatOrderByDrone}
          dragOverDrone={dragOverDrone}
          dragOverChat={dragOverChat}
          deletingChats={deletingChats}
          onDeleteChatClick={(droneIdValue, chatNameValue) => {
            void onDeleteChatClick(droneIdValue, chatNameValue);
          }}
        />
      ))}
    </>
  );
}
