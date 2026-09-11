import { retainClosedSideChatWindows } from '../src/droneHub/app/retainClosedSideChatWindows';
import { readSideChatWorkspaceState } from '../src/droneHub/app/side-chat-workspace-state';
import { closeDockedWindows } from '../src/droneHub/app/closeDockedWindows';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { DockviewComponent, DockviewApi } from 'dockview-core';
import { captureWorkspacePreset, restoreWorkspacePreset, remapPresetFiles } from '../src/droneHub/app/workspace-layout-presets';

let dom: Window;
let component: DockviewComponent;
let api: DockviewApi;
const previous = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  dom = new Window();
  for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: (dom as any)[key === 'window' ? 'window' : key] });
  }
  const host = document.createElement('div');
  document.body.append(host);
  component = new DockviewComponent(host, {
    createComponent: () => ({ element: document.createElement('div'), init() {} }),
  });
  api = new DockviewApi(component);
  api.layout(1200, 800);
});
afterEach(() => {
  component.dispose();
  dom.happyDOM.cancelAsync();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
});

function layout() {
  api.addPanel({ id: 'agent-chat', component: 'chat' });
  api.addPanel({ id: 'tool:editor', component: 'tool', params: { tab: 'editor', paneKey: 'single' }, position: { direction: 'right' } });
  api.addPanel({ id: 'tool:terminal', component: 'tool', params: { tab: 'terminal', paneKey: 'bottom' }, position: { direction: 'below', referencePanel: 'tool:editor' } });
  api.getPanel('agent-chat')!.api.setSize({ width: 430 });
  api.getPanel('tool:terminal')!.api.setSize({ height: 230 });
}

function normalizedGrid() {
  const grid = captureWorkspacePreset(api).grid;
  const visit = (node: any) => {
    if (node.type === 'branch') node.data.forEach(visit);
    else delete node.data.id;
  };
  visit(grid.root);
  return grid;
}

test('restores nested split order and exact sizes while preserving the main chat and floating instances', () => {
  layout();
  const floating = api.addPanel({ id: 'side-chat:fork', component: 'sideChat', floating: { x: 44, y: 55, width: 350, height: 240 } });
  const floatingGroup = floating.group;
  const frame = floatingGroup.element.parentElement;
  const floatingState = api.toJSON().floatingGroups;
  const chat = api.getPanel('agent-chat');
  const preset = captureWorkspacePreset(api);
  expect(preset.panels['side-chat:fork']).toBeUndefined();
  expect(preset.floatingGroups).toBeUndefined();
  const expected = normalizedGrid();
  api.removePanel(api.getPanel('tool:terminal')!);
  api.addPanel({ id: 'tool:canvas', component: 'tool', position: { direction: 'left' } });
  restoreWorkspacePreset(api, preset);
  expect(normalizedGrid()).toEqual(expected);
  expect(api.getPanel('tool:canvas')).toBeUndefined();
  expect(api.getPanel('agent-chat')).toBe(chat);
  expect(api.getPanel(floating.id)).toBe(floating);
  expect(floating.group).toBe(floatingGroup);
  expect(floatingGroup.element.parentElement).toBe(frame);
  expect(api.toJSON().floatingGroups).toEqual(floatingState);
});

test('rejects malformed layouts and conflicts with floating windows without changing anything', () => {
  layout();
  const preset = captureWorkspacePreset(api);
  api.addFloatingGroup(api.getPanel('tool:editor')!.group);
  const before = api.toJSON();
  expect(() => restoreWorkspacePreset(api, preset)).toThrow('currently floating');
  expect(api.toJSON()).toEqual(before);
  expect(() => restoreWorkspacePreset(api, { ...preset, panels: {} })).toThrow('Invalid');
  expect(api.toJSON()).toEqual(before);
});

