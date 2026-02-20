import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { isStartupSeedFresh } from './app-config';
import type { StartupSeedState } from './app-types';

export type SidebarGroup = {
  group: string;
  label: string;
  kind: 'group' | 'repo';
  items: DroneSummary[];
};

type UseSidebarViewModelArgs = {
  selectedDroneIds: string[];
  viewMode: 'grouped' | 'flat';
  sidebarGroupingMode: 'groups' | 'repos';
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
    if (sidebarGroupingMode === 'repos') {
      const byRepo = new Map<string, { group: string; label: string; kind: 'repo'; items: DroneSummary[] }>();
      for (const d of sidebarDronesFilteredByRepo) {
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
      for (const g of out) g.items.sort(compareDronesByNewestFirst);
      out.sort((a, b) => {
        if (isUngroupedGroupName(a.label) && !isUngroupedGroupName(b.label)) return -1;
        if (!isUngroupedGroupName(a.label) && isUngroupedGroupName(b.label)) return 1;
        return a.label.localeCompare(b.label);
      });
      return out;
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
    for (const d of sidebarDronesFilteredByRepo) {
      const raw = (d.group ?? '').trim();
      const g = !raw || isUngroupedGroupName(raw) ? 'Ungrouped' : raw;
      const arr = m.get(g) ?? [];
      arr.push(d);
      m.set(g, arr);
    }
    const out = Array.from(m.entries()).map(([group, items]): SidebarGroup => {
      items.sort(compareDronesByNewestFirst);
      return { group, label: group, kind: 'group', items };
    });
    out.sort((a, b) => {
      if (isUngroupedGroupName(a.label) && !isUngroupedGroupName(b.label)) return -1;
      if (!isUngroupedGroupName(a.label) && isUngroupedGroupName(b.label)) return 1;
      return a.label.localeCompare(b.label);
    });
    return out;
  }, [activeRepoPath, registryGroupNames, sidebarDronesFilteredByRepo, sidebarGroupingMode]);

  const orderedDroneIds = React.useMemo(() => {
    if (viewMode === 'flat') {
      return sidebarDronesFilteredByRepo
        .slice()
        .sort(compareDronesByNewestFirst)
        .map((d) => d.id);
    }
    return sidebarGroups.flatMap((g) => g.items.map((d) => d.id));
  }, [sidebarDronesFilteredByRepo, sidebarGroups, viewMode]);

  const sidebarHasUngroupedGroup = React.useMemo(
    () => sidebarGroups.some((g) => isUngroupedGroupName(g.label)),
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
