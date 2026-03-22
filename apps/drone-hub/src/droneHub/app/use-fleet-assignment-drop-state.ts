import React from 'react';
import { useDndMonitor, useDroppable, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import type { DroneSummary } from '../types';
import { assignFleetTargets, fetchFleetActor, type FleetActorPayload } from '../fleet/fleet-api';
import type { RightPanelTab } from './app-config';
import { parseDroneHubDragData, useDroneHubActiveDrag } from './drone-hub-dnd';
import { assignedDroneIdsFromData, resolveAssignedDroneIdsFromTransfer } from './drone-hub-dnd-utils';
import {
  CANVAS_ASSIGNMENT_PREVIEW_EVENT,
  FLEET_ASSIGNMENT_UPDATED_EVENT,
  dispatchFleetAssignmentUpdated,
  normalizeCanvasAssignmentPreviewDetail,
  normalizeFleetAssignmentUpdatedDetail,
  type CanvasAssignmentPreviewDetail,
  type FleetAssignmentUpdatedDetail,
} from './fleet-assignment-events';

export function useFleetAssignmentDropState({
  currentDrone,
  currentDroneLabel,
  openDroneErrorModal,
  setRightPanelOpen,
  setRightPanelTab,
}: {
  currentDrone: DroneSummary;
  currentDroneLabel: string;
  openDroneErrorModal: (drone: DroneSummary, message: string, meta: null) => void;
  setRightPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRightPanelTab: React.Dispatch<React.SetStateAction<RightPanelTab>>;
}) {
  const activeSidebarDrag = useDroneHubActiveDrag();
  const fleetDropId = React.useMemo(() => `fleet-assignment-drop:${currentDrone.id}`, [currentDrone.id]);
  const [fleetBadgeData, setFleetBadgeData] = React.useState<FleetActorPayload | null>(null);
  const [fleetBadgeLoading, setFleetBadgeLoading] = React.useState(true);
  const [fleetBadgeAssigning, setFleetBadgeAssigning] = React.useState(false);
  const [fleetBadgeError, setFleetBadgeError] = React.useState<string | null>(null);
  const [fleetBadgeSidebarDropActive, setFleetBadgeSidebarDropActive] = React.useState(false);
  const [fleetBadgeNativeDropActive, setFleetBadgeNativeDropActive] = React.useState(false);
  const [canvasAssignmentPreview, setCanvasAssignmentPreview] = React.useState<CanvasAssignmentPreviewDetail | null>(null);
  const fleetBadgeDataRef = React.useRef<FleetActorPayload | null>(null);
  const { setNodeRef: setFleetDropNodeRef } = useDroppable({
    id: fleetDropId,
    data: { type: 'fleet-assignment-drop', droneId: currentDrone.id },
  });

  const assignFleetTargetsToCurrentDrone = React.useCallback(
    async (targetIdsRaw: string[]) => {
      setFleetBadgeAssigning(true);
      setFleetBadgeError(null);
      try {
        const latest = await assignFleetTargets(currentDrone.id, targetIdsRaw);
        if (latest) {
          setFleetBadgeData(latest);
          dispatchFleetAssignmentUpdated({ ownerDroneId: currentDrone.id, actor: latest });
        }
      } catch (error: any) {
        const message = String(error?.message ?? error ?? '').trim() || 'Failed to assign drone.';
        setFleetBadgeError(message);
        openDroneErrorModal(currentDrone, message, null);
      } finally {
        setFleetBadgeAssigning(false);
      }
    },
    [currentDrone, openDroneErrorModal],
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

  const openFleetTab = React.useCallback(() => {
    setRightPanelOpen(true);
    setRightPanelTab('fleet');
  }, [setRightPanelOpen, setRightPanelTab]);

  React.useEffect(() => {
    fleetBadgeDataRef.current = fleetBadgeData;
  }, [fleetBadgeData]);

  React.useEffect(() => {
    const onCanvasAssignmentPreview = (event: Event) => {
      const detail = normalizeCanvasAssignmentPreviewDetail(
        (event as CustomEvent<CanvasAssignmentPreviewDetail | null>).detail,
      );
      setCanvasAssignmentPreview(detail);
    };
    const onFleetAssignmentUpdated = (event: Event) => {
      const detail = normalizeFleetAssignmentUpdatedDetail(
        (event as CustomEvent<FleetAssignmentUpdatedDetail | null>).detail,
      );
      if (!detail || detail.ownerDroneId !== currentDrone.id) return;
      setFleetBadgeData(detail.actor);
      setFleetBadgeError(null);
    };
    window.addEventListener(CANVAS_ASSIGNMENT_PREVIEW_EVENT, onCanvasAssignmentPreview as EventListener);
    window.addEventListener(FLEET_ASSIGNMENT_UPDATED_EVENT, onFleetAssignmentUpdated as EventListener);
    window.addEventListener('mouseup', clearTransientDropState);
    window.addEventListener('dragend', clearTransientDropState);
    window.addEventListener('drop', clearTransientDropState);
    window.addEventListener('blur', clearTransientDropState);
    return () => {
      window.removeEventListener(CANVAS_ASSIGNMENT_PREVIEW_EVENT, onCanvasAssignmentPreview as EventListener);
      window.removeEventListener(FLEET_ASSIGNMENT_UPDATED_EVENT, onFleetAssignmentUpdated as EventListener);
      window.removeEventListener('mouseup', clearTransientDropState);
      window.removeEventListener('dragend', clearTransientDropState);
      window.removeEventListener('drop', clearTransientDropState);
      window.removeEventListener('blur', clearTransientDropState);
    };
  }, [clearTransientDropState, currentDrone.id]);

  React.useEffect(() => {
    let cancelled = false;
    setFleetBadgeData(null);
    setFleetBadgeError(null);
    setFleetBadgeLoading(true);

    const tick = async (silent: boolean) => {
      if (cancelled) return;
      if (!silent) setFleetBadgeLoading(true);
      try {
        const next = await fetchFleetActor(currentDrone.id);
        if (cancelled) return;
        setFleetBadgeData(next);
        setFleetBadgeError(null);
      } catch (error: any) {
        if (cancelled) return;
        const message = String(error?.message ?? error ?? '').trim();
        if (!silent || !fleetBadgeDataRef.current) {
          setFleetBadgeData(null);
          setFleetBadgeError(message || null);
        }
      } finally {
        if (!cancelled && !silent) setFleetBadgeLoading(false);
      }
    };

    void tick(false);
    const intervalId = window.setInterval(() => {
      void tick(true);
    }, 12_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentDrone.id]);

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
      void assignFleetTargetsToCurrentDrone(assignedDroneIdsFromData(activeData));
    },
  });

  const fleetChildrenCount = Math.max(0, Number(fleetBadgeData?.usage.childrenCount ?? 0) || 0);
  const fleetAssignedCount = Math.max(0, Number(fleetBadgeData?.usage.assignedCount ?? 0) || 0);
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
  const fleetBadgeTitle = fleetBadgeDropActive
    ? `Drop drones here to assign them to ${currentDroneLabel}.`
    : `Open Fleet tab for ${currentDroneLabel}. Drop drones here to assign them.`;
  const fleetBadgeSummaryText =
    fleetBadgeLoading && !fleetBadgeData
      ? 'Loading…'
      : fleetBadgeData
        ? `${fleetChildrenCount} child${fleetChildrenCount === 1 ? '' : 'ren'} · ${fleetAssignedCount} assigned`
        : 'Unavailable';
  const fleetDropHintText = fleetBadgeDropActive
    ? `Release to assign ${fleetDropHintCount} drone${fleetDropHintCount === 1 ? '' : 's'} to ${currentDroneLabel}.`
    : `Drop ${fleetDropHintCount} drone${fleetDropHintCount === 1 ? '' : 's'} anywhere in this chat to assign them to ${currentDroneLabel} for Fleet CLI access.`;

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
      void assignFleetTargetsToCurrentDrone(resolveAssignedDroneIdsFromTransfer(event.dataTransfer));
    },
    [assignFleetTargetsToCurrentDrone],
  );

  return {
    fleetBadgeAssigning,
    fleetBadgeDropActive,
    fleetBadgeError,
    fleetBadgeSummaryText,
    fleetBadgeTitle,
    fleetDropHintVisible,
    fleetDropHintText,
    onFleetDropDragLeave,
    onFleetDropDragOver,
    onFleetDropDrop,
    openFleetTab,
    setFleetDropNodeRef,
  };
}
