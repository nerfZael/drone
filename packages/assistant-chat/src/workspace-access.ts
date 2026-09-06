export const MAX_CHAT_WORKSPACES = 100;

export type WorkspacePermissions = { read: boolean; write: boolean; execute: boolean };

export type ChatWorkspaceTarget = WorkspacePermissions & {
  id: string;
  kind: 'drone' | 'host' | 'remote';
  deviceId: string;
  deviceName: string;
  name: string;
  droneId?: string;
  workspaceId?: string;
};

export type ChatWorkspaceAccess = {
  targets: ChatWorkspaceTarget[];
  defaultTargetId: string | null;
};

export type ChatWorkspaceOption = ChatWorkspaceTarget & {
  path?: string;
  runtime?: string;
  status?: string;
  repository?: boolean;
};

export type ChatWorkspaceCatalog = {
  revision: string;
  access: ChatWorkspaceAccess;
  defaults: ChatWorkspaceAccess;
  workspaces: ChatWorkspaceOption[];
  devices: Array<{ id: string; name: string; error?: string }>;
};

/** Strict at the save boundary; an empty selection intentionally grants no workspace access. */
export function parseChatWorkspaceAccess(value: unknown): ChatWorkspaceAccess {
  const raw = value as ChatWorkspaceAccess;
  if (!raw || !Array.isArray(raw.targets) || raw.targets.length > MAX_CHAT_WORKSPACES)
    throw new Error(`Select at most ${MAX_CHAT_WORKSPACES} workspaces.`);
  const ids = new Set<string>();
  const targets = raw.targets.map((item) => {
    const text = (value: unknown) => {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > 500 ||
        /[\0\r\n]/.test(value)
      )
        throw new Error('Invalid workspace identity.');
      return value;
    };
    const deviceId = text(item.deviceId);
    const kind = item.kind;
    if (kind !== 'drone' && kind !== 'host' && kind !== 'remote')
      throw new Error('Invalid workspace kind.');
    const droneId = kind === 'drone' ? text(item.droneId) : undefined;
    const workspaceId = kind !== 'drone' ? text(item.workspaceId) : undefined;
    const id =
      kind === 'drone'
        ? `drone:${droneId}`
        : kind === 'host'
          ? `host:${workspaceId}`
          : `remote:${deviceId}:${workspaceId}`;
    if (item.id !== id || ids.has(id)) throw new Error('Invalid or duplicate workspace.');
    ids.add(id);
    if (
      ![item.read, item.write, item.execute].every((permission) => typeof permission === 'boolean')
    )
      throw new Error('Invalid workspace permissions.');
    if (!item.read && !item.write && !item.execute)
      throw new Error('Remove workspaces with no access.');
    return {
      id,
      kind,
      deviceId,
      deviceName: text(item.deviceName),
      name: text(item.name),
      ...(droneId ? { droneId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      read: item.read,
      write: item.write,
      execute: item.execute,
    };
  });
  if (raw.defaultTargetId !== null && !ids.has(raw.defaultTargetId))
    throw new Error('Choose a default from the selected workspaces.');
  if (targets.length > 0 && raw.defaultTargetId === null)
    throw new Error('Choose a default workspace.');
  return { targets, defaultTargetId: raw.defaultTargetId };
}

const permissions = ['read', 'write', 'execute'] as const;

export function validateChatWorkspaceSelection(
  access: ChatWorkspaceAccess,
  previous: ChatWorkspaceAccess,
  available: ChatWorkspaceOption[],
): ChatWorkspaceAccess {
  return {
    ...access,
    targets: access.targets.map((target) => {
      const option = available.find((item) => item.id === target.id);
      const old = previous.targets.find((item) => item.id === target.id);
      // Offline or removed targets may be retained with reduced permissions, never expanded.
      const ceiling = option ?? old;
      if (!ceiling || permissions.some((permission) => target[permission] && !ceiling[permission]))
        throw new Error(`Access is unavailable for ${target.name}. Refresh the workspaces.`);
      return { ...ceiling, read: target.read, write: target.write, execute: target.execute };
    }),
  };
}
