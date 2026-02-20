import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { isStartupSeedFresh } from './app-config';
import type { StartupSeedState } from './app-types';

type SidebarGroup = {
  group: string;
  items: DroneSummary[];
};

type UseSidebarViewModelArgs = {
  selectedDroneIds: string[];
  viewMode: 'grouped' | 'flat';
  drones: DroneSummary[];
  dronesFilteredByRepo: DroneSummary[];
  groups: SidebarGroup[];
  startupSeedByDrone: Record<string, StartupSeedState>;
  optimisticallyDeletedDrones: Record<string, boolean>;
  activeRepoPath: string;
  registryGroupNames: string[];
};

export function useSidebarViewModel({
  selectedDroneIds,
  viewMode,
  drones,
  dronesFilteredByRepo,
  groups,
  startupSeedByDrone,
  optimisticallyDeletedDrones,
  activeRepoPath,
  registryGroupNames,
}: UseSidebarViewModelArgs) {
  const selectedDroneSet = React.useMemo(() => new Set(selectedDroneIds), [selectedDroneIds]);

  const orderedDroneIds = React.useMemo(() => {
    if (viewMode === 'flat') {
      return dronesFilteredByRepo
        .slice()
        .sort(compareDronesByNewestFirst)
        .map((d) => d.id);
    }
    return groups.flatMap((g) => g.items.map((d) => d.id));
  }, [dronesFilteredByRepo, groups, viewMode]);

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
      out.push({
        id,
        name,
        group: null,
        createdAt: seed.at || new Date().toISOString(),
        repoAttached: false,
        repoPath: '',
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

  const sidebarDronesFilteredByRepo = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return sidebarDrones;
    return sidebarDrones.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, sidebarDrones]);

  const sidebarGroups = React.useMemo(() => {
    const m = new Map<string, DroneSummary[]>();
    const hasRepoFilter = Boolean(String(activeRepoPath ?? '').trim());
    if (!hasRepoFilter) {
      for (const rawName of registryGroupNames) {
        const g = String(rawName ?? '').trim();
        if (!g || isUngroupedGroupName(g)) continue;
        if (!m.has(g)) m.set(g, []);
      }
    }
    for (const d of sidebarDronesFilteredByRepo) {
      const raw = (d.group ?? '').trim();
      const g = !raw || isUngroupedGroupName(raw) ? 'Ungrouped' : raw;
      const arr = m.get(g) ?? [];
      arr.push(d);
      m.set(g, arr);
    }
    const out = Array.from(m.entries()).map(([group, items]) => {
      items.sort(compareDronesByNewestFirst);
      return { group, items };
    });
    out.sort((a, b) => {
      if (isUngroupedGroupName(a.group) && !isUngroupedGroupName(b.group)) return -1;
      if (!isUngroupedGroupName(a.group) && isUngroupedGroupName(b.group)) return 1;
      return a.group.localeCompare(b.group);
    });
    return out;
  }, [activeRepoPath, registryGroupNames, sidebarDronesFilteredByRepo]);

  const sidebarHasUngroupedGroup = React.useMemo(
    () => sidebarGroups.some((g) => isUngroupedGroupName(g.group)),
    [sidebarGroups],
  );

  return {
    selectedDroneSet,
    orderedDroneIds,
    sidebarOptimisticDroneIdSet,
    sidebarDrones,
    uiDroneName,
    sidebarDronesFilteredByRepo,
    sidebarGroups,
    sidebarHasUngroupedGroup,
  };
}
