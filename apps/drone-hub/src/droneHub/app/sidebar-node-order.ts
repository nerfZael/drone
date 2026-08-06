import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
  sidebarGroupParentPath,
} from './sidebar-group-paths';
import { normalizeSidebarGroupOrder, reorderSidebarEntryOrder, type SidebarGroupDropPlacement } from './sidebar-group-order';
import {
  mergeVisibleSidebarNodeOrderByParent,
  orderSidebarNodeIds,
  SIDEBAR_ROOT_PARENT_ID,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
  type SidebarNodeTreeModel,
} from '@drone/hub-model/sidebar';

export {
  mergeVisibleSidebarNodeOrderByParent,
  orderSidebarNodeIds,
  SIDEBAR_ROOT_PARENT_ID,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
};

export function sidebarChatSidebarNodeId(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `chat:${droneId}:${chatName}`;
}

export function sidebarChatRefFromNodeId(
  nodeIdRaw: string,
): { droneId: string; chatName: string } | null {
  const nodeId = String(nodeIdRaw ?? '').trim();
  if (!nodeId.startsWith('chat:')) return null;
  const ref = nodeId.slice('chat:'.length);
  const separatorIndex = ref.indexOf(':');
  if (separatorIndex <= 0) return null;
  const droneId = ref.slice(0, separatorIndex).trim();
  const chatName = ref.slice(separatorIndex + 1).trim() || 'default';
  return droneId ? { droneId, chatName } : null;
}

export function sidebarFolderPathFromNodeId(nodeIdRaw: string): string | null {
  const nodeId = String(nodeIdRaw ?? '').trim();
  return nodeId.startsWith('folder:') ? nodeId.slice('folder:'.length) || null : null;
}

export function sidebarDroneIdFromNodeId(nodeIdRaw: string): string | null {
  const nodeId = String(nodeIdRaw ?? '').trim();
  return nodeId.startsWith('drone:') ? nodeId.slice('drone:'.length) || null : null;
}

function normalizeNodeOrderMap(value: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [parentIdRaw, order] of Object.entries(value)) {
    const parentId = String(parentIdRaw ?? '').trim();
    if (!parentId) continue;
    const normalized = normalizeSidebarGroupOrder(order);
    if (normalized.length === 0) continue;
    out[parentId] = normalized;
  }
  return out;
}

export function reorderSidebarNodeParentOrder(
  map: Record<string, string[]>,
  parentIdRaw: string,
  visibleChildIds: string[],
  activeNodeIdRaw: string,
  overNodeIdRaw: string,
  placement: SidebarGroupDropPlacement,
): Record<string, string[]> {
  const parentId = String(parentIdRaw ?? '').trim() || SIDEBAR_ROOT_PARENT_ID;
  const nextOrder = reorderSidebarEntryOrder(
    map[parentId] ?? [],
    visibleChildIds,
    String(activeNodeIdRaw ?? '').trim(),
    String(overNodeIdRaw ?? '').trim(),
    placement,
  );
  const currentOrder = normalizeSidebarGroupOrder(map[parentId] ?? []);
  if (nextOrder.length === currentOrder.length && nextOrder.every((entry, index) => entry === currentOrder[index])) {
    return map;
  }
  return normalizeNodeOrderMap({
    ...map,
    [parentId]: nextOrder,
  });
}

export function moveSidebarDroneToTopInNodeOrder(
  map: Record<string, string[]>,
  nodeTree: Pick<SidebarNodeTreeModel, 'nodesById' | 'childIdsByParent'>,
  droneIdRaw: string,
): Record<string, string[]> | null {
  const nodeId = sidebarDroneNodeId(String(droneIdRaw ?? '').trim());
  const node = nodeTree.nodesById[nodeId];
  if (!node || node.kind !== 'drone') return null;
  const siblingIds = nodeTree.childIdsByParent[node.parentId] ?? [];
  const firstSiblingId = siblingIds[0];
  if (!firstSiblingId || firstSiblingId === nodeId) return map;
  return reorderSidebarNodeParentOrder(
    map,
    node.parentId,
    siblingIds,
    nodeId,
    firstSiblingId,
    'before',
  );
}

function repoScopedSidebarFolderNodeId(repoGroupPath: string, groupPath: string): string {
  return sidebarFolderNodeId(`repo-scope:${repoGroupPath}:${groupPath}`);
}

export function placeCreatedSidebarFolderAtTop(
  map: Record<string, string[]>,
  nodeTree: Pick<SidebarNodeTreeModel, 'childIdsByParent'> | null,
  groupPathRaw: string,
  repoGroupPathRaw?: string | null,
): Record<string, string[]> {
  return placeCreatedSidebarFolderBeforeNode(
    map,
    nodeTree,
    groupPathRaw,
    repoGroupPathRaw,
    null,
  );
}

