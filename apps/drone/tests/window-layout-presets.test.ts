import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WindowLayoutPresetStore } from '../src/hub/WindowLayoutPresetStore';

const layout = {
  grid: { width: 1200, height: 800, orientation: 'HORIZONTAL', root: { type: 'branch', size: 800, data: [
    { type: 'leaf', size: 1200, data: { id: 'main', views: ['agent-chat'], activeView: 'agent-chat' } },
  ] } },
  panels: { 'agent-chat': { id: 'agent-chat', contentComponent: 'chat' } },
};

test('ten slots survive reopening SQLite and overwriting a slot leaves other slots intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-presets-'));
  const file = path.join(dir, 'presets.sqlite');
  let store = new WindowLayoutPresetStore(file);
  try {
    for (let slot = 0; slot < 10; slot++) store.save(String(slot), layout);
    store.save('0', { ...layout, grid: { ...layout.grid, width: 1500 } });
    store.close();
    store = new WindowLayoutPresetStore(file);
    expect(Object.keys(store.list())).toHaveLength(10);
    expect(store.list()['1']).toEqual(layout);
    expect((store.list()['0'] as typeof layout).grid.width).toBe(1500);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('invalid slots, malformed trees and floating payloads cannot overwrite a saved preset', () => {
  const store = new WindowLayoutPresetStore(':memory:');
  try {
    store.save('1', layout);
    for (const slot of ['10', '-1', '01', 'x', '']) expect(() => store.save(slot, layout)).toThrow();
    for (const invalid of [null, {}, { ...layout, floatingGroups: [] }, { ...layout, panels: {} },
      { ...layout, grid: { ...layout.grid, root: { type: 'branch', data: [layout.grid.root, layout.grid.root] } } },
      { ...layout, grid: { ...layout.grid, width: Infinity } }]) {
      expect(() => store.save('1', invalid)).toThrow();
    }
    expect(store.list()).toEqual({ '1': layout });
  } finally { store.close(); }
});
