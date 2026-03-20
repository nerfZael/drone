import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { isStartupSeedFresh } from './app-config';
import type { StartupSeedState } from './app-types';
import { orderSidebarEntries, orderSidebarGroups, sidebarGroupOrderToken } from './sidebar-group-order';

export type SidebarGroup = {
  group: string;
  label: string;
  kind: 'group' | 'repo';
  items: DroneSummary[];
};

export const SIDEBAR_VISIBLE_MULTI_CHAT_GROUP = '__sidebar-visible-drones__';

type UseSidebarViewModelArgs = {
  selectedDroneIds: string[];
  viewMode: 'grouped' | 'flat';
  sidebarGroupingMode: 'groups' | 'repos';
  collapsedGroups: Record<string, boolean>;
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  hiddenSidebarGroups: string[];
  showHiddenSidebarGroups: boolean;
  drones: DroneSummary[];
  startupSeedByDrone: Record<string, StartupSeedState>;
  optimisticallyDeletedDrones: Record<string, boolean>;
  activeRepoPath: string;
  registryGroupNames: string[];
};

function repoPathToLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export function useSidebarViewModel({
  selectedDroneIds,
  viewMode,
  sidebarGroupingMode,
  collapsedGroups,
  sidebarGroupOrder,
  sidebarDroneOrderByGroup,
  hiddenSidebarGroups,
  showHiddenSidebarGroups,
  drones,
  startupSeedByDrone,
  optimisticallyDeletedDrones,
  activeRepoPath,
  registryGroupNames,
}: UseSidebarViewModelArgs) {
  const selectedDroneSet = React.useMemo(() => new Set(selectedDroneIds), [selectedDroneIds]);

  const sidebarOptimisticDrones = React.useMemo(() => {
    const known = new Set(drones.map((d) => d.id));
    const nowMs = Date.now();
    const out: DroneSummary[] = [];
    for (const [id, seed] of Object.entries(startupSeedByDrone)) {
      if (optimisticallyDeletedDrones[id]) continue;
      if (known.has(id)) continue;
      if (!isStartupSeedFresh(seed, nowMs)) continue;
      const chatName = String(seed.chatName ?? 'default').trim() || 'default';
      const name = String(seed.droneName ?? '').trim() || id;
      const group = String(seed.group ?? '').trim() || null;
      const repoPath = String(seed.repoPath ?? '').trim();
      out.push({
        id,
        name,
        group,
        createdAt: seed.at || new Date().toISOString(),
        repoAttached: Boolean(repoPath),
        repoPath,
        containerPort: 0,
        hostPort: null,
        statusOk: true,
        statusError: null,
        chats: [chatName],
        hubPhase: 'starting',
        hubMessage: 'Queued',
        busy: true,
      });
    }
    out.sort(compareDronesByNewestFirst);
    return out;
  }, [drones, optimisticallyDeletedDrones, startupSeedByDrone]);

  const sidebarOptimisticDroneIdSet = React.useMemo(
    () => new Set(sidebarOptimisticDrones.map((d) => d.id)),
    [sidebarOptimisticDrones],
  );

  const sidebarDrones = React.useMemo(
    () => [...drones, ...sidebarOptimisticDrones],
    [drones, sidebarOptimisticDrones],
  );

  const uiDroneName = React.useCallback((nameRaw: string): string => String(nameRaw ?? '').trim(), []);

  const sidebarDronesFilteredByRepoBase = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return sidebarDrones;
    return sidebarDrones.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, sidebarDrones]);

  const hiddenSidebarGroupTokenSet = React.useMemo(() => new Set(hiddenSidebarGroups), [hiddenSidebarGroups]);

  const allSidebarGroups = React.useMemo(() => {
    if (sidebarGroupingMode === 'repos') {
      const byRepo = new Map<string, { group: string; label: string; kind: 'repo'; items: DroneSummary[] }>();
      for (const d of sidebarDronesFilteredByRepoBase) {
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
        );
      }
      out.sort((a, b) => {
        if (isUngroupedGroupName(a.label) && !isUngroupedGroupName(b.label)) return -1;
        if (!isUngroupedGroupName(a.label) && isUngroupedGroupName(b.label)) return 1;
        return a.label.localeCompare(b.label);
      });
      return orderSidebarGroups(out, sidebarGroupOrder);
    }

    const m = new Map<string, DroneSummary[]>();
    const hasRepoFilter = Boolean(String(activeRepoPath ?? '').trim());
    if (!hasRepoFilter) {
      for (const rawName of registryGroupNames) {
        const g = String(rawName ?? '').trim();
        if (!g || isUngroupedGroupName(g)) continue;
        if (!m.has(g)) m.set(g, []);
      }
    }
    for (const d of sidebarDronesFilteredByRepoBase) {
      const raw = (d.group ?? '').trim();
      const g = !raw || isUngroupedGroupName(raw) ? 'Ungrouped' : raw;
      const arr = m.get(g) ?? [];
      arr.push(d);
      m.set(g, arr);
    }
    const out = Array.from(m.entries()).map(([group, items]): SidebarGroup => {
      items.sort(compareDronesByNewestFirst);
      const groupOrderKey = sidebarGroupOrderToken({ group, kind: 'group' });
      return {
        group,
        label: group,
        kind: 'group',
        items: orderSidebarEntries(items, sidebarDroneOrderByGroup[groupOrderKey] ?? [], (item) => item.id),
      };
    });
    out.sort((a, b) => {
      if (isUngroupedGroupName(a.label) && !isUngroupedGroupName(b.label)) return -1;
      if (!isUngroupedGroupName(a.label) && isUngroupedGroupName(b.label)) return 1;
      return a.label.localeCompare(b.label);
    });
    return orderSidebarGroups(out, sidebarGroupOrder);
  }, [
    activeRepoPath,
    registryGroupNames,
    sidebarDroneOrderByGroup,
    sidebarDronesFilteredByRepoBase,
    sidebarGroupOrder,
    sidebarGroupingMode,
  ]);

  const sidebarHiddenGroupCount = React.useMemo(
    () =>
      allSidebarGroups.reduce(
        (count, group) => count + (hiddenSidebarGroupTokenSet.has(sidebarGroupOrderToken(group)) ? 1 : 0),
        0,
      ),
    [allSidebarGroups, hiddenSidebarGroupTokenSet],
  );

  const sidebarGroups = React.useMemo(() => {
    if (showHiddenSidebarGroups) return allSidebarGroups;
    return allSidebarGroups.filter((group) => !hiddenSidebarGroupTokenSet.has(sidebarGroupOrderToken(group)));
  }, [allSidebarGroups, hiddenSidebarGroupTokenSet, showHiddenSidebarGroups]);

  const visibleSidebarDroneIdSet = React.useMemo(() => {
    const out = new Set<string>();
    for (const group of sidebarGroups) {
      for (const item of group.items) out.add(item.id);
    }
    return out;
  }, [sidebarGroups]);

  const sidebarDronesFilteredByRepo = React.useMemo(() => {
    if (showHiddenSidebarGroups) return sidebarDronesFilteredByRepoBase;
    return sidebarDronesFilteredByRepoBase.filter((drone) => visibleSidebarDroneIdSet.has(drone.id));
  }, [showHiddenSidebarGroups, sidebarDronesFilteredByRepoBase, visibleSidebarDroneIdSet]);

  const orderedDroneIds = React.useMemo(() => {
    if (viewMode === 'flat') {
      return sidebarDronesFilteredByRepo
        .slice()
        .sort(compareDronesByNewestFirst)
        .map((d) => d.id);
    }
    return sidebarGroups.flatMap((g) => g.items.map((d) => d.id));
  }, [sidebarDronesFilteredByRepo, sidebarGroups, viewMode]);

  const sidebarVisibleDrones = React.useMemo(() => {
    if (viewMode === 'flat') {
      return sidebarDronesFilteredByRepo.slice().sort(compareDronesByNewestFirst);
    }
    const visible: DroneSummary[] = [];
    for (const group of sidebarGroups) {
      if (collapsedGroups[group.group]) continue;
      visible.push(...group.items);
    }
    return visible;
  }, [collapsedGroups, sidebarDronesFilteredByRepo, sidebarGroups, viewMode]);

  const sidebarHasUngroupedGroup = React.useMemo(
    () => allSidebarGroups.some((g) => isUngroupedGroupName(g.label)),
    [allSidebarGroups],
  );

  return {
    selectedDroneSet,
    orderedDroneIds,
    sidebarOptimisticDroneIdSet,
    sidebarDrones,
    uiDroneName,
    sidebarDronesFilteredByRepo,
    sidebarVisibleDrones,
    sidebarGroups,
    sidebarHiddenGroupCount,
    sidebarHasUngroupedGroup,
  };
}
