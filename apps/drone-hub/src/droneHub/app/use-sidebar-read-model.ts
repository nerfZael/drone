import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { buildSidebarFolderTree, flattenSidebarFolderTree } from './sidebar-folder-tree';
import { orderSidebarGroups } from './sidebar-group-order';
import { isSameOrDescendantSidebarGroupPath } from './sidebar-group-paths';
import type { SidebarGroup } from './use-sidebar-view-model';

function repoPathToLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

function sidebarFolderHiddenByTokens(
  hiddenTokens: Set<string>,
  path: string,
  kind: 'group' | 'repo',
): boolean {
  const tokenPrefix = `${kind}:`;
  return Array.from(hiddenTokens).some((token) => {
    if (!token.startsWith(tokenPrefix)) return false;
    return isSameOrDescendantSidebarGroupPath(path, token.slice(tokenPrefix.length));
  });
}

type UseSidebarReadModelArgs = {
  draftSidebarPlaceholderDrone: DroneSummary | null;
  hiddenSidebarGroupTokenSet: Set<string>;
  isRepoGroupingMode: boolean;
  optimisticSidebarDronesFilteredByRepo: DroneSummary[];
  optimisticSidebarGroups: SidebarGroup[];
  repoScopedGroupPathsByRepoGroup: Record<string, string[]>;
  showHiddenSidebarGroups: boolean;
  sidebarGroupOrder: string[];
  sidebarGroupingMode: 'groups' | 'repos';
  sidebarGroupCreatedAtByName: Record<string, string | null>;
};

export function useSidebarReadModel({
  draftSidebarPlaceholderDrone,
  hiddenSidebarGroupTokenSet,
  isRepoGroupingMode,
  optimisticSidebarDronesFilteredByRepo,
  optimisticSidebarGroups,
  repoScopedGroupPathsByRepoGroup,
  showHiddenSidebarGroups,
  sidebarGroupOrder,
  sidebarGroupingMode,
  sidebarGroupCreatedAtByName,
}: UseSidebarReadModelArgs) {
  const renderSidebarGroups = React.useMemo(() => {
    if (!draftSidebarPlaceholderDrone) return optimisticSidebarGroups;
    const placeholderGroup =
      sidebarGroupingMode === 'repos'
        ? {
            group: draftSidebarPlaceholderDrone.repoPath
              ? `repo:${draftSidebarPlaceholderDrone.repoPath}`
              : 'repo:ungrouped',
            label: draftSidebarPlaceholderDrone.repoPath
              ? repoPathToLabel(draftSidebarPlaceholderDrone.repoPath)
              : 'Ungrouped',
            kind: 'repo' as const,
          }
        : {
            group: String(draftSidebarPlaceholderDrone.group ?? '').trim() || 'Ungrouped',
            label: String(draftSidebarPlaceholderDrone.group ?? '').trim() || 'Ungrouped',
            kind: 'group' as const,
          };
    if (
      !showHiddenSidebarGroups &&
      sidebarFolderHiddenByTokens(hiddenSidebarGroupTokenSet, placeholderGroup.group, placeholderGroup.kind)
    ) {
      return optimisticSidebarGroups;
    }
    const next = optimisticSidebarGroups.map((group) =>
      group.group === placeholderGroup.group
        ? { ...group, items: [draftSidebarPlaceholderDrone, ...group.items] }
        : group,
    );
    if (next.some((group) => group.group === placeholderGroup.group)) return next;
    next.push({ ...placeholderGroup, items: [draftSidebarPlaceholderDrone] });
    next.sort((a, b) => {
      if (isUngroupedGroupName(a.label) && !isUngroupedGroupName(b.label)) return -1;
      if (!isUngroupedGroupName(a.label) && isUngroupedGroupName(b.label)) return 1;
      return a.label.localeCompare(b.label);
    });
    return orderSidebarGroups(next, sidebarGroupOrder);
  }, [
    draftSidebarPlaceholderDrone,
    hiddenSidebarGroupTokenSet,
    optimisticSidebarGroups,
    showHiddenSidebarGroups,
    sidebarGroupOrder,
    sidebarGroupingMode,
  ]);

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
