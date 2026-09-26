import type { ChatWorkspaceAccess, ChatWorkspaceOption, ChatWorkspaceTarget } from '@drone/assistant-chat';

export type WorkspaceCategory = 'Repositories' | 'Folders' | 'Host drones' | 'Container drones';
export type Permission = 'read' | 'write' | 'execute';

/** Folders and repositories list first so a large drone fleet never buries them. */
export const WORKSPACE_CATEGORIES: readonly WorkspaceCategory[] = [
  'Repositories',
  'Folders',
  'Host drones',
  'Container drones',
];

export function workspaceCategory(option: ChatWorkspaceOption): WorkspaceCategory {
  if (option.kind === 'host' && option.repository) return 'Repositories';
  if (option.kind === 'host' && option.runtime === 'host') return 'Host drones';
  if (option.kind === 'drone' && option.runtime !== 'host') return 'Container drones';
  return 'Folders';
}

export function workspaceAccessSignature(access: ChatWorkspaceAccess): string {
  return JSON.stringify([
    access.defaultTargetId,
    access.targets
      .map((target) => [target.id, target.read, target.write, target.execute])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

/** Keeps a default while anything is selected, and only one that is. */
function withDefault(access: ChatWorkspaceAccess): ChatWorkspaceAccess {
  const ok = access.targets.some((target) => target.id === access.defaultTargetId);
  return { ...access, defaultTargetId: ok ? access.defaultTargetId : (access.targets[0]?.id ?? null) };
}

/** Adds a workspace with Read (the first permission it offers, if not Read). */
export function addWorkspace(access: ChatWorkspaceAccess, option: ChatWorkspaceOption): ChatWorkspaceAccess {
  if (access.targets.some((target) => target.id === option.id)) return access;
  const first: Permission | undefined = option.read ? 'read' : option.write ? 'write' : option.execute ? 'execute' : undefined;
  if (!first) return access;
  const target: ChatWorkspaceTarget = { ...option, read: first === 'read', write: first === 'write', execute: first === 'execute' };
  return withDefault({ ...access, targets: [...access.targets, target] });
}

export function removeWorkspace(access: ChatWorkspaceAccess, id: string): ChatWorkspaceAccess {
  return withDefault({ ...access, targets: access.targets.filter((target) => target.id !== id) });
}

/**
 * Sets one permission. Write and Run include Read (where Read is offered); Read off removes the workspace, and so
 * does turning off its last permission. `offered` is what the workspace allows at all.
 */
export function setPermission(
  access: ChatWorkspaceAccess,
  option: ChatWorkspaceOption,
  permission: Permission,
  value: boolean,
  offered: Record<Permission, boolean>,
): ChatWorkspaceAccess {
  if (value && !offered[permission]) return access;
  const current = access.targets.find((target) => target.id === option.id);
  if (!current) {
    if (!value) return access;
    const added = addWorkspace(access, option);
    return permission === 'read' ? added : setPermission(added, option, permission, true, offered);
  }
  if (permission === 'read' && !value) return removeWorkspace(access, option.id);
  const next = { ...current, [permission]: value };
  if (value && permission !== 'read' && offered.read) next.read = true;
  if (!next.read && !next.write && !next.execute) return removeWorkspace(access, option.id);
  return { ...access, targets: access.targets.map((target) => (target.id === option.id ? next : target)) };
}

export function workspaceOptionMeta(option: ChatWorkspaceOption): string {
  const parts = [option.runtime, option.path, option.status].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  if (option.kind === 'drone') return 'Drone workspace';
  if (option.kind === 'host') return 'Folder on this device';
  return 'Shared folder';
}
