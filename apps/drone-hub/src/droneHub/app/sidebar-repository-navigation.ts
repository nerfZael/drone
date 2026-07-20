import type { DroneSummary, RepoSummary } from '../types';

export type SidebarRepositoryNavigationItem<TStateSummary> = {
  id: string;
  repoPath: string;
  label: string;
  droneCount: number;
  stateSummary: TStateSummary;
};

export function buildSidebarRepositoryNavigationItems<TStateSummary>(args: {
  repos: readonly RepoSummary[];
  drones: readonly DroneSummary[];
  summarize: (drones: readonly DroneSummary[]) => TStateSummary;
}): Array<SidebarRepositoryNavigationItem<TStateSummary>> {
  const repoPathSet = new Set(
    args.repos.map((repo) => String(repo.path ?? '').trim()).filter(Boolean),
  );
  let hasUngroupedDrones = false;
  for (const drone of args.drones) {
    const repoPath = String(drone.repoPath ?? '').trim();
    if (repoPath) repoPathSet.add(repoPath);
    else hasUngroupedDrones = true;
  }

  const paths = [...repoPathSet];
  if (hasUngroupedDrones) paths.unshift('');
  return paths
    .map((repoPath) => {
      const drones = args.drones.filter(
        (drone) => String(drone.repoPath ?? '').trim() === repoPath,
      );
      const pathParts = repoPath.split(/[\\/]/).filter(Boolean);
      return {
        id: repoPath ? `repo:${repoPath}` : 'repo:ungrouped',
        repoPath,
        label: repoPath ? pathParts[pathParts.length - 1] || repoPath : 'Ungrouped',
        droneCount: drones.length,
        stateSummary: args.summarize(drones),
      };
    })
    .sort((left, right) => {
      if (!left.repoPath) return -1;
      if (!right.repoPath) return 1;
      return left.label.localeCompare(right.label) || left.repoPath.localeCompare(right.repoPath);
    });
}
