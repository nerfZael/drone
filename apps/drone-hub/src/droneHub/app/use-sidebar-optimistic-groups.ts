import React from 'react';
import type { DroneSummary } from '../types';
import type { SidebarGroup } from './use-sidebar-view-model';
import type { MoveDronesToGroupResult } from './use-group-management';
import {
  insertSidebarGroupOrderToken,
  mergeVisibleSidebarGroupOrder,
  renameSidebarEntryOrderMapKeysByPrefix,
  renameSidebarGroupTokenListByPrefix,
  type SidebarGroupCreatePlacement,
} from './sidebar-group-order';
import {
  mergeVisibleSidebarNodeOrderByParent,
  renameSidebarNodeOrderByParentGroupPrefix,
} from './sidebar-node-order';
import { renameCollapsedGroupKeysByPrefix } from './sidebar-collapsed-groups';
import {
  applySidebarOptimisticOpsToDrones,
  applySidebarOptimisticOpsToGroups,
  pruneSatisfiedSidebarOptimisticOps,
  type SidebarOptimisticOp,
} from './sidebar-optimistic-ops';
import { isUngroupedGroupName } from '../../domain';

type CreateGroupResult = {
  ok: boolean;
  error: string | null;
};

type ReparentDronesResult = {
  ok: boolean;
  error?: string | null;
  reparentedIds?: string[];
};

type OptimisticReparentOptions = {
  targetGroup?: string | null;
};

type MaybePromise<T> = T | Promise<T>;

type UseSidebarOptimisticGroupsArgs = {
  isRepoGroupingMode: boolean;
  sidebarGroups: SidebarGroup[];
  sidebarDronesFilteredByRepo: DroneSummary[];
  collapsedGroups: Record<string, boolean>;
  sidebarGroupOrder: string[];
  hiddenSidebarGroups: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  visibleNodeOrderByParent: Record<string, string[]>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSidebarGroupOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setHiddenSidebarGroups: React.Dispatch<React.SetStateAction<string[]>>;
  setSidebarDroneOrderByGroup: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  setSidebarNodeOrderByParent: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  onCreateGroup: (group: string) => MaybePromise<CreateGroupResult>;
  onCreateGroupAndMove: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onRenameGroup: (group: string, nextName?: string) => MaybePromise<boolean>;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onReparentDronesToParent: (parentDroneId: string | null, droneIds: string[]) => Promise<ReparentDronesResult>;
};

