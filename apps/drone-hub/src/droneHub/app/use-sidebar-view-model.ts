import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import { compareDronesByNewestFirst, isHiddenDrone, parseIsoTimestampMs } from './helpers';
import { isStartupSeedFresh } from './app-config';
import type { StartupSeedState } from './app-types';
import { orderSidebarEntries, orderSidebarGroups, sidebarGroupOrderToken } from './sidebar-group-order';
import { isSidebarGroupDeleting as matchesDeletingSidebarGroup } from './sidebar-group-delete-visibility';
import { isSameOrDescendantSidebarGroupPath } from './sidebar-group-paths';
import { buildRepoSidebarGroups } from './sidebar-repo-groups';
import { isDroneRecentForSidebar } from './sidebar-recent-filter';

const RECENT_FILTER_REFRESH_MS = 60 * 1000;

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
  deletingGroups: Record<string, boolean>;
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  hiddenSidebarGroups: string[];
  showHiddenSidebarGroups: boolean;
  drones: DroneSummary[];
  startupSeedByDrone: Record<string, StartupSeedState>;
  optimisticallyDeletedDrones: Record<string, boolean>;
  activeRepoPath: string;
  showRecentDronesOnly: boolean;
  registryGroupNames: string[];
  registryGroupCreatedAtByName: Record<string, string | null>;
  registeredRepoPaths: string[];
};

function compareGroupNamesByNewestFirst(
  a: string,
  b: string,
  createdAtByName: Record<string, string | null>,
): number {
  if (isUngroupedGroupName(a) && !isUngroupedGroupName(b)) return -1;
  if (!isUngroupedGroupName(a) && isUngroupedGroupName(b)) return 1;
  const aMs = parseIsoTimestampMs(createdAtByName[a]);
  const bMs = parseIsoTimestampMs(createdAtByName[b]);
  if (aMs != null && bMs == null) return -1;
  if (aMs == null && bMs != null) return 1;
  if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
  return a.localeCompare(b);
}

export function useSidebarViewModel({
  selectedDroneIds,
  viewMode,
  sidebarGroupingMode,
  collapsedGroups,
  deletingGroups,
  sidebarGroupOrder,
  sidebarDroneOrderByGroup,
  hiddenSidebarGroups,
  showHiddenSidebarGroups,
  drones,
  startupSeedByDrone,
  optimisticallyDeletedDrones,
  activeRepoPath,
  showRecentDronesOnly,
  registryGroupNames,
  registryGroupCreatedAtByName,
  registeredRepoPaths,
}: UseSidebarViewModelArgs) {
  const selectedDroneSet = React.useMemo(() => new Set(selectedDroneIds), [selectedDroneIds]);
  const [recentFilterNowMs, setRecentFilterNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!showRecentDronesOnly) return;
    setRecentFilterNowMs(Date.now());
    const intervalId = globalThis.setInterval(() => {
      setRecentFilterNowMs(Date.now());
    }, RECENT_FILTER_REFRESH_MS);
    return () => globalThis.clearInterval(intervalId);
  }, [showRecentDronesOnly]);

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
        runtime: seed.runtime,
        repoAttached: Boolean(repoPath),
        repoPath,
        ...(seed.runtime === 'host' ? { cwd: repoPath || '/' } : {}),
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

  const sidebarVisibleBaseDrones = React.useMemo(
    () => drones.filter((drone) => !isHiddenDrone(drone)),
    [drones],
  );

  const recentSidebarVisibleBaseDrones = React.useMemo(() => {
    if (!showRecentDronesOnly) return sidebarVisibleBaseDrones;
    return sidebarVisibleBaseDrones.filter((drone) =>
      isDroneRecentForSidebar(drone, recentFilterNowMs),
    );
  }, [recentFilterNowMs, showRecentDronesOnly, sidebarVisibleBaseDrones]);

  const sidebarDrones = React.useMemo(
    () => [...recentSidebarVisibleBaseDrones, ...sidebarOptimisticDrones],
    [recentSidebarVisibleBaseDrones, sidebarOptimisticDrones],
  );

  const uiDroneName = React.useCallback((nameRaw: string): string => String(nameRaw ?? '').trim(), []);

  const sidebarDronesFilteredByRepoBase = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return sidebarDrones;
    return sidebarDrones.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, sidebarDrones]);

  const hiddenSidebarGroupTokenSet = React.useMemo(() => new Set(hiddenSidebarGroups), [hiddenSidebarGroups]);
  const isSidebarGroupHidden = React.useCallback(
    (group: SidebarGroup) => {
      const token = sidebarGroupOrderToken(group);
      if (hiddenSidebarGroupTokenSet.has(token)) return true;
      if (group.kind !== 'group') return false;
      return hiddenSidebarGroups.some((hiddenToken) => {
        if (!hiddenToken.startsWith('group:')) return false;
        return isSameOrDescendantSidebarGroupPath(group.group, hiddenToken.slice('group:'.length));
      });
    },
    [hiddenSidebarGroupTokenSet, hiddenSidebarGroups],
  );
  const isSidebarGroupDeleting = React.useCallback(
    (group: SidebarGroup) => matchesDeletingSidebarGroup(group, deletingGroups),
    [deletingGroups],
  );

  const allSidebarGroups = React.useMemo(() => {
    if (sidebarGroupingMode === 'repos') {
      return buildRepoSidebarGroups({
        drones: sidebarDronesFilteredByRepoBase,
        activeRepoPath,
        registeredRepoPaths,
        sidebarDroneOrderByGroup,
        sidebarGroupOrder,
        includeEmptyRegisteredRepoGroups: !showRecentDronesOnly,
      }).filter((group) => !isSidebarGroupDeleting(group));
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
        items: orderSidebarEntries(items, sidebarDroneOrderByGroup[groupOrderKey] ?? [], (item) => item.id, {
          unorderedPlacement: 'start',
        }),
      };
    });
    out.sort((a, b) => compareGroupNamesByNewestFirst(a.group, b.group, registryGroupCreatedAtByName));
    return orderSidebarGroups(out, sidebarGroupOrder).filter((group) => !isSidebarGroupDeleting(group));
  }, [
    activeRepoPath,
    isSidebarGroupDeleting,
    registeredRepoPaths,
    registryGroupNames,
    registryGroupCreatedAtByName,
    sidebarDroneOrderByGroup,
    sidebarDronesFilteredByRepoBase,
    sidebarGroupOrder,
    sidebarGroupingMode,
    showRecentDronesOnly,
  ]);

  const sidebarHiddenGroupCount = React.useMemo(
    () =>
      allSidebarGroups.reduce(
        (count, group) => count + (isSidebarGroupHidden(group) ? 1 : 0),
        0,
      ),
    [allSidebarGroups, isSidebarGroupHidden],
  );

  const sidebarGroups = React.useMemo(() => {
    if (showHiddenSidebarGroups) return allSidebarGroups;
    return allSidebarGroups.filter((group) => !isSidebarGroupHidden(group));
  }, [allSidebarGroups, isSidebarGroupHidden, showHiddenSidebarGroups]);

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
    sidebarGroupCreatedAtByName: registryGroupCreatedAtByName,
  };
}
