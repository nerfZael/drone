import React from 'react';
import type { ChatWorkspaceCatalog } from '@drone/assistant-chat';
import { profileStorageKey } from '../../profile-storage';
import { requestJson } from '../http';
import type { DroneSummary } from '../types';
import { droneHomePath, isHostRuntimeDrone } from '../app/helpers';
import type { ExplorerWorkspace } from './explorer-workspace-store';
import { browsableWorkspacesForLinks } from './workspace-links';
import {
  loadBrowsableWorkspaces,
  subscribeChatWorkspacesChanged,
  subscribeWorkspacesChanged,
  type BrowsableWorkspace,
} from './workspaces-client';
import { chatPathRef } from '../app/chat-identity';

/**
 * The workspaces a drone's File Explorer shows below the drone's own files, as roots of their own: those the open
 * chat can use, and those the user added. Tabs from all of them share the drone's editor.
 */
export const OWN_EXPLORER_ROOT = 'own';

export type DroneRoots = {
  /** Added by the user, in the order they were added. */
  pinned: ExplorerWorkspace[];
  /** Workspaces of the chat that the user removed from this explorer. */
  hidden: string[];
  /** Roots the user opened or collapsed; the others start open when added, collapsed when the chat brings them. */
  open: Record<string, boolean>;
  /**
   * The order the user dragged the roots into, `OWN_EXPLORER_ROOT` among them. It keeps roots that are not shown at
   * the moment (another chat's) in their place; a root it does not name goes after the ones it does.
   */
  order: string[];
};

const STORAGE_KEY = profileStorageKey('droneHub.explorerRootsByDrone');
/** Where the Hub kept the one workspace an explorer was switched to, before it showed several. */
const LEGACY_STORAGE_KEY = profileStorageKey('droneHub.explorerWorkspaceByDrone');
const EMPTY: DroneRoots = { pinned: [], hidden: [], open: {}, order: [] };
const listeners = new Set<() => void>();

const validWorkspace = (value: any): value is ExplorerWorkspace =>
  Boolean(value) && typeof value.id === 'string' && typeof value.browseId === 'string' && typeof value.name === 'string'
  && (value.kind === 'folder' || value.kind === 'drone');

function compact(workspace: ExplorerWorkspace): ExplorerWorkspace {
  return {
    id: workspace.id, browseId: workspace.browseId, name: workspace.name, kind: workspace.kind,
    ...(workspace.path ? { path: workspace.path } : {}), ...(workspace.droneId ? { droneId: workspace.droneId } : {}),
  };
}

function readRoots(): Record<string, DroneRoots> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored == null) {
      // The workspace each drone's explorer was switched to becomes its first added root.
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}');
      const migrated: Record<string, DroneRoots> = {};
      for (const [droneId, workspace] of Object.entries(legacy && typeof legacy === 'object' ? legacy : {})) {
        // Desktop Editor windows key their own choice by window and drone; they keep it.
        if (droneId.includes('\u0000') || !validWorkspace(workspace)) continue;
        migrated[droneId] = { pinned: [compact(workspace)], hidden: [], open: { [workspace.id]: true }, order: [] };
      }
      return migrated;
    }
    const raw = JSON.parse(stored);
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, DroneRoots> = {};
    for (const [droneId, value] of Object.entries(raw) as [string, any][]) {
      if (!value || typeof value !== 'object') continue;
      out[droneId] = {
        pinned: Array.isArray(value.pinned) ? value.pinned.filter(validWorkspace).map(compact) : [],
        hidden: Array.isArray(value.hidden) ? value.hidden.filter((id: unknown) => typeof id === 'string') : [],
        open: value.open && typeof value.open === 'object'
          ? Object.fromEntries(Object.entries(value.open).filter(([, open]) => typeof open === 'boolean')) as Record<string, boolean>
          : {},
        order: Array.isArray(value.order) ? [...new Set(value.order.filter((id: unknown) => typeof id === 'string') as string[])] : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

let byDrone: Record<string, DroneRoots> = typeof localStorage === 'undefined' ? {} : readRoots();

function notify(): void {
  for (const listener of listeners) listener();
}

function update(droneIdRaw: string, change: (current: DroneRoots) => DroneRoots): void {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return;
  const current = byDrone[droneId] ?? EMPTY;
  const next = change(current);
  if (next === current) return;
  byDrone = { ...byDrone, [droneId]: next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byDrone));
  } catch {
    // The roots still hold for this session.
  }
  notify();
}

/** Adds a workspace as a root of a drone's explorer, open; one the chat brings is shown again if it was removed. */
export function addExplorerRoot(droneId: string, workspace: ExplorerWorkspace): void {
  update(droneId, (current) => ({
    pinned: current.pinned.some((item) => item.id === workspace.id)
      ? current.pinned.map((item) => (item.id === workspace.id ? compact(workspace) : item))
      : [...current.pinned, compact(workspace)],
    hidden: current.hidden.filter((id) => id !== workspace.id),
    open: { ...current.open, [workspace.id]: true },
    order: current.order,
  }));
}

