import React from 'react';
import type { DroneSummary } from '../types';
import type { DroneDeleteMode } from './settings-types';
import { SidebarItemStateIndicator, sidebarChatDisplayState, sidebarDroneStateLabel } from '../overview/DroneCard';
import { createCanvasChatNodeId } from './app-config';
import { SidebarContextMenu } from './SidebarContextMenu';
import { IconPencil, IconTrash } from './icons';
import { useDroneHubRuntimeStore } from './use-drone-hub-runtime-store';
import {
  clearComposerSideChatRename,
  composerSideChatFamily,
  requestComposerSideChatRename,
  removePendingComposerSideChat,
  useComposerSideChatRenameStore,
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
 * the branch, after the chat they came from. A chip opens its side chat as the main
 * chat; viewing one shows the same row, so the source chip leads back.
 */
export function ComposerSideChatChips({
  drone,
  chatName,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  deleteMode,
}: {
  drone: DroneSummary;
  chatName: string;
  onSelectChat: (chatName: string) => void;
  /** Archives or deletes per the delete setting, asking first. */
  onDeleteChat: (chatName: string) => Promise<{ ok: boolean; error?: string | null }>;
  /** Renames the chat; an open side chat stays open under its new name. */
  onRenameChat: (chatName: string, newName: string) => Promise<{ ok: boolean; error?: string | null }>;
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
      {/* The source stays first, open or not, so the chips never shift under the pointer. */}
      <button
        type="button"
        data-composer-side-chat-root={family.rootChatName}
        data-composer-side-chat-current={viewingSideChat ? undefined : 'true'}
        onClick={() => onSelectChat(family.rootChatName)}
        aria-current={viewingSideChat ? undefined : 'true'}
        title={viewingSideChat ? `Back to ${family.rootChatName}` : `${family.rootChatName}, the chat these came from`}
        aria-label={viewingSideChat ? `Back to ${family.rootChatName}` : family.rootChatName}
        className={`${chipClass} ${
          viewingSideChat
            ? 'text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--chat-composer-control-fg)]'
            : 'bg-[var(--hover)] text-[var(--fg)]'
        }`}
      >
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
        <span className="truncate">{family.rootChatName}</span>
      </button>
      {family.chips.map((chip) => (
        <SideChatChip
          key={chip.name}
          drone={drone}
          chip={chip}
          current={chip.name === chatName}
          onSelect={() => onSelectChat(chip.name)}
          onArchive={() => void archive(chip)}
          onRename={(newName) => onRenameChat(chip.name, newName)}
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
  onRename,
  archiveVerb,
}: {
  drone: DroneSummary;
  chip: ComposerSideChatChip;
  current: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onRename: (newName: string) => Promise<{ ok: boolean; error?: string | null }>;
  archiveVerb: 'Archive' | 'Delete';
}) {
  const [renaming, setRenaming] = React.useState(false);
  const [menu, setMenu] = React.useState<{ x: number; y: number; view: Window } | null>(null);
  const renameRequested = useComposerSideChatRenameStore(
    (state) => state.target?.droneId === drone.id && state.target.chatName === chip.name,
  );
  React.useEffect(() => {
    if (!renameRequested) return;
    clearComposerSideChatRename();
    if (!chip.pending) setRenaming(true);
  }, [chip.pending, renameRequested]);
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
  if (renaming) {
    return (
      <span data-composer-side-chat={chip.name} className={`${chipClass} bg-[var(--hover)] text-[var(--fg)]`}>
        <span className="inline-flex shrink-0" aria-hidden="true">
          <SidebarItemStateIndicator state={state} unread={unread} emphasized={current} />
        </span>
        <SideChatRenameInput label={chip.label} onRename={onRename} onDone={() => setRenaming(false)} />
      </span>
    );
  }
  return (
    <span
      data-composer-side-chat={chip.name}
      data-composer-side-chat-current={current ? 'true' : undefined}
      className={`${chipClass} relative ${
        current
          ? 'bg-[var(--hover)] text-[var(--fg)]'
          : 'text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--chat-composer-control-fg)]'
      }`}
      onContextMenu={(event) => {
        if (chip.pending) return;
        // The chip's own actions, not the chat's: opening it is not needed to rename it.
        event.preventDefault();
        event.stopPropagation();
        const view = event.currentTarget.ownerDocument.defaultView;
        if (view) setMenu({ x: event.clientX, y: event.clientY, view });
      }}
    >
      {menu ? (
        <SidebarContextMenu
          x={menu.x}
          y={menu.y}
          view={menu.view}
          label="Side chat actions"
          onClose={() => setMenu(null)}
          items={[
            ...(current ? [] : [{ id: 'open-side-chat', label: 'Open', onSelect: onSelect }]),
            {
              id: 'rename-side-chat',
              label: 'Rename',
              shortcut: 'F2',
              separatorBefore: !current,
              icon: <IconPencil className="h-3.5 w-3.5 text-[var(--info)]" />,
              onSelect: () => setRenaming(true),
            },
            {
              id: 'archive-side-chat',
              label: archiveVerb,
              separatorBefore: true,
              tone: 'danger' as const,
              icon: <IconTrash className="h-3.5 w-3.5" />,
              onSelect: onArchive,
            },
          ]}
        />
      ) : null}
      <button
        type="button"
        disabled={chip.pending}
        onClick={(event) => {
          // The first click opens the side chat, which can mount the row again, so a
          // double-click is the second click of a pair, wherever it lands.
          if (event.detail >= 2 && !chip.pending) requestComposerSideChatRename(drone.id, chip.name);
          else onSelect();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'F2') return;
          event.preventDefault();
          setRenaming(true);
        }}
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
          // Over the chip's end, shown on hover or focus: the row never shifts under the pointer.
          className="absolute right-0.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded bg-[var(--hover)] text-[var(--muted-dim)] opacity-0 hover:text-[var(--fg)] focus-visible:opacity-100 group-hover/side-chat:opacity-100"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

/** The chip's label as an input: Enter or leaving it renames, Escape keeps the name. */
function SideChatRenameInput({
  label,
  onRename,
  onDone,
}: {
  label: string;
  onRename: (newName: string) => Promise<{ ok: boolean; error?: string | null }>;
  onDone: () => void;
}) {
  const [draft, setDraft] = React.useState(label);
  const [error, setError] = React.useState<string | null>(null);
  const savingRef = React.useRef(false);
  const commit = async () => {
    if (savingRef.current) return;
    const name = draft.trim();
    if (!name || name === label) {
      onDone();
      return;
    }
    savingRef.current = true;
    const result = await onRename(name);
    savingRef.current = false;
    // A renamed chip mounts again under its new name; a failed rename stays open to fix.
    if (result.ok) onDone();
    else setError(result.error || 'Could not rename the side chat.');
  };
  return (
    <input
      autoFocus
      value={draft}
      aria-label="Side chat name"
      aria-invalid={error ? 'true' : undefined}
      title={error ?? undefined}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        setDraft(event.target.value);
        setError(null);
      }}
      onKeyDown={(event) => {
        // The composer and the app's shortcuts must not see keys typed into the name.
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onDone();
        }
      }}
      onBlur={() => void commit()}
      size={Math.max(6, Math.min(24, draft.length + 1))}
      maxLength={64}
      className={`min-w-0 bg-transparent text-[.6875rem] font-medium text-[var(--fg)] outline-none ${
        error ? 'underline decoration-[var(--red)] decoration-wavy' : ''
      }`}
    />
  );
}
