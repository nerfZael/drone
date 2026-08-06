import {
  sidebarMoveDestination as resolveSidebarMoveDestination,
  type SidebarMoveIntoFolderIntent,
} from '@drone/device-protocol/sidebar';
import { isSameOrDescendantSidebarGroupPath, rewriteSidebarGroupPathPrefix } from './paths';
import type { SidebarTreeDrone } from './types';

export {
  applySidebarMove,
  applySidebarMoveIntoFolder,
  applySidebarReorder,
  firstSidebarInsertionTarget,
  normalizeSidebarLayout,
  reorderSidebarEntries,
  sidebarLayoutPatch,
  sidebarMoveDestination,
} from '@drone/device-protocol/sidebar';
export type {
  SidebarDropPlacement,
  SidebarLayoutPatch,
  SidebarLayoutState,
  SidebarMoveIntent,
  SidebarMoveIntoFolderIntent,
  SidebarReorderIntent,
} from '@drone/device-protocol/sidebar';

export function applyOptimisticSidebarMove<T extends SidebarTreeDrone>(
  drones: T[],
  intent: SidebarMoveIntoFolderIntent,
): T[] {
  const destination = resolveSidebarMoveDestination(intent);
  if (!destination) return drones;
  if (intent.itemKind === 'drone') {
    return drones.map((drone) =>
      drone.id === intent.droneId ? { ...drone, group: destination.targetGroup } : drone,
    );
  }
  return drones.map((drone) => {
    if (
      String(drone.repoPath ?? '').trim() !== intent.repoPath ||
      !isSameOrDescendantSidebarGroupPath(drone.group, intent.sourceGroup)
    ) {
      return drone;
    }
    return {
      ...drone,
      group: rewriteSidebarGroupPathPrefix(drone.group, intent.sourceGroup, destination.nextGroup!),
    };
  });
}
