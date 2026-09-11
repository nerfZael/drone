import type { DockviewApi } from 'dockview';
import { workspaceLayoutPanelIds, type WorkspaceLayoutNode } from './workspace-layout-tree';

/** Move existing panel instances; never deserialize/recreate editors or terminals. */
export function applyWorkspaceLayout(api: DockviewApi, layout: WorkspaceLayoutNode): void {
  const ids = workspaceLayoutPanelIds(layout);
  const panels = ids.map(id => { const panel = api.getPanel(id); if (!panel) throw new Error(`PANEL_UNAVAILABLE: ${id}`); return panel; });
  const staging = api.addGroup({ direction: 'right', skipSetActive: true });
  for (const panel of panels) panel.api.moveTo({ group: staging, position: 'center', skipSetActive: true });
  for (const group of [...api.groups]) {
    if (group !== staging && group.api.location.type === 'grid' && !group.panels.length) api.removeGroup(group);
  }
  const leaves: { node: Extract<WorkspaceLayoutNode, { panels: string[] }>; group: typeof staging; width: number; height: number }[] = [];
  const construct = (node: WorkspaceLayoutNode, group: typeof staging, width: number, height: number) => {
    if ('panels' in node) {
      // Saved empty slots may be narrower than Dockview's default group minimum.
      if (!node.panels.length) group.api.setConstraints({ minimumWidth: 0, minimumHeight: 0 });
      leaves.push({ node, group, width, height });
      return;
    }
    const anchor = Math.max(0, node.children.findIndex(child => workspaceLayoutPanelIds(child).length > 0));
    const groups: (typeof staging)[] = new Array(node.children.length);
    groups[anchor] = group;
    for (let i = anchor - 1; i >= 0; i--) groups[i] = api.addGroup({ referenceGroup: groups[i + 1]!, direction: node.direction === 'row' ? 'left' : 'above', skipSetActive: true });
    for (let i = anchor + 1; i < node.children.length; i++) groups[i] = api.addGroup({ referenceGroup: groups[i - 1]!, direction: node.direction === 'row' ? 'right' : 'below', skipSetActive: true });
    const weights = node.weights ?? node.children.map(() => 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    node.children.forEach((child, i) => construct(child, groups[i]!, node.direction === 'row' ? width * weights[i]! / total : width, node.direction === 'column' ? height * weights[i]! / total : height));
  };
  construct(layout, staging, api.width, api.height);
  for (const { node, group } of leaves) for (const [index, id] of node.panels.entries()) {
    api.getPanel(id)!.api.moveTo({ group, position: 'center', index, skipSetActive: true });
  }
  for (const { group, width, height } of leaves) {
    group.api.setSize({ width: Math.round(width), height: Math.round(height) });
  }
}
