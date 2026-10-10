import React from 'react';
import { Popover } from 'radix-ui';
import type { ChatWorkspaceCatalog } from '@drone/assistant-chat';
import { requestJson } from '../http';
import { IconSpinner } from '../icons';
import { setExplorerWorkspace, type ExplorerWorkspace } from './explorer-workspace-store';
import {
  loadBrowsableWorkspaces,
  openWorkspacesSettings,
  subscribeWorkspacesChanged,
  type BrowsableWorkspace,
} from './workspaces-client';

const CATEGORIES: BrowsableWorkspace['category'][] = ['Home', 'Workspaces', 'Repositories', 'Folders', 'Host drones', 'Container drones'];

/** The last list seen, so reopening shows it at once while a fresh one loads. */
let lastWorkspaces: BrowsableWorkspace[] | null = null;

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <path d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.4 1.5h6c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Picks which workspace a drone's File Explorer shows, one at a time: the drone's own, one its chat can use, or any
 * local workspace (searchable, grouped like the workspace picker). The choice is remembered per drone.
 */
export function ExplorerWorkspaceSwitcher({
  droneId,
  droneName,
  ownPath,
  chatName,
  current,
  storeKey,
}: {
  droneId: string;
  /** Where the choice is kept: the drone's id by default, a desktop Editor window's own key otherwise. */
  storeKey?: string;
  droneName: string;
  /** The drone's own folder, so the same folder listed as a workspace counts as the drone's own. */
  ownPath?: string | null;
  chatName?: string | null;
  current: ExplorerWorkspace | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [workspaces, setWorkspaces] = React.useState<BrowsableWorkspace[] | null>(lastWorkspaces);
  const [chatIds, setChatIds] = React.useState<string[]>([]);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [all, chat] = await Promise.all([
        loadBrowsableWorkspaces(),
        chatName
          ? requestJson<ChatWorkspaceCatalog>(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/workspaces`).catch(() => null)
          : Promise.resolve(null),
      ]);
      lastWorkspaces = all;
      setWorkspaces(all);
      setChatIds((chat?.access.targets ?? []).filter((target) => target.kind !== 'remote').map((target) => target.id));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [chatName, droneId]);

  React.useEffect(() => {
    if (!open) return;
    void load();
    return subscribeWorkspacesChanged(() => void load());
  }, [load, open]);

  const isOwn = (workspace: BrowsableWorkspace) =>
    (workspace.kind === 'drone' && workspace.droneId === droneId) || (Boolean(ownPath) && workspace.kind === 'folder' && workspace.path === ownPath);
  const choose = (workspace: BrowsableWorkspace | null) => {
    setExplorerWorkspace(storeKey ?? droneId, workspace && !isOwn(workspace) ? workspace : null, droneId);
    setOpen(false);
    setQuery('');
  };

  const needle = query.trim().toLowerCase();
  const matches = (workspace: BrowsableWorkspace) =>
    !needle || workspace.name.toLowerCase().includes(needle) || (workspace.path ?? '').toLowerCase().includes(needle);
  const list = (workspaces ?? []).filter((workspace) => !isOwn(workspace));
  const chatWorkspaces = chatIds.map((id) => list.find((workspace) => workspace.id === id)).filter((item): item is BrowsableWorkspace => Boolean(item) && matches(item!));
  const groups = CATEGORIES.map((category) => ({ category, items: list.filter((workspace) => workspace.category === category && matches(workspace)) })).filter((group) => group.items.length > 0);
  const label = current ? current.name : droneName;

  const row = (key: string, workspace: BrowsableWorkspace | null, title: string, detail?: string) => {
    const selected = workspace ? current?.id === workspace.id : !current;
    return (
      <button
        key={key}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => choose(workspace)}
        className={`flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-medium)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--hover)] ${
          selected ? 'bg-[var(--accent-subtle)] text-[var(--fg)]' : 'text-[var(--fg-secondary)]'
        }`}
      >
        <FolderIcon />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {detail ? <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{detail}</span> : null}
        </span>
      </button>
    );
  };
  const heading = (text: string) => (
    <div className="px-2 pb-0.5 pt-2 text-[10px] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">{text}</div>
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5" data-explorer-workspace-switcher>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            title={current ? `Showing ${current.name}${current.path ? ` (${current.path})` : ''}. Click to switch workspace.` : 'Switch the workspace this File Explorer shows'}
            aria-label={`Workspace: ${label}`}
            className={`inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-[var(--radius-medium)] px-1.5 text-ui transition-colors hover:bg-[var(--hover)] ${
              current ? 'text-[var(--accent)]' : 'text-[var(--fg-secondary)]'
            }`}
          >
            <span className="min-w-0 truncate font-[var(--weight-emphasis)]">{label}</span>
            <ChevronIcon />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={triggerRef.current?.ownerDocument.body}>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="z-50 flex max-h-[min(60vh,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-dialog)]"
          >
            <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workspaces"
                aria-label="Search workspaces"
                className="h-7 min-w-0 flex-1 rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2 text-xs text-[var(--field-fg)] placeholder:text-[var(--field-placeholder)] focus:border-[var(--accent-border)] focus:outline-none"
              />
              {loading ? <IconSpinner className="h-3 w-3 shrink-0" size={12} /> : null}
            </div>
            <div role="listbox" aria-label="Workspaces" className="min-h-0 flex-1 overflow-y-auto p-1">
              {heading('This drone')}
              {row('own', null, droneName, ownPath ?? undefined)}
              {chatWorkspaces.length > 0 ? (
                <>
                  {heading('This chat can use')}
                  {chatWorkspaces.map((workspace) => row(`chat:${workspace.id}`, workspace, workspace.name, workspace.path))}
                </>
              ) : null}
              {groups.map((group) => (
                <React.Fragment key={group.category}>
                  {heading(group.category)}
                  {group.items.map((workspace) => row(workspace.id, workspace, workspace.name, workspace.path ?? workspace.status))}
                </React.Fragment>
              ))}
              {workspaces && needle && groups.length === 0 && chatWorkspaces.length === 0 ? (
                <p className="px-2 py-3 text-xs text-[var(--muted)]">No workspace matches “{query.trim()}”.</p>
              ) : null}
              {!workspaces && !error ? <p className="px-2 py-3 text-xs text-[var(--muted)]">Loading workspaces…</p> : null}
              {error ? <p role="alert" className="px-2 py-2 text-xs text-[var(--red)]">{error}</p> : null}
            </div>
            <div className="border-t border-[var(--border-subtle)] p-1">
              <button
                type="button"
                onClick={() => { setOpen(false); openWorkspacesSettings(); }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-medium)] px-2 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              >
                <GearIcon />
                Manage workspaces…
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        onClick={openWorkspacesSettings}
        title="Workspace settings"
        aria-label="Workspace settings"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
      >
        <GearIcon />
      </button>
    </div>
  );
}