export function placeCreatedSidebarFolderBeforeNode(
  map: Record<string, string[]>,
  nodeTree: Pick<SidebarNodeTreeModel, 'childIdsByParent'> | null,
  groupPathRaw: string,
  repoGroupPathRaw?: string | null,
  beforeNodeIdRaw?: string | null,
): Record<string, string[]> {
  const groupPath = String(groupPathRaw ?? '').trim();
  if (!groupPath) return map;
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  const beforeNodeId = String(beforeNodeIdRaw ?? '').trim();
  const parentPath = sidebarGroupParentPath(groupPath);
  const nodeId = repoGroupPath
    ? repoScopedSidebarFolderNodeId(repoGroupPath, groupPath)
    : sidebarFolderNodeId(groupPath);
  const parentId = parentPath
    ? repoGroupPath
      ? repoScopedSidebarFolderNodeId(repoGroupPath, parentPath)
      : sidebarFolderNodeId(parentPath)
    : repoGroupPath
      ? sidebarFolderNodeId(repoGroupPath)
      : SIDEBAR_ROOT_PARENT_ID;
  const visibleSiblingIds = normalizeSidebarGroupOrder(
    nodeTree?.childIdsByParent[parentId] ?? [],
  );
  const visibleSiblingIdSet = new Set(visibleSiblingIds);
  const hiddenIds = normalizeSidebarGroupOrder(map[parentId] ?? []).filter(
    (id) => id !== nodeId && !visibleSiblingIdSet.has(id),
  );
  const nextVisibleSiblingIds = visibleSiblingIds.filter((id) => id !== nodeId);
  const beforeIndex = beforeNodeId ? nextVisibleSiblingIds.indexOf(beforeNodeId) : -1;
  nextVisibleSiblingIds.splice(beforeIndex >= 0 ? beforeIndex : 0, 0, nodeId);
  const nextOrder = normalizeSidebarGroupOrder([...nextVisibleSiblingIds, ...hiddenIds]);
  return normalizeNodeOrderMap({
    ...map,
    [parentId]: nextOrder,
  });
}

export function moveSidebarNodeIdsBetweenParents(args: {
  map: Record<string, string[]>;
  sourceParentId: string;
  targetParentId: string;
  sourceVisibleChildIds: string[];
  targetVisibleChildIds: string[];
  movingNodeIds: string[];
  overNodeId?: string | null;
  placement?: SidebarGroupDropPlacement | 'into';
}): Record<string, string[]> {
  const sourceParentId = String(args.sourceParentId ?? '').trim() || SIDEBAR_ROOT_PARENT_ID;
  const targetParentId = String(args.targetParentId ?? '').trim() || SIDEBAR_ROOT_PARENT_ID;
  const movingNodeIds = normalizeSidebarGroupOrder(args.movingNodeIds);
  if (movingNodeIds.length === 0) return args.map;

  const sourceVisible = normalizeSidebarGroupOrder(args.sourceVisibleChildIds);
  const targetVisibleBase = normalizeSidebarGroupOrder(args.targetVisibleChildIds);
  const overNodeId = String(args.overNodeId ?? '').trim();
  const placement = args.placement ?? 'into';

  const nextSourceVisible = sourceVisible.filter((entry) => !movingNodeIds.includes(entry));
  const nextTargetVisible = sourceParentId === targetParentId ? nextSourceVisible.slice() : targetVisibleBase.filter((entry) => !movingNodeIds.includes(entry));

  let insertIndex = nextTargetVisible.length;
  if (placement !== 'into' && overNodeId) {
    const overIndex = nextTargetVisible.indexOf(overNodeId);
    if (overIndex >= 0) insertIndex = placement === 'before' ? overIndex : overIndex + 1;
  }
  nextTargetVisible.splice(insertIndex, 0, ...movingNodeIds);

  const nextMap = { ...args.map };
  const hiddenSourceEntries = normalizeSidebarGroupOrder(args.map[sourceParentId] ?? []).filter(
    (entry) => !sourceVisible.includes(entry) && !movingNodeIds.includes(entry),
  );
  const hiddenTargetEntries = normalizeSidebarGroupOrder(args.map[targetParentId] ?? []).filter(
    (entry) => !targetVisibleBase.includes(entry) && !movingNodeIds.includes(entry),
  );

  if (nextSourceVisible.length + hiddenSourceEntries.length > 0) {
    nextMap[sourceParentId] = [...nextSourceVisible, ...hiddenSourceEntries];
  } else {
    delete nextMap[sourceParentId];
  }

  const targetCombined = [...nextTargetVisible, ...hiddenTargetEntries];
  if (targetCombined.length > 0) {
    nextMap[targetParentId] = targetCombined;
  } else {
    delete nextMap[targetParentId];
  }

  return normalizeNodeOrderMap(nextMap);
}

