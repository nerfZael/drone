import React from 'react';
import type { SidebarMoveCommandResult } from '@drone/device-protocol';
import {
  type SidebarCommandQueue,
  type SidebarMoveIntent,
} from '@drone/hub-model/sidebar';
import type { DroneSummary } from '../types';
import type { SidebarGroup } from './use-sidebar-view-model';
import type { MoveDronesToGroupResult } from './use-group-management';
import {
  insertSidebarGroupOrderToken,
  removeSidebarGroupOrderToken,
  type SidebarGroupCreatePlacement,
} from './sidebar-group-order';
import {
  applySidebarOptimisticOpsToDrones,
  applySidebarOptimisticOpsToGroups,
  pruneSatisfiedSidebarOptimisticOps,
  sidebarOptimisticOpForMoveIntent,
  type SidebarOptimisticOp,
} from './sidebar-optimistic-ops';
import { isUngroupedGroupName } from '../../domain';
import { isSameOrDescendantSidebarGroupPath } from './sidebar-group-paths';

type CreateGroupResult = {
  ok: boolean;
  error: string | null;
};

type ReparentDronesResult = {
  ok: boolean;
  error?: string | null;
  reparentedIds?: string[];
  rollbackOptimistic?: () => void;
};

type OptimisticReparentOptions = {
  targetGroup?: string | null;
};

type MaybePromise<T> = T | Promise<T>;

type UseSidebarOptimisticGroupsArgs = {
  isRepoGroupingMode: boolean;
  sidebarGroups: SidebarGroup[];
  sidebarDronesFilteredByRepo: DroneSummary[];
  deletingGroups: Record<string, boolean>;
  sidebarGroupOrder: string[];
  setSidebarGroupOrder: React.Dispatch<React.SetStateAction<string[]>>;
  onCreateGroup: (group: string) => MaybePromise<CreateGroupResult>;
  onCreateGroupAndMove: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onRenameGroup: (group: string, nextName?: string) => MaybePromise<boolean>;
  onMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onReparentDronesToParent: (parentDroneId: string | null, droneIds: string[]) => Promise<ReparentDronesResult>;
  onMoveSidebar: (
    intent: SidebarMoveIntent,
  ) => Promise<SidebarMoveCommandResult>;
  sidebarCommandQueue: SidebarCommandQueue;
  onSidebarMutationError: (message: string | null) => void;
};

