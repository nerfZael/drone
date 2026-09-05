import { describe, expect, test } from 'bun:test';
import {
  mobileExplorerExpandedHeight,
  mobileExplorerDragProgress,
  mobileExplorerDragOpens,
} from '../src/drones/mobile-explorer-drag';

describe('mobile explorer dragging', () => {
  test('retains the expanded size and fits short keyboard or landscape layouts', () => {
    expect(mobileExplorerExpandedHeight(800)).toBe(352);
    expect(mobileExplorerExpandedHeight(400)).toBe(220);
    expect(mobileExplorerExpandedHeight(180)).toBe(180);
    expect(mobileExplorerExpandedHeight(0)).toBe(48);
  });

  test('follows upward and downward drags and clamps both ends', () => {
    expect(mobileExplorerDragProgress(0, -100, 200)).toBe(0.5);
    expect(mobileExplorerDragProgress(1, 100, 200)).toBe(0.5);
    expect(mobileExplorerDragProgress(0, 100, 200)).toBe(0);
    expect(mobileExplorerDragProgress(1, -100, 200)).toBe(1);
    expect(mobileExplorerDragProgress(0.4, -20, 200)).toBe(0.5);
    expect(mobileExplorerDragProgress(0, 0, 0)).toBe(0);
  });

  test('settles slow releases at the nearest endpoint', () => {
    expect(mobileExplorerDragOpens(0.49, 0)).toBe(false);
    expect(mobileExplorerDragOpens(0.5, 0)).toBe(true);
    expect(mobileExplorerDragOpens(0.8, 100)).toBe(true);
  });

  test('honors upward and downward flings even before the midpoint', () => {
    expect(mobileExplorerDragOpens(0.1, -700)).toBe(true);
    expect(mobileExplorerDragOpens(0.9, 700)).toBe(false);
  });
});
