import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DroneSummary } from '../types';
import { DRONE_DND_MIME } from '../app/app-config';
import { TypingDots } from '../overview/icons';
import {
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  clampCanvasScale,
  useDroneCanvasStore,
} from './use-drone-canvas-store';

const NODE_WIDTH_PX = 220;
const NODE_HEIGHT_PX = 72;
const DROP_SPACING_X_PX = 236;
const DROP_SPACING_Y_PX = 82;
const DRAG_MOVE_THRESHOLD_PX = 3;
const DOT_GRID_BASE_SPACING_PX = 32;
const DOT_GRID_RADIUS_PX = 1.05;
const DOT_GRID_MAX_OPACITY = 0.34;
const DOT_GRID_MIN_OPACITY = 0.08;

type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type NodeDragState = {
  droneIds: string[];
  startClientX: number;
  startClientY: number;
  startPositionsById: Record<string, { x: number; y: number }>;
  scale: number;
  moved: boolean;
};

type PanDragState = {
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

type MarqueeDragState = {
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  additive: boolean;
  baseSelectedIds: string[];
  panX: number;
  panY: number;
  scale: number;
  moved: boolean;
};

type DroneCanvasIndicatorState = {
  statusOk: boolean;
  statusError: string | null;
  hubPhase?: DroneSummary['hubPhase'];
  hubMessage?: DroneSummary['hubMessage'];
  busy: boolean;
};

function parseDraggedDroneIds(event: React.DragEvent<HTMLElement>): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    const id = String(raw ?? '').trim();
    if (!id || out.includes(id)) return;
    out.push(id);
  };

  try {
    const jsonRaw = event.dataTransfer.getData(DRONE_DND_MIME);
    if (jsonRaw) {
      const parsed = JSON.parse(jsonRaw);
      if (Array.isArray(parsed)) {
        for (const value of parsed) add(value);
      }
    }
  } catch {
    // Ignore malformed drag payload.
  }

  if (out.length === 0) {
    const plain = String(event.dataTransfer.getData('text/plain') ?? '').trim();
    if (plain) {
      for (const line of plain.split('\n')) add(line);
    }
  }

  return out;
}

function hasDroneDragPayload(event: React.DragEvent<HTMLElement>): boolean {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  const types = Array.from(transfer.types ?? []);
  if (types.includes(DRONE_DND_MIME)) return true;
  if (types.includes('text/plain')) return true;
  return parseDraggedDroneIds(event).length > 0;
}

function screenToWorldPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  panX: number,
  panY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - panX) / scale,
    y: (clientY - rect.top - panY) / scale,
  };
}

function buildSelectionBox(
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number,
  rect: DOMRect,
): SelectionBox {
  const left = Math.min(startClientX, endClientX) - rect.left;
  const top = Math.min(startClientY, endClientY) - rect.top;
  const width = Math.abs(endClientX - startClientX);
  const height = Math.abs(endClientY - startClientY);
  return { left, top, width, height };
}

function rectIntersects(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function renderNodeIndicator(state: DroneCanvasIndicatorState | null): React.ReactNode {
  if (!state) return null;

  const isStarting = state.hubPhase === 'creating' || state.hubPhase === 'starting' || state.hubPhase === 'seeding';
  if (isStarting) {
    const label = state.hubPhase === 'seeding' ? 'Seeding' : 'Starting';
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-[rgba(255,178,36,.3)] bg-[var(--yellow-subtle)] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-[var(--yellow)]"
        style={{ fontFamily: 'var(--display)' }}
        title={String(state.hubMessage ?? label)}
      >
        {label}
      </span>
    );
  }

  if (state.busy && state.statusOk && state.hubPhase !== 'error') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-[rgba(255,178,36,.3)] bg-[var(--yellow-subtle)] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-[var(--yellow)]"
        style={{ fontFamily: 'var(--display)' }}
        title="Busy"
      >
        <TypingDots color="var(--yellow)" />
        Busy
      </span>
    );
  }

  if (state.hubPhase === 'error' || !state.statusOk) {
    const label = state.hubPhase === 'error' ? 'Error' : 'Offline';
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-[var(--red)]"
        style={{ fontFamily: 'var(--display)' }}
        title={String(state.hubMessage ?? state.statusError ?? label)}
      >
        {label}
      </span>
    );
  }

  return null;
}

