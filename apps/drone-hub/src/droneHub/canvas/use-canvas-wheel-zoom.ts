import React from 'react';
import { canvasPerf } from './canvas-perf';
import { clampCanvasScale, type DroneCanvasBoard } from './use-drone-canvas-store';

/**
 * How quickly a zoom glides to where the wheel sent it: it closes about two thirds of the remaining way every this
 * many milliseconds. A mouse wheel moves in notches; gliding turns each notch into a smooth zoom instead of a jump,
 * and a trackpad's stream of small steps barely lags.
 */
const ZOOM_GLIDE_MS = 70;
/** Close enough to the target to stop: a hundredth of a percent of the zoom. */
const ZOOM_SETTLE_RATIO = 0.0001;

/**
 * Wheel and pinch zoom, anchored under the pointer, gliding to each new target. Native and not passive, so
 * preventDefault keeps a pinch (Ctrl+wheel) from zooming the whole window. Several wheel events in a frame add up
 * to one target. `onZoom` runs for each wheel event.
 */
export function useCanvasWheelZoom(
  viewportRef: React.RefObject<HTMLElement | null>,
  getView: () => DroneCanvasBoard,
  setViewport: (panX: number, panY: number, scale: number) => void,
  onZoom: () => void = () => {},
) {
  const onZoomRef = React.useRef(onZoom);
  onZoomRef.current = onZoom;

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let target: number | null = null;
    let anchor = { x: 0, y: 0 };
    let applied: number | null = null;
    let frame: number | null = null;
    let lastFrame = 0;

    /** Sets the zoom, keeping the board point under the anchor where it is. */
    const zoomTo = (scale: number) => {
      const { panX, panY, scale: current } = getView();
      const rect = viewport.getBoundingClientRect();
      const anchorX = anchor.x - rect.left;
      const anchorY = anchor.y - rect.top;
      const worldX = (anchorX - panX) / current;
      const worldY = (anchorY - panY) / current;
      setViewport(anchorX - worldX * scale, anchorY - worldY * scale, scale);
      applied = getView().scale;
    };

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      target = null;
      applied = null;
    };

    const tick = (now: number) => {
      frame = null;
      if (target === null) return;
      const current = getView().scale;
      // Something else set the zoom meanwhile (Fit, Reset, another board): it wins.
      if (applied !== null && current !== applied) {
        stop();
        return;
      }
      const elapsed = lastFrame ? Math.min(50, now - lastFrame) : 16;
      lastFrame = now;
      const next = target + (current - target) * Math.exp(-elapsed / ZOOM_GLIDE_MS);
      if (Math.abs(next - target) <= target * ZOOM_SETTLE_RATIO) {
        zoomTo(target);
        stop();
        return;
      }
      zoomTo(next);
      frame = requestAnimationFrame(tick);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      canvasPerf.wheel();
      onZoomRef.current();
      const deltaPx = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * viewport.clientHeight : event.deltaY;
      const from = target ?? getView().scale;
      target = clampCanvasScale(from * Math.exp(-deltaPx * 0.0015));
      anchor = { x: event.clientX, y: event.clientY };
      if (frame === null) {
        applied = getView().scale;
        lastFrame = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      stop();
    };
  }, [getView, setViewport, viewportRef]);
}
