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
