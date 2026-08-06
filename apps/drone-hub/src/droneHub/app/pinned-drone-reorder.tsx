import React from 'react';
import {
  useDndMonitor,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  parseDroneHubDragData,
  type SidebarPinnedDroneDragData,
} from './drone-hub-dnd';
import type { SidebarGroupDropPlacement } from './sidebar-group-order';
import {
  SidebarReorderDropIndicator,
  sidebarDropPlacementFromRects,
} from './sidebar-reorder-ui';

type PinnedDroneDropTarget = {
  droneId: string;
  placement: SidebarGroupDropPlacement;
};

type PinnedDroneDragRenderProps = {
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
  dragNodeRef?: React.Ref<HTMLDivElement>;
  draggable: boolean;
  dragging: boolean;
};

function dropTargetFromEvent(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
): PinnedDroneDropTarget | null {
  const active = parseDroneHubDragData(event.active.data.current);
  const overData = event.over?.data.current as Record<string, unknown> | undefined;
  if (
    active?.type !== 'sidebar-pinned-drone' ||
    overData?.type !== 'sidebar-pinned-drone-reorder'
  ) {
    return null;
  }
  const droneId = String(overData.droneId ?? '').trim();
  if (!droneId || droneId === active.droneId) return null;
  return {
    droneId,
    placement: sidebarDropPlacementFromRects(
      event.active.rect.current.translated ?? event.active.rect.current.initial,
      event.over?.rect ?? null,
    ),
  };
}

export function usePinnedDroneReorder({
  enabled,
  onReorder,
  onPrepareDroneDragStart,
}: {
  enabled: boolean;
  onReorder: (
    activeDroneId: string,
    overDroneId: string,
    placement: SidebarGroupDropPlacement,
  ) => void;
  onPrepareDroneDragStart: (droneId: string, draggedDroneIds?: readonly string[]) => void;
}): PinnedDroneDropTarget | null {
  const [dropTarget, setDropTarget] = React.useState<PinnedDroneDropTarget | null>(null);

  const updateDropTarget = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      setDropTarget(enabled ? dropTargetFromEvent(event) : null);
    },
    [enabled],
  );

  const clearDropTarget = React.useCallback(() => {
    setDropTarget(null);
  }, []);

  useDndMonitor({
    onDragStart: (event) => {
      if (!enabled) return;
      const active = parseDroneHubDragData(event.active.data.current);
      if (active?.type === 'sidebar-pinned-drone') {
        onPrepareDroneDragStart(active.droneId);
      }
    },
    onDragMove: updateDropTarget,
    onDragOver: updateDropTarget,
    onDragCancel: clearDropTarget,
    onDragEnd: (event) => {
      if (!enabled) {
        clearDropTarget();
        return;
      }
      const active = parseDroneHubDragData(event.active.data.current);
      const target = dropTargetFromEvent(event);
      if (active?.type === 'sidebar-pinned-drone' && target) {
        onReorder(active.droneId, target.droneId, target.placement);
      }
      clearDropTarget();
    },
  });

  return dropTarget;
}

export function PinnedDroneReorderItem({
  droneId,
  label,
  disabled,
  dropTarget,
  children,
}: {
  droneId: string;
  label: string;
  disabled: boolean;
  dropTarget: PinnedDroneDropTarget | null;
  children: (props: PinnedDroneDragRenderProps) => React.ReactNode;
}) {
  const dragData = React.useMemo<SidebarPinnedDroneDragData>(
    () => ({
      type: 'sidebar-pinned-drone',
      droneId,
      label,
    }),
    [droneId, label],
  );
  const {
    attributes,
    listeners,
    isDragging,
    setNodeRef: setDragNodeRef,
  } = useDraggable({
    id: `sidebar-pinned-drone:${droneId}`,
    data: dragData,
    disabled,
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `sidebar-pinned-drone-reorder:${droneId}`,
    data: {
      type: 'sidebar-pinned-drone-reorder',
      droneId,
    },
    disabled,
  });

  return (
    <div ref={disabled ? undefined : setDropNodeRef} className="relative">
      {children({
        dragAttributes: disabled
          ? undefined
          : (attributes as unknown as Record<string, unknown>),
        dragListeners: disabled
          ? undefined
          : (listeners as unknown as Record<string, unknown>),
        dragNodeRef: disabled ? undefined : setDragNodeRef,
        draggable: !disabled,
        dragging: isDragging,
      })}
      {dropTarget?.droneId === droneId ? (
        <SidebarReorderDropIndicator placement={dropTarget.placement} />
      ) : null}
    </div>
  );
}