export function DroneCanvasDock({
  droneNameById,
  droneStateById,
  onActivateDrone,
}: {
  droneNameById: Record<string, string>;
  droneStateById: Record<string, DroneCanvasIndicatorState>;
  onActivateDrone?: (droneId: string) => void;
}) {
  const {
    nodesByDroneId,
    nodeOrder,
    selectedDroneIds,
    panX,
    panY,
    scale,
    upsertNodes,
    moveNodes,
    removeNodes,
    syncNodeLabels,
    setSelectedDroneIds,
    toggleSelectedDroneId,
    clearSelection,
    setPan,
    setViewport,
    resetViewport,
  } = useDroneCanvasStore(
    useShallow((s) => ({
      nodesByDroneId: s.nodesByDroneId,
      nodeOrder: s.nodeOrder,
      selectedDroneIds: s.selectedDroneIds,
      panX: s.panX,
      panY: s.panY,
      scale: s.scale,
      upsertNodes: s.upsertNodes,
      moveNodes: s.moveNodes,
      removeNodes: s.removeNodes,
      syncNodeLabels: s.syncNodeLabels,
      setSelectedDroneIds: s.setSelectedDroneIds,
      toggleSelectedDroneId: s.toggleSelectedDroneId,
      clearSelection: s.clearSelection,
      setPan: s.setPan,
      setViewport: s.setViewport,
      resetViewport: s.resetViewport,
    })),
  );
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const nodeDragRef = React.useRef<NodeDragState | null>(null);
  const panDragRef = React.useRef<PanDragState | null>(null);
  const marqueeDragRef = React.useRef<MarqueeDragState | null>(null);
  const suppressNodeClickRef = React.useRef(false);
  const [dragOverCanvas, setDragOverCanvas] = React.useState(false);
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
  const [panning, setPanning] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<SelectionBox | null>(null);

  const nodes = React.useMemo(
    () => nodeOrder.map((droneId) => nodesByDroneId[droneId]).filter(Boolean),
    [nodeOrder, nodesByDroneId],
  );
  const nodesRef = React.useRef(nodes);

  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  React.useEffect(() => {
    syncNodeLabels(droneNameById);
  }, [droneNameById, syncNodeLabels]);

  React.useEffect(() => {
    const onWindowMouseMove = (event: MouseEvent) => {
      const nodeDrag = nodeDragRef.current;
      if (nodeDrag) {
        const dx = (event.clientX - nodeDrag.startClientX) / nodeDrag.scale;
        const dy = (event.clientY - nodeDrag.startClientY) / nodeDrag.scale;
        if (!nodeDrag.moved) {
          const movedDistance = Math.hypot(
            event.clientX - nodeDrag.startClientX,
            event.clientY - nodeDrag.startClientY,
          );
          if (movedDistance >= DRAG_MOVE_THRESHOLD_PX) nodeDrag.moved = true;
        }
        moveNodes(
          nodeDrag.droneIds.map((droneId) => {
            const start = nodeDrag.startPositionsById[droneId];
            return { droneId, x: start.x + dx, y: start.y + dy };
          }),
        );
        return;
      }

      const panDrag = panDragRef.current;
      if (panDrag) {
        const dx = event.clientX - panDrag.startClientX;
        const dy = event.clientY - panDrag.startClientY;
        setPan(panDrag.startPanX + dx, panDrag.startPanY + dy);
        return;
      }

      const marqueeDrag = marqueeDragRef.current;
      if (!marqueeDrag) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const box = buildSelectionBox(
        marqueeDrag.startClientX,
        marqueeDrag.startClientY,
        event.clientX,
        event.clientY,
        rect,
      );
      setSelectionBox(box);

      if (!marqueeDrag.moved) {
        const movedDistance = Math.hypot(
          event.clientX - marqueeDrag.startClientX,
          event.clientY - marqueeDrag.startClientY,
        );
        if (movedDistance >= DRAG_MOVE_THRESHOLD_PX) marqueeDrag.moved = true;
      }
      if (!marqueeDrag.moved) return;

      const world = screenToWorldPoint(
        event.clientX,
        event.clientY,
        rect,
        marqueeDrag.panX,
        marqueeDrag.panY,
        marqueeDrag.scale,
      );
      const minX = Math.min(marqueeDrag.startWorldX, world.x);
      const minY = Math.min(marqueeDrag.startWorldY, world.y);
      const width = Math.abs(world.x - marqueeDrag.startWorldX);
      const height = Math.abs(world.y - marqueeDrag.startWorldY);

      const hits: string[] = [];
      for (const node of nodesRef.current) {
        if (
          rectIntersects(
            minX,
            minY,
            width,
            height,
            node.x,
            node.y,
            NODE_WIDTH_PX,
            NODE_HEIGHT_PX,
          )
        ) {
          hits.push(node.droneId);
        }
      }

      if (marqueeDrag.additive) {
        const next = marqueeDrag.baseSelectedIds.slice();
        for (const id of hits) {
          if (!next.includes(id)) next.push(id);
        }
        setSelectedDroneIds(next);
      } else {
        setSelectedDroneIds(hits);
      }
    };

    const onWindowMouseUp = () => {
      const nodeDrag = nodeDragRef.current;
      if (nodeDrag?.moved) suppressNodeClickRef.current = true;
      nodeDragRef.current = null;
      setDraggingNodeId(null);

      panDragRef.current = null;
      setPanning(false);

      const marqueeDrag = marqueeDragRef.current;
      if (marqueeDrag && !marqueeDrag.moved && !marqueeDrag.additive) {
        clearSelection();
      }
      marqueeDragRef.current = null;
      setSelectionBox(null);
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [clearSelection, moveNodes, setPan, setSelectedDroneIds]);

  const applyZoomAt = React.useCallback(
    (nextScaleRaw: number, anchorClientX: number, anchorClientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const anchorX = anchorClientX - rect.left;
      const anchorY = anchorClientY - rect.top;
      const nextScale = clampCanvasScale(nextScaleRaw);
      const worldX = (anchorX - panX) / scale;
      const worldY = (anchorY - panY) / scale;
      const nextPanX = anchorX - worldX * nextScale;
      const nextPanY = anchorY - worldY * nextScale;
      setViewport(nextPanX, nextPanY, nextScale);
    },
    [panX, panY, scale, setViewport],
  );

  const zoomIn = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoomAt(scale * 1.14, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [applyZoomAt, scale]);

  const zoomOut = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoomAt(scale / 1.14, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [applyZoomAt, scale]);

  const onNodeMouseDown = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();

      const node = nodesByDroneId[droneId];
      if (!node) return;
      const selectedSet = new Set(selectedDroneIds);
      const dragIds =
        selectedSet.has(droneId) && selectedDroneIds.length > 1
          ? selectedDroneIds.filter((id) => Boolean(nodesByDroneId[id]))
          : [droneId];
      const startPositionsById: Record<string, { x: number; y: number }> = {};
      for (const id of dragIds) {
        const dragNode = nodesByDroneId[id];
        if (!dragNode) continue;
        startPositionsById[id] = { x: dragNode.x, y: dragNode.y };
      }

      if (!selectedSet.has(droneId) || selectedDroneIds.length === 0) {
        setSelectedDroneIds([droneId]);
      }

      nodeDragRef.current = {
        droneIds: dragIds,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPositionsById,
        scale,
        moved: false,
      };
      setDraggingNodeId(droneId);
      marqueeDragRef.current = null;
      setSelectionBox(null);
    },
    [nodesByDroneId, scale, selectedDroneIds, setSelectedDroneIds],
  );

  const onNodeClick = React.useCallback(
    (droneId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (suppressNodeClickRef.current) {
        suppressNodeClickRef.current = false;
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        toggleSelectedDroneId(droneId);
        return;
      }
      setSelectedDroneIds([droneId]);
      onActivateDrone?.(droneId);
    },
    [onActivateDrone, setSelectedDroneIds, toggleSelectedDroneId],
  );

  const onCanvasMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[data-canvas-node="1"]')) {
        return;
      }
      if (event.button === 2) {
        event.preventDefault();
        panDragRef.current = {
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPanX: panX,
          startPanY: panY,
        };
        setPanning(true);
        marqueeDragRef.current = null;
        setSelectionBox(null);
        return;
      }

      if (event.button !== 0) return;
      event.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const worldStart = screenToWorldPoint(event.clientX, event.clientY, rect, panX, panY, scale);
      const additive = event.ctrlKey || event.metaKey;
      if (!additive && selectedDroneIds.length > 0) {
        setSelectedDroneIds([]);
      }
      marqueeDragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: worldStart.x,
        startWorldY: worldStart.y,
        additive,
        baseSelectedIds: selectedDroneIds.slice(),
        panX,
        panY,
        scale,
        moved: false,
      };
      setSelectionBox(buildSelectionBox(event.clientX, event.clientY, event.clientX, event.clientY, rect));
    },
    [panX, panY, scale, selectedDroneIds, setSelectedDroneIds],
  );

  const onWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextScale = clampCanvasScale(scale * factor);
      applyZoomAt(nextScale, event.clientX, event.clientY);
    },
    [applyZoomAt, scale],
  );

  const onDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDroneDragPayload(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!dragOverCanvas) setDragOverCanvas(true);
    },
    [dragOverCanvas],
  );

  const onDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragOverCanvas(false);
  }, []);

  const onDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOverCanvas(false);
      const ids = parseDraggedDroneIds(event);
      if (ids.length === 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const origin = screenToWorldPoint(event.clientX, event.clientY, rect, panX, panY, scale);
      upsertNodes(
        ids.map((droneId, idx) => ({
          droneId,
          label: String(droneNameById[droneId] ?? '').trim() || droneId,
          x: origin.x + (idx % 3) * DROP_SPACING_X_PX,
          y: origin.y + Math.floor(idx / 3) * DROP_SPACING_Y_PX,
        })),
      );
      setSelectedDroneIds(ids);
    },
    [droneNameById, panX, panY, scale, setSelectedDroneIds, upsertNodes],
  );

  const onViewportKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const key = event.key.toLowerCase();
      const isPrimaryMod = event.ctrlKey || event.metaKey;

      if (isPrimaryMod && !event.altKey && !event.shiftKey && key === 'a') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedDroneIds(nodeOrder.slice());
        return;
      }

      if (key === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
        return;
      }

      if ((key === 'delete' || key === 'backspace') && selectedDroneIds.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        removeNodes(selectedDroneIds);
      }
    },
    [clearSelection, nodeOrder, removeNodes, selectedDroneIds, setSelectedDroneIds],
  );

  const cursorClassName = panning
    ? 'cursor-grabbing'
    : draggingNodeId
      ? 'cursor-grabbing'
      : selectionBox
        ? 'cursor-crosshair'
        : 'cursor-default';
  const dotOpacity = Math.max(
    DOT_GRID_MIN_OPACITY,
    Math.min(DOT_GRID_MAX_OPACITY, DOT_GRID_MAX_OPACITY * Math.pow(scale, 1.2)),
  );

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase" style={{ fontFamily: 'var(--display)' }}>
          Canvas
        </div>
        <div className="flex items-center gap-1">
          <span className="px-2 text-[10px] font-mono text-[var(--muted-dim)]" title="Selected drones">
            {selectedDroneIds.length} sel
          </span>
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= MIN_CANVAS_SCALE + 0.001}
            className={`h-7 px-2 rounded border text-[10px] font-semibold transition-colors ${
              scale <= MIN_CANVAS_SCALE + 0.001
                ? 'opacity-50 cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= MAX_CANVAS_SCALE - 0.001}
            className={`h-7 px-2 rounded border text-[10px] font-semibold transition-colors ${
              scale >= MAX_CANVAS_SCALE - 0.001
                ? 'opacity-50 cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={resetViewport}
            className="h-7 px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] transition-colors"
            title="Reset canvas view"
          >
            Reset view
          </button>
          <span className="w-[58px] text-right text-[10px] font-mono text-[var(--muted-dim)]" title="Current zoom">
            {Math.round(scale * 100)}%
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        tabIndex={0}
        data-shortcut-capture="true"
        className={`relative flex-1 min-h-0 overflow-hidden select-none outline-none ${cursorClassName} ${dragOverCanvas ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''}`}
        onKeyDown={onViewportKeyDown}
        onMouseDown={onCanvasMouseDown}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={onWheel}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(141, 161, 197, ${dotOpacity.toFixed(3)}) ${DOT_GRID_RADIUS_PX}px, transparent ${DOT_GRID_RADIUS_PX}px)`,
            backgroundSize: `${DOT_GRID_BASE_SPACING_PX * scale}px ${DOT_GRID_BASE_SPACING_PX * scale}px`,
            backgroundPosition: `${panX}px ${panY}px`,
          }}
        />

        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {nodes.map((node) => {
            const selected = selectedDroneIds.includes(node.droneId);
            const dragging = draggingNodeId === node.droneId;
            const indicatorState = droneStateById[node.droneId] ?? null;
            const indicator = renderNodeIndicator(indicatorState);
            return (
              <button
                key={node.droneId}
                type="button"
                data-canvas-node="1"
                onMouseDown={(event) => onNodeMouseDown(node.droneId, event)}
                onClick={(event) => onNodeClick(node.droneId, event)}
                aria-pressed={selected}
                className={`absolute rounded-md border text-left px-2.5 py-2 shadow-[0_10px_20px_rgba(0,0,0,.28)] transition-all ${
                  dragging
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                    : selected
                      ? 'border-[var(--accent-muted)] bg-[rgba(38,46,66,.95)]'
                      : 'border-[var(--border)] bg-[rgba(16,18,23,.92)] hover:border-[var(--accent-muted)]'
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_WIDTH_PX,
                  height: NODE_HEIGHT_PX,
                }}
              >
                <div className="text-[12.5px] leading-[1.2] font-semibold text-[var(--fg-secondary)] break-words">{node.label}</div>
                {indicator ? <div className="mt-1.5">{indicator}</div> : null}
              </button>
            );
          })}
        </div>

        {selectionBox ? (
          <div
            className="absolute pointer-events-none border border-dashed border-[var(--accent)] bg-[var(--accent-subtle)]"
            style={{
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        ) : null}

        {nodes.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center px-5 text-center pointer-events-none">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(11,13,18,.7)] px-4 py-3 max-w-[380px]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Drone Canvas
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                Drag one or more drones from the sidebar and drop them here.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Ctrl-click toggles selection. Left drag draws a selection box.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Esc clears selection. Delete removes selected nodes. Ctrl/Cmd+A selects all nodes.
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
                Right-click drag pans. Mouse wheel zooms.
              </div>
            </div>
          </div>
        ) : null}

        {dragOverCanvas ? (
          <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-[var(--accent-muted)] bg-[var(--accent-subtle)]" />
        ) : null}
      </div>
    </div>
  );
}
