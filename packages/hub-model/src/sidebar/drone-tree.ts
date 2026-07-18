import type { SidebarDroneTree, SidebarTreeDrone } from './types';

function hasValidParent<TDrone extends SidebarTreeDrone>(
  droneId: string,
  parentId: string,
  byId: Map<string, TDrone>,
): boolean {
  if (!parentId || parentId === droneId || !byId.has(parentId)) return false;
  const seen = new Set([droneId]);
  let currentId: string | null = parentId;
  while (currentId) {
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    currentId = String(byId.get(currentId)?.fleetParentId ?? '').trim() || null;
  }
  return true;
}

export function buildSidebarDroneTree<TDrone extends SidebarTreeDrone>(
  drones: TDrone[],
): SidebarDroneTree {
  const byId = new Map<string, TDrone>();
  for (const drone of drones) {
    const droneId = String(drone.id ?? '').trim();
    if (droneId && !byId.has(droneId)) byId.set(droneId, drone);
  }

  const rootDroneIds: string[] = [];
  const childDroneIdsByParentId: Record<string, string[]> = {};
  for (const drone of drones) {
    const droneId = String(drone.id ?? '').trim();
    if (!droneId || byId.get(droneId) !== drone) continue;
    const parentId = String(drone.fleetParentId ?? '').trim();
    if (hasValidParent(droneId, parentId, byId)) {
      (childDroneIdsByParentId[parentId] ??= []).push(droneId);
    } else {
      rootDroneIds.push(droneId);
    }
  }
  return { rootDroneIds, childDroneIdsByParentId };
}
