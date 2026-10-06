import React from 'react';
import { canvasPerf } from './canvas-perf';
import { clampCanvasScale, type DroneCanvasBoard } from './use-drone-canvas-store';
import type { ZoomGesture } from './zoom-gesture';

/**
 * Wheel and pinch zoom, anchored under the pointer. Native and not passive, so preventDefault keeps a pinch
 * (Ctrl+wheel) from zooming the whole window. Wheel and trackpad events can arrive several times a frame:
 * they compound into one zoom per frame.
 */
export function useCanvasWheelZoom(
  viewportRef: React.RefObject<HTMLElement | null>,
  getView: () => DroneCanvasBoard,
  setViewport: (panX: number, panY: number, scale: number) => void,
  zoomGesture: ZoomGesture,
) {
  const applyZoomAt = React.useCallback(
    (nextScaleRaw: number, anchorClientX: number, anchorClientY: number) => {
      const { panX, panY, scale } = getView();
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
    [getView, setViewport],
  );

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let factor = 1;
    let anchor = { x: 0, y: 0 };
    let frame: number | null = null;
    const apply = () => {
      frame = null;
      const pending = factor;
      factor = 1;
      applyZoomAt(getView().scale * pending, anchor.x, anchor.y);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      canvasPerf.wheel();
      zoomGesture.touch(getView().scale);
      const deltaPx = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * viewport.clientHeight : event.deltaY;
      factor *= Math.exp(-deltaPx * 0.0015);
      anchor = { x: event.clientX, y: event.clientY };
      // No shield while zooming: a click right after the wheel stops must reach the card under it.
      if (frame === null) frame = requestAnimationFrame(apply);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
      zoomGesture.end();
    };
  }, [applyZoomAt, getView, zoomGesture]);
}
