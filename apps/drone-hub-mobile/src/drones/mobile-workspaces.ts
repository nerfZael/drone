import type { DroneControlOperation } from '@drone/device-protocol';
import type { MobileDroneSummary } from './drone-sidebar-model';

type RequestDroneControl = (
  destinationId: string,
  operation: DroneControlOperation,
  payload?: any,
  signal?: AbortSignal,
) => Promise<any>;

/** A workspace on the Hub's device the Files page can show; `browseId` is what the file operations take. */
export type BrowsableWorkspace = {
  id: string;
  browseId: string;
  name: string;
  kind: 'folder' | 'drone';
  category: 'Home' | 'Workspaces' | 'Repositories' | 'Folders' | 'Host drones' | 'Container drones';
  path?: string;
  droneId?: string;
  status?: string;
};

/** A workspace the user added on the Hub's device (Settings → Workspaces on the desktop). */
export type MobileUserWorkspace = {
  id: string;
  name: string;
  kind: 'created' | 'linked';
  root: string;
  missing: boolean;
};

/** Another workspace a drone's Files page shows instead of the drone's own files. */
export type ExplorerWorkspaceChoice = Pick<BrowsableWorkspace, 'id' | 'browseId' | 'name' | 'kind' | 'path' | 'droneId'>;

export const WORKSPACE_CATEGORIES: BrowsableWorkspace['category'][] = [
  'Home',
  'Workspaces',
  'Repositories',
  'Folders',
  'Host drones',
  'Container drones',
];
/** Drones shown per group before "more", as on the desktop; a search looks through all of them. */
export const DRONE_CAP = 5;
const DRONE_CATEGORIES = new Set<BrowsableWorkspace['category']>(['Host drones', 'Container drones']);

export async function browseWorkspaces(request: RequestDroneControl, targetId: string, signal?: AbortSignal): Promise<BrowsableWorkspace[]> {
  const result = await request(targetId, 'workspaces.browse', {}, signal);
  return Array.isArray(result?.workspaces) ? result.workspaces : [];
}

export async function listUserWorkspaces(request: RequestDroneControl, targetId: string): Promise<MobileUserWorkspace[]> {
  const result = await request(targetId, 'workspaces.manage', { action: 'list' });
  return Array.isArray(result?.workspaces) ? result.workspaces : [];
}

export async function createUserWorkspace(request: RequestDroneControl, targetId: string, name: string): Promise<MobileUserWorkspace> {
  return (await request(targetId, 'workspaces.manage', { action: 'create', name })).workspace;
}

export async function linkUserWorkspace(request: RequestDroneControl, targetId: string, path: string): Promise<MobileUserWorkspace> {
  return (await request(targetId, 'workspaces.manage', { action: 'link', path })).workspace;
}

export async function renameUserWorkspace(request: RequestDroneControl, targetId: string, id: string, name: string): Promise<void> {
  await request(targetId, 'workspaces.manage', { action: 'rename', id, name });
}

export async function removeUserWorkspace(request: RequestDroneControl, targetId: string, id: string): Promise<void> {
  await request(targetId, 'workspaces.manage', { action: 'remove', id });
}

/** The id pickers and grants use for a workspace the user added. */
export const userWorkspaceTargetId = (id: string) => `host:workspace-${id}`;

/** True when a workspace is the drone's own files (the drone itself, or its folder listed by path). */
export function isOwnWorkspace(workspace: Pick<BrowsableWorkspace, 'kind' | 'droneId' | 'path'>, drone: Pick<MobileDroneSummary, 'id' | 'runtime' | 'cwd' | 'repoPath'>): boolean {
  if (workspace.kind === 'drone') return workspace.droneId === drone.id;
  if (String(drone.runtime ?? '').toLowerCase() !== 'host') return false;
  const own = String(drone.cwd || drone.repoPath || '').replace(/\/+$/, '');
  return Boolean(own) && String(workspace.path ?? '').replace(/\/+$/, '') === own;
}

export type WorkspaceGroup = { category: BrowsableWorkspace['category']; items: BrowsableWorkspace[]; hidden: number };

/**
 * The switcher's sections: what the chat can use first, then every workspace by category. Drone groups show five
 * unless expanded or searched; the workspace shown now always stays visible. The drone's own files are not repeated.
 */
export function workspaceSections(
  workspaces: readonly BrowsableWorkspace[],
  input: {
    drone: Pick<MobileDroneSummary, 'id' | 'runtime' | 'cwd' | 'repoPath'>;
    chatIds: readonly string[];
    query: string;
    expanded: ReadonlySet<string>;
    currentId: string | null;
  },
): { chat: BrowsableWorkspace[]; groups: WorkspaceGroup[] } {
  const needle = input.query.trim().toLowerCase();
  const matches = (workspace: BrowsableWorkspace) =>
    !needle || workspace.name.toLowerCase().includes(needle) || (workspace.path ?? '').toLowerCase().includes(needle);
  const list = workspaces.filter((workspace) => !isOwnWorkspace(workspace, input.drone));
  const chat = input.chatIds
    .map((id) => list.find((workspace) => workspace.id === id))
    .filter((workspace): workspace is BrowsableWorkspace => Boolean(workspace) && matches(workspace!));
  const groups = WORKSPACE_CATEGORIES.map((category) => {
    const all = list.filter((workspace) => workspace.category === category && matches(workspace));
    const capped = DRONE_CATEGORIES.has(category) && !needle && !input.expanded.has(category);
    const items = capped ? all.filter((workspace, index) => index < DRONE_CAP || workspace.id === input.currentId) : all;
    return { category, items, hidden: all.length - items.length };
  }).filter((group) => group.items.length > 0);
  return { chat, groups };
}

/**
 * What the Files page shows for a choice: another drone, or a folder workspace served as a host folder under its id.
 * Null when the choice is the drone's own files or can no longer be shown.
 */
export function explorerWorkspaceDrone(
  choice: ExplorerWorkspaceChoice | null,
  drones: readonly MobileDroneSummary[],
): MobileDroneSummary | null {
  if (!choice) return null;
  if (choice.kind === 'drone') return drones.find((drone) => drone.id === choice.droneId) ?? null;
  if (!choice.path) return null;
  return {
    id: choice.browseId,
    name: choice.name,
    runtime: 'host',
    phase: 'ready',
    status: 'running',
    group: null,
    repoPath: '',
    cwd: choice.path,
    repoAttached: false,
    fleetParentId: null,
    chats: [],
    busyChats: [],
  } as MobileDroneSummary;
}

export function choiceFromWorkspace(workspace: BrowsableWorkspace): ExplorerWorkspaceChoice {
  return {
    id: workspace.id,
    browseId: workspace.browseId,
    name: workspace.name,
    kind: workspace.kind,
    ...(workspace.path ? { path: workspace.path } : {}),
    ...(workspace.droneId ? { droneId: workspace.droneId } : {}),
  };
}
