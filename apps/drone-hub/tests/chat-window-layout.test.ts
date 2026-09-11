import { registerChatWindowLayout } from '../src/droneHub/chat-layout/registerChatWindowLayout';
import { collectChatWindows } from '../src/droneHub/chat-layout/chat-window-layout-events';
import { expect, test } from 'bun:test';
import { planChatWindowLayout, type LayoutWindow, type LayoutRequest } from '../src/droneHub/chat-layout/planChatWindowLayout';
import { ChatWindowLayoutController } from '../src/droneHub/chat-layout/ChatWindowLayoutController';
import { CHAT_LAYOUT_READ, type LayoutCollection } from '../src/droneHub/chat-layout/chat-window-layout-events';

const viewport = { width: 1200, height: 800 };
const windows: LayoutWindow[] = Array.from({ length: 4 }, (_, i) => ({ windowId: `w${i}`, droneId: 'd', chatName: `chat-${i}`, kind: 'side_chat', layer: 0, zIndex: 0, minimumWidth: 320, minimumHeight: 220, bounds: { x: i * 20, y: 0, width: 320, height: 220 } }));
const request = (extra: Partial<LayoutRequest> = {}): LayoutRequest => ({ workspaceId: 'd', layoutRevision: '1', mode: 'tile', gap: 0, ...extra });

test('tiles equal cells across the whole workspace and honors explicit ordering', () => {
  const result = planChatWindowLayout(viewport, windows, request({ columns: 2, windows: ['w3', 'w2', 'w1', 'w0'] }));
  expect([...result.keys()]).toEqual(['w3', 'w2', 'w1', 'w0']);
  expect(result.get('w3')).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  expect(result.get('w0')).toEqual({ x: 600, y: 400, width: 600, height: 400 });
});
test('packs from the bottom right with preserved preferred sizes and no overlap', () => {
  const result = [...planChatWindowLayout(viewport, windows, request({ mode: 'pack', gap: 8 })).values()];
  expect(result[0]).toEqual({ x: 880, y: 580, width: 320, height: 220 });
  for (const [i, a] of result.entries()) for (const b of result.slice(i + 1)) {
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
});
test('stack intentionally overlaps and custom uses fractional bounds', () => {
  const stacked = [...planChatWindowLayout(viewport, windows.slice(0, 2), request({ mode: 'stack' })).values()];
  expect(stacked[1]!.x - stacked[0]!.x).toBe(32);
  const custom = planChatWindowLayout(viewport, windows.slice(0, 1), request({ mode: 'custom', placements: [{ windowId: 'w0', bounds: { x: .5, y: .5, width: .5, height: .5 } }] }));
  expect(custom.get('w0')).toEqual({ x: 600, y: 400, width: 600, height: 400 });
});
test('rejects impossible and invalid requests without mutating inputs', () => {
  const before = structuredClone(windows);
  for (const extra of [ { columns: 4 }, { gap: -1 }, { area: { x: 0, y: 0, width: .1, height: .1 } }, { windows: ['missing'] }, { windows: ['w0', 'w0'] }, { mode: 'pack', size: { width: NaN, height: 300 } } ] as Partial<LayoutRequest>[]) {
    expect(() => planChatWindowLayout(viewport, windows, request(extra))).toThrow();
  }
  expect(() => planChatWindowLayout(viewport, windows, request({ windows: ['w0'] }))).toThrow('unselected');
  expect(windows).toEqual(before);
});
test('overlap respects the existing detached-window layer', () => {
  const mixed = [{ ...windows[0]!, layer: 1 }, windows[1]!];
  expect(() => planChatWindowLayout(viewport, mixed, request({ mode: 'stack' }))).toThrow('WINDOW_LAYER_ORDER');
});

test('controller rejects stale revisions, applies atomically, and supports undo', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const bus = new EventTarget();
  Object.assign(globalThis, { window: bus, document: { activeElement: null } });
  let source = structuredClone(windows);
  let fail = false;
  bus.addEventListener(CHAT_LAYOUT_READ, event => {
    const detail = (event as CustomEvent<LayoutCollection>).detail;
    if (detail.workspaceId !== 'd') return;
    detail.sources.push({ ...viewport, windows: source.map(w => ({ ...w,
      apply(bounds) { if (fail && w.windowId === 'w1') { fail = false; throw new Error('apply failed'); } source = source.map(item => item.windowId === w.windowId ? { ...item, bounds } : item); },
      setOrder(order) { source = source.map(item => item.windowId === w.windowId ? { ...item, zIndex: order } : item); },
      restoreFocus() {},
    })) });
  });
  try {
    const controller = new ChatWindowLayoutController();
    const read = controller.read('d');
    expect(read.supported).toBe(true);
    expect(controller.read('missing').supported).toBe(false);
    const args = { ...request(), layoutRevision: read.layoutRevision };
    expect(() => controller.arrange('other', args)).toThrow();
    fail = true;
    expect(() => controller.arrange('d', args)).toThrow('apply failed');
    expect(source.map(w => w.bounds)).toEqual(windows.map(w => w.bounds));
    const applied = controller.arrange('d', args);
    expect(applied.ok).toBe(true);
    expect(() => controller.arrange('d', args)).toThrow('STALE');
    controller.arrange('d', { workspaceId: 'd', layoutRevision: applied.layoutRevision, mode: 'undo' });
    expect(source.map(w => w.bounds)).toEqual(windows.map(w => w.bounds));
    const again = controller.read('d');
    source[0]!.bounds.x += 1;
    expect(() => controller.arrange('d', { ...args, layoutRevision: again.layoutRevision })).toThrow('STALE');
  } finally { Object.assign(globalThis, { window: oldWindow, document: oldDocument }); }
});

