import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import type { SidebarGroup } from './use-sidebar-view-model';
import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
} from './sidebar-group-paths';

export type SidebarOptimisticOp =
  | {
      id: string;
      kind: 'move_drones';
      droneIds: string[];
      targetGroup: string | null;
    }
  | {
      id: string;
      kind: 'reparent_drones';
      droneIds: string[];
      targetParentDroneId: string | null;
      targetGroup?: string | null;
    }
  | {
      id: string;
      kind: 'rename_group';
      sourceGroup: string;
      targetGroup: string;
    }
  | {
      id: string;
      kind: 'create_group';
      group: string;
    };

function normalizeGroupPath(value: string | null | undefined): string | null {
  const group = String(value ?? '').trim();
  if (!group || isUngroupedGroupName(group)) return null;
  return group;
}

export function applySidebarOptimisticOpsToDrones(
  drones: DroneSummary[],
  ops: SidebarOptimisticOp[],
): DroneSummary[] {
  if (ops.length === 0 || drones.length === 0) return drones;
  let next = drones.slice();

  for (const op of ops) {
    if (op.kind === 'move_drones') {
      const droneIdSet = new Set(op.droneIds);
      const targetGroup = normalizeGroupPath(op.targetGroup);
      next = next.map((drone) =>
        droneIdSet.has(drone.id)
          ? { ...drone, group: targetGroup }
          : drone,
      );
      continue;
    }

    if (op.kind === 'reparent_drones') {
      const droneIdSet = new Set(op.droneIds);
      const targetParentDroneId = String(op.targetParentDroneId ?? '').trim() || null;
      next = next.map((drone) =>
        droneIdSet.has(drone.id)
          ? {
              ...drone,
              fleetParentId: targetParentDroneId,
              ...(op.targetGroup !== undefined ? { group: normalizeGroupPath(op.targetGroup) } : {}),
            }
          : drone,
      );
      continue;
    }

    if (op.kind === 'rename_group') {
      next = next.map((drone) => {
        const group = normalizeGroupPath(drone.group);
        if (!group || !isSameOrDescendantSidebarGroupPath(group, op.sourceGroup)) return drone;
        return {
          ...drone,
          group: rewriteSidebarGroupPathPrefix(group, op.sourceGroup, op.targetGroup),
        };
      });
    }
  }

  return next;
}

export function applySidebarOptimisticOpsToGroups(
  groups: SidebarGroup[],
  optimisticDrones: DroneSummary[],
  ops: SidebarOptimisticOp[],
): SidebarGroup[] {
  if (ops.length === 0) {
    return groups.map((group) => ({
      ...group,
      items: optimisticDrones.filter((drone) => {
        const groupName = normalizeGroupPath(drone.group) ?? 'Ungrouped';
        return group.kind === 'group' && group.group === groupName;
      }),
    }));
  }

  const baseGroupKinds = new Map<string, SidebarGroup['kind']>();
  const groupNames = new Set<string>();
  for (const group of groups) {
    if (group.kind !== 'group') continue;
    baseGroupKinds.set(group.group, group.kind);
    groupNames.add(group.group);
  }

  for (const op of ops) {
    if (op.kind === 'create_group') {
      groupNames.add(op.group);
      continue;
    }
    if (op.kind === 'rename_group') {
      const renamed = new Set<string>();
      for (const groupName of groupNames) {
        if (isSameOrDescendantSidebarGroupPath(groupName, op.sourceGroup)) {
          renamed.add(rewriteSidebarGroupPathPrefix(groupName, op.sourceGroup, op.targetGroup));
          continue;
        }
        renamed.add(groupName);
      }
      groupNames.clear();
      for (const groupName of renamed) groupNames.add(groupName);
    }
  }

  for (const drone of optimisticDrones) {
    const groupName = normalizeGroupPath(drone.group) ?? 'Ungrouped';
    groupNames.add(groupName);
  }

  const itemsByGroup = new Map<string, DroneSummary[]>();
  for (const drone of optimisticDrones) {
    const groupName = normalizeGroupPath(drone.group) ?? 'Ungrouped';
    const items = itemsByGroup.get(groupName) ?? [];
    items.push(drone);
    itemsByGroup.set(groupName, items);
  }

  return Array.from(groupNames).map((groupName) => ({
    group: groupName,
    label: groupName,
    kind: baseGroupKinds.get(groupName) ?? 'group',
    items: itemsByGroup.get(groupName) ?? [],
  }));
}

export function pruneSatisfiedSidebarOptimisticOps(
  ops: SidebarOptimisticOp[],
  groups: SidebarGroup[],
  drones: DroneSummary[],
): SidebarOptimisticOp[] {
  if (ops.length === 0) return ops;
  return ops.filter((op) => {
    if (op.kind === 'move_drones') {
      return op.droneIds.some((droneId) => {
        const drone = drones.find((item) => item.id === droneId);
        const currentGroup = normalizeGroupPath(drone?.group);
        const targetGroup = normalizeGroupPath(op.targetGroup);
        return currentGroup !== targetGroup;
      });
    }
    if (op.kind === 'reparent_drones') {
      return op.droneIds.some((droneId) => {
        const drone = drones.find((item) => item.id === droneId);
        const currentParentDroneId = String(drone?.fleetParentId ?? '').trim() || null;
        const targetParentDroneId = String(op.targetParentDroneId ?? '').trim() || null;
        if (currentParentDroneId !== targetParentDroneId) return true;
        if (op.targetGroup === undefined) return false;
        const currentGroup = normalizeGroupPath(drone?.group);
        const targetGroup = normalizeGroupPath(op.targetGroup);
        return currentGroup !== targetGroup;
      });
    }
    if (op.kind === 'rename_group') {
      const hasSource = groups.some(
        (group) => group.kind === 'group' && isSameOrDescendantSidebarGroupPath(group.group, op.sourceGroup),
      );
      const hasTarget = groups.some(
        (group) => group.kind === 'group' && isSameOrDescendantSidebarGroupPath(group.group, op.targetGroup),
      );
      return hasSource || !hasTarget;
    }
    return !groups.some((group) => group.kind === 'group' && group.group === op.group);
  });
}
