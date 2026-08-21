import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const {
  zoomActionForInput,
}: {
  zoomActionForInput(input: Record<string, unknown>, platform?: string): 'in' | 'out' | 'reset' | null;
} = require('../desktop/hub-electron-zoom.cjs');

describe('Drone Hub Electron zoom', () => {
  test('recognizes platform zoom shortcuts without capturing ordinary keys', () => {
    expect(zoomActionForInput({ type: 'keyDown', control: true, key: '=' }, 'linux')).toBe('in');
    expect(zoomActionForInput({ type: 'keyDown', control: true, key: '-' }, 'win32')).toBe('out');
    expect(zoomActionForInput({ type: 'keyDown', meta: true, key: '0' }, 'darwin')).toBe('reset');
    expect(zoomActionForInput({ type: 'keyDown', control: true, key: '=' }, 'darwin')).toBeNull();
    expect(zoomActionForInput({ type: 'keyDown', key: '=' }, 'linux')).toBeNull();
  });

  test('routes zoom shortcuts to navigation sizing and keeps the renderer at 100%', () => {
    const mainSource = readFileSync(
      new URL('../desktop/hub-electron-main.cjs', import.meta.url),
      'utf8',
    );

    expect(mainSource).toContain("mainWindow.webContents.send(NAVIGATION_ZOOM_CHANNEL, { action })");
    expect(mainSource).toContain('mainWindow.webContents.setZoomFactor(1)');
    expect(mainSource).not.toContain('stepZoomFactor');
    expect(mainSource).not.toContain('currentZoomFactor');
  });
});
