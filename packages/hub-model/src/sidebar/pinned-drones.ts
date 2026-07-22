import type { SidebarTreeDrone } from './types';

export function resolvePinnedSidebarDrones<TDrone extends SidebarTreeDrone>(
  drones: readonly TDrone[],
  pinnedDroneIds: readonly string[],
): TDrone[] {
  const droneById = new Map(
    drones.flatMap((drone) => {
      const id = String(drone?.id ?? '').trim();
      return id ? [[id, drone] as const] : [];
    }),
  );
  const seen = new Set<string>();
  return pinnedDroneIds.flatMap((idRaw) => {
    const id = String(idRaw ?? '').trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const drone = droneById.get(id);
    return drone ? [drone] : [];
  });
}

export function resolvePinnedSidebarDronesForRepo<
  TDrone extends SidebarTreeDrone & { repoPath?: string | null },
>(
  drones: readonly TDrone[],
  pinnedDroneIds: readonly string[],
  repoPath: string | null | undefined,
): TDrone[] {
  const normalizedRepoPath = String(repoPath ?? '').trim();
  return resolvePinnedSidebarDrones(drones, pinnedDroneIds).filter(
    (drone) => String(drone.repoPath ?? '').trim() === normalizedRepoPath,
  );
}
