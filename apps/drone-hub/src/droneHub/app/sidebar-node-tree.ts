import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { orderSidebarEntries, sidebarGroupOrderToken } from './sidebar-group-order';
import { orderSidebarNodeIds, SIDEBAR_ROOT_PARENT_ID, sidebarDroneNodeId, sidebarFolderNodeId } from './sidebar-node-order';
import { sidebarFolderDisplayLabel, type SidebarFolderNode } from './sidebar-folder-tree';
import { buildSidebarDroneTree } from './sidebar-drone-tree';
import type { SidebarGroup } from './use-sidebar-view-model';
import { splitSidebarGroupPath } from './sidebar-group-paths';
import { parseIsoTimestampMs } from './helpers';

export type SidebarTreeFolderNode = {
  id: string;
  kind: 'folder';
  path: string;
  groupPath: string | null;
  repoGroupPath: string | null;
  label: string;
  groupKind: SidebarGroup['kind'];
  parentId: string;
  depth: number;
  totalDroneCount: number;
  directDroneCount: number;
};

export type SidebarTreeDroneNode = {
  id: string;
  kind: 'drone';
  droneId: string;
  parentId: string;
  groupPath: string | null;
  repoGroupPath: string | null;
  depth: number;
};

export type SidebarTreeNode = SidebarTreeFolderNode | SidebarTreeDroneNode;

export type SidebarNodeTreeModel = {
  nodesById: Record<string, SidebarTreeNode>;
  childIdsByParent: Record<string, string[]>;
  rootChildIds: string[];
  folderNodeByPath: Record<string, SidebarTreeFolderNode>;
};

type BuildSidebarNodeTreeArgs = {
  sidebarFolderTree: SidebarFolderNode[];
  sidebarGroups: SidebarGroup[];
  sidebarGroupOrder: string[];
  repoScopedGroupPathsByRepoGroup?: Record<string, string[]>;
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarGroupCreatedAtByName?: Record<string, string | null>;
};

function appendDroneTreeNodes(args: {
  tree: ReturnType<typeof buildSidebarDroneTree>;
  rootDroneIds: string[];
  parentId: string;
  groupPath: string | null;
  repoGroupPath: string | null;
  depth: number;
  nodesById: Record<string, SidebarTreeNode>;
  childIdsByParentDraft: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
}) {
  const visit = (droneIdRaw: string, parentId: string, depth: number) => {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    const id = sidebarDroneNodeId(droneId);
    args.nodesById[id] = {
      id,
      kind: 'drone',
      droneId,
      parentId,
      groupPath: args.groupPath,
      repoGroupPath: args.repoGroupPath,
      depth,
    };
    args.childIdsByParentDraft[parentId] ??= [];
    args.childIdsByParentDraft[parentId].push(id);

    const childDroneIds = args.tree.childDroneIdsByParentId[droneId] ?? [];
    const orderedChildDroneIds = orderSidebarNodeIds(
      childDroneIds.map((childId) => sidebarDroneNodeId(childId)),
      args.sidebarNodeOrderByParent[id] ?? [],
    ).map((childNodeId) => childNodeId.slice('drone:'.length));

    for (const childDroneId of orderedChildDroneIds) {
      visit(childDroneId, id, depth + 1);
    }
  };

  for (const rootDroneId of args.rootDroneIds) {
    visit(rootDroneId, args.parentId, args.depth);
  }
}

function collectFolderNodes(
  folder: SidebarFolderNode,
  parentId: string,
  nodesById: Record<string, SidebarTreeNode>,
  folderNodeByPath: Record<string, SidebarTreeFolderNode>,
  childIdsByParentDraft: Record<string, string[]>,
): void {
  const id = sidebarFolderNodeId(folder.path);
  const folderNode: SidebarTreeFolderNode = {
    id,
    kind: 'folder',
    path: folder.path,
    groupPath: folder.kind === 'group' ? folder.path : null,
    repoGroupPath: folder.kind === 'repo' ? folder.path : null,
    label: sidebarFolderDisplayLabel(folder),
    groupKind: folder.kind,
    parentId,
    depth: folder.depth,
    totalDroneCount: folder.totalDroneCount,
    directDroneCount: folder.directDroneCount,
  };
  nodesById[id] = folderNode;
  if (folderNode.groupPath && !folderNodeByPath[folderNode.groupPath]) {
    folderNodeByPath[folderNode.groupPath] = folderNode;
  }
  childIdsByParentDraft[parentId] ??= [];
  childIdsByParentDraft[parentId].push(id);
  childIdsByParentDraft[id] ??= [];
  for (const child of folder.children) {
    collectFolderNodes(child, id, nodesById, folderNodeByPath, childIdsByParentDraft);
  }
}

function repoScopedFolderPath(repoGroupPathRaw: string, groupPathRaw: string): string {
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  const groupPath = String(groupPathRaw ?? '').trim();
  return `repo-scope:${repoGroupPath}:${groupPath}`;
}

