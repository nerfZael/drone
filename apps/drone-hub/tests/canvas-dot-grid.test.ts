import { expect, test } from 'bun:test';
import { dotGridAt } from '../src/droneHub/canvas/CanvasLayers';

// A dot where the two grids meet, drawn by both.
const sharedDot = (grid: ReturnType<typeof dotGridAt>) => 1 - (1 - grid.fineOpacity) * (1 - grid.coarseOpacity);

test('the dot grid keeps its spacing and brightness on screen at every zoom', () => {
  for (const scale of [0.05, 0.2, 0.5, 0.75, 1, 1.25]) {
    const grid = dotGridAt(scale);
    expect(grid.fineSpacing).toBeGreaterThanOrEqual(24);
    expect(grid.fineSpacing).toBeLessThan(48);
    expect(sharedDot(grid)).toBeCloseTo(0.2, 6);
  }
});

test('crossing to the next spacing, the grid draws the same dots', () => {
  const before = dotGridAt(0.75 - 1e-9);
  const after = dotGridAt(0.75);
  // Fine dots 48px apart, fully shown, become the coarse grid's, with the new fine ones not yet shown.
  expect(before.fineSpacing).toBeCloseTo(48, 5);
  expect(before.coarseSpacing).toBeCloseTo(96, 5);
  expect(before.fineOpacity).toBeCloseTo(0.2, 5);
  expect(after.coarseSpacing).toBeCloseTo(48, 5);
  expect(after.fineSpacing).toBeCloseTo(24, 5);
  expect(after.coarseOpacity).toBeCloseTo(0.2, 5);
  expect(after.fineOpacity).toBeCloseTo(0, 5);
});

test('zoomed in, the grid is no finer than the board spacing and spreads with the cards', () => {
  for (const scale of [1.5, 2, 2.6]) {
    const grid = dotGridAt(scale);
    expect(grid.fineSpacing).toBeCloseTo(32 * scale, 6);
    expect(grid.fineOpacity).toBeCloseTo(0.2, 6);
  }
});