export function useSidebarOptimisticGroups({
  isRepoGroupingMode,
  sidebarGroups,
  sidebarDronesFilteredByRepo,
  collapsedGroups,
  sidebarGroupOrder,
  hiddenSidebarGroups,
  sidebarDroneOrderByGroup,
  sidebarNodeOrderByParent,
  visibleNodeOrderByParent,
  setCollapsedGroups,
  setSidebarGroupOrder,
  setHiddenSidebarGroups,
  setSidebarDroneOrderByGroup,
  setSidebarNodeOrderByParent,
  onCreateGroup,
  onCreateGroupAndMove,
  onRenameGroup,
  onMoveDronesToGroup,
  onReparentDronesToParent,
}: UseSidebarOptimisticGroupsArgs) {
  const [pendingSidebarOps, setPendingSidebarOps] = React.useState<SidebarOptimisticOp[]>([]);
  const optimisticSidebarOpIdRef = React.useRef(0);

  const createOptimisticSidebarOpId = React.useCallback(() => {
    optimisticSidebarOpIdRef.current += 1;
    return `sidebar-op-${optimisticSidebarOpIdRef.current}`;
  }, []);

  React.useEffect(() => {
    setPendingSidebarOps((prev) => pruneSatisfiedSidebarOptimisticOps(prev, sidebarGroups, sidebarDronesFilteredByRepo));
  }, [sidebarDronesFilteredByRepo, sidebarGroups]);

  const runOptimisticCreateGroup = React.useCallback(
    async (groupRaw: string, opts?: { placement?: SidebarGroupCreatePlacement }) => {
      const group = String(groupRaw ?? '').trim();
      if (!group) return { ok: false, error: 'Group name is required.' };
      const placement = opts?.placement ?? 'end';
      const groupOrderSnapshot = sidebarGroupOrder;
      setSidebarGroupOrder((prev) =>
        insertSidebarGroupOrderToken(prev, sidebarGroups, { group, kind: 'group' }, placement),
      );
      const opId = createOptimisticSidebarOpId();
      setPendingSidebarOps((prev) => [...prev, { id: opId, kind: 'create_group', group }]);
      const result = await onCreateGroup(group);
      if (!result.ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
        setSidebarGroupOrder(groupOrderSnapshot);
      }
      return result;
    },
    [createOptimisticSidebarOpId, onCreateGroup, setSidebarGroupOrder, sidebarGroupOrder, sidebarGroups],
  );

  const runOptimisticRenameGroup = React.useCallback(
    async (groupRaw: string, nextNameRaw?: string, opts?: { skipNodeOrderUpdate?: boolean }) => {
      const group = String(groupRaw ?? '').trim();
      const nextName = String(nextNameRaw ?? '').trim();
      if (!group || !nextName || group === nextName) return false;

      const collapsedSnapshot = collapsedGroups;
      const groupOrderSnapshot = sidebarGroupOrder;
      const hiddenSnapshot = hiddenSidebarGroups;
      const droneOrderSnapshot = sidebarDroneOrderByGroup;
      const nodeOrderSnapshot = sidebarNodeOrderByParent;
      const stabilizedGroupOrder = mergeVisibleSidebarGroupOrder(sidebarGroupOrder, sidebarGroups);
      const stabilizedNodeOrder = mergeVisibleSidebarNodeOrderByParent(sidebarNodeOrderByParent, visibleNodeOrderByParent);

      setCollapsedGroups((prev) => renameCollapsedGroupKeysByPrefix(prev, group, nextName));
      setSidebarGroupOrder(() =>
        renameSidebarGroupTokenListByPrefix(
          stabilizedGroupOrder,
          { group, kind: 'group' },
          { group: nextName, kind: 'group' },
        ),
      );
      setHiddenSidebarGroups((prev) =>
        renameSidebarGroupTokenListByPrefix(
          prev,
          { group, kind: 'group' },
          { group: nextName, kind: 'group' },
        ),
      );
      setSidebarDroneOrderByGroup((prev) =>
        renameSidebarEntryOrderMapKeysByPrefix(
          prev,
          { group, kind: 'group' },
          { group: nextName, kind: 'group' },
        ),
      );
      if (!opts?.skipNodeOrderUpdate) {
        setSidebarNodeOrderByParent(() => renameSidebarNodeOrderByParentGroupPrefix(stabilizedNodeOrder, group, nextName));
      }

      const opId = createOptimisticSidebarOpId();
      setPendingSidebarOps((prev) => [...prev, { id: opId, kind: 'rename_group', sourceGroup: group, targetGroup: nextName }]);
      const ok = await onRenameGroup(group, nextName);
      if (!ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
        setCollapsedGroups(collapsedSnapshot);
        setSidebarGroupOrder(groupOrderSnapshot);
        setHiddenSidebarGroups(hiddenSnapshot);
        setSidebarDroneOrderByGroup(droneOrderSnapshot);
        if (!opts?.skipNodeOrderUpdate) {
          setSidebarNodeOrderByParent(nodeOrderSnapshot);
        }
      }
      return ok;
    },
    [
      collapsedGroups,
      createOptimisticSidebarOpId,
      hiddenSidebarGroups,
      onRenameGroup,
      setCollapsedGroups,
      setHiddenSidebarGroups,
      setSidebarDroneOrderByGroup,
      setSidebarGroupOrder,
      setSidebarNodeOrderByParent,
      sidebarDroneOrderByGroup,
      sidebarGroupOrder,
      sidebarNodeOrderByParent,
      sidebarGroups,
      visibleNodeOrderByParent,
    ],
  );

  const runOptimisticMoveDronesToGroup = React.useCallback(
    async (groupRaw: string, droneIdsRaw: string[]) => {
      const droneIds = Array.from(new Set(droneIdsRaw.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)));
      const targetGroup = String(groupRaw ?? '').trim();
      if (droneIds.length === 0) return { ok: false, error: 'No drones selected.' } satisfies MoveDronesToGroupResult;
      const opId = createOptimisticSidebarOpId();
      setPendingSidebarOps((prev) => [
        ...prev,
        {
          id: opId,
          kind: 'move_drones',
          droneIds,
          targetGroup: isUngroupedGroupName(targetGroup) ? null : targetGroup,
        },
      ]);
      const result = await onMoveDronesToGroup(groupRaw, droneIds);
      if (!result.ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
      }
      return result;
    },
    [createOptimisticSidebarOpId, onMoveDronesToGroup],
  );

  const runOptimisticReparentDronesToParent = React.useCallback(
    async (parentDroneIdRaw: string | null, droneIdsRaw: string[], opts?: OptimisticReparentOptions) => {
      const droneIds = Array.from(new Set(droneIdsRaw.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)));
      const targetParentDroneId = String(parentDroneIdRaw ?? '').trim() || null;
      if (droneIds.length === 0) {
        return { ok: false, error: 'No drones selected to reparent.', reparentedIds: [] } satisfies ReparentDronesResult;
      }

      const targetParentDrone = targetParentDroneId
        ? sidebarDronesFilteredByRepo.find((drone) => drone.id === targetParentDroneId) ?? null
        : null;
      const targetGroup = targetParentDrone
        ? (String(targetParentDrone.group ?? '').trim() || null)
        : opts?.targetGroup !== undefined
          ? String(opts.targetGroup ?? '').trim() || null
          : undefined;
      const opId = createOptimisticSidebarOpId();
      setPendingSidebarOps((prev) => [
        ...prev,
        {
          id: opId,
          kind: 'reparent_drones',
          droneIds,
          targetParentDroneId,
          targetGroup,
        },
      ]);

      const result = await onReparentDronesToParent(targetParentDroneId, droneIds);
      if (!result.ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
      }
      return result;
    },
    [createOptimisticSidebarOpId, onReparentDronesToParent, sidebarDronesFilteredByRepo],
  );

  const runOptimisticCreateGroupAndMove = React.useCallback(
    async (groupRaw: string, droneIdsRaw: string[]) => {
      const group = String(groupRaw ?? '').trim();
      const droneIds = Array.from(new Set(droneIdsRaw.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)));
      if (!group) return { ok: false, error: 'Group name is required.' } satisfies MoveDronesToGroupResult;
      if (droneIds.length === 0) return { ok: false, error: 'No drones selected.' } satisfies MoveDronesToGroupResult;
      const createOpId = createOptimisticSidebarOpId();
      const moveOpId = createOptimisticSidebarOpId();
      setPendingSidebarOps((prev) => [
        ...prev,
        { id: createOpId, kind: 'create_group', group },
        { id: moveOpId, kind: 'move_drones', droneIds, targetGroup: isUngroupedGroupName(group) ? null : group },
      ]);
      const result = await onCreateGroupAndMove(group, droneIds);
      if (!result.ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== createOpId && op.id !== moveOpId));
      }
      return result;
    },
    [createOptimisticSidebarOpId, onCreateGroupAndMove],
  );

  const optimisticSidebarDronesFilteredByRepo = React.useMemo(
    () =>
      isRepoGroupingMode
        ? sidebarDronesFilteredByRepo
        : applySidebarOptimisticOpsToDrones(sidebarDronesFilteredByRepo, pendingSidebarOps),
    [isRepoGroupingMode, pendingSidebarOps, sidebarDronesFilteredByRepo],
  );

  const optimisticSidebarGroups = React.useMemo(
    () =>
      isRepoGroupingMode
        ? sidebarGroups
        : applySidebarOptimisticOpsToGroups(sidebarGroups, optimisticSidebarDronesFilteredByRepo, pendingSidebarOps),
    [isRepoGroupingMode, optimisticSidebarDronesFilteredByRepo, pendingSidebarOps, sidebarGroups],
  );

  return {
    optimisticSidebarGroups,
    optimisticSidebarDronesFilteredByRepo,
    runOptimisticCreateGroup,
    runOptimisticCreateGroupAndMove,
    runOptimisticRenameGroup,
    runOptimisticMoveDronesToGroup,
    runOptimisticReparentDronesToParent,
  };
}
