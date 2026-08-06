import {
  isUngroupedGroupName,
  normalizeSidebarGroupPath,
  sidebarFolderDisplayLabel,
  splitSidebarGroupPath,
} from './paths';
import {
  orderSidebarEntries,
  orderSidebarNodeIds,
  parseIsoTimestampMs,
  SIDEBAR_ROOT_PARENT_ID,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
  sidebarGroupLegacyOrderToken,
  sidebarGroupOrderToken,
} from './ordering';
import { buildSidebarDroneTree } from './drone-tree';
import { buildSidebarFolderTree } from './folder-tree';
import type {
  BuildSidebarNodeTreeArgs,
  SidebarFolderNode,
  SidebarNodeTreeModel,
  SidebarTreeDrone,
  SidebarTreeFolderNode,
  SidebarTreeGroup,
  SidebarTreeNode,
} from './types';

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
}): void {
  const visitedDroneIds = new Set<string>();
  const visit = (droneId: string, parentId: string, depth: number) => {
    if (!droneId || visitedDroneIds.has(droneId)) return;
    visitedDroneIds.add(droneId);
    const id = sidebarDroneNodeId(droneId);
    args.nodesById[id] = { id, kind: 'drone', droneId, parentId, groupPath: args.groupPath, repoGroupPath: args.repoGroupPath, depth };
    (args.childIdsByParentDraft[parentId] ??= []).push(id);
    const children = orderSidebarNodeIds(
      (args.tree.childDroneIdsByParentId[droneId] ?? []).map(sidebarDroneNodeId),
      args.sidebarNodeOrderByParent[id] ?? [],
    ).map((childId) => childId.slice('drone:'.length));
    for (const childId of children) visit(childId, id, depth + 1);
  };
  for (const rootId of args.rootDroneIds) visit(rootId, args.parentId, args.depth);
}

function collectFolderNodes<TDrone extends SidebarTreeDrone>(
  folder: SidebarFolderNode<TDrone>,
  parentId: string,
  nodesById: Record<string, SidebarTreeNode>,
  folderNodeByPath: Record<string, SidebarTreeFolderNode>,
  childIdsByParentDraft: Record<string, string[]>,
): void {
  const id = sidebarFolderNodeId(folder.path);
  const node: SidebarTreeFolderNode = {
    id,
    kind: 'folder',
    path: folder.path,
    groupPath: folder.kind === 'group' ? folder.path : null,
    groupId: folder.groupId ?? null,
    repoGroupPath: folder.kind === 'repo' ? folder.path : null,
    label: sidebarFolderDisplayLabel(folder),
    groupKind: folder.kind,
    parentId,
    depth: folder.depth,
    totalDroneCount: folder.totalDroneCount,
    directDroneCount: folder.directDroneCount,
  };
  nodesById[id] = node;
  if (node.groupPath && !folderNodeByPath[node.groupPath]) folderNodeByPath[node.groupPath] = node;
  (childIdsByParentDraft[parentId] ??= []).push(id);
  childIdsByParentDraft[id] ??= [];
  for (const child of folder.children) collectFolderNodes(child, id, nodesById, folderNodeByPath, childIdsByParentDraft);
}

function repoScopedFolderPath(repoGroupPath: string, groupPath: string): string {
  return `repo-scope:${repoGroupPath}:${groupPath}`;
}

