import type { SidebarTreeDrone, SidebarTreeGroupKind } from './types';

export const SIDEBAR_ROOT_PARENT_ID = 'root';

export function sidebarFolderNodeId(pathRaw: string): string {
  return `folder:${String(pathRaw ?? '').trim()}`;
}

export function sidebarDroneNodeId(droneIdRaw: string): string {
  return `drone:${String(droneIdRaw ?? '').trim()}`;
}

export function sidebarGroupOrderToken(group: { group: string; kind: SidebarTreeGroupKind }): string {
  return `${group.kind}:${String(group.group ?? '').trim()}`;
}

export function parseIsoTimestampMs(raw: string | null | undefined): number | null {
  const value = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(value) ? value : null;
}

export function compareSidebarDronesByNewestFirst<TDrone extends SidebarTreeDrone>(
  left: TDrone,
  right: TDrone,
): number {
  const leftMs = parseIsoTimestampMs(left.createdAt);
  const rightMs = parseIsoTimestampMs(right.createdAt);
  if (leftMs == null && rightMs != null) return 1;
  if (leftMs != null && rightMs == null) return -1;
  if (leftMs != null && rightMs != null && leftMs !== rightMs) return rightMs - leftMs;
  return String(left.name ?? '').localeCompare(String(right.name ?? '')) || left.id.localeCompare(right.id);
}

export function orderSidebarEntries<T>(
  entries: T[],
  order: string[],
  getKey: (entry: T) => string,
  options?: { unorderedPlacement?: 'start' | 'end' },
): T[] {
  if (entries.length < 2) return entries.slice();
  const unorderedPlacement = options?.unorderedPlacement === 'start' ? 'start' : 'end';
  const orderIndex = new Map<string, number>();
  for (const token of order) {
    if (!orderIndex.has(token)) orderIndex.set(token, orderIndex.size);
  }
  return entries
    .map((entry, index) => ({
      entry,
      index,
      orderIndex:
        orderIndex.get(String(getKey(entry) ?? '').trim()) ??
        (unorderedPlacement === 'start' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY),
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.index - b.index)
    .map(({ entry }) => entry);
}

export function orderSidebarNodeIds(childIds: string[], order: string[]): string[] {
  const visibleChildIds = [...new Set(childIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (visibleChildIds.length < 2) return visibleChildIds;
  const normalizedOrder = [...new Set(order.map((id) => String(id ?? '').trim()).filter(Boolean))];
  const orderedSet = new Set(normalizedOrder);
  const orderedVisible = orderSidebarEntries(
    visibleChildIds,
    normalizedOrder,
    (id) => id,
    { unorderedPlacement: 'end' },
  ).filter((id) => orderedSet.has(id));
  if (orderedVisible.length === 0) return visibleChildIds;
  if (orderedVisible.length === visibleChildIds.length) return orderedVisible;

  const visibleOrderedSet = new Set(orderedVisible);
  const buckets = Array.from({ length: orderedVisible.length + 1 }, () => [] as string[]);
  let orderedSeen = 0;
  for (const childId of visibleChildIds) {
    if (visibleOrderedSet.has(childId)) orderedSeen += 1;
    else buckets[Math.min(orderedSeen, buckets.length - 1)]!.push(childId);
  }
  const result: string[] = [];
  for (let index = 0; index < orderedVisible.length; index += 1) {
    result.push(...buckets[index]!, orderedVisible[index]!);
  }
  result.push(...buckets[orderedVisible.length]!);
  return result;
}
