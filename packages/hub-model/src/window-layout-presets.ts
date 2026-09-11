export const WINDOW_LAYOUT_SLOTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
export type WindowLayoutSlot = typeof WINDOW_LAYOUT_SLOTS[number];

/** Validate the portable, docked-only Dockview payload at the storage boundary. */
export function validateWindowLayoutPreset(value: unknown): void {
  const fail = (): never => { throw new Error('Invalid window layout preset'); };
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 256_000) fail();
  const layout = value as any;
  if (layout.floatingGroups || layout.popoutGroups || layout.edgeGroups) fail();
  if (!layout.panels || typeof layout.panels !== 'object' || Array.isArray(layout.panels) || Object.keys(layout.panels).length > 200) fail();
  const finiteSize = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100_000;
  if (!layout.grid || !finiteSize(layout.grid.width) || !finiteSize(layout.grid.height)
    || !['HORIZONTAL', 'VERTICAL'].includes(layout.grid.orientation) || layout.grid.root?.type !== 'branch') fail();
  const panels = new Set<string>();
  const groups = new Set<string>();
  let nodes = 0;
  const visit = (node: any, depth: number) => {
    if (!node || ++nodes > 200 || depth > 20 || (node.size !== undefined && !finiteSize(node.size))) fail();
    if (node.type === 'branch') {
      if (!Array.isArray(node.data)) fail();
      node.data.forEach((child: unknown) => visit(child, depth + 1));
    } else if (node.type === 'leaf') {
      const group = node.data;
      if (!group || typeof group.id !== 'string' || groups.has(group.id) || !Array.isArray(group.views)) fail();
      groups.add(group.id);
      for (const id of group.views) {
        if (typeof id !== 'string' || panels.has(id) || !Object.prototype.hasOwnProperty.call(layout.panels, id)) fail();
        const panel = layout.panels[id];
        if (!panel || panel.id !== id || !['chat', 'tool', 'file', 'sideChat'].includes(panel.contentComponent)) fail();
        if (panel.contentComponent === 'file' && (!panel.params || typeof panel.params.path !== 'string' || !panel.params.path)) fail();
        if (panel.params?.presetRelativePath !== undefined && (typeof panel.params.presetRelativePath !== 'string'
          || panel.params.presetRelativePath.split('/').includes('..') || panel.params.presetRelativePath.startsWith('/'))) fail();
        if (panel.contentComponent === 'sideChat' && typeof panel.params?.chatName !== 'string') fail();
        if (panel.contentComponent === 'chat' && id !== 'agent-chat') fail();
        panels.add(id);
      }
      if (group.activeView && !group.views.includes(group.activeView)) fail();
      if (group.tabGroups !== undefined) {
        if (!Array.isArray(group.tabGroups)) fail();
        const grouped = new Set<string>();
        for (const tabGroup of group.tabGroups) {
          if (!tabGroup || typeof tabGroup.id !== 'string' || !Array.isArray(tabGroup.panelIds)) fail();
          for (const id of tabGroup.panelIds) {
            if (!group.views.includes(id) || grouped.has(id)) fail();
            grouped.add(id);
          }
        }
      }
    } else fail();
  };
  visit(layout.grid.root, 0);
  if (!panels.has('agent-chat') || layout.panels['agent-chat'].contentComponent !== 'chat'
    || panels.size !== Object.keys(layout.panels).length) fail();
}
