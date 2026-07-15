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
  lastMessageAt?: string;
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
  entries: MobileDroneSidebarEntry[];
  droneCount: number;
};

export type MobileDroneGroupFolder = {
  id: string;
  path: string;
  label: string;
  roots: MobileDroneTreeNode[];
  children: MobileDroneGroupFolder[];
  entries: MobileDroneSidebarEntry[];
  droneCount: number;
};

export type MobileDroneSidebarEntry =
  | { kind: 'drone'; node: MobileDroneTreeNode }
  | { kind: 'folder'; folder: MobileDroneGroupFolder };

export type MobileDroneSidebarOrder = {
  registeredRepoPaths: string[];
  groupCreatedAtByName: Record<string, string | null>;
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
};

export type MobileDroneCreateBranch = {
  name: string;
  remote: string;
  branch: string;
};

export type MobileDroneCreateRepo = {
  path: string;
  hostBranch: string | null;
  remoteBranches: MobileDroneCreateBranch[];
  branchesError: string | null;
  branchesLoaded: boolean;
};

export function normalizeMobileDroneCreateRepo(raw: unknown): MobileDroneCreateRepo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const repo = raw as Record<string, unknown>;
  const path = text(repo.path);
  if (!path) return null;
  const remoteBranches = Array.isArray(repo.remoteBranches)
    ? repo.remoteBranches.flatMap((rawBranch): MobileDroneCreateBranch[] => {
        if (!rawBranch || typeof rawBranch !== 'object' || Array.isArray(rawBranch)) return [];
        const branch = rawBranch as Record<string, unknown>;
        const name = text(branch.name);
        if (!name) return [];
        const slash = name.indexOf('/');
        return [
          {
            name,
            remote: text(branch.remote) || (slash > 0 ? name.slice(0, slash) : ''),
            branch: text(branch.branch) || (slash > 0 ? name.slice(slash + 1) : name),
          },
        ];
      })
    : [];
  const branchesError = text(repo.branchesError) || null;
  return {
    path,
    hostBranch: text(repo.hostBranch) || null,
    remoteBranches,
    branchesError,
    branchesLoaded:
      repo.branchesLoaded === true ||
      (repo.branchesLoaded !== false &&
        (Array.isArray(repo.remoteBranches) || Boolean(branchesError))),
  };
}

export type MobileDroneCreateModel = {
  id: string;
  label: string;
  reasoningLevels: string[];
  defaultReasoningLevel: string;
};

export function normalizeMobileDroneCreateModelCatalog(raw: unknown): MobileDroneCreateModel[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const models = (raw as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  return models.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const id = text(value.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const reasoningLevels = stringList(value.reasoningLevels);
    const defaultReasoningLevel = text(value.defaultReasoningLevel);
    return [{
      id,
      label: text(value.label) || id,
      reasoningLevels,
      defaultReasoningLevel:
        defaultReasoningLevel && reasoningLevels.includes(defaultReasoningLevel)
          ? defaultReasoningLevel
          : reasoningLevels[0] ?? '',
    }];
  });
}

export const EMPTY_MOBILE_DRONE_SIDEBAR_ORDER: MobileDroneSidebarOrder = {
  registeredRepoPaths: [],
  groupCreatedAtByName: {},
  sidebarGroupOrder: [],
  sidebarDroneOrderByGroup: {},
  sidebarNodeOrderByParent: {},
};

export function suggestNextMobileDroneChatName(
  chats: readonly string[] | null | undefined,
): string {
  const taken = new Set(
    (Array.isArray(chats) ? chats : [])
      .map((chat) => String(chat ?? '').trim())
      .filter(Boolean),
  );
  let nextIndex = Math.max(1, taken.size + 1);
  for (const chat of taken) {
    const match = chat.match(/^chat-(\d+)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    if (Number.isFinite(index) && index >= 1) nextIndex = Math.max(nextIndex, index + 1);
  }
  while (taken.has(`chat-${nextIndex}`)) nextIndex += 1;
  return `chat-${nextIndex}`;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function stringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.map(text).filter(Boolean);
  return result.length > 0 ? [...new Set(result)] : fallback;
}

function stringListMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, items]) => [text(key), stringList(items)] as const)
      .filter(([key, items]) => Boolean(key && items.length)),
  );
}

