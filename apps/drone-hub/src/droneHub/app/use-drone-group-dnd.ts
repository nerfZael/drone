import React from 'react';
import { DRONE_DND_MIME } from './app-config';
import type { MoveDronesToGroupResult } from './use-group-management';

type UseDroneGroupDndArgs = {
  movingDroneGroups: boolean;
  hasUngroupedGroup: boolean;
  selectedDroneIds: string[];
  selectedDroneSet: Set<string>;
  selectionAnchorRef: React.MutableRefObject<string | null>;
  setSelectedDrone: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDroneIds: React.Dispatch<React.SetStateAction<string[]>>;
  onPrepareDragStart: () => void;
  onClearGroupMoveError: () => void;
  moveDronesToGroup: (targetGroupLabel: string, rawDroneNames: string[]) => Promise<MoveDronesToGroupResult>;
};

export function useDroneGroupDnd({
  movingDroneGroups,
  hasUngroupedGroup,
  selectedDroneIds,
  selectedDroneSet,
  selectionAnchorRef,
  setSelectedDrone,
  setSelectedDroneIds,
  onPrepareDragStart,
  onClearGroupMoveError,
  moveDronesToGroup,
}: UseDroneGroupDndArgs) {
  const [draggingDroneNames, setDraggingDroneNames] = React.useState<string[] | null>(null);
  const [dragOverGroup, setDragOverGroup] = React.useState<string | null>(null);
  const [dragOverUngrouped, setDragOverUngrouped] = React.useState(false);

  const resetGroupDndState = React.useCallback(() => {
    setDraggingDroneNames(null);
    setDragOverGroup(null);
    setDragOverUngrouped(false);
  }, []);

  const parseDroneNamesFromDrag = React.useCallback(
    (event: React.DragEvent<HTMLElement>): string[] => {
      const out: string[] = [];
      const add = (raw: any) => {
        const name = String(raw ?? '').trim();
        if (!name || out.includes(name)) return;
        out.push(name);
      };

      try {
        const jsonRaw = event.dataTransfer.getData(DRONE_DND_MIME);
        if (jsonRaw) {
          const parsed = JSON.parse(jsonRaw);
          if (Array.isArray(parsed)) {
            for (const n of parsed) add(n);
          }
        }
      } catch {
        // ignore malformed drag payload
      }

      if (out.length === 0) {
        const plain = String(event.dataTransfer.getData('text/plain') ?? '');
        if (plain) {
          for (const line of plain.split('\n')) add(line);
        }
      }

      if (out.length === 0 && Array.isArray(draggingDroneNames)) {
        for (const n of draggingDroneNames) add(n);
      }
      return out;
    },
    [draggingDroneNames],
  );

  const onDroneDragStart = React.useCallback(
    (droneName: string, event: React.DragEvent<HTMLDivElement>) => {
      if (movingDroneGroups) {
        event.preventDefault();
        return;
      }
      const name = String(droneName ?? '').trim();
      if (!name) return;
      const names =
        selectedDroneSet.has(name) && selectedDroneIds.length > 0
          ? selectedDroneIds.slice()
          : [name];
      onPrepareDragStart();
      setSelectedDrone(name);
      if (!selectedDroneSet.has(name)) setSelectedDroneIds([name]);
      selectionAnchorRef.current = name;
      setDraggingDroneNames(names);
      setDragOverGroup(null);
      setDragOverUngrouped(false);
      onClearGroupMoveError();
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData(DRONE_DND_MIME, JSON.stringify(names));
      } catch {
        // ignore
      }
      try {
        event.dataTransfer.setData('text/plain', names.join('\n'));
      } catch {
        // ignore
      }
    },
    [
      movingDroneGroups,
      onClearGroupMoveError,
      onPrepareDragStart,
      selectedDroneIds,
      selectedDroneSet,
      selectionAnchorRef,
      setSelectedDrone,
      setSelectedDroneIds,
    ],
  );

  const onDroneDragEnd = React.useCallback(() => {
    resetGroupDndState();
  }, [resetGroupDndState]);

  const onGroupDragOver = React.useCallback(
    (group: string, event: React.DragEvent<HTMLDivElement>) => {
      const names = draggingDroneNames && draggingDroneNames.length > 0
        ? draggingDroneNames
        : parseDroneNamesFromDrag(event);
      if (names.length === 0) return;
      event.stopPropagation();
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOverUngrouped(false);
      if (dragOverGroup !== group) setDragOverGroup(group);
    },
    [dragOverGroup, draggingDroneNames, parseDroneNamesFromDrag],
  );

  const onGroupDragLeave = React.useCallback((group: string, event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragOverGroup((prev) => (prev === group ? null : prev));
  }, []);

  const onGroupDrop = React.useCallback(
    (group: string, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOverGroup(null);
      setDragOverUngrouped(false);
      const names = parseDroneNamesFromDrag(event);
      setDraggingDroneNames(null);
      if (names.length === 0) return;
      void moveDronesToGroup(group, names);
    },
    [moveDronesToGroup, parseDroneNamesFromDrag],
  );

  const onUngroupedDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (hasUngroupedGroup) return;
      const names = draggingDroneNames && draggingDroneNames.length > 0
        ? draggingDroneNames
        : parseDroneNamesFromDrag(event);
      if (names.length === 0) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dragOverGroup !== null) setDragOverGroup(null);
      if (!dragOverUngrouped) setDragOverUngrouped(true);
    },
    [dragOverGroup, dragOverUngrouped, draggingDroneNames, hasUngroupedGroup, parseDroneNamesFromDrag],
  );

  const onUngroupedDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragOverUngrouped(false);
  }, []);

  const onUngroupedDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (hasUngroupedGroup) return;
      event.preventDefault();
      setDragOverGroup(null);
      setDragOverUngrouped(false);
      const names = parseDroneNamesFromDrag(event);
      setDraggingDroneNames(null);
      if (names.length === 0) return;
      void moveDronesToGroup('Ungrouped', names);
    },
    [hasUngroupedGroup, moveDronesToGroup, parseDroneNamesFromDrag],
  );

  return {
    draggingDroneNames,
    dragOverGroup,
    dragOverUngrouped,
    onDroneDragStart,
    onDroneDragEnd,
    onGroupDragOver,
    onGroupDragLeave,
    onGroupDrop,
    onUngroupedDragOver,
    onUngroupedDragLeave,
    onUngroupedDrop,
    resetGroupDndState,
  };
}
