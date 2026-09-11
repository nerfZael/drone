export type WorkspaceLayoutNode = { panels: string[] } | { direction: 'row' | 'column'; children: WorkspaceLayoutNode[]; weights?: number[] };
export type WorkspacePanelInfo = { panelId: string; minimumWidth: number; minimumHeight: number; maximumWidth?: number; maximumHeight?: number; location: string };
export type PanelRect = { x: number; y: number; width: number; height: number };

/** Validate the complete docked layout before changing any live panel. */
export function validateWorkspaceLayout(value: unknown, panels: WorkspacePanelInfo[], width: number, height: number): WorkspaceLayoutNode {
  if (![width, height].every(size => Number.isFinite(size) && size > 0)) throw new Error('WORKSPACE_LAYOUT_NOT_READY');
  const seen = new Set<string>();
  let count = 0;
  const parse = (value: unknown, depth: number): WorkspaceLayoutNode => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 8 || ++count > 100) throw new Error('INVALID_WORKSPACE_LAYOUT');
    const node = value as Record<string, unknown>;
    if ('panels' in node) {
      if (Object.keys(node).some(k => k !== 'panels') || !Array.isArray(node.panels) || !node.panels.length) throw new Error('INVALID_LAYOUT_PANELS');
      const ids = node.panels.map(id => {
        if (typeof id !== 'string' || seen.has(id)) throw new Error('DUPLICATE_OR_INVALID_PANEL');
        const panel = panels.find(p => p.panelId === id);
        if (!panel || !['grid', 'floating'].includes(panel.location)) throw new Error(`PANEL_UNAVAILABLE: ${id}`);
        seen.add(id); return id;
      });
      return { panels: ids };
    }
    if (Object.keys(node).some(k => !['direction', 'children', 'weights'].includes(k)) || !['row', 'column'].includes(String(node.direction)) || !Array.isArray(node.children) || node.children.length < 2) throw new Error('INVALID_LAYOUT_SPLIT');
    const children = node.children.map(child => parse(child, depth + 1));
    const weights = node.weights;
    if (weights !== undefined && (!Array.isArray(weights) || weights.length !== children.length || weights.some(w => typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || w > 10000))) throw new Error('INVALID_LAYOUT_WEIGHTS');
    return { direction: node.direction as 'row' | 'column', children, ...(weights ? { weights: weights as number[] } : {}) };
  };
  const layout = parse(value, 0);
  const missing = panels.filter(p => p.location === 'grid' && !seen.has(p.panelId));
  if (missing.length) throw new Error(`MISSING_DOCKED_PANELS: include ${missing.map(p => p.panelId).join(', ')}. Put panels in one leaf to keep them as tabs.`);
  const rectangles = workspaceLayoutRects(layout, width, height);
  for (const [id, rect] of rectangles) {
    const panel = panels.find(p => p.panelId === id)!;
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < panel.minimumWidth || rect.height < panel.minimumHeight || rect.width > (panel.maximumWidth ?? Infinity) || rect.height > (panel.maximumHeight ?? Infinity)) throw new Error(`LAYOUT_DOES_NOT_FIT: ${id}`);
  }
  return layout;
}

export function workspaceLayoutPanelIds(node: WorkspaceLayoutNode): string[] {
  return 'panels' in node ? node.panels : node.children.flatMap(workspaceLayoutPanelIds);
}

export function workspaceLayoutRects(node: WorkspaceLayoutNode, width: number, height: number, x = 0, y = 0): Map<string, PanelRect> {
  if ('panels' in node) return new Map(node.panels.map(id => [id, { x, y, width, height }]));
  const horizontal = node.direction === 'row';
  const weights = node.weights ?? node.children.map(() => 1);
  const total = weights.reduce((sum, w) => sum + w, 0);
  // Dockview dividers overlay the panes rather than consuming layout space.
  const available = horizontal ? width : height;
  let offset = 0;
  const result = new Map<string, PanelRect>();
  node.children.forEach((child, i) => {
    const size = available * weights[i]! / total;
    const rectangles = workspaceLayoutRects(child, horizontal ? size : width, horizontal ? height : size, horizontal ? x + offset : x, horizontal ? y : y + offset);
    rectangles.forEach((rect, id) => result.set(id, rect));
    offset += size;
  });
  return result;
}

/** Dockview serializes alternating split directions and tab groups. */
export function readWorkspaceLayoutTree(node: { type: string; data: any; size?: number }, direction: 'row' | 'column'): WorkspaceLayoutNode {
  if (node.type === 'leaf') return { panels: [...node.data.views] };
  const children = node.data as typeof node[];
  if (children.length === 1) return readWorkspaceLayoutTree(children[0]!, direction === 'row' ? 'column' : 'row');
  return { direction, children: children.map(child => readWorkspaceLayoutTree(child, direction === 'row' ? 'column' : 'row')), weights: children.map(child => Math.max(1, child.size ?? 1)) };
}
