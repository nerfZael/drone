import { clampCanvasScale } from './use-drone-canvas-store';
import type { CanvasRect } from './lineage-geometry';

const FIT_VIEWPORT_PADDING_PX = 48;

export type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function screenToWorldPoint(
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

export function buildSelectionBox(
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

export function rectIntersects(
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

/** Pans and zooms so every rect is inside the viewport, never zooming in past 1:1. */
export function fitViewportToBounds(
  bounds: ReadonlyArray<CanvasRect>,
  viewportWidth: number,
  viewportHeight: number,
): { panX: number; panY: number; scale: number } | null {
  if (bounds.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const rect of bounds) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const innerWidth = Math.max(1, viewportWidth - FIT_VIEWPORT_PADDING_PX * 2);
  const innerHeight = Math.max(1, viewportHeight - FIT_VIEWPORT_PADDING_PX * 2);
  const scale = clampCanvasScale(Math.min(1, innerWidth / width, innerHeight / height));
  return {
    panX: Math.round((viewportWidth - width * scale) / 2 - minX * scale),
    panY: Math.round((viewportHeight - height * scale) / 2 - minY * scale),
    scale,
  };
}
