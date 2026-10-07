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
/** How much one wheel notch zooms, as a change of the zoom's logarithm. */
const ZOOM_PER_PX = 0.0015;

/**
 * Wheel and pinch zoom, gliding to each new target. Zooming in keeps the board point under the pointer where it is,
 * so pointing at a place and zooming lands exactly on it. Zooming out keeps the middle of the view where it is, so
 * the board opens up evenly around what is in view. Going from one place to another is then: zoom out anywhere,
 * point at where to go, zoom in. Native and not passive, so preventDefault keeps a pinch (Ctrl+wheel) from zooming
 * the whole window. Several wheel events in a frame add up to one target. `onZoom` runs for each wheel event.
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
    /** The glide in flight: the board point that stays put on screen, where it is, and the zoom it goes to. */
    let glide: { worldX: number; worldY: number; atX: number; atY: number; toScale: number } | null = null;
    let applied: number | null = null;
    let frame: number | null = null;
    let lastFrame = 0;

    /** Sets the zoom, keeping the glide's board point where it is on screen. */
    const zoomTo = (scale: number) => {
      if (!glide) return;
      setViewport(glide.atX - glide.worldX * scale, glide.atY - glide.worldY * scale, scale);
      applied = getView().scale;
    };

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      glide = null;
      applied = null;
    };

    const tick = (now: number) => {
      frame = null;
      if (!glide) return;
      const current = getView().scale;
      // Something else set the zoom meanwhile (Fit, Reset, another board): it wins.
      if (applied !== null && current !== applied) {
        stop();
        return;
      }
      const target = glide.toScale;
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
      const { panX, panY, scale } = getView();
      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const toScale = clampCanvasScale((glide?.toScale ?? scale) * Math.exp(-deltaPx * ZOOM_PER_PX));
      // In toward the pointer; out from the middle of the view.
      const zoomingIn = toScale >= scale;
      const atX = zoomingIn ? pointerX : rect.width / 2;
      const atY = zoomingIn ? pointerY : rect.height / 2;
      glide = { worldX: (atX - panX) / scale, worldY: (atY - panY) / scale, atX, atY, toScale };
      if (frame === null) {
        applied = scale;
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
