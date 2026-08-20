import { isUngroupedGroupName } from './paths';
import {
  compareSidebarDronesByNewestFirst,
  orderSidebarEntries,
  sidebarGroupOrderToken,
} from './ordering';
import type {
  BuildRepoSidebarGroupsArgs,
  CanonicalSidebarGroup,
  SidebarRepoScopedGroupIndex,
  SidebarTreeDrone,
  SidebarTreeGroup,
} from './types';

export function buildSidebarRepoScopedGroupIndex(
  groups: readonly CanonicalSidebarGroup[],
): SidebarRepoScopedGroupIndex {
  const pathsByRepoGroup: Record<string, string[]> = {};
  const idsByPathByRepoGroup: Record<string, Record<string, string>> = {};
  const createdAtByPathByRepoGroup: Record<string, Record<string, string | null>> = {};

  for (const group of groups) {
    const id = String(group?.id ?? '').trim();
    const name = String(group?.name ?? '').trim();
    const repoPath = String(group?.repoPath ?? '').trim();
    if (!id || !name || isUngroupedGroupName(name)) continue;
    const repoGroup = repoPath ? `repo:${repoPath}` : 'repo:ungrouped';
    const paths = (pathsByRepoGroup[repoGroup] ??= []);
    if (!paths.includes(name)) paths.push(name);
    (idsByPathByRepoGroup[repoGroup] ??= {})[name] = id;
    (createdAtByPathByRepoGroup[repoGroup] ??= {})[name] =
      String(group.createdAt ?? '').trim() || null;
  }

  for (const paths of Object.values(pathsByRepoGroup)) paths.sort((a, b) => a.localeCompare(b));
  return { pathsByRepoGroup, idsByPathByRepoGroup, createdAtByPathByRepoGroup };
}

function repoPathToLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export function buildRepoSidebarGroups<TDrone extends SidebarTreeDrone>(
  args: BuildRepoSidebarGroupsArgs<TDrone>,
): SidebarTreeGroup<TDrone>[] {
  const targetRepo = String(args.activeRepoPath ?? '').trim();
  const visibleRepoPaths = targetRepo ? [targetRepo] : args.registeredRepoPaths;
  const byRepo = new Map<string, SidebarTreeGroup<TDrone>>();
  const seenDroneIds = new Set<string>();
  if (args.includeEmptyRegisteredRepoGroups !== false) {
    for (const repoPathRaw of visibleRepoPaths) {
      const repoPath = String(repoPathRaw ?? '').trim();
      if (!repoPath) continue;
      const key = `repo:${repoPath}`;
      if (!byRepo.has(key)) {
        byRepo.set(key, {
          group: key,
          label: repoPathToLabel(repoPath),
          kind: 'repo',
          items: [],
        });
      }
    }
  }
  for (const drone of args.drones) {
    const droneId = String(drone.id ?? '').trim();
    if (!droneId || seenDroneIds.has(droneId)) continue;
    seenDroneIds.add(droneId);
    const repoPath = String(drone.repoPath ?? '').trim();
    const key = repoPath ? `repo:${repoPath}` : 'repo:ungrouped';
    const existing = byRepo.get(key);
    if (existing) existing.items.push(drone);
    else {
      byRepo.set(key, {
        group: key,
        label: repoPathToLabel(repoPath),
        kind: 'repo',
        items: [drone],
      });
    }
  }

  const groups = [...byRepo.values()];
  for (const group of groups) {
    group.items.sort(compareSidebarDronesByNewestFirst);
    group.items = orderSidebarEntries(
      group.items,
      args.sidebarDroneOrderByGroup[sidebarGroupOrderToken(group)] ?? [],
      (drone) => drone.id,
      { unorderedPlacement: 'start' },
    );
  }
  groups.sort((left, right) => {
    if (isUngroupedGroupName(left.label) && !isUngroupedGroupName(right.label)) return -1;
    if (!isUngroupedGroupName(left.label) && isUngroupedGroupName(right.label)) return 1;
    return left.label.localeCompare(right.label) || left.group.localeCompare(right.group);
  });
  return orderSidebarEntries(groups, args.sidebarGroupOrder, sidebarGroupOrderToken);
}
