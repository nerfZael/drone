import path from 'node:path';
import { listHostWorkspaces } from './assistant/host-workspaces';

/**
 * Folders on the Hub host that are browsed like a host drone's folder (explorer, editor, live file events)
 * without being drones: Companion home, the entity workspace, and every folder in this device's workspace catalog
 * (repositories, host drone folders, workspaces the user added) under its `host:` id. The file routes confine every
 * path to the root.
 */
export interface FolderWorkspace {
  id: string;
  name: string;
  root(): Promise<string>;
  /** Offered in the explorer's workspace switcher (Companion home, the entity's home), not just reachable by id. */
  listed?: boolean;
}

const workspaces = new Map<string, FolderWorkspace>();

export function registerFolderWorkspace(workspace: FolderWorkspace): void {
  workspaces.set(workspace.id, workspace);
}

/** Registered folders the explorer's workspace switcher offers, with their roots. */
export async function listedFolderWorkspaces(): Promise<Array<{ id: string; name: string; path: string }>> {
  const listed = [...workspaces.values()].filter((workspace) => workspace.listed);
  return await Promise.all(listed.map(async (workspace) => ({ id: workspace.id, name: workspace.name, path: path.resolve(await workspace.root()) })));
}

/** The synthetic host drone the file routes and workspace events use for a registered folder, or null. */
export async function resolveFolderWorkspace(ref: unknown): Promise<{
  id: string;
  drone: { id: string; name: string; runtime: 'host'; cwd: string; repoPath: string; gitIgnoreMetadata: false; confineRoot: string };
} | null> {
  const id = String(ref ?? '').trim();
  const workspace: FolderWorkspace | undefined = workspaces.get(id) ?? (id.startsWith('host:') ? await catalogFolder(id) : undefined);
  if (!workspace) return null;
  const root = path.resolve(await workspace.root());
  return { id: workspace.id, drone: { id: workspace.id, name: workspace.name, runtime: 'host', cwd: root, repoPath: '', gitIgnoreMetadata: false, confineRoot: root } };
}

/** A folder from the catalog, resolved by id only: a client never names the path it browses. */
async function catalogFolder(id: string): Promise<FolderWorkspace | undefined> {
  const folder = (await listHostWorkspaces()).find((item) => item.id === id);
  return folder ? { id: folder.id, name: folder.name, root: async () => folder.path } : undefined;
}

/** Throws EACCES when a host path escapes a folder workspace's root. */
export function assertInsideFolderWorkspace(root: string, candidate: string): void {
  const relative = path.relative(root, path.resolve(root, candidate));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('That path is outside this workspace.'), { code: 'EACCES' });
  }
}
