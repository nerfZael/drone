export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RectLike = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

function roundCanvasCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function measureRectInWorldSpace(
  rect: RectLike,
  worldRect: RectLike,
  scale: number,
): CanvasRect {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: roundCanvasCoord((rect.left - worldRect.left) / safeScale),
    y: roundCanvasCoord((rect.top - worldRect.top) / safeScale),
    width: roundCanvasCoord(rect.width / safeScale),
    height: roundCanvasCoord(rect.height / safeScale),
  };
}

export function resolveLineageEndpoint(
  source: CanvasRect,
  target: CanvasRect,
): { startX: number; startY: number; endX: number; endY: number } {
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? {
          startX: source.x + source.width,
          startY: sourceCenterY,
          endX: target.x,
          endY: targetCenterY,
        }
      : {
          startX: source.x,
          startY: sourceCenterY,
          endX: target.x + target.width,
          endY: targetCenterY,
        };
  }

  return dy >= 0
    ? {
        startX: sourceCenterX,
        startY: source.y + source.height,
        endX: targetCenterX,
        endY: target.y,
      }
    : {
        startX: sourceCenterX,
        startY: source.y,
        endX: targetCenterX,
        endY: target.y + target.height,
      };
}

export function buildLineagePath(startX: number, startY: number, endX: number, endY: number): string {
  const dx = endX - startX;
  const dy = endY - startY;
  const controlOffset = Math.max(28, Math.min(120, Math.abs(dx) * 0.35 + Math.abs(dy) * 0.14));
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    const direction = dx >= 0 ? 1 : -1;
    return `M ${startX} ${startY} C ${startX + controlOffset * direction} ${startY}, ${endX - controlOffset * direction} ${endY}, ${endX} ${endY}`;
  }
  const direction = dy >= 0 ? 1 : -1;
  return `M ${startX} ${startY} C ${startX} ${startY + controlOffset * direction}, ${endX} ${endY - controlOffset * direction}, ${endX} ${endY}`;
}
