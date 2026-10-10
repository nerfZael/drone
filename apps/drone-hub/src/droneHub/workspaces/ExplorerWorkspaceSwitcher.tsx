import React from 'react';
import { Popover } from 'radix-ui';
import type { ChatWorkspaceCatalog } from '@drone/assistant-chat';
import { requestJson } from '../http';
import { IconSpinner } from '../icons';
import { setExplorerWorkspace, type ExplorerWorkspace } from './explorer-workspace-store';
import {
  loadBrowsableWorkspaces,
  openWorkspaceFolder,
  openWorkspacesSettings,
  subscribeWorkspacesChanged,
  type BrowsableWorkspace,
} from './workspaces-client';

const CATEGORIES: BrowsableWorkspace['category'][] = ['Home', 'Workspaces', 'Repositories', 'Folders', 'Host drones', 'Container drones'];
const DRONE_CATEGORIES = new Set<BrowsableWorkspace['category']>(['Host drones', 'Container drones']);
/** Drones shown per group before "more", as in the workspace picker; a search looks through all of them. */
const DRONE_CAP = 5;

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

function OpenFolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M1.75 12.25v-8c0-.55.45-1 1-1h3.1l1.4 1.5h5c.55 0 1 .45 1 1v1" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M1.75 12.25 3.4 7.6c.14-.4.52-.67.95-.67h9.4c.69 0 1.17.68.95 1.33l-1.3 3.6c-.14.4-.52.64-.94.64H2.75" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function BackHomeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M2.25 7.25 8 2.5l5.75 4.75M3.75 6v7.25h3v-4h2.5v4h3V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
  ownIsLocal = false,
}: {
  droneId: string;
  /** The drone's own files are a folder on this device (a host drone), so they can open in the file manager. */
  ownIsLocal?: boolean;
  /** Where the choice is kept: the drone's id by default, a desktop Editor window's own key otherwise. */
  storeKey?: string;
  droneName: string;
  /** The drone's own folder, so the same folder listed as a workspace counts as the drone's own. */
  ownPath?: string | null;
  chatName?: string | null;
  current: ExplorerWorkspace | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
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
    if (!open) {
      setExpanded(new Set());
      return;
    }
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

  // Folders on this device open in the system file manager; a container drone's files are not one.
  const openableId = current ? (current.kind === 'folder' ? current.browseId : null) : ownIsLocal ? droneId : null;
  const [openError, setOpenError] = React.useState('');
  React.useEffect(() => {
    if (!openError) return;
    const timer = window.setTimeout(() => setOpenError(''), 6000);
    return () => window.clearTimeout(timer);
  }, [openError]);
  React.useEffect(() => setOpenError(''), [openableId]);
  const openFolder = () => {
    if (!openableId) return;
    setOpenError('');
    void openWorkspaceFolder(openableId).catch((cause) => setOpenError(cause instanceof Error ? cause.message : String(cause)));
  };

  const needle = query.trim().toLowerCase();
  const matches = (workspace: BrowsableWorkspace) =>
    !needle || workspace.name.toLowerCase().includes(needle) || (workspace.path ?? '').toLowerCase().includes(needle);
  const list = (workspaces ?? []).filter((workspace) => !isOwn(workspace));
  const chatWorkspaces = chatIds.map((id) => list.find((workspace) => workspace.id === id)).filter((item): item is BrowsableWorkspace => Boolean(item) && matches(item!));
  const groups = CATEGORIES.map((category) => {
    const all = list.filter((workspace) => workspace.category === category && matches(workspace));
    const capped = DRONE_CATEGORIES.has(category) && !needle && !expanded.has(category);
    // The one shown now stays in the list even past the cap.
    const items = capped ? all.filter((workspace, index) => index < DRONE_CAP || workspace.id === current?.id) : all;
    return { category, items, hidden: all.length - items.length };
  }).filter((group) => group.items.length > 0);
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
                  {group.hidden > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpanded((previous) => new Set(previous).add(group.category))}
                      className="px-2 py-1 text-xs text-[var(--accent)] hover:underline"
                    >
                      + {group.hidden} more
                    </button>
                  ) : null}
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
      {current ? (
        <button
          type="button"
          onClick={() => setExplorerWorkspace(storeKey ?? droneId, null, droneId)}
          title={`Back to ${droneName}`}
          aria-label={`Back to ${droneName}`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        >
          <BackHomeIcon />
        </button>
      ) : null}
      {openableId ? (
        <button
          type="button"
          onClick={openFolder}
          title={openError || 'Open in file manager'}
          aria-label="Open in file manager"
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-medium)] transition-colors hover:bg-[var(--hover)] ${
            openError ? 'text-[var(--red)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'
          }`}
        >
          <OpenFolderIcon />
        </button>
      ) : null}
      {openError ? <span role="alert" className="sr-only">{openError}</span> : null}
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
