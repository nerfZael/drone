import type { DockviewApi, DockviewGroupPanel, SerializedDockview } from 'dockview';
import { filePanelId } from './file-tab-drag';
import { openedFileTabId } from './opened-file-tabs';
import { validateWindowLayoutPreset } from '@drone/hub-model';

type GridNode = SerializedDockview['grid']['root'];
type GroupState = NonNullable<SerializedDockview['floatingGroups']>[number]['data'];
type GridAccess = { deserialize(grid: SerializedDockview['grid'], deserializer: { fromJSON(node: { data: GroupState }): DockviewGroupPanel }): void; layout(width: number, height: number): void };

export function captureWorkspacePreset(api: DockviewApi): SerializedDockview {
  const current = api.toJSON();
  const ids = new Set(leaves(current.grid.root).flatMap(group => group.views));
  const layout: SerializedDockview = {
    grid: current.grid,
    activeGroup: leaves(current.grid.root).some(group => group.id === current.activeGroup) ? current.activeGroup : undefined,
    panels: Object.fromEntries(Object.entries(current.panels).filter(([id]) => ids.has(id))),
  };
  validateWindowLayoutPreset(layout);
  return structuredClone(layout);
}

/** File windows refer to paths in the destination workspace, not source tab IDs. */
export function remapPresetFiles(layout: SerializedDockview, droneId: string, rootPath: string): SerializedDockview {
  validateWindowLayoutPreset(layout);
  const result = structuredClone(layout);
  const ids = new Map<string, string>();
  for (const [oldId, panel] of Object.entries(result.panels)) {
    if (panel.contentComponent !== 'file') continue;
    const params = panel.params!;
    const path = typeof params.presetRelativePath === 'string'
      ? `${rootPath.replace(/\/+$/, '')}/${params.presetRelativePath}` : params.path;
    if (typeof params.presetRelativePath === 'string' && !rootPath) throw new Error('The destination workspace has no file root.');
    if (typeof path !== 'string' || !path) throw new Error('This preset contains an invalid file path.');
    const tabId = openedFileTabId(droneId, path);
    const id = filePanelId(tabId);
    ids.set(oldId, id);
    delete result.panels[oldId];
    result.panels[id] = { ...panel, id, params: { ...params, droneId, tabId, path } };
  }
  for (const group of leaves(result.grid.root)) {
    group.views = group.views.map(id => ids.get(id) ?? id);
    if (group.activeView) group.activeView = ids.get(group.activeView) ?? group.activeView;
    for (const tabGroup of group.tabGroups ?? []) tabGroup.panelIds = tabGroup.panelIds.map(id => ids.get(id) ?? id);
  }
  return result;
}

/** Replace only the grid: fromJSON would tear down every floating chat frame. */
export function restoreWorkspacePreset(api: DockviewApi, preset: SerializedDockview): void {
  assertWorkspacePresetCanRestore(api, preset);
  const previous = captureWorkspacePreset(api);
  try { replaceGrid(api, preset); }
  catch (error) {
    replaceGrid(api, previous);
    throw error;
  }
}

export function assertWorkspacePresetCanRestore(api: DockviewApi, preset: SerializedDockview): void {
  validateWindowLayoutPreset(preset);
  const main = api.getPanel('agent-chat');
  if (!main || main.group.api.location.type !== 'grid') throw new Error('The main chat must be docked to load a preset.');
  for (const id of Object.keys(preset.panels)) {
    const existing = api.getPanel(id);
    if (existing && existing.group.api.location.type !== 'grid') {
      throw new Error('This preset includes a window that is currently floating. Dock it before loading this slot.');
    }
  }
  // Dockview exposes no grid-only restore. Keep this internal dependency here,
  // guarded before mutation and covered by a real Dockview integration test.
  const grid = (api as unknown as { component?: { gridview?: GridAccess } }).component?.gridview;
  if (!grid?.deserialize || !grid.layout) throw new Error('This Dockview version cannot restore docked presets.');
}

function replaceGrid(api: DockviewApi, preset: SerializedDockview): void {
  const main = api.getPanel('agent-chat')!;
  const grid = (api as unknown as { component: { gridview: GridAccess } }).component.gridview;
  const width = api.width;
  const height = api.height;
  const previousActive = api.activePanel;
  const previousFocus = document.activeElement as HTMLElement | null;
  const groups = new Map<string, DockviewGroupPanel>();
  const oldGroups = api.groups.filter(group => group.api.location.type === 'grid');
  for (const group of oldGroups) {
    for (const panel of [...group.panels]) {
      if (panel !== main) api.removePanel(panel);
    }
  }
  for (const state of leaves(preset.grid.root)) {
    const group = api.addGroup({ direction: 'right', skipSetActive: true, locked: state.locked, hideHeader: state.hideHeader, headerPosition: state.headerPosition });
    groups.set(state.id, group);
    for (const id of state.views) {
      if (id === main.id) main.api.moveTo({ group, position: 'center', index: group.panels.length, skipSetActive: true });
      else {
        const { contentComponent, ...panel } = preset.panels[id]!;
        api.addPanel({ ...panel, component: contentComponent!, position: { referenceGroup: group, direction: 'within' }, inactive: true });
      }
    }
    if (state.activeView) group.model.openPanel(api.getPanel(state.activeView)!, { skipSetGroupActive: true });
    if (state.tabGroups) group.model.restoreTabGroups(state.tabGroups);
  }
  for (const group of oldGroups) if (api.groups.includes(group) && !group.panels.length) api.removeGroup(group);
  const restoredGrid = structuredClone(preset.grid);
  for (const state of leaves(restoredGrid.root)) state.id = groups.get(state.id)!.id;
  const byId = new Map([...groups.values()].map(group => [group.id, group]));
  grid.deserialize(restoredGrid, { fromJSON: node => byId.get(node.data.id)! });
  grid.layout(width, height);
  if (previousActive && previousActive.group.api.location.type !== 'grid' && api.getPanel(previousActive.id) === previousActive) {
    previousActive.api.setActive();
  } else {
    const activeGroup = preset.activeGroup ? groups.get(preset.activeGroup) : main.group;
    activeGroup?.activePanel?.api.setActive();
  }
  previousFocus?.focus({ preventScroll: true });
}

function leaves(node: GridNode): GroupState[] {
  return node.type === 'branch'
    ? (node.data as GridNode[]).flatMap(leaves)
    : [node.data as GroupState];
}
