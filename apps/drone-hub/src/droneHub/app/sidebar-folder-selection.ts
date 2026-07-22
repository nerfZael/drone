export type SidebarFolderSelectionOptions = {
  selectDrones?: boolean;
  toggle?: boolean;
};

function normalizeDroneIds(ids: readonly string[]): string[] {
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

export function resolveSidebarFolderDroneSelection(args: {
  selectedDroneIds: readonly string[];
  folderDroneIds: readonly string[];
  options?: SidebarFolderSelectionOptions;
}): string[] {
  const selectedDroneIds = normalizeDroneIds(args.selectedDroneIds);
  const folderDroneIds = normalizeDroneIds(args.folderDroneIds);
  if (!args.options?.selectDrones) return [];
  if (!args.options.toggle) return folderDroneIds;
  if (folderDroneIds.length === 0) return selectedDroneIds;

  const folderDroneIdSet = new Set(folderDroneIds);
  const selectedDroneIdSet = new Set(selectedDroneIds);
  const allSelected = folderDroneIds.every((droneId) => selectedDroneIdSet.has(droneId));
  return allSelected
    ? selectedDroneIds.filter((droneId) => !folderDroneIdSet.has(droneId))
    : [
        ...selectedDroneIds,
        ...folderDroneIds.filter((droneId) => !selectedDroneIdSet.has(droneId)),
      ];
}
