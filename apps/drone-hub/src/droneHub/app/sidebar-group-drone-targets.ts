import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { isSameOrDescendantSidebarGroupPath } from './sidebar-group-paths';

type SidebarGroupDroneTarget = Pick<DroneSummary, 'id' | 'group' | 'repoPath'>;

export function sidebarGroupDroneIds(
  drones: readonly SidebarGroupDroneTarget[],
  groupRaw: string,
  repoPathRaw: string,
): string[] {
  const group = String(groupRaw ?? '').trim();
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!group) return [];
  const wantsUngroupedGroup = isUngroupedGroupName(group);

  return Array.from(
    new Set(
      drones
        .filter((drone) => {
          if (String(drone?.repoPath ?? '').trim() !== repoPath) return false;
          const droneGroup = String(drone?.group ?? '').trim();
          if (wantsUngroupedGroup) return !droneGroup || isUngroupedGroupName(droneGroup);
          return isSameOrDescendantSidebarGroupPath(droneGroup, group);
        })
        .map((drone) => String(drone?.id ?? '').trim())
        .filter(Boolean),
    ),
  );
}