function ensureRepoScopedGroupFolders(args: {
  repoGroup: SidebarGroup;
  repoRootNode: SidebarTreeFolderNode;
  groupedItems: Map<string, DroneSummary[]>;
  groupOrderIndex: Map<string, number>;
  groupCreatedAtByName: Record<string, string | null>;
  nodesById: Record<string, SidebarTreeNode>;
  childIdsByParentDraft: Record<string, string[]>;
}): Map<string, SidebarTreeFolderNode> {
  const folderNodeByGroupPath = new Map<string, SidebarTreeFolderNode>();
  const orderedGroupPaths = Array.from(args.groupedItems.keys())
    .filter(Boolean)
    .sort((a, b) => {
      const aOrder = args.groupOrderIndex.get(sidebarGroupOrderToken({ group: a, kind: 'group' })) ?? Number.POSITIVE_INFINITY;
      const bOrder = args.groupOrderIndex.get(sidebarGroupOrderToken({ group: b, kind: 'group' })) ?? Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aMs = parseIsoTimestampMs(args.groupCreatedAtByName[a]);
      const bMs = parseIsoTimestampMs(args.groupCreatedAtByName[b]);
      if (aMs != null && bMs == null) return -1;
      if (aMs == null && bMs != null) return 1;
      if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
      return a.localeCompare(b);
    });

  for (const groupPath of orderedGroupPaths) {
    const parts = splitSidebarGroupPath(groupPath);
    let parentId = args.repoRootNode.id;
    let depth = args.repoRootNode.depth + 1;
    let currentGroupPath = '';
    for (const part of parts) {
      currentGroupPath = currentGroupPath ? `${currentGroupPath}/${part}` : part;
      const existing = folderNodeByGroupPath.get(currentGroupPath);
      if (existing) {
        parentId = existing.id;
        depth = existing.depth + 1;
        continue;
      }
      const id = sidebarFolderNodeId(repoScopedFolderPath(args.repoGroup.group, currentGroupPath));
      const folderNode: SidebarTreeFolderNode = {
        id,
        kind: 'folder',
        path: repoScopedFolderPath(args.repoGroup.group, currentGroupPath),
        groupPath: currentGroupPath,
        repoGroupPath: args.repoGroup.group,
        label: part,
        groupKind: 'group',
        parentId,
        depth,
        totalDroneCount: 0,
        directDroneCount: 0,
      };
      args.nodesById[id] = folderNode;
      args.childIdsByParentDraft[parentId] ??= [];
      args.childIdsByParentDraft[parentId].push(id);
      args.childIdsByParentDraft[id] ??= [];
      folderNodeByGroupPath.set(currentGroupPath, folderNode);
      parentId = id;
      depth += 1;
    }
  }

  for (const [groupPath, items] of args.groupedItems.entries()) {
    if (!groupPath) continue;
    const leafNode = folderNodeByGroupPath.get(groupPath);
    if (!leafNode) continue;
    leafNode.directDroneCount += items.length;
    leafNode.totalDroneCount += items.length;
    let currentParentPath = groupPath;
    while (currentParentPath.includes('/')) {
      currentParentPath = currentParentPath.slice(0, currentParentPath.lastIndexOf('/'));
      const parentNode = folderNodeByGroupPath.get(currentParentPath);
      if (!parentNode) continue;
      parentNode.totalDroneCount += items.length;
    }
  }

  return folderNodeByGroupPath;
}

