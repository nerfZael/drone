import React from 'react';
import { useDndMonitor, useDraggable, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { DroneCard } from '../overview';
import { TypingDots } from '../overview/icons';
import type { DroneSummary } from '../types';
import { createCanvasChatNodeId } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import { isDroneStartingOrSeeding } from './helpers';
import { IconChatThread, IconDrone, IconPencil, IconSpinner, IconTrash } from './icons';
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
  normalizeSidebarReorderTarget,
  sidebarDropPlacementFromRects,
  SidebarReorderDropIndicator,
} from './sidebar-reorder-ui';
import {
  canSetSidebarDroneSelectionParent,
  sidebarDroneDropIntentFromRects,
} from './sidebar-drone-drop';
import { sidebarInlineSectionKey, type SidebarInlineSectionKind } from './sidebar-inline-sections';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';
import type { SidebarDroneTree } from './sidebar-drone-tree';
import type { SidebarDensityMode } from './settings-types';
import type { ChatEditorState } from './use-sidebar-interactions';

export type SidebarDroneTreeListProps = {
  droneById: Record<string, DroneSummary>;
  tree: SidebarDroneTree;
  sidebarDensityMode: SidebarDensityMode;
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
  setCollapsedDroneSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  uiDroneName: (nameRaw: string) => string;
  onToggleSection: (droneId: string, kind: SidebarInlineSectionKind) => void;
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
  onPrepareDroneDragStart: (droneId: string) => void;
  onReparentDronesToParent: (
    parentDroneId: string | null,
    droneIds: string[],
    opts?: { targetGroup?: string | null },
  ) => Promise<{ ok: boolean; error?: string | null; reparentedIds?: string[] }>;
  groupOrderKey?: string | null;
  groupName?: string | null;
  showGroup?: boolean;
};

export type SidebarDroneTreeListSharedProps = Omit<SidebarDroneTreeListProps, 'tree'>;

type SidebarDroneRowProps = {
  drone: DroneSummary;
  sidebarDensityMode: SidebarDensityMode;
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
  dragOverParenting: boolean;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneCard: (droneId: string, opts?: { toggle?: boolean; range?: boolean }) => void;
  onOpenCloneModal: (drone: DroneSummary) => void;
  onOpenCreateDroneChat: (drone: DroneSummary) => void;
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
};

type SidebarChatRowProps = {
  drone: DroneSummary;
  sidebarDensityMode: SidebarDensityMode;
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
  editing: boolean;
  editorValue: string;
  editorError: string | null;
  editorPending: boolean;
  canRename: boolean;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onRenameChatClick: (droneId: string, chatName: string) => void;
  onEditorValueChange: (next: string) => void;
  onEditorSubmit: () => void;
  onEditorBlur: () => void;
  onEditorCancel: () => void;
  onDeleteChatClick: (droneId: string, chatName: string) => void;
};

type SidebarDroneNodeProps = SidebarDroneTreeListProps & {
  droneId: string;
  ancestorDroneIds?: Set<string>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  dragOverDrone: { droneId: string; placement: SidebarGroupDropPlacement } | null;
  dragOverChat: { key: string; placement: SidebarGroupDropPlacement } | null;
  dragOverParentDroneId: string | null;
  deletingChats: Record<string, boolean>;
  onDeleteChatClick: (droneId: string, chatName: string) => void;
  chatEditor: ChatEditorState | null;
  chatEditorInputRef: React.RefObject<HTMLInputElement>;
  onOpenCreateDroneChat: (drone: DroneSummary) => void;
  onStartRenameDroneChat: (droneId: string, chatName: string) => void;
  onChatEditorValueChange: (next: string) => void;
  onSubmitChatEditor: () => void;
  onBlurChatEditor: () => void;
  onCancelChatEditor: () => void;
};

const EMPTY_CHAT_ORDER: string[] = [];

