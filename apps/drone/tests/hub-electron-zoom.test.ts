import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  readZoomFactor,
  stepZoomFactor,
  writeZoomFactor,
  zoomActionForInput,
  zoomPreferencesPath,
}: {
  readZoomFactor(preferencesPath: string): number;
  stepZoomFactor(current: number, direction: 'in' | 'out'): number;
  writeZoomFactor(preferencesPath: string, zoomFactor: number): void;
  zoomActionForInput(input: Record<string, unknown>, platform?: string): 'in' | 'out' | 'reset' | null;
  zoomPreferencesPath(userDataPath: string): string;
} = require('../desktop/hub-electron-zoom.cjs');

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Drone Hub Electron zoom', () => {
  test('recognizes platform zoom shortcuts without capturing ordinary keys', () => {
    expect(zoomActionForInput({ type: 'keyDown', control: true, key: '=' }, 'linux')).toBe('in');
    expect(zoomActionForInput({ type: 'keyDown', control: true, key: '-' }, 'win32')).toBe('out');
    expect(zoomActionForInput({ type: 'keyDown', meta: true, key: '0' }, 'darwin')).toBe('reset');
    expect(zoomActionForInput({ type: 'keyDown', control: true, key: '=' }, 'darwin')).toBeNull();
    expect(zoomActionForInput({ type: 'keyDown', key: '=' }, 'linux')).toBeNull();
  });

  test('steps through and clamps the supported zoom factors', () => {
    expect(stepZoomFactor(1, 'in')).toBe(1.1);
    expect(stepZoomFactor(1, 'out')).toBe(0.9);
    expect(stepZoomFactor(1.5, 'in')).toBe(1.5);
    expect(stepZoomFactor(0.75, 'out')).toBe(0.75);
  });

  test('persists the selected zoom and safely defaults invalid preferences', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-zoom-'));
    temporaryDirectories.push(directory);
    const preferencesPath = zoomPreferencesPath(directory);

    expect(readZoomFactor(preferencesPath)).toBe(1);
    writeZoomFactor(preferencesPath, 1.25);
    expect(readZoomFactor(preferencesPath)).toBe(1.25);

    fs.writeFileSync(preferencesPath, JSON.stringify({ zoomFactor: 9 }), 'utf8');
    expect(readZoomFactor(preferencesPath)).toBe(1);
  });
});
