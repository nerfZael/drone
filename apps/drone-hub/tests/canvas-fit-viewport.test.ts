import { expect, test } from 'bun:test';
import { fitViewportToBounds } from '../src/droneHub/canvas/DroneCanvasDock';
import { MIN_CANVAS_SCALE, clampCanvasScale } from '../src/droneHub/canvas/use-drone-canvas-store';

test('fit centres a small board at 1:1 instead of zooming in', () => {
  const fit = fitViewportToBounds([{ x: 100, y: 100, width: 200, height: 40 }], 1000, 600)!;
  expect(fit.scale).toBe(1);
  // (1000 - 200) / 2 - 100 = 300; (600 - 40) / 2 - 100 = 180
  expect(fit).toEqual({ panX: 300, panY: 180, scale: 1 });
});

test('fit zooms out just enough for a wide board, with padding on both sides', () => {
  const fit = fitViewportToBounds(
    [{ x: 0, y: 0, width: 100, height: 40 }, { x: 1700, y: 300, width: 100, height: 40 }],
    1000, 600,
  )!;
  // Content is 1800 wide; the viewport offers 1000 - 96 of it.
  expect(fit.scale).toBeCloseTo(904 / 1800, 5);
  expect(fit.panX).toBe(48);
  expect(fit.scale).toBeGreaterThanOrEqual(MIN_CANVAS_SCALE);
});

test('fit never goes below the zoom floor and ignores an empty board', () => {
  const fit = fitViewportToBounds([{ x: 0, y: 0, width: 50_000, height: 40 }], 1000, 600)!;
  expect(fit.scale).toBe(MIN_CANVAS_SCALE);
  expect(fitViewportToBounds([], 1000, 600)).toBeNull();
  expect(clampCanvasScale(0.1)).toBe(MIN_CANVAS_SCALE);
});
