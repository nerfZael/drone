import path from 'node:path';

/**
 * Folders on the Hub host that are browsed like a host drone's folder (explorer, editor, live file events)
 * without being drones: Companion home, the entity workspace. The file routes confine every path to the root.
 */
export interface FolderWorkspace {
  id: string;
  name: string;
  root(): Promise<string>;
}

const workspaces = new Map<string, FolderWorkspace>();

export function registerFolderWorkspace(workspace: FolderWorkspace): void {
  workspaces.set(workspace.id, workspace);
}

/** The synthetic host drone the file routes and workspace events use for a registered folder, or null. */
export async function resolveFolderWorkspace(ref: unknown): Promise<{
  id: string;
  drone: { id: string; name: string; runtime: 'host'; cwd: string; repoPath: string; gitIgnoreMetadata: false; confineRoot: string };
} | null> {
  const workspace = workspaces.get(String(ref ?? '').trim());
  if (!workspace) return null;
  const root = path.resolve(await workspace.root());
  return { id: workspace.id, drone: { id: workspace.id, name: workspace.name, runtime: 'host', cwd: root, repoPath: '', gitIgnoreMetadata: false, confineRoot: root } };
}

/** Throws EACCES when a host path escapes a folder workspace's root. */
export function assertInsideFolderWorkspace(root: string, candidate: string): void {
  const relative = path.relative(root, path.resolve(root, candidate));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('That path is outside this workspace.'), { code: 'EACCES' });
  }
}
