import { afterEach, expect, test } from 'bun:test';
import type { SerializedDockview } from 'dockview';
import { executeWorkspacePreset } from '../src/droneHub/app/executeWorkspacePreset';
import { registerWorkspacePresetTarget } from '../src/droneHub/app/workspace-preset-target';

const originalFetch = globalThis.fetch;
const cleanups: (() => void)[] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanups.splice(0).forEach(cleanup => cleanup());
});

function target(identity = {}) {
  const restored: SerializedDockview[] = [];
  const target = { identity, capture: () => ({}) as SerializedDockview, closeDockedWindows() {}, restore: (layout: SerializedDockview) => { restored.push(layout); } };
  cleanups.push(registerWorkspacePresetTarget('drone', target));
  return { target, restored };
}

function pendingRequest() {
  let respond!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(resolve => { respond = resolve; })) as typeof fetch;
  return () => respond(Response.json({ presets: { '1': { panels: {} } } }));
}

test('loading an empty slot leaves the workspace intact', async () => {
  const { restored } = target();
  globalThis.fetch = (async () => Response.json({ presets: {} })) as typeof fetch;
  await expect(executeWorkspacePreset('loadLayout0', 'drone')).rejects.toThrow('Slot 0 is empty');
  expect(restored).toEqual([]);
});

test('switching drones during a pending load does not restore into the old workspace', async () => {
  const { restored } = target();
  const respond = pendingRequest();
  let current = true;
  const request = executeWorkspacePreset('loadLayout1', 'drone', () => current);
  current = false;
  respond();
  await expect(request).rejects.toThrow('workspace changed');
  expect(restored).toEqual([]);
});

test('replacing the workspace rejects a pending load', async () => {
  const original = target();
  const respond = pendingRequest();
  const request = executeWorkspacePreset('loadLayout1', 'drone');
  const replacement = target();
  respond();
  await expect(request).rejects.toThrow('workspace changed');
  expect(original.restored).toEqual([]);
  expect(replacement.restored).toEqual([]);
});

test('a re-render of the same workspace uses its latest restore callback', async () => {
  const identity = {};
  const original = target(identity);
  const respond = pendingRequest();
  const request = executeWorkspacePreset('loadLayout1', 'drone');
  const refreshed = target(identity);
  respond();
  await request;
  expect(original.restored).toEqual([]);
  expect(refreshed.restored).toHaveLength(1);
});
