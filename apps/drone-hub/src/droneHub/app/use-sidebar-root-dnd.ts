import React from 'react';
import { useDndMonitor, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { isUngroupedGroupName } from '../../domain';
import {
  draggedDroneIdsFromData,
  parseDroneHubDragData,
  type SidebarDragGroupRef,
  type DroneHubDragData,
} from './drone-hub-dnd';
import {
  orderSidebarGroups,
  reorderSidebarGroupOrder,
  sidebarGroupOrderToken,
  type SidebarGroupDropPlacement,
} from './sidebar-group-order';
import { isSameOrDescendantSidebarGroupPath, sidebarGroupParentPath } from './sidebar-group-paths';
import { normalizeSidebarReorderTarget, sidebarDropPlacementFromRects } from './sidebar-reorder-ui';
import type { MoveDronesToGroupResult } from './use-group-management';
import type { SidebarGroup } from './use-sidebar-view-model';

type UseSidebarRootDndArgs = {
  activeDrag: DroneHubDragData | null;
  isRepoGroupingMode: boolean;
  moveFolderIntoGroup: (sourceGroup: string, targetGroup: string) => Promise<boolean>;
  runOptimisticMoveDronesToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  setCreateGroupInlineError: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateGroupTargetDroneIds: React.Dispatch<React.SetStateAction<string[] | null>>;
  setSidebarGroupOrder: React.Dispatch<React.SetStateAction<string[]>>;
  sidebarGroupOrder: string[];
  sidebarGroups: SidebarGroup[];
  sidebarHasUngroupedGroup: boolean;
};

export function useSidebarRootDnd({
  activeDrag,
  isRepoGroupingMode,
  moveFolderIntoGroup,
  runOptimisticMoveDronesToGroup,
  setCreateGroupInlineError,
  setCreateGroupTargetDroneIds,
  setSidebarGroupOrder,
  sidebarGroupOrder,
  sidebarGroups,
  sidebarHasUngroupedGroup,
}: UseSidebarRootDndArgs) {
  const [dragOverCreateGroup, setDragOverCreateGroup] = React.useState(false);
  const [dragOverGroup, setDragOverGroup] = React.useState<string | null>(null);
  const [dragOverUngrouped, setDragOverUngrouped] = React.useState(false);
  const [dragOverSidebarGroup, setDragOverSidebarGroup] = React.useState<{
    token: string;
    placement: SidebarGroupDropPlacement;
  } | null>(null);

  const activeDraggedDroneIds = React.useMemo(() => draggedDroneIdsFromData(activeDrag), [activeDrag]);
  const draggingSidebarGroup =
    activeDrag?.type === 'sidebar-group' ? sidebarGroupOrderToken(activeDrag.groupRef) : null;

  const clearSidebarDragState = React.useCallback(() => {
    setDragOverSidebarGroup(null);
    setDragOverGroup(null);
    setDragOverUngrouped(false);
    setDragOverCreateGroup(false);
  }, []);

  const currentPlacementFromEvent = React.useCallback(
    (event: DragMoveEvent | DragOverEvent | DragEndEvent): SidebarGroupDropPlacement =>
      sidebarDropPlacementFromRects(
        event.active.rect.current.translated ?? event.active.rect.current.initial,
        event.over?.rect ?? null,
      ),
    [],
  );

  const currentSidebarGroupTargetFromEvent = React.useCallback(
    (
      event: DragMoveEvent | DragOverEvent | DragEndEvent,
      activeGroupRef: SidebarDragGroupRef,
      overGroupRef: SidebarDragGroupRef,
    ) => {
      const visibleTokens = orderSidebarGroups(sidebarGroups, sidebarGroupOrder)
        .filter((group: SidebarGroup) => {
          if (group.kind !== activeGroupRef.kind) return false;
          if (group.kind !== 'group') return true;
          return sidebarGroupParentPath(group.group) === sidebarGroupParentPath(overGroupRef.group);
        })
        .map((group: SidebarGroup) => sidebarGroupOrderToken(group));
      const overTokenRaw = sidebarGroupOrderToken(overGroupRef);
      return normalizeSidebarReorderTarget(visibleTokens, overTokenRaw, currentPlacementFromEvent(event));
    },
    [currentPlacementFromEvent, sidebarGroupOrder, sidebarGroups],
  );

  const resolveMoveTargetGroupFromOverData = React.useCallback((overData: Record<string, unknown> | undefined): string | null => {
    if (!overData) return null;
    if (overData.type === 'sidebar-group-move') {
      return String(overData.group ?? '').trim() || null;
    }
    if (overData.type === 'sidebar-drone-reorder') {
      return String(overData.groupName ?? '').trim() || null;
    }
    return null;
  }, []);

  const updateSidebarDragState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overData = event.over?.data.current as Record<string, unknown> | undefined;
      const draggedDroneIds = draggedDroneIdsFromData(activeData);
      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-reorder' &&
        overData.groupRef &&
        typeof overData.groupRef === 'object'
      ) {
        const target = overData.groupRef as SidebarDragGroupRef;
        const draggedToken = sidebarGroupOrderToken(activeData.groupRef);
        const targetToken = sidebarGroupOrderToken(target);
        const sameFolderParent =
          activeData.groupRef.kind !== 'group' ||
          target.kind !== 'group' ||
          sidebarGroupParentPath(activeData.groupRef.group) === sidebarGroupParentPath(target.group);
        if (sameFolderParent && draggedToken && targetToken && draggedToken !== targetToken) {
          const dropTarget = currentSidebarGroupTargetFromEvent(event, activeData.groupRef, target);
          setDragOverGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(false);
          setDragOverSidebarGroup({
            token: dropTarget.overId,
            placement: dropTarget.placement,
          });
          return;
        }
      }

      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-reorder' &&
        overData.groupRef &&
        typeof overData.groupRef === 'object'
      ) {
        const target = overData.groupRef as SidebarDragGroupRef;
        const sameFolderParent =
          activeData.groupRef.kind !== 'group' ||
          target.kind !== 'group' ||
          sidebarGroupParentPath(activeData.groupRef.group) === sidebarGroupParentPath(target.group);
        if (
          !sameFolderParent &&
          target.kind === 'group' &&
          target.group &&
          target.group !== activeData.groupRef.group &&
          !isUngroupedGroupName(target.group) &&
          !isSameOrDescendantSidebarGroupPath(target.group, activeData.groupRef.group)
        ) {
          setDragOverSidebarGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(false);
          setDragOverGroup(target.group);
          return;
        }
      }

      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-move' &&
        typeof overData.group === 'string'
      ) {
        const targetGroup = String(overData.group ?? '').trim();
        if (
          targetGroup &&
          targetGroup !== activeData.groupRef.group &&
          !isUngroupedGroupName(targetGroup) &&
          !isSameOrDescendantSidebarGroupPath(targetGroup, activeData.groupRef.group)
        ) {
          setDragOverSidebarGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(false);
          setDragOverGroup(targetGroup);
          return;
        }
      }

      if (!isRepoGroupingMode && draggedDroneIds.length > 0) {
        const moveTargetGroup = resolveMoveTargetGroupFromOverData(overData);
        if (moveTargetGroup) {
          if (activeData?.type === 'sidebar-group' && activeData.groupRef.kind === 'group' && activeData.groupRef.group === moveTargetGroup) {
            clearSidebarDragState();
            return;
          }
          setDragOverSidebarGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(false);
          setDragOverGroup(moveTargetGroup);
          return;
        }
        if (overData?.type === 'sidebar-ungrouped-drop' && !sidebarHasUngroupedGroup) {
          setDragOverSidebarGroup(null);
          setDragOverGroup(null);
          setDragOverCreateGroup(false);
          setDragOverUngrouped(true);
          return;
        }
        if (overData?.type === 'sidebar-create-group-drop') {
          setDragOverSidebarGroup(null);
          setDragOverGroup(null);
          setDragOverUngrouped(false);
          setDragOverCreateGroup(true);
          return;
        }
      }

      clearSidebarDragState();
    },
    [
      clearSidebarDragState,
      currentSidebarGroupTargetFromEvent,
      isRepoGroupingMode,
      resolveMoveTargetGroupFromOverData,
      sidebarHasUngroupedGroup,
    ],
  );

  useDndMonitor({
    onDragMove: updateSidebarDragState,
    onDragOver: updateSidebarDragState,
    onDragCancel: clearSidebarDragState,
    onDragEnd: (event: DragEndEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overData = event.over?.data.current as Record<string, unknown> | undefined;
      const draggedDroneIds = draggedDroneIdsFromData(activeData);

      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-reorder' &&
        overData.groupRef &&
        typeof overData.groupRef === 'object'
      ) {
        const target = overData.groupRef as SidebarDragGroupRef;
        const targetToken = sidebarGroupOrderToken(target);
        const sameFolderParent =
          activeData.groupRef.kind !== 'group' ||
          target.kind !== 'group' ||
          sidebarGroupParentPath(activeData.groupRef.group) === sidebarGroupParentPath(target.group);
        if (sameFolderParent && targetToken && targetToken !== sidebarGroupOrderToken(activeData.groupRef)) {
          const fallbackTarget = currentSidebarGroupTargetFromEvent(event, activeData.groupRef, target);
          const dropTarget = dragOverSidebarGroup ?? {
            token: fallbackTarget.overId,
            placement: fallbackTarget.placement,
          };
          const resolvedTarget =
            orderSidebarGroups(sidebarGroups, sidebarGroupOrder).find(
              (group: SidebarGroup) => sidebarGroupOrderToken(group) === dropTarget.token,
            ) ?? target;
          setSidebarGroupOrder((prev: string[]) =>
            reorderSidebarGroupOrder(prev, sidebarGroups, activeData.groupRef, resolvedTarget, dropTarget.placement),
          );
          clearSidebarDragState();
          return;
        }
      }

      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-reorder' &&
        overData.groupRef &&
        typeof overData.groupRef === 'object'
      ) {
        const target = overData.groupRef as SidebarDragGroupRef;
        const sameFolderParent =
          activeData.groupRef.kind !== 'group' ||
          target.kind !== 'group' ||
          sidebarGroupParentPath(activeData.groupRef.group) === sidebarGroupParentPath(target.group);
        if (
          !sameFolderParent &&
          target.kind === 'group' &&
          target.group &&
          target.group !== activeData.groupRef.group &&
          !isUngroupedGroupName(target.group) &&
          !isSameOrDescendantSidebarGroupPath(target.group, activeData.groupRef.group)
        ) {
          void moveFolderIntoGroup(activeData.groupRef.group, target.group);
          clearSidebarDragState();
          return;
        }
      }

      if (
        activeData?.type === 'sidebar-group' &&
        overData?.type === 'sidebar-group-move' &&
        typeof overData.group === 'string'
      ) {
        const targetGroup = String(overData.group ?? '').trim();
        if (
          targetGroup &&
          targetGroup !== activeData.groupRef.group &&
          !isUngroupedGroupName(targetGroup) &&
          !isSameOrDescendantSidebarGroupPath(targetGroup, activeData.groupRef.group)
        ) {
          void moveFolderIntoGroup(activeData.groupRef.group, targetGroup);
          clearSidebarDragState();
          return;
        }
      }

      if (!isRepoGroupingMode && draggedDroneIds.length > 0) {
        const moveTargetGroup = resolveMoveTargetGroupFromOverData(overData);
        if (moveTargetGroup) {
          void runOptimisticMoveDronesToGroup(moveTargetGroup, draggedDroneIds);
          clearSidebarDragState();
          return;
        }
        if (overData?.type === 'sidebar-ungrouped-drop' && !sidebarHasUngroupedGroup) {
          void runOptimisticMoveDronesToGroup('Ungrouped', draggedDroneIds);
          clearSidebarDragState();
          return;
        }
        if (overData?.type === 'sidebar-create-group-drop') {
          setCreateGroupTargetDroneIds(draggedDroneIds);
          setCreateGroupInlineError(null);
          clearSidebarDragState();
          return;
        }
      }

      clearSidebarDragState();
    },
  });

  return {
    activeDraggedDroneIds,
    dragOverCreateGroup,
    dragOverGroup,
    dragOverSidebarGroup,
    dragOverUngrouped,
    draggingSidebarGroup,
  };
}