function ensureRepoScopedGroupFolders<TDrone extends SidebarTreeDrone>(args: {
  repoGroup: SidebarTreeGroup<TDrone>;
  repoRootNode: SidebarTreeFolderNode;
  groupedItems: Map<string, TDrone[]>;
  groupOrderIndex: Map<string, number>;
  groupCreatedAtByName: Record<string, string | null>;
  groupIdByName: Record<string, string>;
  nodesById: Record<string, SidebarTreeNode>;
  childIdsByParentDraft: Record<string, string[]>;
}): Map<string, SidebarTreeFolderNode> {
  const byGroupPath = new Map<string, SidebarTreeFolderNode>();
  const resolvedGroupIdByPath = new Map<string, string>();
  for (const [groupPath, items] of args.groupedItems) {
    const configuredId = String(args.groupIdByName[groupPath] ?? '').trim();
    const itemId = items
      .map((item) => String(item.groupId ?? '').trim())
      .find(Boolean);
    const groupId = configuredId || itemId;
    if (groupId) resolvedGroupIdByPath.set(groupPath, groupId);
  }
  const groupIdForPath = (groupPath: string): string | undefined =>
    resolvedGroupIdByPath.get(groupPath) || undefined;
  const groupPaths = [...args.groupedItems.keys()].filter(Boolean).sort((a, b) => {
    const aOrder = args.groupOrderIndex.get(sidebarGroupOrderToken({ groupId: groupIdForPath(a), group: a, kind: 'group' })) ??
      args.groupOrderIndex.get(sidebarGroupLegacyOrderToken({ group: a, kind: 'group' })) ?? Number.POSITIVE_INFINITY;
    const bOrder = args.groupOrderIndex.get(sidebarGroupOrderToken({ groupId: groupIdForPath(b), group: b, kind: 'group' })) ??
      args.groupOrderIndex.get(sidebarGroupLegacyOrderToken({ group: b, kind: 'group' })) ?? Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aMs = parseIsoTimestampMs(args.groupCreatedAtByName[a]);
    const bMs = parseIsoTimestampMs(args.groupCreatedAtByName[b]);
    if (aMs != null && bMs == null) return -1;
    if (aMs == null && bMs != null) return 1;
    if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
    return a.localeCompare(b);
  });
  for (const groupPath of groupPaths) {
    let parentId = args.repoRootNode.id;
    let depth = args.repoRootNode.depth + 1;
    let currentPath = '';
    for (const part of splitSidebarGroupPath(groupPath)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = byGroupPath.get(currentPath);
      if (existing) {
        parentId = existing.id;
        depth = existing.depth + 1;
        continue;
      }
      const path = repoScopedFolderPath(args.repoGroup.group, currentPath);
      const id = sidebarFolderNodeId(path);
      const node: SidebarTreeFolderNode = {
        id,
        kind: 'folder',
        path,
        groupPath: currentPath,
        groupId: groupIdForPath(currentPath) ?? null,
        repoGroupPath: args.repoGroup.group,
        label: part,
        groupKind: 'group',
        parentId,
        depth,
        totalDroneCount: 0,
        directDroneCount: 0,
      };
      args.nodesById[id] = node;
      (args.childIdsByParentDraft[parentId] ??= []).push(id);
      args.childIdsByParentDraft[id] ??= [];
      byGroupPath.set(currentPath, node);
      parentId = id;
      depth += 1;
    }
  }
  for (const [groupPath, items] of args.groupedItems) {
    if (!groupPath) continue;
    const leaf = byGroupPath.get(groupPath);
    if (!leaf) continue;
    leaf.directDroneCount += items.length;
    leaf.totalDroneCount += items.length;
    let parentPath = groupPath;
    while (parentPath.includes('/')) {
      parentPath = parentPath.slice(0, parentPath.lastIndexOf('/'));
      const parent = byGroupPath.get(parentPath);
      if (parent) parent.totalDroneCount += items.length;
    }
  }
  const compareFolders = (leftId: string, rightId: string): number => {
    const left = args.nodesById[leftId];
    const right = args.nodesById[rightId];
    if (!left || left.kind !== 'folder' || !right || right.kind !== 'folder') return 0;
    const leftGroupPath = left.groupPath ?? '';
    const rightGroupPath = right.groupPath ?? '';
    const leftOrder = args.groupOrderIndex.get(sidebarGroupOrderToken({ groupId: groupIdForPath(leftGroupPath), group: leftGroupPath, kind: 'group' })) ??
      args.groupOrderIndex.get(sidebarGroupLegacyOrderToken({ group: leftGroupPath, kind: 'group' })) ?? Number.POSITIVE_INFINITY;
    const rightOrder = args.groupOrderIndex.get(sidebarGroupOrderToken({ groupId: groupIdForPath(rightGroupPath), group: rightGroupPath, kind: 'group' })) ??
      args.groupOrderIndex.get(sidebarGroupLegacyOrderToken({ group: rightGroupPath, kind: 'group' })) ?? Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftMs = parseIsoTimestampMs(args.groupCreatedAtByName[left.groupPath ?? '']);
    const rightMs = parseIsoTimestampMs(args.groupCreatedAtByName[right.groupPath ?? '']);
    if (leftMs != null && rightMs == null) return -1;
    if (leftMs == null && rightMs != null) return 1;
    if (leftMs != null && rightMs != null && leftMs !== rightMs) return rightMs - leftMs;
    return left.label.localeCompare(right.label) || left.path.localeCompare(right.path);
  };
  const folderParentIds = [
    args.repoRootNode.id,
    ...[...byGroupPath.values()].map((node) => node.id),
  ];
  for (const parentId of folderParentIds) {
    const children = args.childIdsByParentDraft[parentId] ?? [];
    const sortedFolderIds = children
      .filter((childId) => args.nodesById[childId]?.kind === 'folder')
      .sort(compareFolders);
    let folderIndex = 0;
    args.childIdsByParentDraft[parentId] = children.map((childId) =>
      args.nodesById[childId]?.kind === 'folder' ? sortedFolderIds[folderIndex++]! : childId,
    );
  }
  return byGroupPath;
}