test('Dockview adapter moves existing panels, persists bounds, and unregisters cleanly', () => {
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { window: new EventTarget() });
  let bounds = { x: 100, y: 120, width: 320, height: 248 };
  let persisted: unknown, active = 0, level = '0';
  const frame = { style: { zIndex: '' }, getAttribute: () => level, setAttribute: (_: string, v: string) => { level = v; }, getBoundingClientRect: () => bounds };
  const element = { closest: () => frame, querySelector: () => null };
  const panel = { id: 'side', group: { element, panels: [{}], minimumWidth: 320, minimumHeight: 248, api: { location: { type: 'floating' }, isMaximized: () => false } } };
  const api = { ...viewport, panels: [panel], activePanel: { api: { setActive: () => active++ } }, addFloatingGroup(existing: unknown, next: typeof bounds) { expect(existing).toBe(panel); bounds = next; } };
  const root = { isConnected: true, closest: () => null, getBoundingClientRect: () => ({ x: 0, y: 0, ...viewport }) };
  const dispose = registerChatWindowLayout({ workspaceId: 'd', api: () => api as any, root: () => root as any, available: () => true, identity: () => ({ droneId: 'd', chatName: 'side', kind: 'side_chat' }), layer: 0, persist: (_, next) => { persisted = next; } });
  try {
    const source = collectChatWindows('d')[0]!;
    expect(source.windows[0]!.minimumHeight).toBe(248);
    source.windows[0]!.apply({ x: 0, y: 0, width: 600, height: 400 }, 0);
    source.windows[0]!.restoreFocus();
    source.windows[0]!.setOrder(3);
    expect(persisted).toEqual(bounds);
    expect(active).toBe(1);
    expect(level).toBe('3');
    expect(frame.style.zIndex).toContain('+ 6');
    expect(collectChatWindows('other')).toEqual([]);
    panel.group.api.location.type = 'grid';
    expect(collectChatWindows('d')[0]!.windows).toEqual([]);
    dispose();
    expect(collectChatWindows('d')).toEqual([]);
  } finally { dispose(); Object.assign(globalThis, { window: oldWindow }); }
});