function sidebarTreeDensityClasses(sidebarDensityMode: SidebarDensityMode): {
  chatRow: string;
  chatDeleteWidth: string;
  chatPlaceholderWidth: string;
  childIndent: string;
  draftRow: string;
  draftText: string;
  leadingIcon: string;
} {
  if (sidebarDensityMode === 'compact') {
    return {
      chatRow: 'h-6 px-1.5 text-[10.5px]',
      chatDeleteWidth: 'w-6',
      chatPlaceholderWidth: 'w-6',
      childIndent: 'ml-4',
      draftRow: 'px-2.5 h-7',
      draftText: 'text-[11.5px]',
      leadingIcon: 'h-3 w-3 text-[var(--muted-dim)] opacity-75',
    };
  }
  if (sidebarDensityMode === 'comfortable') {
    return {
      chatRow: 'h-8 px-2.5 text-[11.5px]',
      chatDeleteWidth: 'w-8',
      chatPlaceholderWidth: 'w-8',
      childIndent: 'ml-6',
      draftRow: 'px-3 h-9',
      draftText: 'text-[13px]',
      leadingIcon: 'h-[15px] w-[15px] text-[var(--muted-dim)] opacity-75',
    };
  }
  return {
    chatRow: 'h-7 px-2 text-[11px]',
    chatDeleteWidth: 'w-7',
    chatPlaceholderWidth: 'w-7',
    childIndent: 'ml-5',
    draftRow: 'px-3 h-8',
    draftText: 'text-[12.5px]',
    leadingIcon: 'h-3.5 w-3.5 text-[var(--muted-dim)] opacity-75',
  };
}

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

function createDroneChildrenDropId(droneIdRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `sidebar-drone-children:${droneId}`;
}

function currentPlacementFromEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
): SidebarGroupDropPlacement {
  return sidebarDropPlacementFromRects(
    event.active.rect.current.translated ?? event.active.rect.current.initial,
    event.over?.rect ?? null,
  );
}

function currentReorderTargetFromEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  entries: string[],
  overIdRaw: string,
): { overId: string; placement: SidebarGroupDropPlacement } {
  return normalizeSidebarReorderTarget(entries, overIdRaw, currentPlacementFromEvent(event));
}

function SidebarDroneRow({
  drone,
  sidebarDensityMode,
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
  dragOverParenting,
  uiDroneName,
  onSelectDroneCard,
  onOpenCloneModal,
  onOpenCreateDroneChat,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
}: SidebarDroneRowProps) {
  const densityClasses = sidebarTreeDensityClasses(sidebarDensityMode);
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
    <div
      className={`relative flex items-stretch gap-1 rounded-md transition-colors ${
        dragOverParenting ? 'bg-[rgba(80,130,255,.10)] ring-1 ring-[rgba(90,140,255,.34)]' : ''
      }`}
      ref={setNodeRef}
    >
      {dragOverPlacement ? <SidebarReorderDropIndicator placement={dragOverPlacement} /> : null}
      <div className="min-w-0 flex-1">
        <DroneCard
          drone={drone}
          density={sidebarDensityMode}
          displayName={uiDroneName(drone.name)}
          statusHint={isOptimistic ? 'queued' : undefined}
          selected={selectedDroneSet.has(drone.id)}
          busy={busy}
          unreadAgentMessage={unread}
          showGroup={showGroup}
          leadingIcon={<IconDrone className={densityClasses.leadingIcon} />}
          onClick={(rowOpts) => onSelectDroneCard(drone.id, rowOpts)}
          dragNodeRef={setDragNodeRef}
          draggable={!dragDisabled}
          dragging={isDragging}
          dragAttributes={attributes as unknown as Record<string, unknown>}
          dragListeners={listeners as unknown as Record<string, unknown>}
          onClone={() => onOpenCloneModal(drone)}
          onCreateChat={() => onOpenCreateDroneChat(drone)}
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
          createChatDisabled={
            isOptimistic ||
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
  );
}

