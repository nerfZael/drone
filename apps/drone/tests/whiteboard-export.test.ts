import { describe, expect, test } from 'bun:test';

import { renderWhiteboardPng } from '../src/hub/whiteboard-export';
import type { WhiteboardDocument } from '../src/hub/whiteboard-store';

function whiteboard(elements: any[]): WhiteboardDocument {
  return {
    id: 'main',
    title: 'Main whiteboard',
    scopeType: 'global',
    scopeValue: '',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
    version: 2,
    scene: { elements, appState: null, files: {} },
  };
}

describe('whiteboard PNG export', () => {
  test('renders visible shapes into a PNG image', () => {
    const result = renderWhiteboardPng(
      whiteboard([
        { id: 'rect1', type: 'rectangle', x: 10, y: 20, width: 220, height: 90, strokeColor: '#1e293b', backgroundColor: '#e0f2fe' },
        { id: 'text1', type: 'text', x: 28, y: 44, width: 180, height: 38, strokeColor: '#0f172a', text: 'Hello board' },
        { id: 'arrow1', type: 'arrow', x: 230, y: 65, width: 170, height: 40, strokeColor: '#dc2626', points: [[0, 0], [170, 40]] },
        { id: 'deleted1', type: 'rectangle', x: -1000, y: -1000, width: 20, height: 20, isDeleted: true },
      ]),
      { maxWidth: 800, maxHeight: 600 },
    );
    const png = Buffer.from(result.data, 'base64');

    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(result.mimeType).toBe('image/png');
    expect(result.visibleElementCount).toBe(3);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.bounds.minX).toBe(10);
    expect(result.bounds.maxX).toBe(400);
  });

  test('renders empty boards without failing', () => {
    const result = renderWhiteboardPng(whiteboard([]), { maxWidth: 320, maxHeight: 240 });
    const png = Buffer.from(result.data, 'base64');

    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(result.visibleElementCount).toBe(0);
    expect(result.width).toBeGreaterThanOrEqual(160);
    expect(result.height).toBeGreaterThanOrEqual(160);
  });
});
