import React from 'react';
import { profileStorageKey } from '../../profile-storage';
import type { DroneSummary } from '../types';
import { loadBrowsableWorkspaces, subscribeWorkspacesChanged, type BrowsableWorkspace } from './workspaces-client';

/** Another workspace a drone's File Explorer is pointed at; none means the drone's own. */
export type ExplorerWorkspace = Pick<BrowsableWorkspace, 'id' | 'browseId' | 'name' | 'kind' | 'path' | 'droneId'>;

const STORAGE_KEY = profileStorageKey('droneHub.explorerWorkspaceByDrone');
const listeners = new Set<() => void>();
let byDrone: Record<string, ExplorerWorkspace> = read();

function read(): Record<string, ExplorerWorkspace> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        ([, value]: [string, any]) =>
          value && typeof value.id === 'string' && typeof value.browseId === 'string' && typeof value.name === 'string' && (value.kind === 'folder' || value.kind === 'drone'),
      ),
    ) as Record<string, ExplorerWorkspace>;
  } catch {
    return {};
  }
}

function write(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byDrone));
  } catch {
    // The choice still holds for this session.
  }
}

export function explorerWorkspaceFor(key: string): ExplorerWorkspace | null {
  return byDrone[key] ?? null;
}

/**
 * Points an explorer at a workspace, or back at its drone's own (null, or the drone itself). The key is the drone's
 * id for the Hub's explorer; a desktop Editor window keys its own choice and names its drone as `ownDroneId`.
 */
export function setExplorerWorkspace(key: string, workspace: ExplorerWorkspace | null, ownDroneId: string = key): void {
  const id = String(key ?? '').trim();
  if (!id) return;
  const own = !workspace || (workspace.kind === 'drone' && workspace.droneId === ownDroneId);
  const entry: ExplorerWorkspace | null = own ? null : {
    id: workspace!.id, browseId: workspace!.browseId, name: workspace!.name, kind: workspace!.kind,
    ...(workspace!.path ? { path: workspace!.path } : {}), ...(workspace!.droneId ? { droneId: workspace!.droneId } : {}),
  };
  if (JSON.stringify(byDrone[id] ?? null) === JSON.stringify(entry)) return;
  const next = { ...byDrone };
  if (!entry) delete next[id];
  else next[id] = entry;
  byDrone = next;
  write();
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useExplorerWorkspace(key: string | null | undefined): ExplorerWorkspace | null {
  const id = String(key ?? '').trim();
  return React.useSyncExternalStore(subscribe, () => (id ? byDrone[id] ?? null : null), () => null);
}

/**
 * What a drone's File Explorer shows instead of the drone, as a drone summary the file routes take: another drone, or
 * a folder workspace served as a host folder under its id. Null for the drone's own files, and when the chosen
 * workspace is gone (its choice is then forgotten).
 */
export function useExplorerWorkspaceDrone(
  key: string | null | undefined,
  droneById: Record<string, DroneSummary>,
): { workspace: ExplorerWorkspace | null; drone: DroneSummary | null } {
  const workspace = useExplorerWorkspace(key);
  const id = String(key ?? '').trim();
  // A folder's path is remembered for an immediate listing; check it against the Hub per choice and whenever the
  // workspaces change, since it may have moved or been removed.
  React.useEffect(() => {
    if (!id || workspace?.kind !== 'folder') return;
    let cancelled = false;
    const check = () => void loadBrowsableWorkspaces()
      .then((all) => {
        if (cancelled) return;
        const fresh = all.find((item) => item.id === workspace.id);
        if (!fresh) setExplorerWorkspace(id, null);
        else if (fresh.path !== workspace.path || fresh.name !== workspace.name) setExplorerWorkspace(id, fresh);
      })
      .catch(() => undefined);
    check();
    const unsubscribe = subscribeWorkspacesChanged(check);
    return () => { cancelled = true; unsubscribe(); };
  }, [id, workspace?.id, workspace?.kind, workspace?.path, workspace?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const other = workspace?.kind === 'drone' && workspace.droneId ? droneById[workspace.droneId] ?? null : null;
  React.useEffect(() => {
    // The other drone was deleted: show this drone's own files again.
    if (id && workspace?.kind === 'drone' && Object.keys(droneById).length > 0 && !other) setExplorerWorkspace(id, null);
  }, [id, workspace, other, droneById]);
  const drone = React.useMemo<DroneSummary | null>(() => {
    if (!workspace) return null;
    if (workspace.kind === 'drone') return other;
    if (!workspace.path) return null;
    return { id: workspace.browseId, name: workspace.name, runtime: 'host', cwd: workspace.path, repoPath: '', repoAttached: false } as DroneSummary;
  }, [workspace, other]);
  return { workspace: drone ? workspace : null, drone };
}
