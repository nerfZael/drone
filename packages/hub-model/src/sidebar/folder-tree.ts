import {
  isUngroupedGroupName,
  sidebarGroupBaseName,
  splitSidebarGroupPath,
} from './paths';
import { parseIsoTimestampMs, sidebarGroupLegacyOrderToken, sidebarGroupOrderToken } from './ordering';
import type {
  SidebarFolderNode,
  SidebarTreeDrone,
  SidebarTreeGroup,
  SidebarTreeGroupKind,
} from './types';

type SidebarFolderNodeDraft<TDrone extends SidebarTreeDrone> = SidebarFolderNode<TDrone> & {
  childrenMap: Map<string, SidebarFolderNodeDraft<TDrone>>;
};

function createFolderNode<TDrone extends SidebarTreeDrone>(args: {
  groupId?: string | null;
  path: string;
  label: string;
  name: string;
  kind: SidebarTreeGroupKind;
  depth: number;
  ownItems?: TDrone[];
  hasExplicitGroup?: boolean;
  isVirtualGroup?: boolean;
}): SidebarFolderNodeDraft<TDrone> {
  const ownItems = args.ownItems ?? [];
  return {
    ...args,
    ownItems,
    directDroneCount: ownItems.length,
    totalDroneCount: ownItems.length,
    hasExplicitGroup: Boolean(args.hasExplicitGroup),
    isVirtualGroup: Boolean(args.isVirtualGroup),
    children: [],
    childrenMap: new Map(),
  };
}

function finalizeFolderNode<TDrone extends SidebarTreeDrone>(
  node: SidebarFolderNodeDraft<TDrone>,
): SidebarFolderNode<TDrone> {
  const children = [...node.childrenMap.values()].map(finalizeFolderNode);
  return {
    groupId: node.groupId ?? null,
    path: node.path,
    label: node.label,
    name: node.name,
    kind: node.kind,
    depth: node.depth,
    ownItems: node.ownItems,
    directDroneCount: node.directDroneCount,
    totalDroneCount:
      node.directDroneCount + children.reduce((sum, child) => sum + child.totalDroneCount, 0),
    hasExplicitGroup: node.hasExplicitGroup,
    isVirtualGroup: node.isVirtualGroup,
    children,
  };
}

function ensureGroupPathNode<TDrone extends SidebarTreeDrone>(
  root: SidebarFolderNodeDraft<TDrone>,
  group: SidebarTreeGroup<TDrone>,
  rootsByPath: Map<string, SidebarFolderNodeDraft<TDrone>>,
): void {
  if (group.kind === 'repo' || isUngroupedGroupName(group.group)) {
    const existing = rootsByPath.get(group.group);
    if (existing) {
      existing.groupId = group.groupId ?? null;
      existing.ownItems = group.items;
      existing.directDroneCount = group.items.length;
      existing.hasExplicitGroup = true;
      return;
    }
    const next = createFolderNode({
      groupId: group.groupId ?? null,
      path: group.group,
      label: group.label,
      name: group.label,
      kind: group.kind,
      depth: 0,
      ownItems: group.items,
      hasExplicitGroup: true,
      isVirtualGroup: group.kind === 'repo',
    });
    rootsByPath.set(group.group, next);
    root.childrenMap.set(group.group, next);
    return;
  }

  const parts = splitSidebarGroupPath(group.group);
  let current = root;
  let currentPath = '';
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const isLeaf = index === parts.length - 1;
    let next = current.childrenMap.get(currentPath);
    if (!next) {
      next = createFolderNode({
        groupId: isLeaf ? group.groupId ?? null : null,
        path: currentPath,
        label: isLeaf ? group.label : part,
        name: part,
        kind: group.kind,
        depth: index,
        ownItems: isLeaf ? group.items : [],
        hasExplicitGroup: isLeaf,
      });
      current.childrenMap.set(currentPath, next);
    }
    current = next;
    if (isLeaf) {
      current.label = group.label;
      current.groupId = group.groupId ?? null;
      current.name = sidebarGroupBaseName(group.group) || group.label;
      current.kind = group.kind;
      current.ownItems = group.items;
      current.directDroneCount = group.items.length;
      current.hasExplicitGroup = true;
    }
  }
}

function sortFolderNodes<TDrone extends SidebarTreeDrone>(
  nodes: SidebarFolderNode<TDrone>[],
  orderIndex: Map<string, number>,
  createdAtByName: Record<string, string | null>,
): SidebarFolderNode<TDrone>[] {
  return nodes
    .map((node, index) => ({
      node,
      index,
      order: orderIndex.get(sidebarGroupOrderToken({
        group: node.path,
        kind: node.kind,
        groupId: node.groupId,
      })) ?? orderIndex.get(sidebarGroupLegacyOrderToken({ group: node.path, kind: node.kind })) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      if (left.order === Number.POSITIVE_INFINITY && right.order === Number.POSITIVE_INFINITY) {
        if (isUngroupedGroupName(left.node.path) && !isUngroupedGroupName(right.node.path)) return -1;
        if (!isUngroupedGroupName(left.node.path) && isUngroupedGroupName(right.node.path)) return 1;
        if (left.node.kind === 'group' && right.node.kind === 'group') {
          const leftMs = parseIsoTimestampMs(createdAtByName[left.node.path]);
          const rightMs = parseIsoTimestampMs(createdAtByName[right.node.path]);
          if (leftMs != null && rightMs == null) return -1;
          if (leftMs == null && rightMs != null) return 1;
          if (leftMs != null && rightMs != null && leftMs !== rightMs) return rightMs - leftMs;
          return left.node.label.localeCompare(right.node.label);
        }
      }
      return left.index - right.index;
    })
    .map(({ node }) => ({
      ...node,
      children: sortFolderNodes(node.children, orderIndex, createdAtByName),
    }));
}

export function buildSidebarFolderTree<TDrone extends SidebarTreeDrone>(
  groups: SidebarTreeGroup<TDrone>[],
  sidebarGroupOrder: string[],
  groupCreatedAtByName: Record<string, string | null> = {},
): SidebarFolderNode<TDrone>[] {
  const root = createFolderNode<TDrone>({
    path: '__root__',
    label: '__root__',
    name: '__root__',
    kind: 'group',
    depth: -1,
  });
  const rootsByPath = new Map<string, SidebarFolderNodeDraft<TDrone>>();
  for (const group of groups) ensureGroupPathNode(root, group, rootsByPath);
  const orderIndex = new Map<string, number>();
  for (const token of sidebarGroupOrder) {
    if (!orderIndex.has(token)) orderIndex.set(token, orderIndex.size);
  }
  return sortFolderNodes(finalizeFolderNode(root).children, orderIndex, groupCreatedAtByName);
}

export function flattenSidebarFolderTree<TDrone extends SidebarTreeDrone>(
  nodes: SidebarFolderNode<TDrone>[],
  result: SidebarFolderNode<TDrone>[] = [],
): SidebarFolderNode<TDrone>[] {
  for (const node of nodes) {
    result.push(node);
    flattenSidebarFolderTree(node.children, result);
  }
  return result;
}
