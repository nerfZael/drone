import {
  buildRepoSidebarModel,
  type RepoSidebarModel,
} from '@drone/hub-model/sidebar';
import type { DroneSummary, RepoSummary } from '../types';

export type SidebarRepositoryNavigationItem<TStateSummary> = {
  id: string;
  repoPath: string;
  label: string;
  droneCount: number;
  stateSummary: TStateSummary;
};

export type SidebarRepositoryNavigationModel<TStateSummary> =
  RepoSidebarModel<DroneSummary> & {
    items: Array<SidebarRepositoryNavigationItem<TStateSummary>>;
  };

export function buildSidebarRepositoryNavigationModel<TStateSummary>(args: {
  repos: readonly RepoSummary[];
  drones: readonly DroneSummary[];
  summarize: (drones: readonly DroneSummary[]) => TStateSummary;
  sidebarGroupOrder?: readonly string[];
  sidebarDroneOrderByGroup?: Readonly<Record<string, string[]>>;
  sidebarNodeOrderByParent?: Readonly<Record<string, string[]>>;
  sidebarGroupCreatedAtByName?: Readonly<Record<string, string | null>>;
  sidebarGroupIdByName?: Readonly<Record<string, string>>;
  repoScopedGroupPathsByRepoGroup?: Readonly<Record<string, string[]>>;
}): SidebarRepositoryNavigationModel<TStateSummary> {
  const model = buildRepoSidebarModel({
    drones: [...args.drones],
    registeredRepoPaths: args.repos
      .map((repo) => String(repo.path ?? '').trim())
      .filter(Boolean),
    sidebarGroupOrder: [...(args.sidebarGroupOrder ?? [])],
    sidebarDroneOrderByGroup: { ...(args.sidebarDroneOrderByGroup ?? {}) },
    sidebarNodeOrderByParent: { ...(args.sidebarNodeOrderByParent ?? {}) },
    sidebarGroupCreatedAtByName: { ...(args.sidebarGroupCreatedAtByName ?? {}) },
    sidebarGroupIdByName: { ...(args.sidebarGroupIdByName ?? {}) },
    repoScopedGroupPathsByRepoGroup: { ...(args.repoScopedGroupPathsByRepoGroup ?? {}) },
  });
  return {
    ...model,
    items: model.groups.map((group) => {
      const repoPath = group.group === 'repo:ungrouped'
        ? ''
        : group.group.slice('repo:'.length);
      return {
        id: group.group,
        repoPath,
        label: group.label,
        droneCount: group.items.length,
        stateSummary: args.summarize(group.items),
      };
    }),
  };
}

export function buildSidebarRepositoryNavigationItems<TStateSummary>(args: {
  repos: readonly RepoSummary[];
  drones: readonly DroneSummary[];
  summarize: (drones: readonly DroneSummary[]) => TStateSummary;
  sidebarGroupOrder?: readonly string[];
  sidebarDroneOrderByGroup?: Readonly<Record<string, string[]>>;
  sidebarNodeOrderByParent?: Readonly<Record<string, string[]>>;
  sidebarGroupCreatedAtByName?: Readonly<Record<string, string | null>>;
  sidebarGroupIdByName?: Readonly<Record<string, string>>;
  repoScopedGroupPathsByRepoGroup?: Readonly<Record<string, string[]>>;
}): Array<SidebarRepositoryNavigationItem<TStateSummary>> {
  return buildSidebarRepositoryNavigationModel(args).items;
}
