import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hostDroneWorkspacePath } from '../../host/runtime';
import { listCanonicalRepositories } from '../groups-repositories';
import { loadDroneSummaryRegistry } from '../drone-summary-registry';
import { userWorkspaces, userWorkspaceTargetId } from '../user-workspaces';

export type HostWorkspace = {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  repository: boolean;
  /** Set when the folder is the private workspace generated for one host drone. */
  droneName?: string;
  /** Set when the user added this workspace (Settings → Workspaces). */
  userWorkspace?: true;
};

export function hostWorkspaceFilesystemEntry(workspace: HostWorkspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    runtime: 'host' as const,
    cwd: workspace.path,
    repoPath: workspace.repository ? workspace.path : '',
  };
}

export async function assertHostWorkspacePath(root: string, target: string): Promise<void> {
  const inside = (base: string, candidate: string) => {
    const relative = path.relative(base, candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const deny = () => new Error('Path must stay inside the selected workspace.');
  if (!inside(root, target)) throw deny();
  const realRoot = await fs.realpath(root);
  // For new files/directories, validate the nearest existing ancestor as well as existing files.
  let candidate = target;
  while (true) {
    try {
      await fs.lstat(candidate);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw deny();
      candidate = parent;
      continue;
    }
    const realCandidate = await fs.realpath(candidate); // Dangling links are never safe destinations.
    if (!inside(realRoot, realCandidate)) throw deny();
    return;
  }
}

export function hostWorkspaceRoot(drone: { cwd?: string; repoPath?: string }): string {
  const cwd = String(drone.cwd ?? '').trim();
  const repo = String(drone.repoPath ?? '').trim();
  return path.resolve(path.isAbsolute(cwd) ? cwd : path.isAbsolute(repo) ? repo : os.homedir());
}

export function hostWorkspaceId(root: string): string {
  return `host:${crypto.createHash('sha256').update(path.resolve(root)).digest('hex')}`;
}

export function buildHostWorkspaces(
  drones: Array<{ id?: string; name?: string; runtime?: string; cwd?: string; repoPath?: string }>,
  repositories: string[],
  added: Array<{ id: string; name: string; root: string }> = [],
): HostWorkspace[] {
  const repoPaths = new Set(
    [...repositories, ...drones.map((drone) => drone.repoPath ?? '')]
      .filter((root) => path.isAbsolute(root))
      .map((root) => path.resolve(root)),
  );
  const hostDrones = drones.filter((drone) => drone.runtime === 'host');
  const roots = new Set([...repoPaths, ...hostDrones.map(hostWorkspaceRoot)]);
  // A host drone without a repository works in a generated directory of its
  // own; that folder is only meaningful under the drone's name.
  const privateWorkspaceDroneNames = new Map<string, string>();
  for (const drone of hostDrones) {
    if (!drone.id) continue;
    const root = hostWorkspaceRoot(drone);
    if (root !== path.resolve(hostDroneWorkspacePath(drone.id))) continue;
    if (!privateWorkspaceDroneNames.has(root))
      privateWorkspaceDroneNames.set(root, String(drone.name || drone.id));
  }
  const user: HostWorkspace[] = added.map((workspace) => {
    const id = userWorkspaceTargetId(workspace.id);
    const root = path.resolve(workspace.root);
    return { id, workspaceId: id.slice('host:'.length), name: workspace.name, path: root, repository: repoPaths.has(root), userWorkspace: true };
  });
  const discovered: HostWorkspace[] = [...roots]
    .map((root) => {
      const id = hostWorkspaceId(root);
      const droneName = privateWorkspaceDroneNames.get(root);
      return {
        id,
        workspaceId: id.slice('host:'.length),
        name: droneName ?? (path.basename(root) || root),
        path: root,
        repository: repoPaths.has(root),
        ...(droneName ? { droneName } : {}),
      };
    });
  return [...discovered, ...user].sort((a, b) => a.path.localeCompare(b.path));
}

/** Resolve from the device's catalog, never from a client-supplied filesystem path. */
export async function listHostWorkspaces(): Promise<HostWorkspace[]> {
  const [registry, repositories, added] = await Promise.all([
    loadDroneSummaryRegistry(),
    listCanonicalRepositories(),
    userWorkspaces().available(),
  ]);
  return buildHostWorkspaces(
    [...Object.values(registry.drones ?? {}), ...Object.values(registry.pending ?? {})] as any[],
    repositories.map((repo) => repo.path),
    added,
  );
}
