import type { DockviewApi, DockviewGroupPanel, SerializedDockview } from 'dockview';
import { OCCUPIED_GROUP_CONSTRAINTS } from './workspace-panel-expansion';

/**
 * A docked window stacked above or below another one can be collapsed to its
 * tab bar by clicking its tab, and opened again the same way. The window it
 * sits under grows into the space, so the tab bar drops to the bottom; one
 * above another window instead keeps its tab bar where it is. The state lives
 * in the panel's parameters, so it is saved with the layout.
 */

type CollapseParameters = { collapsed?: unknown; expandedHeight?: unknown };
type GridNode = SerializedDockview['grid']['root'];

/** The tab bar height when the window isn't laid out yet (normal headers). */
const FALLBACK_TAB_BAR_PX = 28;

/** Groups held at their tab bar, per workspace: which group each collapsed panel is in, at what height. */
const held = new WeakMap<DockviewApi, Map<string, { group: DockviewGroupPanel; height: number }>>();

function heldIn(api: DockviewApi) {
  let map = held.get(api);
  if (!map) held.set(api, map = new Map());
  return map;
}

function parametersOf(api: DockviewApi, panelId: string): CollapseParameters {
  return (api.getPanel(panelId)?.params ?? {}) as CollapseParameters;
}

export function isWorkspacePanelCollapsed(api: DockviewApi, panelId: string): boolean {
  return parametersOf(api, panelId).collapsed === true;
}

/** Whether the group shares its column with another window, so there is one to take its space. */
export function isStackedInColumn(api: DockviewApi, group: DockviewGroupPanel): boolean {
  if (group.api.location.type !== 'grid' || api.hasMaximizedGroup()) return false;
  const { grid } = api.toJSON();
  const find = (node: GridNode, orientation: string): boolean => {
    if (node.type !== 'branch') return false;
    const children = node.data as GridNode[];
    const childOrientation = orientation === 'VERTICAL' ? 'HORIZONTAL' : 'VERTICAL';
    for (const child of children) {
      if (child.type === 'leaf' && (child.data as { id?: string }).id === group.id) {
        return orientation === 'VERTICAL' && children.length > 1;
      }
      if (find(child, childOrientation)) return true;
    }
    return false;
  };
  return find(grid.root, grid.orientation);
}

function collapsible(api: DockviewApi, group: DockviewGroupPanel): boolean {
  return group.panels.length === 1 && isStackedInColumn(api, group);
}

function tabBarHeight(group: DockviewGroupPanel): number {
  const header = group.element.querySelector<HTMLElement>('.dv-tabs-and-actions-container');
  const measured = header?.getBoundingClientRect().height ?? 0;
  if (measured > 0) return Math.round(measured);
  const declared = parseFloat(getComputedStyle(group.element).getPropertyValue('--dv-tabs-and-actions-container-height'));
  return Number.isFinite(declared) && declared > 0 ? Math.round(declared) : FALLBACK_TAB_BAR_PX;
}

/** Lifts the held height (to Dockview's own "no maximum"); a group left empty becomes a slot that can be dragged shut. */
function release(api: DockviewApi, group: DockviewGroupPanel) {
  if (!api.groups.includes(group)) return;
  group.api.setConstraints({
    minimumHeight: group.panels.length ? OCCUPIED_GROUP_CONSTRAINTS.minimumHeight : 0,
    maximumHeight: Number.MAX_SAFE_INTEGER,
  });
}

function open(api: DockviewApi, group: DockviewGroupPanel, height: unknown) {
  release(api, group);
  // Only a column takes its height back. In a row the height is the whole row's, and
  // Dockview keeps a size set on a floating group and applies it once the group is docked again.
  if (!api.groups.includes(group) || !isStackedInColumn(api, group)) return;
  if (typeof height === 'number' && height > 0) group.api.setSize({ height });
}

/**
 * Collapses the panel's window to its tab bar, or opens it back to the height
 * it had. Does nothing for a window that has no neighbour above or below it.
 */
export function toggleWorkspacePanelCollapse(api: DockviewApi, panelId: string): void {
  const panel = api.getPanel(panelId);
  if (!panel) return;
  const parameters = parametersOf(api, panelId);
  if (parameters.collapsed === true) {
    panel.api.updateParameters({ ...parameters, collapsed: undefined, expandedHeight: undefined });
    heldIn(api).delete(panelId);
    open(api, panel.group, parameters.expandedHeight);
    return;
  }
  if (!collapsible(api, panel.group)) return;
  panel.api.updateParameters({ ...parameters, collapsed: true, expandedHeight: Math.round(panel.group.api.height) });
  syncCollapsedWorkspacePanels(api);
}

/**
 * Holds collapsed windows at their tab bar's height, in whichever group they
 * are in now (a restored layout or a move gives them a new one, a header mode
 * change a new height). A collapsed window joined by another tab or left
 * without a neighbour above or below opens again. While a window is
 * maximized (the canvas's full view) the rest of the grid is hidden, not
 * rearranged, so nothing changes until it is restored.
 */
export function syncCollapsedWorkspacePanels(api: DockviewApi): void {
  if (api.hasMaximizedGroup()) return;
  const groups = heldIn(api);
  for (const panel of api.panels) {
    const parameters = (panel.params ?? {}) as CollapseParameters;
    if (parameters.collapsed !== true) continue;
    const group = panel.group;
    const previous = groups.get(panel.id);
    if (previous && previous.group !== group) release(api, previous.group);
    if (!collapsible(api, group)) {
      panel.api.updateParameters({ ...parameters, collapsed: undefined, expandedHeight: undefined });
      groups.delete(panel.id);
      open(api, group, parameters.expandedHeight);
      continue;
    }
    const height = tabBarHeight(group);
    if (previous?.group !== group || previous.height !== height) {
      groups.set(panel.id, { group, height });
      group.api.setConstraints({ minimumHeight: height, maximumHeight: height });
    }
    if (Math.round(group.api.height) !== height) group.api.setSize({ height });
  }
  for (const [panelId, { group }] of groups) {
    if (isWorkspacePanelCollapsed(api, panelId)) continue;
    groups.delete(panelId);
    release(api, group);
  }
}
