import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { orderSidebarEntries, orderSidebarGroups, sidebarGroupOrderToken } from './sidebar-group-order';
import type { SidebarGroup } from './use-sidebar-view-model';

function repoPathToLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export function buildRepoSidebarGroups(args: {
  drones: DroneSummary[];
  activeRepoPath: string;
  registeredRepoPaths: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarGroupOrder: string[];
  includeEmptyRegisteredRepoGroups?: boolean;
}): SidebarGroup[] {
  const {
    drones,
    activeRepoPath,
    registeredRepoPaths,
    sidebarDroneOrderByGroup,
    sidebarGroupOrder,
    includeEmptyRegisteredRepoGroups = true,
  } = args;
  const byRepo = new Map<string, SidebarGroup>();
  const targetRepo = String(activeRepoPath ?? '').trim();
  const visibleRepoPaths = targetRepo ? [targetRepo] : registeredRepoPaths;

  if (includeEmptyRegisteredRepoGroups) {
    for (const repoPathRaw of visibleRepoPaths) {
      const repoPath = String(repoPathRaw ?? '').trim();
      if (!repoPath) continue;
      const key = `repo:${repoPath}`;
      if (byRepo.has(key)) continue;
      byRepo.set(key, { group: key, label: repoPathToLabel(repoPath), kind: 'repo', items: [] });
    }
  }

  for (const d of drones) {
    const repoPath = String(d?.repoPath ?? '').trim();
    const hasRepo = repoPath.length > 0;
    const key = hasRepo ? `repo:${repoPath}` : 'repo:ungrouped';
    const label = hasRepo ? repoPathToLabel(repoPath) : 'Ungrouped';
    const existing = byRepo.get(key);
    if (existing) {
      existing.items.push(d);
      continue;
    }
    byRepo.set(key, { group: key, label, kind: 'repo', items: [d] });
  }

  const out = Array.from(byRepo.values());
  for (const g of out) {
    g.items.sort(compareDronesByNewestFirst);
    g.items = orderSidebarEntries(
      g.items,
      sidebarDroneOrderByGroup[sidebarGroupOrderToken({ group: g.group, kind: g.kind })] ?? [],
      (item) => item.id,
      { unorderedPlacement: 'start' },
    );
  }
  out.sort((a, b) => {
    if (isUngroupedGroupName(a.label) && !isUngroupedGroupName(b.label)) return -1;
    if (!isUngroupedGroupName(a.label) && isUngroupedGroupName(b.label)) return 1;
    return a.label.localeCompare(b.label);
  });
  return orderSidebarGroups(out, sidebarGroupOrder);
}
