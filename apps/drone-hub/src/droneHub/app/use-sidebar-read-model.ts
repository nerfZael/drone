import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { buildSidebarFolderTree, flattenSidebarFolderTree } from './sidebar-folder-tree';
import { orderSidebarGroups } from './sidebar-group-order';
import type { SidebarGroup } from './use-sidebar-view-model';
import { isSidebarFolderHidden } from './is-sidebar-folder-hidden';

function repoPathToLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

type UseSidebarReadModelArgs = {
  draftSidebarPlaceholderDrone: DroneSummary | null;
  hiddenSidebarGroupTokenSet: Set<string>;
  isRepoGroupingMode: boolean;
  optimisticSidebarDronesFilteredByRepo: DroneSummary[];
  optimisticSidebarGroups: SidebarGroup[];
  repoScopedGroupPathsByRepoGroup: Record<string, string[]>;
  repoScopedGroupIdByPathByRepoGroup: Record<string, Record<string, string>>;
  showHiddenSidebarGroups: boolean;
  sidebarGroupIdByName: Record<string, string>;
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
  repoScopedGroupIdByPathByRepoGroup,
  showHiddenSidebarGroups,
  sidebarGroupIdByName,
  sidebarGroupOrder,
  sidebarGroupingMode,
  sidebarGroupCreatedAtByName,
}: UseSidebarReadModelArgs) {
  const renderSidebarGroups = React.useMemo(() => {
    const visibleOptimisticSidebarGroups =
      isRepoGroupingMode && !showHiddenSidebarGroups
        ? optimisticSidebarGroups.map((group) => {
            if (group.kind !== 'repo') return group;
            const scopedGroupIds = repoScopedGroupIdByPathByRepoGroup[group.group] ?? {};
            const items = group.items.filter((drone) => {
              const groupPath = String(drone.group ?? '').trim();
              return !groupPath || !isSidebarFolderHidden(
                hiddenSidebarGroupTokenSet,
                groupPath,
                'group',
                scopedGroupIds,
              );
            });
            return items.length === group.items.length ? group : { ...group, items };
          })
        : optimisticSidebarGroups;
    if (!draftSidebarPlaceholderDrone) return visibleOptimisticSidebarGroups;
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
    const placeholderGroupPath = String(draftSidebarPlaceholderDrone.group ?? '').trim();
    const placeholderGroupHidden =
      placeholderGroup.kind === 'repo' &&
      Boolean(placeholderGroupPath) &&
      isSidebarFolderHidden(
        hiddenSidebarGroupTokenSet,
        placeholderGroupPath,
        'group',
        repoScopedGroupIdByPathByRepoGroup[placeholderGroup.group] ?? {},
      );
    if (
      !showHiddenSidebarGroups &&
      (placeholderGroupHidden ||
        isSidebarFolderHidden(
          hiddenSidebarGroupTokenSet,
          placeholderGroup.group,
          placeholderGroup.kind,
          sidebarGroupIdByName,
        ))
    ) {
      return visibleOptimisticSidebarGroups;
    }
    const next = visibleOptimisticSidebarGroups.map((group) =>
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
    isRepoGroupingMode,
    optimisticSidebarGroups,
    repoScopedGroupIdByPathByRepoGroup,
    showHiddenSidebarGroups,
    sidebarGroupIdByName,
    sidebarGroupOrder,
    sidebarGroupingMode,
  ]);

  const visibleRepoScopedGroupPathsByRepoGroup = React.useMemo<Record<string, string[]>>(() => {
    if (!isRepoGroupingMode || showHiddenSidebarGroups) return repoScopedGroupPathsByRepoGroup;
    let changed = false;
    const next: Record<string, string[]> = {};
    for (const [repoGroupPath, groupPaths] of Object.entries(repoScopedGroupPathsByRepoGroup)) {
      const scopedGroupIds = repoScopedGroupIdByPathByRepoGroup[repoGroupPath] ?? {};
      const visiblePaths = groupPaths.filter(
        (groupPath) => !isSidebarFolderHidden(
          hiddenSidebarGroupTokenSet,
          groupPath,
          'group',
          scopedGroupIds,
        ),
      );
      if (visiblePaths.length !== groupPaths.length) changed = true;
      next[repoGroupPath] = visiblePaths;
    }
    return changed ? next : repoScopedGroupPathsByRepoGroup;
  }, [
    hiddenSidebarGroupTokenSet,
    isRepoGroupingMode,
    repoScopedGroupIdByPathByRepoGroup,
    repoScopedGroupPathsByRepoGroup,
    showHiddenSidebarGroups,
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
    for (const [repoGroupPath, groupPaths] of Object.entries(visibleRepoScopedGroupPathsByRepoGroup)) {
      if (!visibleRepoGroupPathSet.has(repoGroupPath)) continue;
      for (const groupPath of groupPaths) out.add(groupPath);
    }
    return out;
  }, [flatSidebarFolderNodes, isRepoGroupingMode, renderSidebarGroups, visibleRepoScopedGroupPathsByRepoGroup]);

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
    visibleRepoScopedGroupPathsByRepoGroup,
    visibleSidebarFolderPathSet,
  };
}
