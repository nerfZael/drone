import React from 'react';
import type { DroneSummary } from '../types';
import type { DroneDeleteMode } from './settings-types';
import { SidebarItemStateIndicator, sidebarChatDisplayState, sidebarDroneStateLabel } from '../overview/DroneCard';
import { createCanvasChatNodeId } from './app-config';
import { useDroneHubRuntimeStore } from './use-drone-hub-runtime-store';
import {
  composerSideChatFamily,
  removePendingComposerSideChat,
  sideChatDescendantNames,
  usePendingComposerSideChatsStore,
  type ComposerSideChatChip,
} from './composer-side-chats';

/** A chip whose chat the Hub never listed (it was renamed first, or creation stalled) stops showing. */
const PENDING_CHIP_MAX_AGE_MS = 30_000;
const EMPTY_PENDING: never[] = [];

const chipClass =
  'group/side-chat inline-flex min-h-7 min-w-0 max-w-[10rem] shrink-0 items-center gap-1.5 rounded px-1.5 text-[.6875rem] font-medium transition-colors';

/**
 * The side chats sent from this chat's composer (F or G while recording), left of
 * the branch. A chip opens its side chat as the main chat; viewing one shows the
 * same row with a way back to the chat they came from.
 */
export function ComposerSideChatChips({
  drone,
  chatName,
  onSelectChat,
  onDeleteChat,
  deleteMode,
}: {
  drone: DroneSummary;
  chatName: string;
  onSelectChat: (chatName: string) => void;
  /** Archives or deletes per the delete setting, asking first. */
  onDeleteChat: (chatName: string) => Promise<{ ok: boolean; error?: string | null }>;
  deleteMode: DroneDeleteMode;
}) {
  const pending = usePendingComposerSideChatsStore((state) => state.byDrone[drone.id] ?? EMPTY_PENDING);
  const family = React.useMemo(
    () => composerSideChatFamily(drone.sideChats, chatName, pending),
    [chatName, drone.sideChats, pending],
  );

  React.useEffect(() => {
    if (pending.length === 0) return;
    const listed = new Set((drone.sideChats ?? []).map((chat) => chat.name));
    for (const chat of pending) if (listed.has(chat.name)) removePendingComposerSideChat(drone.id, chat.name);
    const waiting = pending.filter((chat) => !listed.has(chat.name));
    if (waiting.length === 0) return;
    const oldest = Math.min(...waiting.map((chat) => Date.parse(chat.createdAt) || Date.now()));
    const timer = setTimeout(() => {
      const now = Date.now();
      for (const chat of waiting) {
        if (now - (Date.parse(chat.createdAt) || 0) >= PENDING_CHIP_MAX_AGE_MS) {
          removePendingComposerSideChat(drone.id, chat.name);
        }
      }
    }, Math.max(0, oldest + PENDING_CHIP_MAX_AGE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [drone.id, drone.sideChats, pending]);

  if (family.chips.length === 0) return null;
  const viewingSideChat = chatName !== family.rootChatName;

  const archive = async (chip: ComposerSideChatChip) => {
    const leavesView = chip.name === chatName || sideChatDescendantNames(drone.sideChats, [chip.name]).includes(chatName);
    const result = await onDeleteChat(chip.name);
    if (result.ok && leavesView) onSelectChat(family.rootChatName);
  };

  return (
    <div
      role="group"
      aria-label="Side chats"
      data-composer-side-chats={family.rootChatName}
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {viewingSideChat ? (
        <button
          type="button"
          data-composer-side-chat-root={family.rootChatName}
          onClick={() => onSelectChat(family.rootChatName)}
          title={`Back to ${family.rootChatName}`}
          aria-label={`Back to ${family.rootChatName}`}
          className={`${chipClass} text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--chat-composer-control-fg)]`}
        >
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
          <span className="truncate">{family.rootChatName}</span>
        </button>
      ) : null}
      {family.chips.map((chip) => (
        <SideChatChip
          key={chip.name}
          drone={drone}
          chip={chip}
          current={chip.name === chatName}
          onSelect={() => onSelectChat(chip.name)}
          onArchive={() => void archive(chip)}
          archiveVerb={deleteMode === 'archive' ? 'Archive' : 'Delete'}
        />
      ))}
    </div>
  );
}

function SideChatChip({
  drone,
  chip,
  current,
  onSelect,
  onArchive,
  archiveVerb,
}: {
  drone: DroneSummary;
  chip: ComposerSideChatChip;
  current: boolean;
  onSelect: () => void;
  onArchive: () => void;
  archiveVerb: 'Archive' | 'Delete';
}) {
  const nodeId = createCanvasChatNodeId(drone.id, chip.name);
  const localBusy = useDroneHubRuntimeStore((state) => (state.localBusyChatCountByNodeId[nodeId] ?? 0) > 0);
  const localApproval = useDroneHubRuntimeStore((state) => Boolean(state.approvalRequiredByChatNodeId[nodeId]));
  const localUnread = useDroneHubRuntimeStore((state) => Boolean(state.unreadAgentMessageByChatNodeId[nodeId]));
  const unread = !current && !chip.pending && (chip.unread || localUnread);
  const state = sidebarChatDisplayState(
    drone,
    chip.busy || localBusy,
    localApproval || chip.approval,
  );
  const stateLabel = chip.pending ? 'Starting' : sidebarDroneStateLabel(state, unread);
  const origin = chip.kind === 'fork' ? `Fork of ${chip.sourceChatName}` : `New chat from ${chip.sourceChatName}`;
  return (
    <span
      data-composer-side-chat={chip.name}
      data-composer-side-chat-current={current ? 'true' : undefined}
      className={`${chipClass} ${
        current
          ? 'bg-[var(--hover)] text-[var(--fg)]'
          : 'text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--chat-composer-control-fg)]'
      }`}
    >
      <button
        type="button"
        disabled={chip.pending}
        onClick={onSelect}
        aria-current={current ? 'true' : undefined}
        title={`${chip.label}\n${origin} · ${stateLabel}`}
        className="inline-flex min-w-0 items-center gap-1.5 disabled:cursor-default"
      >
        <span role="img" aria-label={stateLabel} className="inline-flex shrink-0">
          <SidebarItemStateIndicator state={chip.pending ? 'starting' : state} unread={unread} emphasized={current} />
        </span>
        <span className="truncate">{chip.label}</span>
      </button>
      {chip.pending ? null : (
        <button
          type="button"
          onClick={onArchive}
          aria-label={`${archiveVerb} side chat ${chip.label}`}
          title={`${archiveVerb} side chat`}
          // Takes no space until hovered or focused, so the row stays compact; still reachable by Tab.
          className="-ml-1.5 inline-flex h-4 w-0 shrink-0 items-center justify-center overflow-hidden rounded text-[var(--muted-dim)] opacity-0 hover:text-[var(--fg)] focus-visible:ml-0 focus-visible:w-4 focus-visible:opacity-100 group-hover/side-chat:ml-0 group-hover/side-chat:w-4 group-hover/side-chat:opacity-100"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
