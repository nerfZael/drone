import React from 'react';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { buildSidebarFolderTree, flattenSidebarFolderTree } from './sidebar-folder-tree';
import type { SidebarGroup } from './use-sidebar-view-model';

type UseSidebarReadModelArgs = {
  draftSidebarPlaceholderDrone: DroneSummary | null;
  isRepoGroupingMode: boolean;
  optimisticSidebarDronesFilteredByRepo: DroneSummary[];
  optimisticSidebarGroups: SidebarGroup[];
  repoScopedGroupPathsByRepoGroup: Record<string, string[]>;
  sidebarGroupOrder: string[];
  sidebarGroupCreatedAtByName: Record<string, string | null>;
};

export function useSidebarReadModel({
  draftSidebarPlaceholderDrone,
  isRepoGroupingMode,
  optimisticSidebarDronesFilteredByRepo,
  optimisticSidebarGroups,
  repoScopedGroupPathsByRepoGroup,
  sidebarGroupOrder,
  sidebarGroupCreatedAtByName,
}: UseSidebarReadModelArgs) {
  const renderSidebarGroups = optimisticSidebarGroups;

  const sidebarFolderTree = React.useMemo(
    () => buildSidebarFolderTree(renderSidebarGroups, sidebarGroupOrder, sidebarGroupCreatedAtByName),
    [renderSidebarGroups, sidebarGroupCreatedAtByName, sidebarGroupOrder],
  );

  const flatSidebarFolderNodes = React.useMemo(
    () => flattenSidebarFolderTree(sidebarFolderTree),
    [sidebarFolderTree],
  );

  const visibleSidebarFolderPathSet = React.useMemo(() => {
    const out = new Set(flatSidebarFolderNodes.map((node: { path: string }) => node.path));
    if (!isRepoGroupingMode) return out;
    const visibleRepoGroupPathSet = new Set(
      renderSidebarGroups
        .filter((group: SidebarGroup) => group.kind === 'repo')
        .map((group: SidebarGroup) => String(group.group ?? '').trim())
        .filter(Boolean),
    );
    for (const [repoGroupPath, groupPaths] of Object.entries(repoScopedGroupPathsByRepoGroup)) {
      if (!visibleRepoGroupPathSet.has(repoGroupPath)) continue;
      for (const groupPath of groupPaths) out.add(groupPath);
    }
    return out;
  }, [flatSidebarFolderNodes, isRepoGroupingMode, renderSidebarGroups, repoScopedGroupPathsByRepoGroup]);

  const sidebarDronesWithDraft = React.useMemo(() => {
    const items = optimisticSidebarDronesFilteredByRepo.slice().sort(compareDronesByNewestFirst);
    return draftSidebarPlaceholderDrone ? [draftSidebarPlaceholderDrone, ...items] : items;
  }, [draftSidebarPlaceholderDrone, optimisticSidebarDronesFilteredByRepo]);

  const sidebarDroneById = React.useMemo(() => {
    const out: Record<string, DroneSummary> = {};
    for (const drone of sidebarDronesWithDraft) {
      const droneId = String(drone?.id ?? '').trim();
      if (!droneId) continue;
      out[droneId] = drone;
    }
    return out;
  }, [sidebarDronesWithDraft]);

  return {
    renderSidebarGroups,
    sidebarDroneById,
    sidebarFolderTree,
    visibleSidebarFolderPathSet,
  };
}
