import React from 'react';
import { DroneCard } from '../overview';
import { TypingDots } from '../overview/icons';
import type { DroneSummary } from '../types';
import { DRONE_CHAT_DND_MIME, createCanvasChatNodeId } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import { isDroneStartingOrSeeding } from './helpers';
import { IconChevron, IconSpinner, IconTrash } from './icons';
import {
  orderSidebarEntries,
  reorderSidebarEntryOrder,
  type SidebarGroupDropPlacement,
} from './sidebar-group-order';
import {
  sidebarDropPlacementFromClientY,
  SidebarReorderDropIndicator,
} from './sidebar-reorder-ui';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';
import type { SidebarDroneTree } from './sidebar-drone-tree';

export type SidebarInlineSectionKind = 'chats' | 'children';

export function sidebarInlineSectionKey(droneIdRaw: string, kind: SidebarInlineSectionKind): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `${kind}:${droneId}`;
}

function SidebarInlineSectionToggle({
  expanded,
  label,
  countLabel,
  onClick,
  title,
}: {
  expanded: boolean;
  label: string;
  countLabel: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-6 rounded border px-2 text-left text-[10px] transition-all flex items-center gap-1.5 border-transparent text-[var(--muted-dim)] hover:border-[var(--border-subtle)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
      title={title}
      aria-label={title}
      aria-expanded={expanded}
    >
      <IconChevron down={expanded} className="opacity-70" />
      <span
        className="min-w-0 flex-1 truncate font-semibold tracking-wide uppercase"
        style={{ fontFamily: 'var(--display)' }}
      >
        {label}
      </span>
      <span className="flex-shrink-0 font-mono text-[9px] text-[var(--muted-dim)]">
        {countLabel}
      </span>
    </button>
  );
}

export type SidebarDroneTreeListProps = {
  droneById: Record<string, DroneSummary>;
  tree: SidebarDroneTree;
  draftSidebarPlaceholderId: string;
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
  onDroneDragStart: (droneId: string, event: React.DragEvent<HTMLDivElement>) => void;
  onDroneDragEnd: () => void;
  groupOrderKey?: string | null;
  showGroup?: boolean;
};

const SIDEBAR_DRONE_REORDER_DND_MIME = 'application/x-dronehub-sidebar-drone';
const SIDEBAR_CHAT_REORDER_DND_MIME = 'application/x-dronehub-sidebar-chat';

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

export function SidebarDroneTreeList({
  droneById,
  tree,
  draftSidebarPlaceholderId,
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
  onDroneDragStart,
  onDroneDragEnd,
  groupOrderKey,
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

  const parseDraggedDroneId = React.useCallback((event: React.DragEvent<HTMLElement>): string | null => {
    try {
      const raw = event.dataTransfer.getData(SIDEBAR_DRONE_REORDER_DND_MIME);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const droneId = String(parsed?.droneId ?? '').trim();
      return droneId || null;
    } catch {
      return null;
    }
  }, []);

  const parseDraggedChatRef = React.useCallback((event: React.DragEvent<HTMLElement>): { droneId: string; chatName: string } | null => {
    try {
      const raw = event.dataTransfer.getData(SIDEBAR_CHAT_REORDER_DND_MIME);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const droneId = String(parsed?.droneId ?? '').trim();
      const chatName = String(parsed?.chatName ?? '').trim();
      if (!droneId || !chatName) return null;
      return { droneId, chatName };
    } catch {
      return null;
    }
  }, []);

  const onDroneReorderDrop = React.useCallback(
    (overDroneIdRaw: string, event: React.DragEvent<HTMLDivElement>) => {
      if (!groupOrderKey) return false;
      const activeDroneId = parseDraggedDroneId(event);
      const overDroneId = String(overDroneIdRaw ?? '').trim();
      if (!activeDroneId || !overDroneId || activeDroneId === overDroneId) {
        setDragOverDrone(null);
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      const placement = dragOverDrone?.droneId === overDroneId ? dragOverDrone.placement : 'after';
      setSidebarDroneOrderByGroup((prev) => ({
        ...prev,
        [groupOrderKey]: reorderSidebarEntryOrder(
          prev[groupOrderKey] ?? [],
          visibleDroneOrder,
          activeDroneId,
          overDroneId,
          placement,
        ),
      }));
      setDragOverDrone(null);
      return true;
    },
    [dragOverDrone, groupOrderKey, parseDraggedDroneId, setSidebarDroneOrderByGroup, visibleDroneOrder],
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
        if (!result.ok) {
          if (result.error) window.alert(result.error);
          return;
        }
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

  const renderDroneNode = React.useCallback(
    (droneId: string, ancestorDroneIds?: Set<string>): React.ReactNode => {
      if (ancestorDroneIds?.has(droneId)) return null;
      const drone = droneById[droneId];
      if (!drone) return null;
      const nextAncestorDroneIds = new Set(ancestorDroneIds ?? []);
      nextAncestorDroneIds.add(droneId);
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
        sidebarChatOrderByDrone[drone.id] ?? [],
        (chatName) => chatName,
      );
      const hasOnlyDefaultChat = chats.length === 1 && chats[0] === 'default';
      const hasChatSection = chats.length > 0 && !hasOnlyDefaultChat;
      const childDroneIds = tree.childDroneIdsByParentId[drone.id] ?? [];
      const hasChildrenSection = childDroneIds.length > 0;
      const chatsExpanded = !collapsedDroneSections[sidebarInlineSectionKey(drone.id, 'chats')];
      const childrenExpanded = !collapsedDroneSections[sidebarInlineSectionKey(drone.id, 'children')];
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
          <div
            className="relative flex items-stretch gap-1"
            onDragOver={(event) => {
              if (!groupOrderKey) return;
              const activeDroneId = parseDraggedDroneId(event);
              if (!activeDroneId || activeDroneId === drone.id) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              const placement = sidebarDropPlacementFromClientY(event.clientY, event.currentTarget);
              setDragOverDrone((prev) =>
                prev?.droneId === drone.id && prev.placement === placement ? prev : { droneId: drone.id, placement },
              );
            }}
            onDragLeave={(event) => {
              const related = event.relatedTarget;
              if (related instanceof Node && event.currentTarget.contains(related)) return;
              setDragOverDrone((prev) => (prev?.droneId === drone.id ? null : prev));
            }}
            onDrop={(event) => {
              void onDroneReorderDrop(drone.id, event);
            }}
          >
            {dragOverDrone?.droneId === drone.id ? (
              <SidebarReorderDropIndicator placement={dragOverDrone.placement} />
            ) : null}
            <div className="min-w-0 flex-1">
              <DroneCard
                drone={drone}
                displayName={uiDroneName(drone.name)}
                statusHint={isOptimistic ? 'queued' : undefined}
                selected={selectedDroneSet.has(drone.id)}
                busy={showDroneBusy}
                unreadAgentMessage={showDroneUnread}
                showGroup={showGroup}
                onClick={(rowOpts) => onSelectDroneCard(drone.id, rowOpts)}
                draggable={!movingDroneGroups && !isOptimistic}
                onDragStart={(event) => {
                  onDroneDragStart(drone.id, event);
                  if (groupOrderKey) {
                    try {
                      event.dataTransfer.setData(
                        SIDEBAR_DRONE_REORDER_DND_MIME,
                        JSON.stringify({ droneId: drone.id, groupOrderKey }),
                      );
                    } catch {
                      // Ignore drag payload assignment errors.
                    }
                  }
                  if (!hasOnlyDefaultChat) return;
                  const nodeId = createCanvasChatNodeId(drone.id, 'default');
                  if (!nodeId) return;
                  const payload = [{ nodeId, droneId: drone.id, chatName: 'default' }];
                  try {
                    event.dataTransfer.setData(DRONE_CHAT_DND_MIME, JSON.stringify(payload));
                  } catch {
                    // Ignore drag payload assignment errors.
                  }
                }}
                onDragEnd={() => {
                  setDragOverDrone(null);
                  onDroneDragEnd();
                }}
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
          {hasChatSection ? (
            <>
              <div className="ml-5 mr-1">
                <SidebarInlineSectionToggle
                  expanded={chatsExpanded}
                  label="Chats"
                  countLabel={`${chats.length}`}
                  onClick={() => onToggleSection(drone.id, 'chats')}
                  title={chatsExpanded ? `Collapse chats for ${uiDroneName(drone.name)}` : `Expand chats for ${uiDroneName(drone.name)}`}
                />
              </div>
              {chatsExpanded ? (
                <div className="ml-5 mr-1 flex flex-col gap-0.5">
                  {chats.map((chatName) => {
                    const chatNodeId = createCanvasChatNodeId(drone.id, chatName);
                    if (!chatNodeId) return null;
                    const chatKey = `${drone.id}:${chatName}`;
                    const selected = selectedDrone === drone.id && activeChatName === chatName;
                    const unread = unreadAgentMessageByChatNodeId[chatNodeId] === true;
                    const busy = busyChatNodeIdSet.has(chatNodeId);
                    const deletingChat = Boolean(deletingChats[chatKey]);
                    const canDeleteChat = chatName !== 'default';
                    return (
                      <div
                        key={`${drone.id}:${chatName}`}
                        className="relative flex items-stretch gap-1 group/chat-row"
                        onDragOver={(event) => {
                          const activeChatRef = parseDraggedChatRef(event);
                          if (!activeChatRef || activeChatRef.droneId !== drone.id || activeChatRef.chatName === chatName) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = 'move';
                          const placement = sidebarDropPlacementFromClientY(event.clientY, event.currentTarget);
                          setDragOverChat((prev) =>
                            prev?.key === chatKey && prev.placement === placement ? prev : { key: chatKey, placement },
                          );
                        }}
                        onDragLeave={(event) => {
                          const related = event.relatedTarget;
                          if (related instanceof Node && event.currentTarget.contains(related)) return;
                          setDragOverChat((prev) => (prev?.key === chatKey ? null : prev));
                        }}
                        onDrop={(event) => {
                          const activeChatRef = parseDraggedChatRef(event);
                          if (!activeChatRef || activeChatRef.droneId !== drone.id || activeChatRef.chatName === chatName) {
                            setDragOverChat(null);
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          const placement = dragOverChat?.key === chatKey ? dragOverChat.placement : 'after';
                          setSidebarChatOrderByDrone((prev) => ({
                            ...prev,
                            [drone.id]: reorderSidebarEntryOrder(
                              prev[drone.id] ?? [],
                              chats,
                              activeChatRef.chatName,
                              chatName,
                              placement,
                            ),
                          }));
                          setDragOverChat(null);
                        }}
                      >
                        {dragOverChat?.key === chatKey ? (
                          <SidebarReorderDropIndicator placement={dragOverChat.placement} />
                        ) : null}
                        <button
                          type="button"
                          draggable={!movingDroneGroups && !isOptimistic}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectDroneChat(drone.id, chatName);
                          }}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = 'move';
                            try {
                              event.dataTransfer.setData(
                                SIDEBAR_CHAT_REORDER_DND_MIME,
                                JSON.stringify({ droneId: drone.id, chatName }),
                              );
                            } catch {
                              // Ignore drag payload assignment errors.
                            }
                            try {
                              event.dataTransfer.setData(
                                DRONE_CHAT_DND_MIME,
                                JSON.stringify([{ droneId: drone.id, chatName }]),
                              );
                            } catch {
                              // Ignore drag payload assignment errors.
                            }
                            try {
                              event.dataTransfer.setData('text/plain', `${uiDroneName(drone.name)} / ${chatName}`);
                            } catch {
                              // Ignore drag payload assignment errors.
                            }
                          }}
                          onDragEnd={() => setDragOverChat(null)}
                          className={`flex-1 h-7 rounded border px-2 text-left text-[11px] transition-all flex items-center gap-1.5 min-w-0 ${
                            selected
                              ? 'border-[var(--accent-muted)] bg-[var(--selected)] text-[var(--fg)]'
                              : 'border-transparent text-[var(--muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
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
                        {canDeleteChat ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void onDeleteChatClick(drone.id, chatName);
                            }}
                            disabled={deletingChat}
                            className={`inline-flex w-7 flex-shrink-0 items-center justify-center rounded border transition-all ${
                              deletingChat
                                ? 'bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                : 'opacity-0 pointer-events-none group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
                            }`}
                            title={`Delete chat "${chatName}"`}
                            aria-label={`Delete chat "${chatName}"`}
                          >
                            {deletingChat ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                          </button>
                        ) : (
                          <span className="w-7 flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
          {hasChildrenSection ? (
            <>
              <div className="ml-5 mr-1">
                <SidebarInlineSectionToggle
                  expanded={childrenExpanded}
                  label="Children"
                  countLabel={`${childDroneIds.length}`}
                  onClick={() => onToggleSection(drone.id, 'children')}
                  title={
                    childrenExpanded
                      ? `Collapse child drones for ${uiDroneName(drone.name)}`
                      : `Expand child drones for ${uiDroneName(drone.name)}`
                  }
                />
              </div>
              {childrenExpanded ? (
                <div className="ml-5 mr-1 flex flex-col gap-0.5">
                  {childDroneIds.map((childDroneId) => renderDroneNode(childDroneId, nextAncestorDroneIds))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      );
    },
    [
      activeChatName,
      busyChatNodeIdSet,
      collapsedDroneSections,
      deletingDrones,
      draftSidebarPlaceholderId,
      droneById,
      movingDroneGroups,
      onDeleteDrone,
      onDeleteDroneChat,
      onDeleteChatClick,
      onDroneDragEnd,
      onDroneDragStart,
      onDroneReorderDrop,
      onOpenCloneModal,
      onOpenDroneErrorModal,
      onRenameDrone,
      onSelectDroneCard,
      onSelectDroneChat,
      onSetDroneBaseImage,
      onToggleSection,
      parseDraggedChatRef,
      parseDraggedDroneId,
      renamingDrones,
      selectedDrone,
      selectedDroneSet,
      setSidebarChatOrderByDrone,
      settingBaseImages,
      showGroup,
      sidebarChatOrderByDrone,
      sidebarOptimisticDroneIdSet,
      tree.childDroneIdsByParentId,
      uiDroneName,
      unreadAgentMessageByChatNodeId,
      deletingChats,
      dragOverChat,
      dragOverDrone,
      groupOrderKey,
    ],
  );

  return <>{tree.rootDroneIds.map((droneId) => renderDroneNode(droneId))}</>;
}
