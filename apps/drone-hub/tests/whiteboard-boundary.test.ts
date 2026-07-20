import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWhiteboardScene, whiteboardSceneSignature } from '../src/droneHub/whiteboard/use-whiteboard-state';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, '../src/droneHub/whiteboard', relativePath), 'utf8');
}

describe('whiteboard boundaries', () => {
  test('mounts the whiteboard canvas without a whiteboard-specific lazy boundary', () => {
    const dock = readSource('WhiteboardDock.tsx');
    expect(dock).not.toContain("@excalidraw/excalidraw'");
    expect(dock).not.toContain('@excalidraw/excalidraw/types');
    expect(dock).toContain("import { WhiteboardCanvas } from './WhiteboardCanvas'");
    expect(dock).not.toContain('React.lazy');
    expect(dock).not.toContain('Loading drawing surface');

    const canvas = readSource('WhiteboardCanvas.tsx');
    expect(canvas).toContain("@excalidraw/excalidraw'");
    expect(canvas).not.toContain('@excalidraw/excalidraw/index.css');
    expect(canvas).toContain('className="dh-whiteboard-theme h-full w-full"');
    expect(canvas).toContain('theme="dark"');
  });

  test('keeps whiteboard API state out of the render shell', () => {
    const dock = readSource('WhiteboardDock.tsx');
    expect(dock).not.toContain('whiteboard-api');
    expect(dock).not.toContain('listWhiteboards');
    expect(dock).not.toContain('readWhiteboard');
    expect(dock).toContain('useWhiteboardState');

    const hook = readSource('use-whiteboard-state.ts');
    expect(hook).toContain('readWhiteboard');
    expect(hook).toContain('refreshListInBackground');
  });

  test('normalizes malformed scene data without rejecting the document', () => {
    expect(normalizeWhiteboardScene({ elements: 'bad', appState: [], files: null })).toEqual({
      elements: [],
      appState: null,
      files: {},
    });
  });

  test('scene signatures are stable across object key order', () => {
    const left = whiteboardSceneSignature({
      elements: [{ id: 'a', type: 'rectangle', x: 1, y: 2 }],
      appState: { theme: 'dark', viewBackgroundColor: '#fff' },
      files: { b: { mimeType: 'image/png', id: 'b' } },
    });
    const right = whiteboardSceneSignature({
      files: { b: { id: 'b', mimeType: 'image/png' } },
      appState: { viewBackgroundColor: '#fff', theme: 'dark' },
      elements: [{ y: 2, x: 1, type: 'rectangle', id: 'a' }],
    });
    expect(left).toBe(right);
  });
});
