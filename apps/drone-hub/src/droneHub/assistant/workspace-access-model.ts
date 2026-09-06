import type { ChatWorkspaceAccess, ChatWorkspaceOption } from '@drone/assistant-chat';

export type WorkspaceCategory = 'Repositories' | 'Folders' | 'Host drones' | 'Container drones';

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

export function toggleWorkspace(
  access: ChatWorkspaceAccess,
  option: ChatWorkspaceOption,
): ChatWorkspaceAccess {
  if (access.targets.some((target) => target.id === option.id)) {
    return {
      targets: access.targets.filter((target) => target.id !== option.id),
      defaultTargetId: access.defaultTargetId === option.id ? null : access.defaultTargetId,
    };
  }
  return {
    targets: [
      ...access.targets,
      {
        ...option,
        read: option.read,
        write: !option.read && option.write,
        execute: !option.read && !option.write && option.execute,
      },
    ],
    defaultTargetId: access.targets.length === 0 ? option.id : access.defaultTargetId,
  };
}

export function workspaceOptionMeta(option: ChatWorkspaceOption): string {
  const parts = [option.runtime, option.path, option.status].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  if (option.kind === 'drone') return 'Drone workspace';
  if (option.kind === 'host') return 'Folder on this device';
  return 'Shared folder';
}