export function buildSidebarNodeTree<TDrone extends SidebarTreeDrone>({
  sidebarFolderTree,
  sidebarGroups,
  sidebarGroupOrder,
  repoScopedGroupPathsByRepoGroup = {},
  sidebarDroneOrderByGroup,
  sidebarNodeOrderByParent,
  sidebarGroupCreatedAtByName = {},
  sidebarGroupIdByName = {},
  repoScopedGroupCreatedAtByPathByRepoGroup = {},
  repoScopedGroupIdByPathByRepoGroup = {},
}: BuildSidebarNodeTreeArgs<TDrone>): SidebarNodeTreeModel {
  const nodesById: Record<string, SidebarTreeNode> = {};
  const folderNodeByPath: Record<string, SidebarTreeFolderNode> = {};
  const childIdsByParentDraft: Record<string, string[]> = {};
  const groupOrderIndex = new Map<string, number>();
  for (const token of sidebarGroupOrder) if (!groupOrderIndex.has(token)) groupOrderIndex.set(token, groupOrderIndex.size);
  const resolvedSidebarFolderTree =
    sidebarFolderTree ??
    buildSidebarFolderTree(sidebarGroups, sidebarGroupOrder, sidebarGroupCreatedAtByName);
  for (const folder of resolvedSidebarFolderTree) {
    // Ungrouped is a root scope, not a navigable folder. Its drones are appended
    // directly below the active repository (or the standalone root) below.
    if (folder.kind === 'group' && isUngroupedGroupName(folder.path)) continue;
    collectFolderNodes(
      folder,
      SIDEBAR_ROOT_PARENT_ID,
      nodesById,
      folderNodeByPath,
      childIdsByParentDraft,
    );
  }

  const rootUngrouped = sidebarGroups.find((group) => group.kind === 'group' && isUngroupedGroupName(group.group));
  const rootItems = orderSidebarEntries(
    rootUngrouped?.items ?? [],
    sidebarDroneOrderByGroup['group:Ungrouped'] ?? [],
    (drone) => drone.id,
    { unorderedPlacement: 'start' },
  );
  const rootTree = buildSidebarDroneTree(rootItems);
  appendDroneTreeNodes({
    tree: rootTree,
    rootDroneIds: rootTree.rootDroneIds,
    parentId: SIDEBAR_ROOT_PARENT_ID,
    groupPath: null,
    repoGroupPath: null,
    depth: 0,
    nodesById,
    childIdsByParentDraft,
    sidebarNodeOrderByParent,
  });

  for (const group of sidebarGroups) {
    const rawGroupPath = String(group.group ?? '').trim();
    const groupPath =
      group.kind === 'group' ? normalizeSidebarGroupPath(rawGroupPath) : rawGroupPath;
    if (!groupPath || (group.kind === 'group' && isUngroupedGroupName(groupPath))) continue;
    if (group.kind === 'repo') {
      const repoRoot = nodesById[sidebarFolderNodeId(groupPath)];
      if (!repoRoot || repoRoot.kind !== 'folder') continue;
      const directItems: TDrone[] = [];
      const groupedItems = new Map<string, TDrone[]>();
      for (const item of group.items) {
        const rawGroup = normalizeSidebarGroupPath(item.group);
        const actualGroup = !rawGroup || isUngroupedGroupName(rawGroup) ? '' : rawGroup;
        if (!actualGroup) directItems.push(item);
        else (groupedItems.get(actualGroup) ?? (groupedItems.set(actualGroup, []), groupedItems.get(actualGroup)!)).push(item);
      }
      for (const rawPath of repoScopedGroupPathsByRepoGroup[group.group] ?? []) {
        const path = normalizeSidebarGroupPath(rawPath);
        if (path && !groupedItems.has(path)) groupedItems.set(path, []);
      }
      const orderedDirectItems = orderSidebarEntries(
        directItems,
        sidebarDroneOrderByGroup['group:Ungrouped'] ?? [],
        (drone) => drone.id,
        { unorderedPlacement: 'start' },
      );
      const directTree = buildSidebarDroneTree(orderedDirectItems);
      appendDroneTreeNodes({
        tree: directTree,
        rootDroneIds: directTree.rootDroneIds,
        parentId: repoRoot.id,
        groupPath: null,
        repoGroupPath: group.group,
        depth: repoRoot.depth + 1,
        nodesById,
        childIdsByParentDraft,
        sidebarNodeOrderByParent,
      });
      const folderByGroupPath = ensureRepoScopedGroupFolders({
        repoGroup: group,
        repoRootNode: repoRoot,
        groupedItems,
        groupOrderIndex,
        groupCreatedAtByName:
          repoScopedGroupCreatedAtByPathByRepoGroup[group.group] ??
          sidebarGroupCreatedAtByName,
        groupIdByName:
          repoScopedGroupIdByPathByRepoGroup[group.group] ?? sidebarGroupIdByName,
        nodesById,
        childIdsByParentDraft,
      });
      for (const [actualGroupPath, rawItems] of groupedItems) {
        const repoScopedGroupId =
          String(
            rawItems.find((item) => String(item.groupId ?? '').trim())?.groupId ?? '',
          ).trim() ||
          repoScopedGroupIdByPathByRepoGroup[group.group]?.[actualGroupPath] ||
          sidebarGroupIdByName[actualGroupPath];
        const orderedItems = orderSidebarEntries(
          rawItems,
          sidebarDroneOrderByGroup[sidebarGroupOrderToken({
            groupId: repoScopedGroupId,
            group: actualGroupPath,
            kind: 'group',
          })] ?? sidebarDroneOrderByGroup[sidebarGroupLegacyOrderToken({ group: actualGroupPath, kind: 'group' })] ?? [],
          (drone) => drone.id,
          { unorderedPlacement: 'start' },
        );
        const droneTree = buildSidebarDroneTree(orderedItems);
        const parent = folderByGroupPath.get(actualGroupPath) ?? repoRoot;
        appendDroneTreeNodes({
          tree: droneTree,
          rootDroneIds: droneTree.rootDroneIds,
          parentId: parent.id,
          groupPath: actualGroupPath,
          repoGroupPath: group.group,
          depth: parent.depth + 1,
          nodesById,
          childIdsByParentDraft,
          sidebarNodeOrderByParent,
        });
      }
      continue;
    }
    const folder = folderNodeByPath[groupPath];
    if (!folder) continue;
    const orderedItems = orderSidebarEntries(
      group.items,
      sidebarDroneOrderByGroup[sidebarGroupOrderToken(group)] ??
        sidebarDroneOrderByGroup[sidebarGroupLegacyOrderToken(group)] ?? [],
      (drone) => drone.id,
      { unorderedPlacement: 'start' },
    );
    const droneTree = buildSidebarDroneTree(orderedItems);
    appendDroneTreeNodes({
      tree: droneTree,
      rootDroneIds: droneTree.rootDroneIds,
      parentId: folder.id,
      groupPath,
      repoGroupPath: null,
      depth: folder.depth + 1,
      nodesById,
      childIdsByParentDraft,
      sidebarNodeOrderByParent,
    });
  }

  const childIdsByParent: Record<string, string[]> = {};
  for (const parentId of new Set([SIDEBAR_ROOT_PARENT_ID, ...Object.keys(childIdsByParentDraft)])) {
    const children = childIdsByParentDraft[parentId] ?? [];
    if (children.length) childIdsByParent[parentId] = orderSidebarNodeIds(children, sidebarNodeOrderByParent[parentId] ?? []);
  }
  return { nodesById, childIdsByParent, rootChildIds: childIdsByParent[SIDEBAR_ROOT_PARENT_ID] ?? [], folderNodeByPath };
}