export function buildSidebarNodeTree({
  sidebarFolderTree,
  sidebarGroups,
  sidebarGroupOrder,
  repoScopedGroupPathsByRepoGroup = {},
  sidebarDroneOrderByGroup,
  sidebarNodeOrderByParent,
  sidebarGroupCreatedAtByName = {},
}: BuildSidebarNodeTreeArgs): SidebarNodeTreeModel {
  const nodesById: Record<string, SidebarTreeNode> = {};
  const folderNodeByPath: Record<string, SidebarTreeFolderNode> = {};
  const childIdsByParentDraft: Record<string, string[]> = {};
  const groupOrderIndex = new Map<string, number>();
  for (const token of sidebarGroupOrder) {
    if (groupOrderIndex.has(token)) continue;
    groupOrderIndex.set(token, groupOrderIndex.size);
  }

  for (const folder of sidebarFolderTree) {
    collectFolderNodes(folder, SIDEBAR_ROOT_PARENT_ID, nodesById, folderNodeByPath, childIdsByParentDraft);
  }

  const rootUngrouped = sidebarGroups.find((group) => group.kind === 'group' && isUngroupedGroupName(group.group)) ?? null;
  const rootUngroupedOrderedItems = orderSidebarEntries(
    rootUngrouped?.items ?? [],
    sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: 'Ungrouped', kind: 'group' })] ?? [],
    (item) => item.id,
    { unorderedPlacement: 'start' },
  );
  const rootUngroupedTree = buildSidebarDroneTree(rootUngroupedOrderedItems);
  appendDroneTreeNodes({
    tree: rootUngroupedTree,
    rootDroneIds: rootUngroupedTree.rootDroneIds,
    parentId: SIDEBAR_ROOT_PARENT_ID,
    groupPath: null,
    repoGroupPath: null,
    depth: 0,
    nodesById,
    childIdsByParentDraft,
    sidebarNodeOrderByParent,
  });

  for (const group of sidebarGroups) {
    const groupPath = String(group.group ?? '').trim();
    if (!groupPath) continue;
    if (group.kind === 'group' && isUngroupedGroupName(groupPath)) continue;
    if (group.kind === 'repo') {
      const repoRootNode = nodesById[sidebarFolderNodeId(groupPath)];
      if (!repoRootNode || repoRootNode.kind !== 'folder') continue;
      const repoRootItems: DroneSummary[] = [];
      const itemsByActualGroup = new Map<string, DroneSummary[]>();
      for (const item of group.items) {
        const actualGroupPath = String(item.group ?? '').trim();
        const key = !actualGroupPath || isUngroupedGroupName(actualGroupPath) ? '' : actualGroupPath;
        if (!key) {
          repoRootItems.push(item);
          continue;
        }
        const existingItems = itemsByActualGroup.get(key);
        if (existingItems) {
          existingItems.push(item);
        } else {
          itemsByActualGroup.set(key, [item]);
        }
      }
      for (const repoScopedGroupPath of repoScopedGroupPathsByRepoGroup[group.group] ?? []) {
        const groupPath = String(repoScopedGroupPath ?? '').trim();
        if (!groupPath || itemsByActualGroup.has(groupPath)) continue;
        itemsByActualGroup.set(groupPath, []);
      }
      const orderedRepoRootItems = orderSidebarEntries(
        repoRootItems,
        sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: 'Ungrouped', kind: 'group' })] ?? [],
        (item) => item.id,
        { unorderedPlacement: 'start' },
      );
      const repoRootTree = buildSidebarDroneTree(orderedRepoRootItems);
      appendDroneTreeNodes({
        tree: repoRootTree,
        rootDroneIds: repoRootTree.rootDroneIds,
        parentId: repoRootNode.id,
        groupPath: null,
        repoGroupPath: group.group,
        depth: repoRootNode.depth + 1,
        nodesById,
        childIdsByParentDraft,
        sidebarNodeOrderByParent,
      });
      const repoFolderNodeByGroupPath = ensureRepoScopedGroupFolders({
        repoGroup: group,
        repoRootNode,
        groupedItems: itemsByActualGroup,
        groupOrderIndex,
        groupCreatedAtByName: sidebarGroupCreatedAtByName,
        nodesById,
        childIdsByParentDraft,
      });
      for (const [actualGroupPath, rawItems] of itemsByActualGroup.entries()) {
        const orderedDroneItems = orderSidebarEntries(
          rawItems,
          sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: actualGroupPath, kind: 'group' })] ?? [],
          (item) => item.id,
          { unorderedPlacement: 'start' },
        );
        const tree = buildSidebarDroneTree(orderedDroneItems);
        const parentNode = repoFolderNodeByGroupPath.get(actualGroupPath);
        appendDroneTreeNodes({
          tree,
          rootDroneIds: tree.rootDroneIds,
          parentId: parentNode?.id ?? repoRootNode.id,
          groupPath: actualGroupPath,
          repoGroupPath: group.group,
          depth: (parentNode?.depth ?? repoRootNode.depth) + 1,
          nodesById,
          childIdsByParentDraft,
          sidebarNodeOrderByParent,
        });
      }
      continue;
    }
    const folderNode = folderNodeByPath[groupPath];
    if (!folderNode) continue;
    const orderedDroneItems = orderSidebarEntries(
      group.items,
      sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: groupPath, kind: group.kind })] ?? [],
      (item) => item.id,
      { unorderedPlacement: 'start' },
    );
    const tree = buildSidebarDroneTree(orderedDroneItems);
    appendDroneTreeNodes({
      tree,
      rootDroneIds: tree.rootDroneIds,
      parentId: folderNode.id,
      groupPath,
      repoGroupPath: null,
      depth: folderNode.depth + 1,
      nodesById,
      childIdsByParentDraft,
      sidebarNodeOrderByParent,
    });
  }

  const childIdsByParent: Record<string, string[]> = {};
  const orderedParentIds = new Set<string>([SIDEBAR_ROOT_PARENT_ID, ...Object.keys(childIdsByParentDraft)]);
  for (const parentId of orderedParentIds) {
    const rawChildIds = childIdsByParentDraft[parentId] ?? [];
    if (rawChildIds.length === 0) continue;
    childIdsByParent[parentId] = orderSidebarNodeIds(rawChildIds, sidebarNodeOrderByParent[parentId] ?? []);
  }

  return {
    nodesById,
    childIdsByParent,
    rootChildIds: childIdsByParent[SIDEBAR_ROOT_PARENT_ID] ?? [],
    folderNodeByPath,
  };
}
