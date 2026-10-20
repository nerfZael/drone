import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { DockviewComponent, DockviewApi } from 'dockview-core';
import { isWorkspacePanelCollapsed, syncCollapsedWorkspacePanels, toggleWorkspacePanelCollapse } from '../src/droneHub/app/workspace-panel-collapse';

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

/** Without a laid-out tab bar, the collapsed height falls back to the normal header's 28px. */
const TAB_BAR = 28;
const height = (id: string) => Math.round(api.getPanel(id)!.group.api.height);

function explorerColumn(top: string, bottom: string) {
  api.addPanel({ id: 'agent-chat', component: 'chat' });
  api.addPanel({ id: top, component: 'tool', position: { direction: 'right' } });
  api.addPanel({ id: bottom, component: 'tool', position: { direction: 'below', referencePanel: top } });
  api.getPanel(bottom)!.group.api.setSize({ height: 300 });
}

test('a window under another collapses to its tab bar and opens back to its height', () => {
  explorerColumn('file-explorer', 'changes-explorer');

  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(true);
  expect(height('changes-explorer')).toBe(TAB_BAR);
  expect(height('file-explorer')).toBe(800 - TAB_BAR);
  // The window above took the space, so the tab bar sits at the bottom of the column.
  expect(api.toJSON().panels['changes-explorer'].params).toMatchObject({ collapsed: true, expandedHeight: 300 });

  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(false);
  expect(height('changes-explorer')).toBe(300);
  expect(height('file-explorer')).toBe(500);
  expect(api.toJSON().panels['changes-explorer'].params ?? {}).not.toHaveProperty('collapsed');
});

test('a window above another collapses up, and the one below takes the space', () => {
  explorerColumn('changes-explorer', 'file-explorer');

  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  expect(height('changes-explorer')).toBe(TAB_BAR);
  expect(height('file-explorer')).toBe(800 - TAB_BAR);
});

test('a collapsed window holds its tab bar height while the workspace resizes', () => {
  explorerColumn('file-explorer', 'changes-explorer');
  toggleWorkspacePanelCollapse(api, 'changes-explorer');

  api.layout(1200, 600);
  expect(height('changes-explorer')).toBe(TAB_BAR);
  expect(height('file-explorer')).toBe(600 - TAB_BAR);
});

test('a window with nothing above or below it does not collapse', () => {
  api.addPanel({ id: 'agent-chat', component: 'chat' });
  api.addPanel({ id: 'changes-explorer', component: 'tool', position: { direction: 'right' } });

  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(false);
  expect(height('changes-explorer')).toBe(800);
});

test('a window beside another in a row under a third does not collapse the row', () => {
  api.addPanel({ id: 'agent-chat', component: 'chat' });
  api.addPanel({ id: 'tool:terminal', component: 'tool', position: { direction: 'below' } });
  api.addPanel({ id: 'changes-explorer', component: 'tool', position: { direction: 'right', referencePanel: 'tool:terminal' } });

  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(false);
});

test('a restored layout keeps the window collapsed', () => {
  explorerColumn('file-explorer', 'changes-explorer');
  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  const saved = api.toJSON();

  api.clear();
  api.fromJSON(saved);
  syncCollapsedWorkspacePanels(api);
  expect(height('changes-explorer')).toBe(TAB_BAR);
  api.layout(1200, 700);
  expect(height('changes-explorer')).toBe(TAB_BAR);

  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  expect(height('changes-explorer')).toBe(300);
});

test('a collapsed window that gains a tab opens again', () => {
  explorerColumn('file-explorer', 'changes-explorer');
  toggleWorkspacePanelCollapse(api, 'changes-explorer');

  api.addPanel({ id: 'tool:terminal', component: 'tool', position: { referencePanel: 'changes-explorer', direction: 'within' } });
  syncCollapsedWorkspacePanels(api);
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(false);
  expect(height('changes-explorer')).toBe(300);
});

test('maximizing another window (the canvas full view) leaves the window collapsed', () => {
  explorerColumn('file-explorer', 'changes-explorer');
  toggleWorkspacePanelCollapse(api, 'changes-explorer');

  api.getPanel('agent-chat')!.group.api.maximize();
  syncCollapsedWorkspacePanels(api);
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(true);

  api.exitMaximizedGroup();
  syncCollapsedWorkspacePanels(api);
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(true);
  expect(height('changes-explorer')).toBe(TAB_BAR);
});

test('a collapsed window that floats opens without taking its docked height', () => {
  explorerColumn('file-explorer', 'changes-explorer');
  toggleWorkspacePanelCollapse(api, 'changes-explorer');

  api.addFloatingGroup(api.getPanel('changes-explorer')!, { x: 10, y: 10, width: 260, height: 200 });
  // Dockview keeps a size set on a floating group and applies it once the group is docked again.
  const floating = api.getPanel('changes-explorer')!.group;
  const sizes: unknown[] = [];
  const setSize = floating.api.setSize.bind(floating.api);
  floating.api.setSize = (event) => { sizes.push(event); setSize(event); };
  syncCollapsedWorkspacePanels(api);
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(false);
  expect(sizes).toEqual([]);
});

test('a collapsed window whose column goes away opens into its new slot without resizing the row', () => {
  api.addPanel({ id: 'agent-chat', component: 'chat' });
  api.addPanel({ id: 'tool:terminal', component: 'tool', position: { direction: 'below' } });
  api.addPanel({ id: 'file-explorer', component: 'tool', position: { direction: 'right', referencePanel: 'agent-chat' } });
  api.addPanel({ id: 'changes-explorer', component: 'tool', position: { direction: 'below', referencePanel: 'file-explorer' } });
  api.getPanel('tool:terminal')!.group.api.setSize({ height: 200 });
  api.getPanel('changes-explorer')!.group.api.setSize({ height: 300 });
  toggleWorkspacePanelCollapse(api, 'changes-explorer');
  expect(height('changes-explorer')).toBe(TAB_BAR);

  api.removePanel(api.getPanel('file-explorer')!);
  syncCollapsedWorkspacePanels(api);
  expect(isWorkspacePanelCollapsed(api, 'changes-explorer')).toBe(false);
  expect(height('tool:terminal')).toBe(200);
  expect(height('changes-explorer')).toBe(600);
});