function nullableStringMap(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [text(key), text(item) || null] as const)
      .filter(([key]) => Boolean(key)),
  );
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
    lastMessageAt: text(value.lastMessageAt) || undefined,
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
  sidebar: MobileDroneSidebarOrder;
  createRepos: MobileDroneCreateRepo[];
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      drones: [],
      schemaVersion: null,
      sidebar: EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
      createRepos: [],
    };
  }
  const value = raw as Record<string, unknown>;
  const sidebar =
    value.sidebar && typeof value.sidebar === 'object' && !Array.isArray(value.sidebar)
      ? (value.sidebar as Record<string, unknown>)
      : {};
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
  const createOptions =
    value.createOptions &&
    typeof value.createOptions === 'object' &&
    !Array.isArray(value.createOptions)
      ? (value.createOptions as Record<string, unknown>)
      : {};
  const createRepos = Array.isArray(createOptions.repos)
    ? createOptions.repos.flatMap((rawRepo): MobileDroneCreateRepo[] => {
        const repo = normalizeMobileDroneCreateRepo(rawRepo);
        return repo ? [repo] : [];
      })
    : [];
  return {
    drones,
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isFinite(value.schemaVersion)
        ? value.schemaVersion
        : null,
    sidebar: {
      registeredRepoPaths: stringList(sidebar.registeredRepoPaths),
      groupCreatedAtByName: nullableStringMap(sidebar.groupCreatedAtByName),
      sidebarGroupOrder: stringList(sidebar.sidebarGroupOrder),
      sidebarDroneOrderByGroup: stringListMap(sidebar.sidebarDroneOrderByGroup),
      sidebarNodeOrderByParent: stringListMap(sidebar.sidebarNodeOrderByParent),
    },
    createRepos,
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

function droneCreatedAtMs(drone: MobileDroneSummary): number | null {
  const value = Date.parse(String(drone.createdAt ?? '').trim());
  return Number.isFinite(value) ? value : null;
}

export function compareMobileDronesByNewestFirst(
  left: MobileDroneSummary,
  right: MobileDroneSummary,
): number {
  const leftMs = droneCreatedAtMs(left);
  const rightMs = droneCreatedAtMs(right);
  if (leftMs == null && rightMs != null) return 1;
  if (leftMs != null && rightMs == null) return -1;
  if (leftMs != null && rightMs != null && leftMs !== rightMs) return rightMs - leftMs;
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function orderSidebarEntries<T>(
  entries: T[],
  order: string[],
  getKey: (entry: T) => string,
  unorderedPlacement: 'start' | 'end',
): T[] {
  if (entries.length < 2 || order.length === 0) return entries.slice();
  const orderIndex = new Map(order.map((key, index) => [key, index]));
  return entries
    .map((entry, index) => ({
      entry,
      index,
      orderIndex:
        orderIndex.get(getKey(entry)) ??
        (unorderedPlacement === 'start' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY),
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex || left.index - right.index)
    .map(({ entry }) => entry);
}

function orderSidebarNodeEntries(
  entries: MobileDroneSidebarEntry[],
  order: string[],
): MobileDroneSidebarEntry[] {
  if (entries.length < 2 || order.length === 0) return entries.slice();
  const entryId = (entry: MobileDroneSidebarEntry) =>
    entry.kind === 'drone' ? `drone:${entry.node.drone.id}` : `folder:${entry.folder.id}`;
  const visibleIds = entries.map(entryId);
  const byId = new Map(entries.map((entry) => [entryId(entry), entry]));
  const orderedVisibleIds = order.filter((id) => byId.has(id));
  if (orderedVisibleIds.length === 0) return entries.slice();
  const orderedSet = new Set(orderedVisibleIds);
  const buckets = Array.from({ length: orderedVisibleIds.length + 1 }, () => [] as string[]);
  let orderedSeen = 0;
  for (const id of visibleIds) {
    if (orderedSet.has(id)) orderedSeen += 1;
    else buckets[Math.min(orderedSeen, buckets.length - 1)]!.push(id);
  }
  const result: MobileDroneSidebarEntry[] = [];
  for (let index = 0; index < orderedVisibleIds.length; index += 1) {
    for (const id of buckets[index]!) result.push(byId.get(id)!);
    result.push(byId.get(orderedVisibleIds[index]!)!);
  }
  for (const id of buckets.at(-1)!) result.push(byId.get(id)!);
  return result;
}

function orderDroneChildren(
  node: MobileDroneTreeNode,
  sidebarNodeOrderByParent: Record<string, string[]>,
): void {
  node.children = orderSidebarNodeEntries(
    node.children.map((child) => ({ kind: 'drone' as const, node: child })),
    sidebarNodeOrderByParent[`drone:${node.drone.id}`] ?? [],
  ).map((entry) => (entry as { kind: 'drone'; node: MobileDroneTreeNode }).node);
  for (const child of node.children) orderDroneChildren(child, sidebarNodeOrderByParent);
}

function buildGroupTree(
  drones: MobileDroneSummary[],
  repoOrder: string[],
  groupOrder: string[],
  sidebarNodeOrderByParent: Record<string, string[]>,
): MobileDroneTreeNode[] {
  let orderedDrones = drones.slice().sort(compareMobileDronesByNewestFirst);
  orderedDrones = orderSidebarEntries(orderedDrones, repoOrder, (drone) => drone.id, 'start');
  orderedDrones = orderSidebarEntries(orderedDrones, groupOrder, (drone) => drone.id, 'start');
  const byId = new Map(orderedDrones.map((drone) => [drone.id, drone]));
  const nodes = new Map<string, MobileDroneTreeNode>(
    orderedDrones.map((drone) => [drone.id, { drone, children: [] }]),
  );
  const roots: MobileDroneTreeNode[] = [];
  for (const drone of orderedDrones) {
    const node = nodes.get(drone.id)!;
    if (hasValidParent(drone, byId)) nodes.get(drone.fleetParentId!)!.children.push(node);
    else roots.push(node);
  }
  for (const root of roots) orderDroneChildren(root, sidebarNodeOrderByParent);
  return roots;
}

function normalizedGroupPath(value: string | null): string {
  const path = text(value)
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return path.toLowerCase() === 'ungrouped' ? '' : path;
}

function timestampMs(value: string | null | undefined): number | null {
  const parsed = Date.parse(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDroneGroupFolders(
  drones: MobileDroneSummary[],
  repoGroupId: string,
  order: MobileDroneSidebarOrder,
): {
  roots: MobileDroneTreeNode[];
  folders: MobileDroneGroupFolder[];
  entries: MobileDroneSidebarEntry[];
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
          id: `repo-scope:${repoGroupId}:${path}`,
          path,
          label: parts[index]!,
          roots: [],
          children: [],
          entries: [],
          droneCount: 0,
        };
        foldersByPath.set(path, folder);
        parentChildren.push(folder);
      }
      folder.droneCount += items.length;
      parentChildren = folder.children;
      if (index === parts.length - 1) {
        folder.roots = buildGroupTree(
          items,
          order.sidebarDroneOrderByGroup[`repo:${repoGroupId}`] ?? [],
          order.sidebarDroneOrderByGroup[`group:${groupPath}`] ?? [],
          order.sidebarNodeOrderByParent,
        );
      }
    }
  }
  const groupOrderIndex = new Map(order.sidebarGroupOrder.map((token, index) => [token, index]));
  const sortFolders = (items: MobileDroneGroupFolder[]) => {
    items.sort((left, right) => {
      const leftOrder = groupOrderIndex.get(`group:${left.path}`) ?? Number.POSITIVE_INFINITY;
      const rightOrder = groupOrderIndex.get(`group:${right.path}`) ?? Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftMs = timestampMs(order.groupCreatedAtByName[left.path]);
      const rightMs = timestampMs(order.groupCreatedAtByName[right.path]);
      if (leftMs == null && rightMs != null) return 1;
      if (leftMs != null && rightMs == null) return -1;
      if (leftMs != null && rightMs != null && leftMs !== rightMs) return rightMs - leftMs;
      return left.label.localeCompare(right.label);
    });
    for (const item of items) {
      sortFolders(item.children);
      item.entries = orderSidebarNodeEntries(
        [
          ...item.children.map((folder) => ({ kind: 'folder' as const, folder })),
          ...item.roots.map((node) => ({ kind: 'drone' as const, node })),
        ],
        order.sidebarNodeOrderByParent[`folder:${item.id}`] ?? [],
      );
    }
  };
  sortFolders(folders);
  const roots = buildGroupTree(
    ungrouped,
    order.sidebarDroneOrderByGroup[`repo:${repoGroupId}`] ?? [],
    order.sidebarDroneOrderByGroup['group:Ungrouped'] ?? [],
    order.sidebarNodeOrderByParent,
  );
  const entries = orderSidebarNodeEntries(
    [
      ...folders.map((folder) => ({ kind: 'folder' as const, folder })),
      ...roots.map((node) => ({ kind: 'drone' as const, node })),
    ],
    order.sidebarNodeOrderByParent[`folder:${repoGroupId}`] ?? [],
  );
  return { roots, folders, entries };
}

export function buildMobileDroneRepoGroups(
  drones: MobileDroneSummary[],
  order: MobileDroneSidebarOrder = EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
): MobileDroneRepoGroup[] {
  const byRepo = new Map<string, MobileDroneSummary[]>();
  for (const repoPath of order.registeredRepoPaths) {
    if (text(repoPath)) byRepo.set(text(repoPath), []);
  }
  for (const drone of drones) {
    const repoPath = text(drone.repoPath);
    const group = byRepo.get(repoPath) ?? [];
    group.push(drone);
    byRepo.set(repoPath, group);
  }
  return [...byRepo.entries()]
    .map(([repoPath, items]) => {
      const id = repoPath ? `repo:${repoPath}` : 'repo:ungrouped';
      const tree = buildDroneGroupFolders(items, id, order);
      return {
        id,
        label: mobileRepoLabel(repoPath),
        repoPath,
        roots: tree.roots,
        folders: tree.folders,
        entries: tree.entries,
        droneCount: items.length,
      };
    })
    .sort((left, right) => {
      const leftOrder = order.sidebarGroupOrder.indexOf(`repo:${left.id}`);
      const rightOrder = order.sidebarGroupOrder.indexOf(`repo:${right.id}`);
      if (leftOrder >= 0 || rightOrder >= 0) {
        if (leftOrder < 0) return 1;
        if (rightOrder < 0) return -1;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      if (!left.repoPath && right.repoPath) return -1;
      if (left.repoPath && !right.repoPath) return 1;
      return left.label.localeCompare(right.label) || left.repoPath.localeCompare(right.repoPath);
    });
}

export function mobileDroneTurnsToAssistantMessages(raw: unknown): AssistantMessage[] {
  return normalizeMobileDroneTurns(raw).flatMap((turn): AssistantMessage[] => {
    const { prompt, output, error, attachments } = turn;
    const messages: AssistantMessage[] = [];
    if (prompt || attachments.length > 0) {
      messages.push({
        role: 'user',
        ...(prompt ? { content: prompt } : {}),
        ...(turn.promptAt || turn.at ? { createdAt: turn.promptAt || turn.at } : {}),
        ...(attachments.length > 0 ? { details: { attachments } } : {}),
      });
    }
    if (output || error) {
      messages.push(
        !turn.ok && error
          ? {
              role: 'assistant',
              ...(output ? { content: output } : {}),
              ...(turn.completedAt || turn.at ? { createdAt: turn.completedAt || turn.at } : {}),
              isError: true,
              errorMessage: error,
            }
          : {
              role: 'assistant',
              content: output || error,
              ...(turn.completedAt || turn.at ? { createdAt: turn.completedAt || turn.at } : {}),
            },
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
