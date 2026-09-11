import { applyWorkspaceLayout } from '../src/droneHub/workspace-layout/applyWorkspaceLayout';
import { workspacePanelConstraints } from '../src/droneHub/workspace-layout/workspace-panel-constraints';
import { expect, test } from 'bun:test';
import { readWorkspaceLayoutTree, validateWorkspaceLayout, workspaceLayoutRects, type WorkspaceLayoutNode } from '../src/droneHub/workspace-layout/workspace-layout-tree';

const panels = ['file-a', 'file-b', 'file-c', 'agent-chat'].map(panelId => ({ panelId, minimumWidth: 320, minimumHeight: 180, location: 'grid' }));
const layout: WorkspaceLayoutNode = { direction: 'column', children: [
  { direction: 'row', children: panels.slice(0, 3).map(p => ({ panels: [p.panelId] })) },
  { panels: ['agent-chat'] },
] };

test('three existing file panes above a full-width chat fit in one split tree', () => {
  const result = validateWorkspaceLayout(layout, panels, 1200, 800);
  expect([...workspaceLayoutRects(result, 1200, 800).values()]).toEqual([
    { x: 0, y: 0, width: 400, height: 400 }, { x: 400, y: 0, width: 400, height: 400 }, { x: 800, y: 0, width: 400, height: 400 }, { x: 0, y: 400, width: 1200, height: 400 },
  ]);
});
test('weights resize sections and leaf arrays retain tab groups', () => {
  const tree = validateWorkspaceLayout({ direction: 'row', weights: [1, 2], children: [{ panels: ['agent-chat'] }, { panels: ['file-a', 'file-b', 'file-c'] }] }, panels, 1200, 800);
  const rects = workspaceLayoutRects(tree, 1200, 800);
  expect(rects.get('agent-chat')!.width).toBe(400);
  expect(rects.get('file-a')).toEqual(rects.get('file-c'));
  expect(rects.get('file-a')!.width).toBe(800);
});
test('rejects missing, duplicate, unknown, too-small and invalid layout nodes', () => {
  const invalid = [ { panels: ['agent-chat'] }, { panels: [...panels.map(p => p.panelId), 'new-file'] }, { panels: [...panels.map(p => p.panelId), 'file-a'] }, { ...layout, weights: [1, 0] }, { ...layout, weights: [1] }, { ...layout, extra: true }, { direction: 'row', children: [] } ];
  for (const value of invalid) expect(() => validateWorkspaceLayout(value, panels, 1200, 800)).toThrow();
  expect(() => validateWorkspaceLayout(layout, panels, 600, 400)).toThrow('DOES_NOT_FIT');
});
test('floating panels remain optional but can be docked explicitly', () => {
  const withFloat = [...panels, { panelId: 'terminal', minimumWidth: 200, minimumHeight: 150, location: 'floating' }];
  expect(validateWorkspaceLayout(layout, withFloat, 1200, 800)).toEqual(layout);
  expect(validateWorkspaceLayout({ panels: withFloat.map(p => p.panelId) }, withFloat, 1200, 800)).toEqual({ panels: withFloat.map(p => p.panelId) });
});
test('reads Dockview split orientation, tab groups, sizes and empty slots', () => {
  const leaf = (views: string[], size: number) => ({ type: 'leaf', data: { views }, size });
  const node = { type: 'branch', data: [{ type: 'branch', data: [leaf(['a','b'], 600), leaf([], 200)], size: 1200 }], size: 800 };
  expect(readWorkspaceLayoutTree(node, 'row')).toEqual({ direction: 'column', children: [{ panels: ['a', 'b'] }, { panels: [] }], weights: [600, 200] });
});


test('hidden panels use their own minimum and maximum sizes instead of active sibling constraints', () => {
  const small = { panelId: 'small', location: 'grid', ...workspacePanelConstraints({ minimumWidth: 100, minimumHeight: 100 }) };
  const large = { panelId: 'large', location: 'grid', ...workspacePanelConstraints({ minimumWidth: 700, minimumHeight: 100, maximumWidth: 900 }) };
  const split = { direction: 'row', children: [{ panels: ['small'] }, { panels: ['large'] }] };
  expect(() => validateWorkspaceLayout(split, [small, large], 1200, 800)).toThrow('large');
  expect(validateWorkspaceLayout({ ...split, weights: [1, 2] }, [small, large], 1200, 800)).toHaveProperty('weights', [1, 2]);
  expect(() => validateWorkspaceLayout({ panels: ['small', 'large'] }, [small, large], 1200, 800)).toThrow('large');
  expect(workspacePanelConstraints({})).toEqual({ minimumWidth: 100, minimumHeight: 100 });
});

test('a viewport that is not ready cannot pass preflight validation', () => {
  for (const size of [0, -1, NaN, Infinity]) {
    expect(() => validateWorkspaceLayout(layout, panels, size, 800)).toThrow('NOT_READY');
    expect(() => validateWorkspaceLayout(layout, panels, 1200, size)).toThrow('NOT_READY');
  }
});

test('undo can restore empty slots below the default group minimum without replacing panels', () => {
  const groups: any[] = [];
  const addGroup = () => {
    let minimumWidth = 100, minimumHeight = 100;
    const group: any = { panels: [], width: 0, height: 0, api: {
      location: { type: 'grid' },
      setConstraints(constraints: any) { minimumWidth = constraints.minimumWidth; minimumHeight = constraints.minimumHeight; },
      setSize(size: any) { group.width = Math.max(minimumWidth, size.width); group.height = Math.max(minimumHeight, size.height); },
    } };
    groups.push(group); return group;
  };
  const originalGroup = addGroup();
  const panel: any = { id: 'editor', group: originalGroup, api: {
    moveTo({ group }: any) {
      panel.group.panels = panel.group.panels.filter((p: any) => p !== panel);
      panel.group = group; group.panels.push(panel);
    },
  } };
  originalGroup.panels.push(panel);
  const api: any = { width: 1200, height: 800, groups, addGroup,
    getPanel: (id: string) => id === panel.id ? panel : undefined,
    removeGroup(group: any) { expect(group.panels).toHaveLength(0); groups.splice(groups.indexOf(group), 1); },
  };
  applyWorkspaceLayout(api, { direction: 'row', weights: [1, 23], children: [{ panels: [] }, { panels: ['editor'] }] });
  expect(groups.find(group => !group.panels.length).width).toBe(50);
  expect(panel.group.width).toBe(1150);
  expect(groups.flatMap(group => group.panels)).toEqual([panel]);
});
