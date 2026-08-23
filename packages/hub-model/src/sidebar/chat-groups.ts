import { orderSidebarNodeIds } from './ordering';

export type SidebarChatTreeFolderNode = {
  kind: 'folder';
  id: string;
  droneId: string;
  path: string;
  label: string;
  parentId: string;
};

export type SidebarChatTreeChatNode = {
  kind: 'chat';
  id: string;
  droneId: string;
  chatName: string;
  parentId: string;
};

export type SidebarChatTreeNode = SidebarChatTreeFolderNode | SidebarChatTreeChatNode;

export type SidebarChatTreeModel = {
  droneId: string;
  rootId: string;
  rootChildIds: string[];
  nodesById: Record<string, SidebarChatTreeNode>;
  childIdsByParent: Record<string, string[]>;
};

export type SidebarChatGroupLayout = {
  sidebarChatGroupPathsByDrone: Record<string, string[]>;
  sidebarChatGroupByChat: Record<string, string>;
  sidebarChatNodeOrderByParent: Record<string, string[]>;
};

export function sidebarChatRootNodeId(droneIdRaw: string): string {
  return `chat-root:${String(droneIdRaw ?? '').trim()}`;
}

export function sidebarChatNodeId(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `chat:${droneId}:${chatName}`;
}

export function sidebarChatGroupNodeId(droneIdRaw: string, pathRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `chat-folder:${droneId}:${normalizeSidebarChatGroupPath(pathRaw)}`;
}

export function normalizeSidebarChatGroupPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

export function sidebarChatGroupParentPath(pathRaw: string): string | null {
  const path = normalizeSidebarChatGroupPath(pathRaw);
  const separator = path.lastIndexOf('/');
  return separator > 0 ? path.slice(0, separator) : null;
}

export function sidebarChatGroupBaseName(pathRaw: string): string {
  const path = normalizeSidebarChatGroupPath(pathRaw);
  const separator = path.lastIndexOf('/');
  return separator >= 0 ? path.slice(separator + 1) : path;
}

export function isSameOrDescendantSidebarChatGroupPath(
  pathRaw: string | null | undefined,
  ancestorRaw: string | null | undefined,
): boolean {
  const path = normalizeSidebarChatGroupPath(pathRaw);
  const ancestor = normalizeSidebarChatGroupPath(ancestorRaw);
  return Boolean(path && ancestor && (path === ancestor || path.startsWith(`${ancestor}/`)));
}

export function rewriteSidebarChatGroupPathPrefix(
  pathRaw: string,
  currentRaw: string,
  nextRaw: string,
): string {
  const path = normalizeSidebarChatGroupPath(pathRaw);
  const current = normalizeSidebarChatGroupPath(currentRaw);
  const next = normalizeSidebarChatGroupPath(nextRaw);
  if (!isSameOrDescendantSidebarChatGroupPath(path, current)) return path;
  return `${next}${path.slice(current.length)}`;
}

export function buildSidebarChatTree(args: {
  droneId: string;
  chatNames: readonly string[];
  groupPaths?: readonly string[];
  groupByChat?: Readonly<Record<string, string>>;
  nodeOrderByParent?: Readonly<Record<string, readonly string[]>>;
}): SidebarChatTreeModel {
  const droneId = String(args.droneId ?? '').trim();
  const rootId = sidebarChatRootNodeId(droneId);
  const chatNames = uniqueStrings(args.chatNames).map((name) => name || 'default');
  const groupPaths = new Set<string>();
  const addPath = (pathRaw: unknown) => {
    let path = normalizeSidebarChatGroupPath(pathRaw);
    while (path) {
      groupPaths.add(path);
      path = sidebarChatGroupParentPath(path) ?? '';
    }
  };
  for (const path of args.groupPaths ?? []) addPath(path);
  for (const chatName of chatNames) addPath(args.groupByChat?.[sidebarChatNodeId(droneId, chatName)]);

  const nodesById: Record<string, SidebarChatTreeNode> = {};
  const childIdsByParent: Record<string, string[]> = { [rootId]: [] };
  const appendChild = (parentId: string, childId: string) => {
    (childIdsByParent[parentId] ??= []).push(childId);
  };

  for (const path of [...groupPaths].sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth || a.localeCompare(b);
  })) {
    const parentPath = sidebarChatGroupParentPath(path);
    const parentId = parentPath ? sidebarChatGroupNodeId(droneId, parentPath) : rootId;
    const id = sidebarChatGroupNodeId(droneId, path);
    nodesById[id] = {
      kind: 'folder',
      id,
      droneId,
      path,
      label: sidebarChatGroupBaseName(path),
      parentId,
    };
    childIdsByParent[id] ??= [];
    appendChild(parentId, id);
  }

  for (const chatName of chatNames) {
    const id = sidebarChatNodeId(droneId, chatName);
    const assignedPath = normalizeSidebarChatGroupPath(args.groupByChat?.[id]);
    const parentId = assignedPath && groupPaths.has(assignedPath)
      ? sidebarChatGroupNodeId(droneId, assignedPath)
      : rootId;
    nodesById[id] = { kind: 'chat', id, droneId, chatName, parentId };
    appendChild(parentId, id);
  }

  for (const [parentId, childIds] of Object.entries(childIdsByParent)) {
    childIdsByParent[parentId] = orderSidebarNodeIds(
      childIds,
      [...(args.nodeOrderByParent?.[parentId] ?? [])],
    );
  }

  return {
    droneId,
    rootId,
    rootChildIds: childIdsByParent[rootId] ?? [],
    nodesById,
    childIdsByParent,
  };
}

export function flattenSidebarChatTreeChatNodeIds(tree: SidebarChatTreeModel): string[] {
  const nodeIds: string[] = [];
  const visit = (nodeId: string) => {
    const node = tree.nodesById[nodeId];
    if (!node) return;
    if (node.kind === 'chat') nodeIds.push(node.id);
    for (const childId of tree.childIdsByParent[nodeId] ?? []) visit(childId);
  };
  for (const nodeId of tree.rootChildIds) visit(nodeId);
  return nodeIds;
}

export function sidebarChatTreeChatNamesInGroup(
  tree: SidebarChatTreeModel,
  groupNodeId: string,
): string[] {
  const chatNames: string[] = [];
  const visit = (parentId: string) => {
    for (const childId of tree.childIdsByParent[parentId] ?? []) {
      const child = tree.nodesById[childId];
      if (!child) continue;
      if (child.kind === 'chat') chatNames.push(child.chatName);
      else visit(child.id);
    }
  };
  visit(groupNodeId);
  return chatNames;
}

export function resolveEffectiveSidebarChatMuteSets(
  tree: SidebarChatTreeModel,
  mutedChatIds: ReadonlySet<string>,
): {
  effectiveMutedChatGroupIdSet: Set<string>;
  effectiveMutedChatIdSet: Set<string>;
} {
  const effectiveGroups = new Set<string>();
  const effectiveChats = new Set<string>();
  const visit = (nodeId: string, inheritedMuted: boolean) => {
    const node = tree.nodesById[nodeId];
    if (!node) return;
    const muted = inheritedMuted || mutedChatIds.has(node.id);
    if (node.kind === 'chat') {
      if (muted) effectiveChats.add(node.id);
      return;
    }
    if (muted) effectiveGroups.add(node.id);
    for (const childId of tree.childIdsByParent[node.id] ?? []) visit(childId, muted);
  };
  for (const rootId of tree.rootChildIds) visit(rootId, false);
  return {
    effectiveMutedChatGroupIdSet: effectiveGroups,
    effectiveMutedChatIdSet: effectiveChats,
  };
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    : [];
}
