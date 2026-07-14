import type { AssistantMessage } from '@drone/assistant-chat';

export type MobileDroneSummary = {
  id: string;
  name: string;
  runtime: string;
  phase: string;
  status: string;
  group: string | null;
  repoPath: string;
  fleetParentId: string | null;
  chats: string[];
  busyChats: string[];
  createdAt?: string;
  lastActivityAt?: string;
  statusOk?: boolean;
  statusError?: string | null;
};

export type MobileDroneTurn = {
  id: string;
  turn: number | null;
  at: string;
  promptAt: string;
  completedAt: string;
  prompt: string;
  output: string;
  error: string;
  ok: boolean;
  model: string;
  reasoning: string;
  attachments: Array<{ name: string; mime: string; size: number | null }>;
};

export type MobileDroneTreeNode = {
  drone: MobileDroneSummary;
  children: MobileDroneTreeNode[];
};

export type MobileDroneRepoGroup = {
  id: string;
  label: string;
  repoPath: string;
  roots: MobileDroneTreeNode[];
  folders: MobileDroneGroupFolder[];
  droneCount: number;
};

export type MobileDroneGroupFolder = {
  id: string;
  path: string;
  label: string;
  roots: MobileDroneTreeNode[];
  children: MobileDroneGroupFolder[];
  droneCount: number;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function stringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.map(text).filter(Boolean);
  return result.length > 0 ? [...new Set(result)] : fallback;
}

export function normalizeMobileDrone(raw: unknown): MobileDroneSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const repo =
    value.repo && typeof value.repo === 'object' && !Array.isArray(value.repo)
      ? (value.repo as Record<string, unknown>)
      : {};
  const id = text(value.id || value.name);
  if (!id) return null;
  return {
    id,
    name: text(value.name || value.id) || id,
    runtime: text(value.runtime) || 'container',
    phase: text(value.phase),
    status: text(value.status),
    group: text(value.group) || null,
    repoPath:
      text(value.repoPath) ||
      text(value.repositoryPath) ||
      text(repo.path) ||
      text(repo.hostPath) ||
      text(repo.dest),
    fleetParentId: text(value.fleetParentId) || null,
    chats: stringList(value.chats, ['default']),
    busyChats: stringList(value.busyChats),
    createdAt: text(value.createdAt) || undefined,
    lastActivityAt: text(value.lastActivityAt) || undefined,
    statusOk: value.statusOk !== false,
    statusError: text(value.statusError) || null,
  };
}

export function normalizeMobileDrones(raw: unknown): MobileDroneSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const drone = normalizeMobileDrone(item);
    return drone ? [drone] : [];
  });
}

export function normalizeMobileDroneListPayload(raw: unknown): {
  drones: MobileDroneSummary[];
  schemaVersion: number | null;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { drones: [], schemaVersion: null };
  }
  const value = raw as Record<string, unknown>;
  const repoPathByDroneId =
    value.repoPathByDroneId &&
    typeof value.repoPathByDroneId === 'object' &&
    !Array.isArray(value.repoPathByDroneId)
      ? (value.repoPathByDroneId as Record<string, unknown>)
      : {};
  const drones = normalizeMobileDrones(value.drones).map((drone) => ({
    ...drone,
    repoPath: drone.repoPath || text(repoPathByDroneId[drone.id]),
  }));
  return {
    drones,
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isFinite(value.schemaVersion)
        ? value.schemaVersion
        : null,
  };
}

export function mobileRepoLabel(repoPath: string): string {
  const path = text(repoPath);
  if (!path) return 'Ungrouped';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
}

function hasValidParent(drone: MobileDroneSummary, byId: Map<string, MobileDroneSummary>): boolean {
  const parentId = drone.fleetParentId;
  if (!parentId || parentId === drone.id || !byId.has(parentId)) return false;
  const seen = new Set([drone.id]);
  let currentId: string | null = parentId;
  while (currentId) {
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    currentId = byId.get(currentId)?.fleetParentId ?? null;
  }
  return true;
}

