import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
} from './sidebar-group-paths';
import { normalizeSidebarGroupOrder, orderSidebarEntries, reorderSidebarEntryOrder, type SidebarGroupDropPlacement } from './sidebar-group-order';

export const SIDEBAR_ROOT_PARENT_ID = 'root';

export function sidebarFolderNodeId(pathRaw: string): string {
  const path = String(pathRaw ?? '').trim();
  return `folder:${path}`;
}

export function sidebarDroneNodeId(droneIdRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `drone:${droneId}`;
}

export function sidebarChatSidebarNodeId(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `chat:${droneId}:${chatName}`;
}

export function sidebarFolderPathFromNodeId(nodeIdRaw: string): string | null {
  const nodeId = String(nodeIdRaw ?? '').trim();
  return nodeId.startsWith('folder:') ? nodeId.slice('folder:'.length) || null : null;
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

export function mergeVisibleSidebarNodeOrderByParent(
  map: Record<string, string[]>,
  visibleChildIdsByParent: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const parentIds = new Set<string>([...Object.keys(map), ...Object.keys(visibleChildIdsByParent)]);

  for (const parentId of parentIds) {
    const visibleChildIds = normalizeSidebarGroupOrder(visibleChildIdsByParent[parentId] ?? []);
    const existingOrder = normalizeSidebarGroupOrder(map[parentId] ?? []);
    if (visibleChildIds.length === 0) {
      if (existingOrder.length > 0) out[parentId] = existingOrder;
      continue;
    }
    const visibleChildIdSet = new Set(visibleChildIds);
    const hiddenEntries = existingOrder.filter((entry) => !visibleChildIdSet.has(entry));
    out[parentId] = normalizeSidebarGroupOrder([...visibleChildIds, ...hiddenEntries]);
  }

  return normalizeNodeOrderMap(out);
}

export function orderSidebarNodeIds(childIds: string[], order: string[]): string[] {
  const visibleChildIds = normalizeSidebarGroupOrder(childIds);
  if (visibleChildIds.length < 2) return visibleChildIds;
  const normalizedOrder = normalizeSidebarGroupOrder(order);
  const orderedChildIdSet = new Set(normalizedOrder);

  const orderedVisibleChildIds = orderSidebarEntries(visibleChildIds, normalizedOrder, (childId) => childId, {
    unorderedPlacement: 'end',
  }).filter((childId) => orderedChildIdSet.has(childId));

  if (orderedVisibleChildIds.length === 0) return visibleChildIds;
  if (orderedVisibleChildIds.length === visibleChildIds.length) return orderedVisibleChildIds;

  const visibleOrderedChildIdSet = new Set(orderedVisibleChildIds);
  const unorderedBuckets = Array.from({ length: orderedVisibleChildIds.length + 1 }, () => [] as string[]);
  let orderedSeen = 0;
  for (const childId of visibleChildIds) {
    if (visibleOrderedChildIdSet.has(childId)) {
      orderedSeen += 1;
      continue;
    }
    unorderedBuckets[Math.min(orderedSeen, unorderedBuckets.length - 1)].push(childId);
  }

  const out: string[] = [];
  for (let index = 0; index < orderedVisibleChildIds.length; index += 1) {
    out.push(...unorderedBuckets[index], orderedVisibleChildIds[index]);
  }
  out.push(...unorderedBuckets[orderedVisibleChildIds.length]);
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
