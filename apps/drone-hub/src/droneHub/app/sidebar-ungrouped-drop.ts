export function resolveSidebarUngroupedDropDroneIds({
  droneIds,
  overType,
  enabled,
}: {
  droneIds: string[];
  overType: unknown;
  enabled: boolean;
}): string[] {
  if (!enabled || overType !== 'sidebar-ungrouped-drop') return [];
  return droneIds;
}