export function renameSidebarNodeOrderByParentGroupPrefix(
  map: Record<string, string[]>,
  currentGroupRaw: string,
  nextGroupRaw: string,
): Record<string, string[]> {
  const currentGroup = String(currentGroupRaw ?? '').trim();
  const nextGroup = String(nextGroupRaw ?? '').trim();
  if (!currentGroup || !nextGroup || currentGroup === nextGroup) return map;

  const out: Record<string, string[]> = {};
  for (const [parentIdRaw, order] of Object.entries(map)) {
    const folderParentPath = sidebarFolderPathFromNodeId(parentIdRaw);
    const nextParentId =
      folderParentPath && isSameOrDescendantSidebarGroupPath(folderParentPath, currentGroup)
        ? sidebarFolderNodeId(rewriteSidebarGroupPathPrefix(folderParentPath, currentGroup, nextGroup))
        : parentIdRaw;
    const nextOrder = normalizeSidebarGroupOrder(order).map((entry) => {
      const folderPath = sidebarFolderPathFromNodeId(entry);
      if (!folderPath || !isSameOrDescendantSidebarGroupPath(folderPath, currentGroup)) return entry;
      return sidebarFolderNodeId(rewriteSidebarGroupPathPrefix(folderPath, currentGroup, nextGroup));
    });
    out[nextParentId] = normalizeSidebarGroupOrder([...(out[nextParentId] ?? []), ...nextOrder]);
  }
  return normalizeNodeOrderMap(out);
}

export function removeSidebarNodeOrderByParentGroupPrefix(
  map: Record<string, string[]>,
  groupRaw: string,
): Record<string, string[]> {
  const group = String(groupRaw ?? '').trim();
  if (!group) return map;

  const out: Record<string, string[]> = {};
  for (const [parentIdRaw, order] of Object.entries(map)) {
    const folderParentPath = sidebarFolderPathFromNodeId(parentIdRaw);
    if (folderParentPath && isSameOrDescendantSidebarGroupPath(folderParentPath, group)) continue;
    const filtered = normalizeSidebarGroupOrder(order).filter((entry) => {
      const folderPath = sidebarFolderPathFromNodeId(entry);
      return !folderPath || !isSameOrDescendantSidebarGroupPath(folderPath, group);
    });
    if (filtered.length > 0) out[parentIdRaw] = filtered;
  }
  return out;
}

export function removeSidebarRepoScopedNodeOrderByGroupPrefix(
  map: Record<string, string[]>,
  repoGroupPathRaw: string,
  groupRaw: string,
): Record<string, string[]> {
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  const group = String(groupRaw ?? '').trim();
  if (!repoGroupPath || !group) return map;
  const nodePathPrefix = `repo-scope:${repoGroupPath}:${group}`;
  const matchesGroupNode = (nodeIdRaw: string): boolean => {
    const nodePath = sidebarFolderPathFromNodeId(nodeIdRaw);
    return Boolean(
      nodePath &&
      (nodePath === nodePathPrefix || nodePath.startsWith(`${nodePathPrefix}/`)),
    );
  };
  let changed = false;
  const out: Record<string, string[]> = {};
  for (const [parentId, order] of Object.entries(map)) {
    if (matchesGroupNode(parentId)) {
      changed = true;
      continue;
    }
    const filtered = normalizeSidebarGroupOrder(order).filter(
      (nodeId) => !matchesGroupNode(nodeId),
    );
    if (filtered.length !== order.length) changed = true;
    if (filtered.length > 0) out[parentId] = filtered;
  }
  return changed ? out : map;
}

export function removeDroneIdsFromSidebarNodeOrderByParent(
  map: Record<string, string[]>,
  droneIdsRaw: string[],
): Record<string, string[]> {
  const droneNodeIds = new Set(
    droneIdsRaw.map((droneId) => sidebarDroneNodeId(droneId)).filter(Boolean),
  );
  if (droneNodeIds.size === 0) return map;

  let changed = false;
  const out: Record<string, string[]> = {};
  for (const [parentId, order] of Object.entries(map)) {
    const filtered = normalizeSidebarGroupOrder(order).filter((entry) => !droneNodeIds.has(entry));
    if (filtered.length !== order.length) changed = true;
    if (filtered.length > 0) out[parentId] = filtered;
  }
  return changed ? out : map;
}