test('remaps file window IDs and paths across drones without changing the saved preset', () => {
  layout();
  api.addPanel({ id: 'file-tab:old', component: 'file', params: { path: '/old/src/app.ts', presetRelativePath: 'src/app.ts', tabId: 'old' } });
  const preset = captureWorkspacePreset(api);
  const mapped = remapPresetFiles(preset, 'destination', '/new');
  const file = Object.values(mapped.panels).find(panel => panel.contentComponent === 'file')!;
  expect(file.params?.path).toBe('/new/src/app.ts');
  expect(file.params?.droneId).toBe('destination');
  expect(JSON.stringify(mapped.grid)).toContain(file.id);
  expect(preset.panels['file-tab:old']?.params?.path).toBe('/old/src/app.ts');
});

test('restores tab order and empty split regions as well as window sizes', () => {
  layout();
  api.addPanel({ id: 'tool:canvas', component: 'tool', position: { referencePanel: 'tool:editor', direction: 'within' } });
  api.addPanel({ id: 'tool:changes', component: 'tool', position: { referencePanel: 'tool:editor', direction: 'within' } });
  api.addGroup({ direction: 'left', initialWidth: 100 });
  const preset = captureWorkspacePreset(api);
  const expected = normalizedGrid();
  restoreWorkspacePreset(api, preset);
  expect(normalizedGrid()).toEqual(expected);
});


test('close docked windows keeps the main chat and floating instances, and removes empty regions', () => {
  layout();
  api.addPanel({ id: 'file-explorer', component: 'tool', position: { direction: 'left' } });
  api.addPanel({ id: 'file-tab:test', component: 'file', params: { path: '/test' } });
  api.addGroup({ direction: 'left', initialWidth: 100 });
  const floating = api.addPanel({ id: 'side-chat:fork', component: 'sideChat', floating: { x: 44, y: 55, width: 350, height: 240 } });
  const group = floating.group;
  const frame = group.element.parentElement;
  const bounds = api.toJSON().floatingGroups;
  const chat = api.getPanel('agent-chat');
  closeDockedWindows(api);
  expect(api.panels.map(panel => panel.id).sort()).toEqual(['agent-chat', 'side-chat:fork']);
  expect(api.groups.filter(group => group.api.location.type === 'grid')).toHaveLength(1);
  expect(api.getPanel('agent-chat')).toBe(chat);
  expect(api.getPanel(floating.id)).toBe(floating);
  expect(floating.group).toBe(group);
  expect(group.element.parentElement).toBe(frame);
  expect(api.toJSON().floatingGroups).toEqual(bounds);
  closeDockedWindows(api);
  expect(api.getPanel('agent-chat')).toBe(chat);
  expect(api.toJSON().floatingGroups).toEqual(bounds);
});

test('loading preserves the saved active tab even when the main chat was selected before loading', () => {
  api.addPanel({ id: 'agent-chat', component: 'chat' });
  api.addPanel({ id: 'tool:editor', component: 'tool', position: { referencePanel: 'agent-chat', direction: 'within' } });
  api.getPanel('tool:editor')!.api.setActive();
  const preset = captureWorkspacePreset(api);
  api.getPanel('agent-chat')!.api.setActive();
  restoreWorkspacePreset(api, preset);
  expect(api.getPanel('agent-chat')!.group.activePanel?.id).toBe('tool:editor');
});


test('closed docked forks stay hidden across refreshes while existing floating forks remain open', () => {
  layout();
  api.addPanel({ id: 'side-chat:docked', component: 'sideChat', params: { chatName: 'docked' } });
  const floating = api.addPanel({ id: 'side-chat:floating', component: 'sideChat', params: { chatName: 'floating' }, floating: true });
  const saved = captureWorkspacePreset(api);
  const finishClose = retainClosedSideChatWindows('drone', api);
  closeDockedWindows(api);
  finishClose();
  expect(readSideChatWorkspaceState('drone').closedWindows).toEqual(['docked']);
  expect(api.getPanel(floating.id)).toBe(floating);
  const finishLoad = retainClosedSideChatWindows('drone', api);
  restoreWorkspacePreset(api, saved);
  finishLoad();
  expect(readSideChatWorkspaceState('drone').closedWindows).toEqual([]);
  expect(api.getPanel(floating.id)).toBe(floating);
});
