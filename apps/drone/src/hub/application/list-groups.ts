import { loadDroneSummaryRegistry } from '../drone-summary-registry';
import { listCanonicalGroups } from '../groups-repositories';
import { isWorkflowChildDroneEntry } from '../workflows/workflow-child-drone-metadata';
import { isUngroupedGroupName } from './group-name';

export type GroupSummary = {
  id: string;
  repoPath: string;
  name: string;
  label: string;
  parentId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  droneCount: number;
  pendingCount: number;
  totalCount: number;
};

export async function listGroups(repoPath?: string): Promise<{
  ok: true;
  groups: GroupSummary[];
  total: number;
}> {
  const registry = await loadDroneSummaryRegistry();
  const canonical = await listCanonicalGroups(repoPath);
  const canonicalById = new Map(canonical.map((group) => [group.id, group]));
  const canonicalByScopeAndName = new Map(
    canonical.map((group) => [`${group.repoPath}\0${group.name}`, group]),
  );
  const counts = new Map<string, { drones: number; pending: number }>();
  const count = (entries: any, kind: 'drones' | 'pending') => {
    for (const drone of Object.values(entries ?? {}) as any[]) {
      if (isWorkflowChildDroneEntry(drone)) continue;
      const group = String(drone?.group ?? '').trim();
      if (!group || isUngroupedGroupName(group)) continue;
      const droneRepoPath = String(drone?.repoPath ?? '').trim();
      if (repoPath !== undefined && droneRepoPath !== repoPath) continue;
      const referenced = canonicalById.get(String(drone?.groupId ?? '').trim());
      const canonicalGroup =
        referenced?.repoPath === droneRepoPath
          ? referenced
          : canonicalByScopeAndName.get(`${droneRepoPath}\0${group}`);
      if (!canonicalGroup) continue;
      const current = counts.get(canonicalGroup.id) ?? { drones: 0, pending: 0 };
      current[kind] += 1;
      counts.set(canonicalGroup.id, current);
    }
  };
  count(registry.drones, 'drones');
  count(registry.pending, 'pending');

  const groups = canonical.map((entry) => {
    const totals = counts.get(entry.id) ?? { drones: 0, pending: 0 };
    return {
      id: entry.id,
      repoPath: entry.repoPath,
      name: entry.name,
      label: entry.label ?? entry.name.slice(entry.name.lastIndexOf('/') + 1),
      parentId: entry.parentId ?? null,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
      droneCount: totals.drones,
      pendingCount: totals.pending,
      totalCount: totals.drones + totals.pending,
    };
  });
  return { ok: true, groups, total: groups.length };
}
