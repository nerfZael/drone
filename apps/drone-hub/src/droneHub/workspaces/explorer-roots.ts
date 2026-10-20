import React from 'react';
import { profileStorageKey } from '../../profile-storage';
import type { DroneSummary } from '../types';
import { droneHomePath, isHostRuntimeDrone } from '../app/helpers';
import type { ExplorerWorkspace } from './explorer-workspace-store';
import { browsableWorkspacesForLinks } from './workspace-links';
import { loadBrowsableWorkspaces, subscribeWorkspacesChanged, type BrowsableWorkspace } from './workspaces-client';

/**
 * The workspaces a drone's File Explorer shows below the drone's own files, as roots of their own: those added to it,
 * by the user or by opening a link or a chat's home there. They belong to the drone, whichever of its chats is open.
 * Tabs from all of them share the drone's editor.
 */
export const OWN_EXPLORER_ROOT = 'own';

export type DroneRoots = {
  /** Added to this explorer, in the order they were added. */
  pinned: ExplorerWorkspace[];
  /** Roots the user opened or collapsed; the others are open. */
  open: Record<string, boolean>;
  /**
   * The order the user dragged the roots into, `OWN_EXPLORER_ROOT` among them. It keeps roots that are not shown at
   * the moment (a workspace not loaded yet) in their place; a root it does not name goes after the ones it does.
   */
  order: string[];
};

const STORAGE_KEY = profileStorageKey('droneHub.explorerRootsByDrone');
/** Where the Hub kept the one workspace an explorer was switched to, before it showed several. */
const LEGACY_STORAGE_KEY = profileStorageKey('droneHub.explorerWorkspaceByDrone');
const EMPTY: DroneRoots = { pinned: [], open: {}, order: [] };
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
        migrated[droneId] = { pinned: [compact(workspace)], open: { [workspace.id]: true }, order: [] };
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

/** Adds a workspace as a root of a drone's explorer, open. */
export function addExplorerRoot(droneId: string, workspace: ExplorerWorkspace): void {
  update(droneId, (current) => ({
    pinned: current.pinned.some((item) => item.id === workspace.id)
      ? current.pinned.map((item) => (item.id === workspace.id ? compact(workspace) : item))
      : [...current.pinned, compact(workspace)],
    open: { ...current.open, [workspace.id]: true },
    order: current.order,
  }));
}

function withoutRoots(current: DroneRoots, removed: (workspaceId: string) => boolean): DroneRoots {
  if (!current.pinned.some((item) => removed(item.id))) return current;
  return {
    pinned: current.pinned.filter((item) => !removed(item.id)),
    open: Object.fromEntries(Object.entries(current.open).filter(([id]) => !removed(id))),
    order: current.order.filter((id) => !removed(id)),
  };
}

/** Removes a root from a drone's explorer. */
export function removeExplorerRoot(droneId: string, workspaceId: string): void {
  update(droneId, (current) => withoutRoots(current, (id) => id === workspaceId));
}

/** Removes the workspaces `removed` picks from every drone's explorer. */
export function removeExplorerRootsEverywhere(removed: (workspaceId: string) => boolean): void {
  for (const droneId of Object.keys(byDrone)) update(droneId, (current) => withoutRoots(current, removed));
}

/** Opens or collapses a root (`OWN_EXPLORER_ROOT` for the drone's own files). */
export function setExplorerRootOpen(droneId: string, rootId: string, open: boolean): void {
  update(droneId, (current) => (current.open[rootId] === open ? current : { ...current, open: { ...current.open, [rootId]: open } }));
}

/**
 * The roots shown in `shown` order after a drag, written into the saved order. Roots it does not show keep their
 * place after the root they followed.
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

/** A drone's explorer roots as kept, for callers outside React. */
export function explorerRootsState(droneId: string): DroneRoots {
  return byDrone[droneId] ?? EMPTY;
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
 * A drone's explorer roots after its own files: the ones added to it. `workspaces` is every workspace this device can
 * browse, null until loaded.
 */
export function explorerRootsFor({ drone, workspaces, state, droneById }: {
  drone: DroneSummary;
  workspaces: readonly BrowsableWorkspace[] | null;
  state: DroneRoots;
  droneById: Record<string, DroneSummary>;
}): ExplorerRoot[] {
  const out: ExplorerRoot[] = [];
  for (const pinned of state.pinned) {
    // Until the list is loaded, the remembered entry lists at once; a workspace since removed then drops out.
    const workspace = workspaces ? workspaces.find((item) => item.id === pinned.id) : pinned;
    if (!workspace || isOwnExplorerWorkspace(drone, workspace) || out.some((root) => root.workspace.id === workspace.id)) continue;
    const rootDrone = explorerRootDrone(workspace, droneById);
    if (!rootDrone) continue;
    out.push({ workspace: compact(workspace), drone: rootDrone, open: state.open[workspace.id] ?? true });
  }
  return out;
}

export function useExplorerRoots({ drone, droneById }: {
  drone: DroneSummary | null;
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

  const roots = React.useMemo(
    () => (drone ? explorerRootsFor({ drone, workspaces, state, droneById }) : []),
    [drone, droneById, state, workspaces],
  );

  return { roots, ownOpen: state.open[OWN_EXPLORER_ROOT] ?? true, workspaces };
}
