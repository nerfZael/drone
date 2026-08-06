import React from 'react';
import {
  useDndMonitor,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  draggedDroneIdsFromData,
  parseDroneHubDragData,
  type DroneHubDragData,
} from './drone-hub-dnd';
import { resolveSidebarUngroupedDropDroneIds } from './sidebar-ungrouped-drop';
import type { MoveDronesToGroupResult } from './use-group-management';

type UseSidebarUngroupedDropArgs = {
  activeDrag: DroneHubDragData | null;
  isRepoGroupingMode: boolean;
  runOptimisticMoveDronesToGroup: (
    group: string,
    droneIds: string[],
  ) => Promise<MoveDronesToGroupResult>;
  sidebarHasUngroupedGroup: boolean;
};

export function useSidebarUngroupedDrop({
  activeDrag,
  isRepoGroupingMode,
  runOptimisticMoveDronesToGroup,
  sidebarHasUngroupedGroup,
}: UseSidebarUngroupedDropArgs) {
  const [dragOverUngrouped, setDragOverUngrouped] = React.useState(false);
  const activeDraggedDroneIds = React.useMemo(
    () => draggedDroneIdsFromData(activeDrag),
    [activeDrag],
  );
  const enabled = !isRepoGroupingMode && !sidebarHasUngroupedGroup;

  const dropDroneIds = React.useCallback(
    (event: DragMoveEvent | DragOverEvent | DragEndEvent) =>
      resolveSidebarUngroupedDropDroneIds({
        droneIds: draggedDroneIdsFromData(
          parseDroneHubDragData(event.active.data.current),
        ),
        overType: event.over?.data.current?.type,
        enabled,
      }),
    [enabled],
  );
  const updateDragState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      setDragOverUngrouped(dropDroneIds(event).length > 0);
    },
    [dropDroneIds],
  );
  const clearDragState = React.useCallback(() => {
    setDragOverUngrouped(false);
  }, []);

  useDndMonitor({
    onDragMove: updateDragState,
    onDragOver: updateDragState,
    onDragCancel: clearDragState,
    onDragEnd: (event) => {
      const droneIds = dropDroneIds(event);
      if (droneIds.length > 0) {
        void runOptimisticMoveDronesToGroup('Ungrouped', droneIds);
      }
      clearDragState();
    },
  });

  return {
    activeDraggedDroneIds,
    dragOverUngrouped,
  };
}
