import {
  formatWorkspaceLink,
  parseWorkspaceLink,
  resolveWorkspaceRef,
  workspaceLinkAbsolutePath,
  workspaceLinkPath,
  workspaceLinkRef,
  type WorkspaceLink,
} from '@drone/assistant-chat';
import type { DroneSummary } from '../types';
import { droneHomePath, isHostRuntimeDrone } from '../app/helpers';
import { loadBrowsableWorkspaces, subscribeWorkspacesChanged, type BrowsableWorkspace } from './workspaces-client';

/**
 * Links to files in workspaces (`workspace://Guides/notes.md#L4`, see `@drone/assistant-chat`): every place that
 * shows a link hands it to `openWorkspaceLink`, and the Hub's window opens it in the File Explorer and the editor.
 */
export const OPEN_WORKSPACE_LINK_EVENT = 'drone-hub:open-workspace-link';
export type OpenWorkspaceLinkDetail = { link: string };

/** Opens a workspace link; false when `raw` is not one. */
export function openWorkspaceLink(raw: string): boolean {
  const link = String(raw ?? '').trim();
  if (!parseWorkspaceLink(link) || typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent<OpenWorkspaceLinkDetail>(OPEN_WORKSPACE_LINK_EVENT, { detail: { link } }));
  return true;
}

let cached: Promise<BrowsableWorkspace[]> | null = null;
let watching = false;

/** The workspaces links resolve against: every one this device can browse, loaded once and again when they change. */
export function browsableWorkspacesForLinks(): Promise<BrowsableWorkspace[]> {
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    subscribeWorkspacesChanged(() => { cached = null; });
  }
  cached ??= loadBrowsableWorkspaces().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

const trimmed = (path: string | undefined) => `/${String(path ?? '').split('/').filter(Boolean).join('/')}`;

/** The workspace that holds a drone's own files: its container, or the folder a host drone works in. */
export function ownWorkspaceOf(drone: DroneSummary, workspaces: readonly BrowsableWorkspace[]): BrowsableWorkspace | null {
  if (!isHostRuntimeDrone(drone)) return workspaces.find((item) => item.kind === 'drone' && item.droneId === drone.id) ?? null;
  const home = trimmed(droneHomePath(drone));
  return workspaces.find((item) => item.kind === 'folder' && trimmed(item.path) === home) ?? null;
}

/**
 * The workspace an explorer shows, from what its file routes take: a folder workspace's browse id, a drone's id, or a
 * host drone, whose folder is the one at its home path.
 */
export function workspaceShownBy(
  shown: { id: string; homePath: string },
  workspaces: readonly BrowsableWorkspace[],
): BrowsableWorkspace | null {
  return workspaces.find((item) => item.kind === 'folder' && item.browseId === shown.id)
    ?? workspaces.find((item) => item.kind === 'drone' && item.droneId === shown.id)
    ?? workspaces.find((item) => item.kind === 'folder' && trimmed(item.path) === trimmed(shown.homePath))
    ?? null;
}

/** A workspace's root on its own filesystem, where a link's relative path starts. */
export function workspaceRoot(workspace: BrowsableWorkspace, droneById: Record<string, DroneSummary>): string | null {
  if (workspace.kind === 'folder') return workspace.path ?? null;
  const drone = workspace.droneId ? droneById[workspace.droneId] : null;
  return drone ? droneHomePath(drone) : null;
}

/**
 * A link to `path` (absolute) in what an explorer shows (`shownId`, `homePath`: as for `workspaceShownBy`), or null
 * when its workspace is not known.
 */
export async function workspaceLinkForPath(input: {
  shownId: string;
  homePath: string;
  path: string;
  line?: number | null;
  column?: number | null;
}): Promise<string | null> {
  const workspaces = await browsableWorkspacesForLinks();
  const workspace = workspaceShownBy({ id: input.shownId, homePath: input.homePath }, workspaces);
  if (!workspace) return null;
  const root = workspace.kind === 'folder' ? workspace.path : input.homePath;
  if (!root) return null;
  return formatWorkspaceLink({
    workspace: workspaceLinkRef(workspace, workspaces),
    path: workspaceLinkPath(root, input.path),
    line: input.line ?? null,
    column: input.line ? input.column ?? null : null,
  });
}

export type ResolvedWorkspaceLink = {
  link: WorkspaceLink;
  workspace: BrowsableWorkspace;
  /** Absolute, on the workspace's own filesystem. */
  path: string;
  /** The link names the workspace itself, not a file in it. */
  root: boolean;
};

/** What a link opens, or why it cannot. */
export async function resolveWorkspaceLink(
  raw: string,
  droneById: Record<string, DroneSummary>,
): Promise<{ ok: true; target: ResolvedWorkspaceLink } | { ok: false; error: string }> {
  const link = parseWorkspaceLink(raw);
  if (!link) return { ok: false, error: `Not a workspace link: ${raw}` };
  let workspace = resolveWorkspaceRef(link.workspace, await browsableWorkspacesForLinks());
  if (!workspace) {
    // The list may predate the workspace, as a chat's home made while this window was reconnecting to the Hub would.
    cached = null;
    workspace = resolveWorkspaceRef(link.workspace, await browsableWorkspacesForLinks());
  }
  if (!workspace) return { ok: false, error: `No workspace named “${link.workspace}” on this device.` };
  const root = workspaceRoot(workspace, droneById);
  if (!root) return { ok: false, error: `“${workspace.name}” is not available right now.` };
  return { ok: true, target: { link, workspace, path: workspaceLinkAbsolutePath(root, link.path), root: !link.path } };
}
