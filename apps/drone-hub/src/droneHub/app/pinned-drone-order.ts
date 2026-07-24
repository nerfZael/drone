import type { SidebarGroupDropPlacement } from './sidebar-group-order';

export function reorderVisiblePinnedDroneIds(
  pinnedDroneIdsRaw: readonly string[],
  visibleDroneIdsRaw: readonly string[],
  activeDroneIdRaw: string,
  overDroneIdRaw: string,
  placement: SidebarGroupDropPlacement,
): string[] {
  const pinnedDroneIds = normalizeIds(pinnedDroneIdsRaw);
  const visibleDroneIds = normalizeIds(visibleDroneIdsRaw).filter((id) =>
    pinnedDroneIds.includes(id),
  );
  const activeDroneId = String(activeDroneIdRaw ?? '').trim();
  const overDroneId = String(overDroneIdRaw ?? '').trim();
  if (
    !activeDroneId ||
    !overDroneId ||
    activeDroneId === overDroneId ||
    !visibleDroneIds.includes(activeDroneId) ||
    !visibleDroneIds.includes(overDroneId)
  ) {
    return pinnedDroneIds;
  }

  const reorderedVisibleIds = visibleDroneIds.filter((id) => id !== activeDroneId);
  const overIndex = reorderedVisibleIds.indexOf(overDroneId);
  if (overIndex < 0) return pinnedDroneIds;
  reorderedVisibleIds.splice(
    placement === 'before' ? overIndex : overIndex + 1,
    0,
    activeDroneId,
  );

  const visibleDroneIdSet = new Set(visibleDroneIds);
  let visibleIndex = 0;
  return pinnedDroneIds.map((id) =>
    visibleDroneIdSet.has(id)
      ? (reorderedVisibleIds[visibleIndex++] ?? id)
      : id,
  );
}

function normalizeIds(ids: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const idRaw of ids) {
    const id = String(idRaw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}
