import React from 'react';
import { useDndMonitor, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import type { DroneSummary } from '../types';
import { parseDroneHubDragData, useDroneHubActiveDrag } from './drone-hub-dnd';
import { assignedDroneIdsFromData, resolveAssignedDroneIdsFromTransfer } from './drone-hub-dnd-utils';
import {
  CANVAS_ASSIGNMENT_PREVIEW_EVENT,
  normalizeCanvasAssignmentPreviewDetail,
  type CanvasAssignmentPreviewDetail,
} from './fleet-assignment-events';

export function useFleetAssignmentDropState({
  currentDrone,
  currentDroneLabel,
  openDroneErrorModal,
  onRequestDropActions,
}: {
  currentDrone: DroneSummary;
  currentDroneLabel: string;
  openDroneErrorModal: (drone: DroneSummary, message: string, meta: null) => void;
  onRequestDropActions: (targetDroneId: string, sourceDroneIds: string[]) => { ok: boolean; error?: string | null };
}) {
  const activeSidebarDrag = useDroneHubActiveDrag();
  const fleetDropId = React.useMemo(() => `fleet-assignment-drop:${currentDrone.id}`, [currentDrone.id]);
  const [fleetBadgeSidebarDropActive, setFleetBadgeSidebarDropActive] = React.useState(false);
  const [fleetBadgeNativeDropActive, setFleetBadgeNativeDropActive] = React.useState(false);
  const [canvasAssignmentPreview, setCanvasAssignmentPreview] = React.useState<CanvasAssignmentPreviewDetail | null>(null);
  const { setNodeRef: setFleetDropNodeRef } = useDroppable({
    id: fleetDropId,
    data: { type: 'fleet-assignment-drop', droneId: currentDrone.id },
  });

  const requestDropActionsForCurrentDrone = React.useCallback(
    (targetIdsRaw: string[]) => {
      const targetIds = Array.from(new Set(targetIdsRaw.map((item) => String(item ?? '').trim()).filter(Boolean)));
      if (targetIds.length === 0) return;
      const result = onRequestDropActions(currentDrone.id, targetIds);
      if (!result.ok) {
        const message = String(result.error ?? '').trim() || 'Unable to open drop actions.';
        openDroneErrorModal(currentDrone, message, null);
      }
    },
    [currentDrone, onRequestDropActions, openDroneErrorModal],
  );

  const clearTransientDropState = React.useCallback(() => {
    setFleetBadgeSidebarDropActive(false);
    setFleetBadgeNativeDropActive(false);
    setCanvasAssignmentPreview(null);
  }, []);

  const updateFleetDropState = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overType = String(event.over?.data.current?.type ?? '').trim();
      const overDroneId = String(event.over?.data.current?.droneId ?? '').trim();
      const hasAssignableTarget = assignedDroneIdsFromData(activeData).some((id) => id && id !== currentDrone.id);
      setFleetBadgeSidebarDropActive(
        overType === 'fleet-assignment-drop' && overDroneId === currentDrone.id && hasAssignableTarget,
      );
    },
    [currentDrone.id],
  );

  React.useEffect(() => {
    const onCanvasAssignmentPreview = (event: Event) => {
      const detail = normalizeCanvasAssignmentPreviewDetail(
        (event as CustomEvent<CanvasAssignmentPreviewDetail | null>).detail,
      );
      setCanvasAssignmentPreview(detail);
    };
    window.addEventListener(CANVAS_ASSIGNMENT_PREVIEW_EVENT, onCanvasAssignmentPreview as EventListener);
    window.addEventListener('mouseup', clearTransientDropState);
    window.addEventListener('dragend', clearTransientDropState);
    window.addEventListener('drop', clearTransientDropState);
    window.addEventListener('blur', clearTransientDropState);
    return () => {
      window.removeEventListener(CANVAS_ASSIGNMENT_PREVIEW_EVENT, onCanvasAssignmentPreview as EventListener);
      window.removeEventListener('mouseup', clearTransientDropState);
      window.removeEventListener('dragend', clearTransientDropState);
      window.removeEventListener('drop', clearTransientDropState);
      window.removeEventListener('blur', clearTransientDropState);
    };
  }, [clearTransientDropState, currentDrone.id]);

  useDndMonitor({
    onDragMove: updateFleetDropState,
    onDragOver: updateFleetDropState,
    onDragCancel: clearTransientDropState,
    onDragEnd: (event: DragEndEvent) => {
      const activeData = parseDroneHubDragData(event.active.data.current);
      const overType = String(event.over?.data.current?.type ?? '').trim();
      const overDroneId = String(event.over?.data.current?.droneId ?? '').trim();
      clearTransientDropState();
      if (overType !== 'fleet-assignment-drop' || overDroneId !== currentDrone.id) return;
      requestDropActionsForCurrentDrone(assignedDroneIdsFromData(activeData));
    },
  });

  const sidebarDraggedDroneIds = React.useMemo(
    () =>
      assignedDroneIdsFromData(activeSidebarDrag).filter((droneId) => droneId && droneId !== currentDrone.id),
    [activeSidebarDrag, currentDrone.id],
  );
  const canvasDraggedDroneIds = React.useMemo(
    () =>
      (canvasAssignmentPreview?.droneIds ?? []).filter((droneId) => droneId && droneId !== currentDrone.id),
    [canvasAssignmentPreview?.droneIds, currentDrone.id],
  );
  const fleetDropHintCount = Math.max(sidebarDraggedDroneIds.length, canvasDraggedDroneIds.length);
  const fleetDropHintVisible = fleetDropHintCount > 0;
  const fleetBadgeDropActive =
    fleetBadgeSidebarDropActive ||
    fleetBadgeNativeDropActive ||
    String(canvasAssignmentPreview?.overDroneId ?? '').trim() === currentDrone.id;
  const fleetDropHintText = fleetBadgeDropActive
    ? `Release to assign ${fleetDropHintCount} drone${fleetDropHintCount === 1 ? '' : 's'} to ${currentDroneLabel}.`
    : `Drop ${fleetDropHintCount} drone${fleetDropHintCount === 1 ? '' : 's'} anywhere in this chat to assign them to ${currentDroneLabel}.`;

  const onFleetDropDragOver = React.useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const droneIds = resolveAssignedDroneIdsFromTransfer(event.dataTransfer);
      const hasAssignableTarget = droneIds.some((id) => id && id !== currentDrone.id);
      if (!hasAssignableTarget) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (!fleetBadgeNativeDropActive) setFleetBadgeNativeDropActive(true);
    },
    [currentDrone.id, fleetBadgeNativeDropActive],
  );
  const onFleetDropDragLeave = React.useCallback((event: React.DragEvent<HTMLElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setFleetBadgeNativeDropActive(false);
  }, []);
  const onFleetDropDrop = React.useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setFleetBadgeNativeDropActive(false);
      requestDropActionsForCurrentDrone(resolveAssignedDroneIdsFromTransfer(event.dataTransfer));
    },
    [requestDropActionsForCurrentDrone],
  );

  return {
    fleetBadgeDropActive,
    fleetDropHintVisible,
    fleetDropHintText,
    onFleetDropDragLeave,
    onFleetDropDragOver,
    onFleetDropDrop,
    setFleetDropNodeRef,
  };
}
