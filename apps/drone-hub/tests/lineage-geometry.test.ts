import { describe, expect, test } from 'bun:test';
import {
  buildLineagePath,
  measureRectInWorldSpace,
  resolveLineageEndpoint,
  scaleCanvasRect,
} from '../src/droneHub/canvas/lineage-geometry';

describe('lineage geometry helpers', () => {
  test('projects rendered node bounds back into canvas world space', () => {
    expect(
      measureRectInWorldSpace(
        { left: 404, top: 306, width: 132, height: 54 },
        { left: 140, top: 90, width: 800, height: 600 },
        2,
      ),
    ).toEqual({
      x: 132,
      y: 108,
      width: 66,
      height: 27,
    });
  });

  test('anchors vertical connections on the bottom and top edges of the nodes', () => {
    expect(
      resolveLineageEndpoint(
        { x: 160, y: 120, width: 132, height: 54 },
        { x: 200, y: 280, width: 118, height: 54 },
      ),
    ).toEqual({
      startX: 226,
      startY: 174,
      endX: 259,
      endY: 280,
    });
  });

  test('builds a cubic path between the resolved endpoints', () => {
    expect(buildLineagePath(226, 174, 259, 280)).toBe(
      'M 226 174 C 226 202, 259 252, 259 280',
    );
  });
});


test('calculated bounds match a card scaled around its left edge and vertical center', () => {
  const rect = { x: 100, y: 200, width: 150, height: 40 };
  expect(scaleCanvasRect(rect, 1)).toEqual(rect);
  expect(scaleCanvasRect(rect, 1.4)).toEqual({ x: 100, y: 192, width: 210, height: 56 });
});