/** Removes a root from a drone's explorer; a workspace of the chat stays away until it is added again. */
export function removeExplorerRoot(droneId: string, workspaceId: string, fromChat: boolean): void {
  update(droneId, (current) => {
    const open = { ...current.open };
    delete open[workspaceId];
    return {
      pinned: current.pinned.filter((item) => item.id !== workspaceId),
      hidden: fromChat && !current.hidden.includes(workspaceId) ? [...current.hidden, workspaceId] : current.hidden,
      open,
      order: current.order.filter((id) => id !== workspaceId),
    };
  });
}

/** Opens or collapses a root (`OWN_EXPLORER_ROOT` for the drone's own files). */
export function setExplorerRootOpen(droneId: string, rootId: string, open: boolean): void {
  update(droneId, (current) => (current.open[rootId] === open ? current : { ...current, open: { ...current.open, [rootId]: open } }));
}

/**
 * The roots shown in `shown` order after a drag, written into the saved order. Roots it does not show keep their
 * place after the root they followed, so moving roots with one chat open leaves another chat's roots where they were.
 */
export function mergeExplorerRootOrder(saved: readonly string[], shown: readonly string[]): string[] {
  const next = [...shown];
  const shownSet = new Set(shown);
  let after: string | null = null;
  for (const id of saved) {
    if (shownSet.has(id)) {
      after = id;
      continue;
    }
    if (next.includes(id)) continue;
    next.splice(after === null ? 0 : next.indexOf(after) + 1, 0, id);
    after = id;
  }
  return next;
}

