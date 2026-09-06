import { parseChatWorkspaceAccess, validateChatWorkspaceSelection } from '@drone/assistant-chat';
import type { ChatWorkspaceAccess, ChatWorkspaceOption } from '@drone/assistant-chat';

export type WorkspaceCategory = 'Repositories' | 'Folders' | 'Host drones' | 'Container drones';

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

/** Refresh destination grants before saving; disconnected targets can only retain or lose access. */
export async function validateMobileWorkspaceSelection(
  requested: ChatWorkspaceAccess,
  previous: ChatWorkspaceAccess,
  load: (deviceId: string) => Promise<ChatWorkspaceOption[]>,
): Promise<ChatWorkspaceAccess> {
  const access = parseChatWorkspaceAccess(requested);
  if (access.targets.some((target) => target.kind !== 'remote'))
    throw new Error('Phone chats can only select shared folders.');
  const devices = [...new Set(access.targets.map((target) => target.deviceId))];
  const options = await Promise.all(
    devices.map(async (deviceId) => {
      try {
        return await load(deviceId);
      } catch {
        return [];
      }
    }),
  );
  return validateChatWorkspaceSelection(access, previous, options.flat());
}