export function useSidebarOptimisticGroups({
  isRepoGroupingMode,
  sidebarGroups,
  sidebarDronesFilteredByRepo,
  deletingGroups,
  sidebarGroupOrder,
  setSidebarGroupOrder,
  onCreateGroup,
  onCreateGroupAndMove,
  onRenameGroup,
  onMoveDronesToGroup,
  onReparentDronesToParent,
  onMoveSidebar,
  sidebarCommandQueue,
  onSidebarMutationError,
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
      const placement = opts?.placement ?? 'start';
      setSidebarGroupOrder((prev) =>
        insertSidebarGroupOrderToken(prev, sidebarGroups, { group, kind: 'group' }, placement),
      );
      const opId = createOptimisticSidebarOpId();
      setPendingSidebarOps((prev) => [...prev, { id: opId, kind: 'create_group', group }]);
      const result = await sidebarCommandQueue.enqueue(
        async () => await onCreateGroup(group),
      );
      if (!result.ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
        setSidebarGroupOrder((prev) => removeSidebarGroupOrderToken(prev, { group, kind: 'group' }));
      }
      return result;
    },
    [createOptimisticSidebarOpId, onCreateGroup, setSidebarGroupOrder, sidebarCommandQueue, sidebarGroups],
  );

  const runOptimisticRenameGroup = React.useCallback(
    async (groupRaw: string, nextNameRaw?: string, _opts?: { skipNodeOrderUpdate?: boolean }) => {
      const group = String(groupRaw ?? '').trim();
      const nextName = String(nextNameRaw ?? '').trim();
      if (!group || !nextName || group === nextName) return false;

      const opId = createOptimisticSidebarOpId();
      setPendingSidebarOps((prev) => [...prev, { id: opId, kind: 'rename_group', sourceGroup: group, targetGroup: nextName }]);
      const ok = await sidebarCommandQueue.enqueue(
        async () => await onRenameGroup(group, nextName),
      );
      if (!ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
      }
      return ok;
    },
    [
      createOptimisticSidebarOpId,
      onRenameGroup,
      sidebarCommandQueue,
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
      const result = await sidebarCommandQueue.enqueue(
        () => onMoveDronesToGroup(groupRaw, droneIds),
      );
      if (!result.ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
      }
      return result;
    },
    [createOptimisticSidebarOpId, onMoveDronesToGroup, sidebarCommandQueue],
  );

  const runOptimisticMoveSidebar = React.useCallback(
    async (intent: SidebarMoveIntent): Promise<boolean> => {
      onSidebarMutationError(null);
      const op = sidebarOptimisticOpForMoveIntent(
        intent,
        createOptimisticSidebarOpId(),
      );
      if (op) setPendingSidebarOps((prev) => [...prev, op]);
      try {
        const result = await onMoveSidebar(intent);
        const ok = result.ok;
        const membershipApplied = result.stages.membership.status === 'applied';
        if (!ok && op) {
          if (!membershipApplied) {
            setPendingSidebarOps((prev) => prev.filter((pending) => pending.id !== op.id));
          }
        }
        if (!ok) {
          onSidebarMutationError(
            membershipApplied
              ? `The item moved, but its sidebar ordering was not saved: ${result.error}`
              : `Could not update the sidebar: ${result.error}`,
          );
        }
        return ok;
      } catch (error) {
        if (op) {
          setPendingSidebarOps((prev) => prev.filter((pending) => pending.id !== op.id));
        }
        onSidebarMutationError('Could not update the sidebar. Your latest change was not saved.');
        throw error;
      }
    },
    [createOptimisticSidebarOpId, onMoveSidebar, onSidebarMutationError],
  );

  const runOptimisticReparentDronesToParent = React.useCallback(
    async (parentDroneIdRaw: string | null, droneIdsRaw: string[], opts?: OptimisticReparentOptions) => {
      const droneIds = Array.from(new Set(droneIdsRaw.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)));
      const targetParentDroneId = String(parentDroneIdRaw ?? '').trim() || null;
      if (droneIds.length === 0) {
        return { ok: false, error: 'No drones selected to reparent.', reparentedIds: [] } satisfies ReparentDronesResult;
      }

      const optimisticDrones = isRepoGroupingMode
        ? sidebarDronesFilteredByRepo
        : applySidebarOptimisticOpsToDrones(sidebarDronesFilteredByRepo, pendingSidebarOps);
      const targetParentDrone = targetParentDroneId
        ? optimisticDrones.find((drone) => drone.id === targetParentDroneId) ?? null
        : null;
      const targetGroup = targetParentDrone
        ? (String(targetParentDrone.group ?? '').trim() || null)
        : opts?.targetGroup !== undefined
          ? String(opts.targetGroup ?? '').trim() || null
          : undefined;
      const opId = createOptimisticSidebarOpId();
      const rollbackOptimistic = () => {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== opId));
      };
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

      const result = await sidebarCommandQueue.enqueue(
        () => onReparentDronesToParent(targetParentDroneId, droneIds),
      );
      if (!result.ok) {
        rollbackOptimistic();
      }
      return result.ok ? { ...result, rollbackOptimistic } : result;
    },
    [createOptimisticSidebarOpId, isRepoGroupingMode, onReparentDronesToParent, pendingSidebarOps, sidebarCommandQueue, sidebarDronesFilteredByRepo],
  );

  const runOptimisticCreateGroupAndMove = React.useCallback(
    async (groupRaw: string, droneIdsRaw: string[]) => {
      const group = String(groupRaw ?? '').trim();
      const droneIds = Array.from(new Set(droneIdsRaw.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)));
      if (!group) return { ok: false, error: 'Group name is required.' } satisfies MoveDronesToGroupResult;
      if (droneIds.length === 0) return { ok: false, error: 'No drones selected.' } satisfies MoveDronesToGroupResult;
      const createOpId = createOptimisticSidebarOpId();
      const moveOpId = createOptimisticSidebarOpId();
      setSidebarGroupOrder((prev) =>
        insertSidebarGroupOrderToken(prev, sidebarGroups, { group, kind: 'group' }, 'start'),
      );
      setPendingSidebarOps((prev) => [
        ...prev,
        { id: createOpId, kind: 'create_group', group },
        { id: moveOpId, kind: 'move_drones', droneIds, targetGroup: isUngroupedGroupName(group) ? null : group },
      ]);
      const result = await sidebarCommandQueue.enqueue(
        () => onCreateGroupAndMove(group, droneIds),
      );
      if (!result.ok) {
        setPendingSidebarOps((prev) => prev.filter((op) => op.id !== createOpId && op.id !== moveOpId));
        if (!result.groupCreated) {
          setSidebarGroupOrder((prev) => removeSidebarGroupOrderToken(prev, { group, kind: 'group' }));
        }
      }
      return result;
    },
    [createOptimisticSidebarOpId, onCreateGroupAndMove, setSidebarGroupOrder, sidebarCommandQueue, sidebarGroups],
  );

  const optimisticSidebarDronesFilteredByRepo = React.useMemo(
    () =>
      isRepoGroupingMode
        ? sidebarDronesFilteredByRepo
        : applySidebarOptimisticOpsToDrones(sidebarDronesFilteredByRepo, pendingSidebarOps),
    [isRepoGroupingMode, pendingSidebarOps, sidebarDronesFilteredByRepo],
  );

  const optimisticSidebarGroups = React.useMemo(() => {
    if (isRepoGroupingMode) return sidebarGroups;
    const pendingDeletedGroupNames = Object.entries(deletingGroups)
      .filter(([, deleting]) => deleting)
      .map(([group]) => group);
    return applySidebarOptimisticOpsToGroups(
      sidebarGroups,
      optimisticSidebarDronesFilteredByRepo,
      pendingSidebarOps,
    ).filter(
      (group) =>
        !pendingDeletedGroupNames.some((deletedGroup) =>
          isSameOrDescendantSidebarGroupPath(group.group, deletedGroup),
        ),
    );
  }, [
    deletingGroups,
    isRepoGroupingMode,
    optimisticSidebarDronesFilteredByRepo,
    pendingSidebarOps,
    sidebarGroups,
  ]);

  return {
    optimisticSidebarGroups,
    optimisticSidebarDronesFilteredByRepo,
    runOptimisticCreateGroup,
    runOptimisticCreateGroupAndMove,
    runOptimisticRenameGroup,
    runOptimisticMoveDronesToGroup,
    runOptimisticMoveSidebar,
    runOptimisticReparentDronesToParent,
  };
}
