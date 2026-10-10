import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { hostWorkspaceRoot } from './assistant/host-workspaces';
import { resolveCanonicalDroneOrPendingForReadRef } from './drone-lifecycle-service';
import { resolveFolderWorkspace } from './folder-workspaces';

const badRequest = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** The command that opens a folder in this operating system's file manager. */
export function fileManagerCommand(platform: NodeJS.Platform, folder: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [folder]];
  if (platform === 'win32') return ['explorer.exe', [folder]];
  return ['xdg-open', [folder]];
}

/**
 * The folder on this device a File Explorer target shows, by the id the file routes take: a folder workspace
 * (Companion home, the entity's home, a catalog folder) or a host drone. Container drones have no folder here.
 */
export async function localFolderFor(browseId: string): Promise<string> {
  const id = String(browseId ?? '').trim();
  if (!id) throw badRequest('Choose a workspace to open.');
  const folder = await resolveFolderWorkspace(id);
  if (folder) return folder.drone.cwd;
  const resolved = await resolveCanonicalDroneOrPendingForReadRef(id);
  if (!resolved) throw badRequest('That workspace no longer exists.', 404);
  if (resolved.kind === 'pending') throw badRequest('That drone is still starting.', 409);
  if (resolved.drone.runtime !== 'host') throw badRequest('A container drone’s files are not a folder on this device.');
  return hostWorkspaceRoot(resolved.drone as { cwd?: string; repoPath?: string });
}

/** Opens a workspace's folder in the system file manager of the device the Hub runs on. */
export async function openWorkspaceFolder(browseId: string, platform: NodeJS.Platform = process.platform): Promise<{ path: string }> {
  const folder = await localFolderFor(browseId);
  try {
    if (!(await fs.stat(folder)).isDirectory()) throw new Error();
  } catch {
    throw badRequest(`${folder} is not a folder on this device.`, 404);
  }
  const [command, args] = fileManagerCommand(platform, folder);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', env: process.env });
    child.once('error', (error) => reject(badRequest(`Could not open the file manager (${command}): ${error.message}`, 500)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return { path: folder };
}