/** Puts roots in the saved order; the ones it does not name keep their own order, after it. */
export function orderExplorerRoots<T>(items: readonly T[], idOf: (item: T) => string, order: readonly string[]): T[] {
  const index = new Map(order.map((id, at) => [id, at]));
  return items
    .map((item, at) => ({ item, at, rank: index.get(idOf(item)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map(({ item }) => item);
}

/** `shown` with `movedId` put before or after `targetId`; null when that leaves every root where it is. */
export function movedExplorerRootOrder(shown: readonly string[], movedId: string, targetId: string, placement: 'before' | 'after'): string[] | null {
  if (movedId === targetId || !shown.includes(movedId) || !shown.includes(targetId)) return null;
  const next = shown.filter((id) => id !== movedId);
  next.splice(next.indexOf(targetId) + (placement === 'after' ? 1 : 0), 0, movedId);
  return next.every((id, at) => id === shown[at]) ? null : next;
}

/** Moves a drone's root `movedId` to before or after `targetId`; `shown` is every root in view, in its order now. */
export function moveExplorerRoot(droneId: string, shown: readonly string[], movedId: string, targetId: string, placement: 'before' | 'after'): void {
  const next = movedExplorerRootOrder(shown, movedId, targetId, placement);
  if (next) update(droneId, (current) => ({ ...current, order: mergeExplorerRootOrder(current.order, next) }));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function useDroneRoots(droneId: string): DroneRoots {
  return React.useSyncExternalStore(subscribe, () => byDrone[droneId] ?? EMPTY, () => EMPTY);
}

/** The order the user dragged a drone's explorer roots into. */
export function useExplorerRootOrder(droneId: string): string[] {
  return useDroneRoots(droneId).order;
}

export type ExplorerRootReveal = { path: string; sequence: number; kind: 'file' | 'directory' };
const reveals = new Map<string, ExplorerRootReveal>();
let revealSequence = 0;
const revealKey = (droneId: string, rootId: string) => `${droneId}\u0000${rootId}`;

/** Asks a root of a drone's explorer to show `path`, opening the root. */
export function revealInExplorerRoot(droneId: string, rootId: string, path: string, kind: 'file' | 'directory' = 'file'): void {
  reveals.set(revealKey(droneId, rootId), { path, kind, sequence: ++revealSequence });
  setExplorerRootOpen(droneId, rootId, true);
  notify();
}

export function useExplorerRootReveal(droneId: string, rootId: string): ExplorerRootReveal | null {
  const key = revealKey(droneId, rootId);
  return React.useSyncExternalStore(subscribe, () => reveals.get(key) ?? null, () => null);
}

export type ExplorerRoot = {
  workspace: ExplorerWorkspace;
  /** The workspace as the file routes take it: another drone, or a folder served as a host drone under its id. */
  drone: DroneSummary;
  /** The open chat can use it. */
  fromChat: boolean;
  /** The user added it. */
  pinned: boolean;
  open: boolean;
};

export function explorerRootDrone(workspace: ExplorerWorkspace, droneById: Record<string, DroneSummary>): DroneSummary | null {
  if (workspace.kind === 'drone') return workspace.droneId ? droneById[workspace.droneId] ?? null : null;
  if (!workspace.path) return null;
  return { id: workspace.browseId, name: workspace.name, runtime: 'host', cwd: workspace.path, repoPath: '', repoAttached: false } as DroneSummary;
}

const trimmed = (path: string | undefined) => `/${String(path ?? '').split('/').filter(Boolean).join('/')}`;

/** The drone's own files, which its explorer always shows first: its container, or the folder a host drone is in. */
export function isOwnExplorerWorkspace(drone: DroneSummary, workspace: Pick<ExplorerWorkspace, 'kind' | 'droneId' | 'path'>): boolean {
  if (workspace.kind === 'drone') return workspace.droneId === drone.id;
  return isHostRuntimeDrone(drone) && trimmed(workspace.path) === trimmed(droneHomePath(drone));
}

/**
 * A drone's explorer roots after its own files: the open chat's workspaces (unless removed), then the ones the user
 * added. `workspaces` is every workspace this device can browse, null until loaded.
 */
export function explorerRootsFor({ drone, chatIds, workspaces, state, droneById }: {
  drone: DroneSummary;
  chatIds: readonly string[];
  workspaces: readonly BrowsableWorkspace[] | null;
  state: DroneRoots;
  droneById: Record<string, DroneSummary>;
}): ExplorerRoot[] {
  const out: ExplorerRoot[] = [];
  const byId = new Map<string, ExplorerRoot>();
  const add = (workspace: ExplorerWorkspace, fromChat: boolean) => {
    const existing = byId.get(workspace.id);
    if (existing) {
      if (fromChat) existing.fromChat = true;
      else existing.pinned = true;
      return;
    }
    if (isOwnExplorerWorkspace(drone, workspace)) return;
    const rootDrone = explorerRootDrone(workspace, droneById);
    if (!rootDrone) return;
    const root: ExplorerRoot = { workspace: compact(workspace), drone: rootDrone, fromChat, pinned: !fromChat, open: false };
    byId.set(workspace.id, root);
    out.push(root);
  };
  if (workspaces) {
    for (const id of chatIds) {
      if (state.hidden.includes(id)) continue;
      const workspace = workspaces.find((item) => item.id === id);
      if (workspace) add(workspace, true);
    }
  }
  for (const pinned of state.pinned) {
    // Until the list is loaded, the remembered entry lists at once; a workspace since removed then drops out.
    const workspace = workspaces ? workspaces.find((item) => item.id === pinned.id) : pinned;
    if (workspace) add(workspace, false);
  }
  for (const root of out) root.open = state.open[root.workspace.id] ?? root.pinned;
  return out;
}

const NO_IDS: string[] = [];
/** Each chat's workspaces as last heard, so coming back to a chat shows its roots at once. */
const chatWorkspaceIds = new Map<string, string[]>();

export function useExplorerRoots({ drone, chatName, droneById }: {
  drone: DroneSummary | null;
  chatName: string | null;
  droneById: Record<string, DroneSummary>;
}): { roots: ExplorerRoot[]; ownOpen: boolean; workspaces: BrowsableWorkspace[] | null } {
  const droneId = String(drone?.id ?? '').trim();
  const state = useDroneRoots(droneId);
  const [workspaces, setWorkspaces] = React.useState<BrowsableWorkspace[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const apply = (all: BrowsableWorkspace[]) => { if (!cancelled) setWorkspaces(all); };
    void browsableWorkspacesForLinks().then(apply, () => undefined);
    // A fresh list: the cached one may not have heard of the change yet.
    const unsubscribe = subscribeWorkspacesChanged(() => void loadBrowsableWorkspaces().then(apply, () => undefined));
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  const [chat, setChat] = React.useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const chatKey = droneId && chatName ? `${droneId}\u0000${chatName}` : '';
  React.useEffect(() => {
    if (!chatKey) return;
    let cancelled = false;
    let request = 0;
    const load = () => {
      const current = ++request;
      void requestJson<ChatWorkspaceCatalog>(`/api/drones/${encodeURIComponent(droneId)}/chats/${chatPathRef(droneId, chatName)}/workspaces`)
        .then((catalog) => {
          if (cancelled || current !== request) return;
          const ids = (catalog?.access.targets ?? []).filter((target) => target.kind !== 'remote').map((target) => target.id);
          chatWorkspaceIds.set(chatKey, ids);
          setChat((previous) => (previous.key === chatKey && previous.ids.join('\u0000') === ids.join('\u0000') ? previous : { key: chatKey, ids }));
        })
        // A chat that cannot be asked brings no roots; the ones it brought stay until it can.
        .catch(() => undefined);
    };
    load();
    const unsubscribeChat = subscribeChatWorkspacesChanged(load);
    const unsubscribeWorkspaces = subscribeWorkspacesChanged(load);
    return () => { cancelled = true; unsubscribeChat(); unsubscribeWorkspaces(); };
  }, [chatKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const chatIds = chat.key === chatKey ? chat.ids : chatWorkspaceIds.get(chatKey) ?? NO_IDS;

  const roots = React.useMemo(
    () => (drone ? explorerRootsFor({ drone, chatIds, workspaces, state, droneById }) : []),
    [chatIds, drone, droneById, state, workspaces],
  );

  return { roots, ownOpen: state.open[OWN_EXPLORER_ROOT] ?? true, workspaces };
}