function buildGroupTree(drones: MobileDroneSummary[]): MobileDroneTreeNode[] {
  const byId = new Map(drones.map((drone) => [drone.id, drone]));
  const nodes = new Map<string, MobileDroneTreeNode>(
    drones.map((drone) => [drone.id, { drone, children: [] }]),
  );
  const roots: MobileDroneTreeNode[] = [];
  for (const drone of drones) {
    const node = nodes.get(drone.id)!;
    if (hasValidParent(drone, byId)) nodes.get(drone.fleetParentId!)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function normalizedGroupPath(value: string | null): string {
  const path = text(value)
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return path.toLowerCase() === 'ungrouped' ? '' : path;
}

function buildDroneGroupFolders(drones: MobileDroneSummary[]): {
  roots: MobileDroneTreeNode[];
  folders: MobileDroneGroupFolder[];
} {
  const ungrouped: MobileDroneSummary[] = [];
  const dronesByGroup = new Map<string, MobileDroneSummary[]>();
  for (const drone of drones) {
    const groupPath = normalizedGroupPath(drone.group);
    if (!groupPath) {
      ungrouped.push(drone);
      continue;
    }
    const items = dronesByGroup.get(groupPath) ?? [];
    items.push(drone);
    dronesByGroup.set(groupPath, items);
  }

  const foldersByPath = new Map<string, MobileDroneGroupFolder>();
  const folders: MobileDroneGroupFolder[] = [];
  for (const [groupPath, items] of dronesByGroup) {
    const parts = groupPath.split('/').map(text).filter(Boolean);
    let parentChildren = folders;
    for (let index = 0; index < parts.length; index += 1) {
      const path = parts.slice(0, index + 1).join('/');
      let folder = foldersByPath.get(path);
      if (!folder) {
        folder = {
          id: `group:${path}`,
          path,
          label: parts[index]!,
          roots: [],
          children: [],
          droneCount: 0,
        };
        foldersByPath.set(path, folder);
        parentChildren.push(folder);
      }
      folder.droneCount += items.length;
      parentChildren = folder.children;
      if (index === parts.length - 1) folder.roots = buildGroupTree(items);
    }
  }
  const sortFolders = (items: MobileDroneGroupFolder[]) => {
    items.sort((left, right) => left.label.localeCompare(right.label));
    for (const item of items) sortFolders(item.children);
  };
  sortFolders(folders);
  return { roots: buildGroupTree(ungrouped), folders };
}

export function buildMobileDroneRepoGroups(drones: MobileDroneSummary[]): MobileDroneRepoGroup[] {
  const byRepo = new Map<string, MobileDroneSummary[]>();
  for (const drone of drones) {
    const repoPath = text(drone.repoPath);
    const group = byRepo.get(repoPath) ?? [];
    group.push(drone);
    byRepo.set(repoPath, group);
  }
  return [...byRepo.entries()]
    .map(([repoPath, items]) => {
      const tree = buildDroneGroupFolders(items);
      return {
        id: repoPath ? `repo:${repoPath}` : 'repo:ungrouped',
        label: mobileRepoLabel(repoPath),
        repoPath,
        roots: tree.roots,
        folders: tree.folders,
        droneCount: items.length,
      };
    })
    .sort((left, right) => {
      if (!left.repoPath && right.repoPath) return -1;
      if (left.repoPath && !right.repoPath) return 1;
      return left.label.localeCompare(right.label) || left.repoPath.localeCompare(right.repoPath);
    });
}

export function mobileDroneTurnsToAssistantMessages(raw: unknown): AssistantMessage[] {
  return normalizeMobileDroneTurns(raw).flatMap((turn): AssistantMessage[] => {
    const { prompt, output, error } = turn;
    const messages: AssistantMessage[] = [];
    if (prompt) messages.push({ role: 'user', content: prompt });
    if (output || error) {
      messages.push(
        !turn.ok && error
          ? {
              role: 'assistant',
              ...(output ? { content: output } : {}),
              isError: true,
              errorMessage: error,
            }
          : { role: 'assistant', content: output || error },
      );
    }
    return messages;
  });
}

function normalizeTurnAttachments(value: unknown): MobileDroneTurn['attachments'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const attachment = item as Record<string, unknown>;
    const name = text(attachment.name || attachment.fileName);
    if (!name) return [];
    const size = Number(attachment.size);
    return [
      {
        name,
        mime: text(attachment.mime || attachment.mimeType) || 'file',
        size: Number.isFinite(size) && size >= 0 ? size : null,
      },
    ];
  });
}

export function normalizeMobileDroneTurns(raw: unknown): MobileDroneTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const turn = item as Record<string, unknown>;
    const turnNumber = Number(turn.turn);
    const at = text(turn.at);
    return [
      {
        id: text(turn.id) || `turn-${Number.isFinite(turnNumber) ? turnNumber : index}`,
        turn: Number.isFinite(turnNumber) ? turnNumber : null,
        at,
        promptAt: text(turn.promptAt) || at,
        completedAt: text(turn.completedAt) || at,
        prompt: text(turn.prompt),
        output: text(turn.output),
        error: text(turn.error),
        ok: turn.ok !== false,
        model: text(turn.model),
        reasoning: text(turn.reasoning),
        attachments: normalizeTurnAttachments(turn.attachments),
      },
    ];
  });
}
