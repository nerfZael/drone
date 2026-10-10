import React from 'react';
import { Popover } from 'radix-ui';
import {
  setChangesWorktreeMode,
  setPinnedChangesWorktree,
  type ChangesWorktreeMode,
  type ChangesWorktreeSource,
  type ChatWorktree,
  type RepoWorktree,
} from './changes-worktree';

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.5" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 5v6M11.5 7c0 2.5-2.5 3-7 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0" aria-hidden="true">
      <path d="m4.5 6.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FollowChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.25 3.75c0-.55.45-1 1-1h9.5c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H7l-3 2.5v-2.5h-.75c-.55 0-1-.45-1-1v-6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 6.75h5M8.5 5l1.75 1.75L8.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MainCheckoutIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.25 7.25 8 2.5l5.75 4.75M3.75 6v7.25h3v-4h2.5v4h3V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function folderName(worktreePath: string): string {
  return worktreePath.split(/[\\/]/).filter(Boolean).pop() || worktreePath;
}

function worktreeLabel(worktree: RepoWorktree): string {
  return worktree.branch ?? (worktree.head ? `detached ${worktree.head.slice(0, 7)}` : folderName(worktree.path));
}

/**
 * Picks which worktree of the drone's repository the Changes explorer shows. Two toggles set how it behaves across
 * chats: follow the chat being looked at (its reported worktree, else the main checkout), or stay on the main
 * checkout. Picking a worktree from the list keeps that one shown for this drone until either toggle is pressed.
 */
export function ChangesWorktreeSwitcher({
  droneId,
  chatName,
  mode,
  source,
  path,
  worktrees,
  chatWorktree,
}: {
  droneId: string;
  chatName: string | null;
  mode: ChangesWorktreeMode;
  source: ChangesWorktreeSource;
  /** The worktree shown; null for the main checkout. */
  path: string | null;
  worktrees: RepoWorktree[];
  chatWorktree: ChatWorktree | null;
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const main = worktrees.find((worktree) => worktree.main) ?? null;
  const shown = (path ? worktrees.find((worktree) => worktree.path === path) : main) ?? null;
  const chatPath = chatWorktree?.available ? chatWorktree.path : null;
  const label = shown ? worktreeLabel(shown) : 'Main checkout';
  const chatLabel = chatName ? `“${chatName}”` : 'this chat';
  const title =
    source === 'chat'
      ? `Following ${chatLabel} in its worktree ${path}. Click to pick another worktree.`
      : source === 'pinned'
        ? `Showing ${shown?.path ?? label}, picked by hand. Click to pick another worktree.`
        : `Showing the main checkout${main ? ` (${main.path})` : ''}. Click to pick a worktree.`;
  const choose = (worktree: RepoWorktree) => {
    setPinnedChangesWorktree(droneId, worktree.path);
    setOpen(false);
  };
  const toggleClass = (pressed: boolean) =>
    `inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-medium)] transition-colors hover:bg-[var(--hover)] ${
      pressed ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'
    }`;

  return (
    <div className="flex min-w-0 items-center gap-0.5" data-changes-worktree-switcher>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            title={title}
            aria-label={`Worktree: ${label}`}
            className={`inline-flex h-6 min-w-0 max-w-[14rem] items-center gap-1 rounded-[var(--radius-medium)] px-1.5 text-ui transition-colors hover:bg-[var(--hover)] ${
              source === 'main' ? 'text-[var(--fg-secondary)]' : 'text-[var(--accent)]'
            }`}
          >
            <BranchIcon />
            <span className="min-w-0 truncate font-[var(--weight-emphasis)]">{label}</span>
            <ChevronIcon />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={triggerRef.current?.ownerDocument.body}>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 flex max-h-[min(60vh,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-dialog)]"
          >
            <div role="listbox" aria-label="Worktrees" className="min-h-0 flex-1 overflow-y-auto p-1">
              {worktrees.map((worktree) => {
                const selected = shown?.path === worktree.path;
                const chats = worktree.path === chatPath && !worktree.main;
                return (
                  <button
                    key={worktree.path}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(worktree)}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-medium)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--hover)] ${
                      selected ? 'bg-[var(--accent-subtle)] text-[var(--fg)]' : 'text-[var(--fg-secondary)]'
                    }`}
                  >
                    <BranchIcon />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{worktree.main ? `Main checkout · ${worktreeLabel(worktree)}` : worktreeLabel(worktree)}</span>
                        {chats ? (
                          <span className="shrink-0 rounded-[var(--radius-small)] bg-[var(--accent-subtle)] px-1 text-[10px] text-[var(--accent)]">
                            {chatName ?? 'chat'}
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{worktree.path}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        onClick={() => setChangesWorktreeMode(droneId, 'follow-chat')}
        aria-pressed={mode === 'follow-chat' && source !== 'pinned'}
        title={
          chatPath
            ? `Follow the chat you are looking at (${chatLabel} works in ${folderName(chatPath)})`
            : `Follow the chat you are looking at (${chatLabel} has not reported a worktree, so the main checkout shows)`
        }
        aria-label="Follow the chat's worktree"
        className={toggleClass(mode === 'follow-chat' && source !== 'pinned')}
      >
        <FollowChatIcon />
      </button>
      <button
        type="button"
        onClick={() => setChangesWorktreeMode(droneId, 'main')}
        aria-pressed={mode === 'main' && source !== 'pinned'}
        title="Always show the main checkout"
        aria-label="Always show the main checkout"
        className={toggleClass(mode === 'main' && source !== 'pinned')}
      >
        <MainCheckoutIcon />
      </button>
    </div>
  );
}
