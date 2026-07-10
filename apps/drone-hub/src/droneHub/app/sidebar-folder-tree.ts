import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import type { SidebarGroup } from './use-sidebar-view-model';
import { sidebarGroupBaseName, sidebarGroupParentPath, splitSidebarGroupPath } from './sidebar-group-paths';
import type { SidebarGroupOrderKind } from './sidebar-group-order';
import { parseIsoTimestampMs } from './helpers';

export type SidebarFolderNode = {
  path: string;
  label: string;
  name: string;
  kind: SidebarGroupOrderKind;
  depth: number;
  ownItems: DroneSummary[];
  directDroneCount: number;
  totalDroneCount: number;
  hasExplicitGroup: boolean;
  isVirtualGroup: boolean;
  children: SidebarFolderNode[];
};

type SidebarFolderNodeDraft = SidebarFolderNode & {
  childrenMap: Map<string, SidebarFolderNodeDraft>;
};

function createNode(args: {
  path: string;
  label: string;
  name: string;
  kind: SidebarGroupOrderKind;
  depth: number;
  ownItems?: DroneSummary[];
  hasExplicitGroup?: boolean;
  isVirtualGroup?: boolean;
}): SidebarFolderNodeDraft {
  const ownItems = args.ownItems ?? [];
  return {
    path: args.path,
    label: args.label,
    name: args.name,
    kind: args.kind,
    depth: args.depth,
    ownItems,
    directDroneCount: ownItems.length,
    totalDroneCount: ownItems.length,
    hasExplicitGroup: Boolean(args.hasExplicitGroup),
    isVirtualGroup: Boolean(args.isVirtualGroup),
    children: [],
    childrenMap: new Map(),
  };
}

function finalizeNode(node: SidebarFolderNodeDraft): SidebarFolderNode {
  const children = Array.from(node.childrenMap.values()).map(finalizeNode);
  const totalDroneCount = node.directDroneCount + children.reduce((sum, child) => sum + child.totalDroneCount, 0);
  return {
    path: node.path,
    label: node.label,
    name: node.name,
    kind: node.kind,
    depth: node.depth,
    ownItems: node.ownItems,
    directDroneCount: node.directDroneCount,
    totalDroneCount,
    hasExplicitGroup: node.hasExplicitGroup,
    isVirtualGroup: node.isVirtualGroup,
    children,
  };
}

function ensureChildNode(
  parent: SidebarFolderNodeDraft,
  key: string,
  create: () => SidebarFolderNodeDraft,
): SidebarFolderNodeDraft {
  const existing = parent.childrenMap.get(key);
  if (existing) return existing;
  const next = create();
  parent.childrenMap.set(key, next);
  return next;
}

function ensureGroupPathNode(
  root: SidebarFolderNodeDraft,
  group: SidebarGroup,
  rootsByPath: Map<string, SidebarFolderNodeDraft>,
): SidebarFolderNodeDraft {
  if (group.kind === 'repo' || isUngroupedGroupName(group.group)) {
    const existing = rootsByPath.get(group.group);
    if (existing) {
      existing.ownItems = group.items;
      existing.directDroneCount = group.items.length;
      existing.hasExplicitGroup = true;
      return existing;
    }
    const next = createNode({
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
    return next;
  }

  const parts = splitSidebarGroupPath(group.group);
  let current = root;
  let currentPath = '';
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const isLeaf = index === parts.length - 1;
    current = ensureChildNode(current, currentPath, () =>
      createNode({
        path: currentPath,
        label: isLeaf ? group.label : part,
        name: part,
        kind: group.kind,
        depth: index,
        ownItems: isLeaf ? group.items : [],
        hasExplicitGroup: isLeaf,
        isVirtualGroup: false,
      }),
    );
    if (isLeaf) {
      current.label = group.label;
      current.name = sidebarGroupBaseName(group.group) || group.label;
      current.kind = group.kind;
      current.ownItems = group.items;
      current.directDroneCount = group.items.length;
      current.hasExplicitGroup = true;
    }
  }
  return current;
}

function flattenOrderedNodes(nodes: SidebarFolderNode[], out: SidebarFolderNode[] = []): SidebarFolderNode[] {
  for (const node of nodes) {
    out.push(node);
    flattenOrderedNodes(node.children, out);
  }
  return out;
}

function sortNodesByFlatOrder(
  nodes: SidebarFolderNode[],
  orderIndex: Map<string, number>,
  groupCreatedAtByName: Record<string, string | null>,
): SidebarFolderNode[] {
  const sorted = nodes
    .map((node, index) => ({
      node,
      index,
      order: orderIndex.get(`${node.kind}:${node.path}`) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.order === Number.POSITIVE_INFINITY && b.order === Number.POSITIVE_INFINITY) {
        if (isUngroupedGroupName(a.node.path) && !isUngroupedGroupName(b.node.path)) return -1;
        if (!isUngroupedGroupName(a.node.path) && isUngroupedGroupName(b.node.path)) return 1;
        if (a.node.kind === 'group' && b.node.kind === 'group') {
          const aMs = parseIsoTimestampMs(groupCreatedAtByName[a.node.path]);
          const bMs = parseIsoTimestampMs(groupCreatedAtByName[b.node.path]);
          if (aMs != null && bMs == null) return -1;
          if (aMs == null && bMs != null) return 1;
          if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
          return a.node.label.localeCompare(b.node.label);
        }
      }
      return a.index - b.index;
    })
    .map((entry) => entry.node);
  return sorted.map((node) => ({
    ...node,
    children: sortNodesByFlatOrder(node.children, orderIndex, groupCreatedAtByName),
  }));
}

export function buildSidebarFolderTree(
  sidebarGroups: SidebarGroup[],
  sidebarGroupOrder: string[],
  groupCreatedAtByName: Record<string, string | null> = {},
): SidebarFolderNode[] {
  const root = createNode({
    path: '__root__',
    label: '__root__',
    name: '__root__',
    kind: 'group',
    depth: -1,
  });
  const rootsByPath = new Map<string, SidebarFolderNodeDraft>();

  for (const group of sidebarGroups) {
    ensureGroupPathNode(root, group, rootsByPath);
  }

  const finalized = finalizeNode(root).children;
  const orderIndex = new Map<string, number>();
  for (const token of sidebarGroupOrder) {
    if (orderIndex.has(token)) continue;
    orderIndex.set(token, orderIndex.size);
  }

  return sortNodesByFlatOrder(finalized, orderIndex, groupCreatedAtByName);
}

export function flattenSidebarFolderTree(nodes: SidebarFolderNode[]): SidebarFolderNode[] {
  return flattenOrderedNodes(nodes, []);
}

export function sidebarFolderDisplayLabel(node: SidebarFolderNode): string {
  if (node.kind === 'repo') return node.label;
  if (isUngroupedGroupName(node.path)) return node.label;
  return node.name || sidebarGroupBaseName(node.path) || node.label || node.path;
}

export function sidebarFolderParentPath(node: SidebarFolderNode): string | null {
  if (node.kind === 'repo' || isUngroupedGroupName(node.path)) return null;
  return sidebarGroupParentPath(node.path);
}
