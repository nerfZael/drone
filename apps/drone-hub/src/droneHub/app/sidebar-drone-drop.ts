import type { DroneSummary } from '../types';

export function canReorderSidebarDroneSelectionAtParent(
  droneById: Record<string, DroneSummary>,
  sourceDroneIdsRaw: string[],
  targetParentDroneIdRaw: string | null | undefined,
): boolean {
  const sourceDroneIds = Array.from(
    new Set(sourceDroneIdsRaw.map((item) => String(item ?? '').trim()).filter(Boolean)),
  );
  if (sourceDroneIds.length === 0) return false;
  const targetParentDroneId = String(targetParentDroneIdRaw ?? '').trim();
  if (!targetParentDroneId) return true;
  return sourceDroneIds.every(
    (sourceDroneId) =>
      String(droneById[sourceDroneId]?.fleetParentId ?? '').trim() === targetParentDroneId,
  );
}