function SidebarChatRow({
  drone,
  sidebarDensityMode,
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
  editing,
  editorValue,
  editorError,
  editorPending,
  canRename,
  onSelectDroneChat,
  onRenameChatClick,
  onEditorValueChange,
  onEditorSubmit,
  onEditorBlur,
  onEditorCancel,
  onDeleteChatClick,
}: SidebarChatRowProps) {
  const densityClasses = sidebarTreeDensityClasses(sidebarDensityMode);
  const chatKey = `${drone.id}:${chatName}`;
  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className={`flex items-center gap-1.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 ${densityClasses.chatRow}`}>
          <IconChatThread className="h-3 w-3 flex-shrink-0 text-[var(--accent)] opacity-85" />
          <input
            type="text"
            value={editorValue}
            onChange={(event) => onEditorValueChange(event.target.value)}
            onBlur={onEditorBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onEditorSubmit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onEditorCancel();
              }
            }}
            placeholder="Chat name"
            className="min-w-0 flex-1 rounded border border-[var(--accent-muted)] bg-[rgba(15,18,28,.88)] px-2 py-1 font-mono text-[11px] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none"
          />
          {editorPending ? <IconSpinner className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)] opacity-90" /> : null}
        </div>
        {editorError ? <div className="px-1 text-[10px] text-[var(--red)]">{editorError}</div> : null}
      </div>
    );
  }
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
        className={`flex-1 rounded border text-left transition-all flex items-center gap-1.5 min-w-0 ${densityClasses.chatRow} ${
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
      <div className="flex items-center gap-1">
        {canRename ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRenameChatClick(drone.id, chatName);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            className={`inline-flex ${densityClasses.chatDeleteWidth} flex-shrink-0 items-center justify-center rounded border transition-all opacity-0 pointer-events-none group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto bg-[rgba(80,130,255,.10)] border-[rgba(90,140,255,.22)] text-[rgb(124,170,255)] hover:bg-[rgba(80,130,255,.16)]`}
            title={`Rename chat "${chatName}"`}
            aria-label={`Rename chat "${chatName}"`}
          >
            <IconPencil className="opacity-90" />
          </button>
        ) : null}
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
            className={`inline-flex ${densityClasses.chatDeleteWidth} flex-shrink-0 items-center justify-center rounded border transition-all ${
              deleting
                ? 'bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                : 'opacity-0 pointer-events-none group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
            }`}
            title={`Delete chat "${chatName}"`}
            aria-label={`Delete chat "${chatName}"`}
          >
            {deleting ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
          </button>
        ) : canRename ? null : (
          <span className={`${densityClasses.chatPlaceholderWidth} flex-shrink-0`} />
        )}
      </div>
    </div>
  );
}

function SidebarDroneChildrenSection({
  droneId,
  highlighted,
  movingDroneGroups,
  isOptimistic,
  groupOrderKey,
  className,
  children,
}: {
  droneId: string;
  highlighted: boolean;
  movingDroneGroups: boolean;
  isOptimistic: boolean;
  groupOrderKey?: string | null;
  className: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: createDroneChildrenDropId(droneId),
    data: {
      type: 'sidebar-drone-parenting',
      droneId,
      groupOrderKey: groupOrderKey ?? null,
    },
    disabled: movingDroneGroups || isOptimistic,
  });

  return (
    <div
      ref={setNodeRef}
      className={`${className} rounded-md transition-colors ${
        highlighted ? 'bg-[rgba(80,130,255,.08)] ring-1 ring-[rgba(90,140,255,.24)]' : ''
      }`}
    >
      {children}
    </div>
  );
}

function SidebarDroneNode({
  droneById,
  tree,
  sidebarDensityMode,
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
  setCollapsedDroneSections,
  uiDroneName,
  onToggleSection,
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
  groupOrderKey,
  groupName,
  showGroup,
  droneId,
  ancestorDroneIds,
  sidebarChatOrderByDrone,
  dragOverDrone,
  dragOverChat,
  dragOverParentDroneId,
  deletingChats,
  onDeleteChatClick,
  chatEditor,
  chatEditorInputRef,
  onOpenCreateDroneChat,
  onStartRenameDroneChat,
  onChatEditorValueChange,
  onSubmitChatEditor,
  onBlurChatEditor,
  onCancelChatEditor,
}: SidebarDroneNodeProps) {
  const densityClasses = sidebarTreeDensityClasses(sidebarDensityMode);
  if (ancestorDroneIds?.has(droneId)) return null;
  const drone = droneById[droneId];
  if (!drone) return null;
  const nextAncestorDroneIds = new Set(ancestorDroneIds ?? []);
  nextAncestorDroneIds.add(droneId);
  void onDeleteDroneChat;
  void onCreateDroneChat;
  void onRenameDroneChat;

  if (drone.id === draftSidebarPlaceholderId) {
    return (
      <div key={drone.id} className={`w-full text-left flex items-center rounded-md border bg-[var(--selected)] border-[var(--accent-muted)] relative ${densityClasses.draftRow}`}>
        <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className={`flex-1 min-w-0 truncate font-semibold text-[var(--fg)] ${densityClasses.draftText}`} title={`${drone.name} · pending draft`}>
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
  const showCreateChatEditor = chatEditor?.mode === 'create' && chatEditor.droneId === drone.id;
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
        sidebarDensityMode={sidebarDensityMode}
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
        dragOverParenting={dragOverParentDroneId === drone.id}
        uiDroneName={uiDroneName}
        onSelectDroneCard={onSelectDroneCard}
        onOpenCloneModal={onOpenCloneModal}
        onOpenCreateDroneChat={onOpenCreateDroneChat}
        onRenameDrone={onRenameDrone}
        onSetDroneBaseImage={onSetDroneBaseImage}
        onDeleteDrone={onDeleteDrone}
        onOpenDroneErrorModal={onOpenDroneErrorModal}
      />
      {hasChatSection || showCreateChatEditor ? (
        <div className={`${densityClasses.childIndent} mr-1 flex flex-col gap-0.5`}>
          {showCreateChatEditor ? (
            <div className="flex flex-col gap-0.5">
              <div className={`flex items-center gap-1.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 ${densityClasses.chatRow}`}>
                <IconChatThread className="h-3 w-3 flex-shrink-0 text-[var(--accent)] opacity-85" />
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
                  className="min-w-0 flex-1 rounded border border-[var(--accent-muted)] bg-[rgba(15,18,28,.88)] px-2 py-1 font-mono text-[11px] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none"
                />
                {chatEditor?.pending ? <IconSpinner className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)] opacity-90" /> : null}
              </div>
              {chatEditor?.error ? <div className="px-1 text-[10px] text-[var(--red)]">{chatEditor.error}</div> : null}
            </div>
          ) : null}
          {chats.map((chatName) => {
            const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
            if (!chatNodeId) return null;
            const chatKey = `${drone.id}:${chatName}`;
            return (
              <SidebarChatRow
                key={chatKey}
                drone={drone}
                sidebarDensityMode={sidebarDensityMode}
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
                editing={chatEditor?.mode === 'rename' && chatEditor.droneId === drone.id && chatEditor.targetChatName === chatName}
                editorValue={chatEditor?.value ?? ''}
                editorError={chatEditor?.error ?? null}
                editorPending={Boolean(chatEditor?.pending)}
                canRename={chatName !== 'default'}
                onSelectDroneChat={onSelectDroneChat}
                onRenameChatClick={onStartRenameDroneChat}
                onEditorValueChange={onChatEditorValueChange}
                onEditorSubmit={onSubmitChatEditor}
                onEditorBlur={onBlurChatEditor}
                onEditorCancel={onCancelChatEditor}
                onDeleteChatClick={onDeleteChatClick}
              />
            );
          })}
        </div>
      ) : null}
      {hasChildrenSection ? (
        <SidebarDroneChildrenSection
          droneId={drone.id}
          highlighted={dragOverParentDroneId === drone.id}
          movingDroneGroups={movingDroneGroups}
          isOptimistic={isOptimistic}
          groupOrderKey={groupOrderKey}
          className={`${densityClasses.childIndent} mr-1 flex flex-col gap-0.5`}
        >
          {childDroneIds.map((childDroneId) => (
            <SidebarDroneNode
              key={childDroneId}
              droneId={childDroneId}
              ancestorDroneIds={nextAncestorDroneIds}
              droneById={droneById}
              tree={tree}
              sidebarDensityMode={sidebarDensityMode}
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
              onCreateDroneChat={onCreateDroneChat}
              onRenameDroneChat={onRenameDroneChat}
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
              dragOverParentDroneId={dragOverParentDroneId}
              deletingChats={deletingChats}
              onDeleteChatClick={onDeleteChatClick}
              chatEditor={chatEditor}
              chatEditorInputRef={chatEditorInputRef}
              onOpenCreateDroneChat={onOpenCreateDroneChat}
              onStartRenameDroneChat={onStartRenameDroneChat}
              onChatEditorValueChange={onChatEditorValueChange}
              onSubmitChatEditor={onSubmitChatEditor}
              onBlurChatEditor={onBlurChatEditor}
              onCancelChatEditor={onCancelChatEditor}
            />
          ))}
        </SidebarDroneChildrenSection>
      ) : null}
    </div>
  );
}

export function SidebarDroneTreeList({
  droneById,
  tree,
  sidebarDensityMode,
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
  setCollapsedDroneSections,
  uiDroneName,
  onToggleSection,
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
  onReparentDronesToParent,
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
  const [dragOverParentDroneId, setDragOverParentDroneId] = React.useState<string | null>(null);
  const [deletingChats, setDeletingChats] = React.useState<Record<string, boolean>>({});
  const [chatEditor, setChatEditor] = React.useState<ChatEditorState | null>(null);
  const chatEditorInputRef = React.useRef<HTMLInputElement>(null);
  const visibleDroneOrder = React.useMemo(() => flattenSidebarTreeOrder(tree), [tree]);

  const openCreateDroneChatEditor = React.useCallback((drone: DroneSummary) => {
    const droneId = String(drone?.id ?? '').trim();
    if (!droneId) return;
    const chats = Array.isArray(drone?.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
    setChatEditor({
      mode: 'create',
      droneId,
      targetChatName: null,
      value: `chat-${Math.max(1, chats.length + 1)}`,
      error: null,
      pending: false,
    });
  }, []);

  const startRenameDroneChatEditor = React.useCallback((droneIdRaw: string, chatNameRaw: string) => {
    const droneId = String(droneIdRaw ?? '').trim();
    const chatName = String(chatNameRaw ?? '').trim() || 'default';
    if (!droneId || !chatName || chatName === 'default') return;
    setChatEditor({
      mode: 'rename',
      droneId,
      targetChatName: chatName,
      value: chatName,
      error: null,
      pending: false,
    });
  }, []);

  const updateChatEditorValue = React.useCallback((next: string) => {
    setChatEditor((prev) => (prev ? { ...prev, value: next, error: null } : prev));
  }, []);

  const submitChatEditor = React.useCallback(async () => {
    const draft = chatEditor;
    if (!draft || draft.pending) return;
    const drone = droneById[draft.droneId];
    if (!drone) {
      setChatEditor((prev) => (prev ? { ...prev, error: 'Drone is unavailable.' } : prev));
      return;
    }
    const chatName = String(draft.value ?? '').trim();
    if (!chatName) {
      setChatEditor((prev) => (prev ? { ...prev, error: 'Chat name is required.' } : prev));
      return;
    }
    setChatEditor((prev) => (prev ? { ...prev, pending: true, error: null } : prev));
    const result =
      draft.mode === 'create'
        ? await onCreateDroneChat(drone, chatName)
        : await onRenameDroneChat(draft.droneId, String(draft.targetChatName ?? '').trim(), chatName);
    if (!result.ok) {
      setChatEditor((prev) =>
        prev ? { ...prev, pending: false, error: result.error || `${draft.mode === 'create' ? 'Create' : 'Rename'} chat failed.` } : prev,
      );
      return;
    }
    setChatEditor(null);
  }, [chatEditor, droneById, onCreateDroneChat, onRenameDroneChat]);

  const blurChatEditor = React.useCallback(() => {
    const draft = chatEditor;
    if (!draft || draft.pending) return;
    if (!String(draft.value ?? '').trim()) {
      setChatEditor(null);
      return;
    }
    void submitChatEditor();
  }, [chatEditor, submitChatEditor]);

  const cancelChatEditor = React.useCallback(() => {
    setChatEditor(null);
  }, []);

  const chatEditorFocusKey = React.useMemo(
    () => (chatEditor ? `${chatEditor.mode}:${chatEditor.droneId}:${chatEditor.targetChatName ?? ''}` : null),
    [chatEditor],
  );

  React.useEffect(() => {
    if (!chatEditorFocusKey) return;
    const id = window.requestAnimationFrame(() => {
      chatEditorInputRef.current?.focus();
      chatEditorInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [chatEditorFocusKey]);

  const clearDragOverState = React.useCallback(() => {
    setDragOverDrone(null);
    setDragOverChat(null);
    setDragOverParentDroneId(null);
  }, []);

  const handleDroneParentingDrop = React.useCallback(
    async (parentDroneIdRaw: string | null, sourceDroneIdsRaw: string[]) => {
      const parentDroneId = String(parentDroneIdRaw ?? '').trim() || null;
      if (!canSetSidebarDroneSelectionParent(droneById, sourceDroneIdsRaw, parentDroneId)) return;
      const childrenSectionKey = parentDroneId ? sidebarInlineSectionKey(parentDroneId, 'children') : null;
      const shouldOptimisticallyOpenChildren = Boolean(
        childrenSectionKey && collapsedDroneSections[childrenSectionKey],
      );
      if (childrenSectionKey && shouldOptimisticallyOpenChildren) {
        setCollapsedDroneSections((prev) =>
          prev[childrenSectionKey]
            ? {
                ...prev,
                [childrenSectionKey]: false,
              }
            : prev,
        );
      }
      const result = await onReparentDronesToParent(parentDroneId, sourceDroneIdsRaw, { targetGroup: groupName });
      if (!result.ok && result.error) {
        if (childrenSectionKey && shouldOptimisticallyOpenChildren) {
          setCollapsedDroneSections((prev) =>
            prev[childrenSectionKey]
              ? prev
              : {
                  ...prev,
                  [childrenSectionKey]: true,
                },
          );
        }
        const targetDrone = parentDroneId ? droneById[parentDroneId] ?? null : null;
        if (targetDrone) onOpenDroneErrorModal(targetDrone, result.error);
        else window.alert(result.error);
      }
    },
    [
      collapsedDroneSections,
      droneById,
      onOpenDroneErrorModal,
      onReparentDronesToParent,
      setCollapsedDroneSections,
    ],
  );

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
      if (active?.type === 'sidebar-drone') {
        if (overData?.type === 'sidebar-drone-parenting') {
          const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
          if (canSetSidebarDroneSelectionParent(droneById, active.droneIds, overDroneId)) {
            setDragOverDrone(null);
            setDragOverChat(null);
            setDragOverParentDroneId(overDroneId);
            return;
          }
        }

        if (overData?.type === 'sidebar-drone-reorder') {
          const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
          const overGroupOrderKey = String((overData as { groupOrderKey?: unknown }).groupOrderKey ?? '').trim();
          if (overDroneId) {
            const dropIntent = sidebarDroneDropIntentFromRects(
              event.active.rect.current.translated ?? event.active.rect.current.initial,
              event.over?.rect ?? null,
            );
            if (
              dropIntent === 'inside' &&
              canSetSidebarDroneSelectionParent(droneById, active.droneIds, overDroneId)
            ) {
              setDragOverDrone(null);
              setDragOverChat(null);
              setDragOverParentDroneId(overDroneId);
              return;
            }
            if (
              dropIntent !== 'inside' &&
              groupOrderKey &&
              active.groupOrderKey === groupOrderKey &&
              overGroupOrderKey === groupOrderKey &&
              active.droneId !== overDroneId
            ) {
              const dropTarget = currentReorderTargetFromEvent(event, visibleDroneOrder, overDroneId);
              setDragOverParentDroneId(null);
              setDragOverChat(null);
              setDragOverDrone({
                droneId: dropTarget.overId,
                placement: dropTarget.placement,
              });
              return;
            }
          }
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
          const currentChats = orderSidebarEntries(
            normalizedDroneChats(droneById[active.droneId]),
            sidebarChatOrderByDrone[active.droneId] ?? EMPTY_CHAT_ORDER,
            (chat) => chat,
          );
          const dropTarget = currentReorderTargetFromEvent(event, currentChats, overChatName);
          setDragOverDrone(null);
          setDragOverParentDroneId(null);
          setDragOverChat({
            key: `${overDroneId}:${dropTarget.overId}`,
            placement: dropTarget.placement,
          });
          return;
        }
      }

      clearDragOverState();
    },
    [clearDragOverState, droneById, groupOrderKey, sidebarChatOrderByDrone, visibleDroneOrder],
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

      if (active?.type === 'sidebar-drone') {
        if (overData?.type === 'sidebar-drone-parenting') {
          const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
          clearDragOverState();
          if (canSetSidebarDroneSelectionParent(droneById, active.droneIds, overDroneId)) {
            void handleDroneParentingDrop(overDroneId, active.droneIds);
          }
          return;
        }

        if (overData?.type === 'sidebar-drone-reorder') {
          const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
          const overGroupOrderKey = String((overData as { groupOrderKey?: unknown }).groupOrderKey ?? '').trim();
          const dropIntent =
            dragOverParentDroneId === overDroneId
              ? 'inside'
              : sidebarDroneDropIntentFromRects(
                  event.active.rect.current.translated ?? event.active.rect.current.initial,
                  event.over?.rect ?? null,
                );
          if (
            dropIntent === 'inside' &&
            canSetSidebarDroneSelectionParent(droneById, active.droneIds, overDroneId)
          ) {
            clearDragOverState();
            void handleDroneParentingDrop(overDroneId, active.droneIds);
            return;
          }
          if (
            dropIntent !== 'inside' &&
            groupOrderKey &&
            active.groupOrderKey === groupOrderKey &&
            overDroneId &&
            overGroupOrderKey === groupOrderKey &&
            active.droneId !== overDroneId
          ) {
            const fallbackTarget = currentReorderTargetFromEvent(event, visibleDroneOrder, overDroneId);
            const dropTarget = dragOverDrone ?? {
              droneId: fallbackTarget.overId,
              placement: fallbackTarget.placement,
            };
            const targetParentDroneId = String(droneById[dropTarget.droneId]?.fleetParentId ?? '').trim() || null;
            setSidebarDroneOrderByGroup((prev) => ({
              ...prev,
              [groupOrderKey]: reorderSidebarEntryOrder(
                prev[groupOrderKey] ?? [],
                visibleDroneOrder,
                active.droneId,
                dropTarget.droneId,
                dropTarget.placement,
              ),
            }));
            if (canSetSidebarDroneSelectionParent(droneById, active.droneIds, targetParentDroneId)) {
              void handleDroneParentingDrop(targetParentDroneId, active.droneIds);
            }
          }
        }
      }

      if (active?.type === 'sidebar-chat' && overData?.type === 'sidebar-chat-reorder') {
        const overDroneId = String((overData as { droneId?: unknown }).droneId ?? '').trim();
        const overChatName = String((overData as { chatName?: unknown }).chatName ?? '').trim() || 'default';
        if (overDroneId === active.droneId && overChatName && overChatName !== active.chatName) {
          const currentChats = orderSidebarEntries(
            normalizedDroneChats(droneById[active.droneId]),
            sidebarChatOrderByDrone[active.droneId] ?? EMPTY_CHAT_ORDER,
            (chat) => chat,
          );
          const fallbackTarget = currentReorderTargetFromEvent(event, currentChats, overChatName);
          const prefix = `${overDroneId}:`;
          const targetChatName =
            dragOverChat?.key.startsWith(prefix)
              ? String(dragOverChat.key.slice(prefix.length) || overChatName)
              : fallbackTarget.overId;
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
          sidebarDensityMode={sidebarDensityMode}
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
          onCreateDroneChat={onCreateDroneChat}
          onRenameDroneChat={onRenameDroneChat}
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
          dragOverParentDroneId={dragOverParentDroneId}
          deletingChats={deletingChats}
          onDeleteChatClick={(droneIdValue, chatNameValue) => {
            void onDeleteChatClick(droneIdValue, chatNameValue);
          }}
          chatEditor={chatEditor}
          chatEditorInputRef={chatEditorInputRef}
          onOpenCreateDroneChat={openCreateDroneChatEditor}
          onStartRenameDroneChat={startRenameDroneChatEditor}
          onChatEditorValueChange={updateChatEditorValue}
          onSubmitChatEditor={submitChatEditor}
          onBlurChatEditor={blurChatEditor}
          onCancelChatEditor={cancelChatEditor}
        />
      ))}
    </>
  );
}
