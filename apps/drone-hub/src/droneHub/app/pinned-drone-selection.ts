export type SelectedDronePinMutation = {
  droneIds: string[];
  pinned: boolean;
};

function normalizeIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawId of ids) {
    const id = String(rawId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function resolveSelectedDronePinMutation(args: {
  selectedDroneIds: readonly string[];
  activeDroneId?: string | null;
  availableDroneIds: ReadonlySet<string>;
  pinnedDroneIds: readonly string[];
}): SelectedDronePinMutation | null {
  const selectedIds = normalizeIds(args.selectedDroneIds).filter((id) => args.availableDroneIds.has(id));
  const activeDroneId = String(args.activeDroneId ?? '').trim();
  const droneIds = selectedIds.length > 0
    ? selectedIds
    : activeDroneId && args.availableDroneIds.has(activeDroneId)
      ? [activeDroneId]
      : [];
  if (droneIds.length === 0) return null;

  const pinnedDroneIdSet = new Set(normalizeIds(args.pinnedDroneIds));
  return {
    droneIds,
    pinned: !droneIds.every((id) => pinnedDroneIdSet.has(id)),
  };
}

export function excludePinnedSidebarGroupItems<
  TDrone extends { id: string },
  TGroup extends { items: TDrone[] },
>(groups: readonly TGroup[], pinnedDroneIds: ReadonlySet<string>): TGroup[] {
  if (pinnedDroneIds.size === 0) return groups.slice();
  return groups.map((group) => {
    const items = group.items.filter((drone) => !pinnedDroneIds.has(String(drone?.id ?? '').trim()));
    return items.length === group.items.length ? group : { ...group, items };
  });
}
