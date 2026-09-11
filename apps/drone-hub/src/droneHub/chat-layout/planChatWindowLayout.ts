export type Rect = { x: number; y: number; width: number; height: number };
export type LayoutWindow = { windowId: string; droneId: string; chatName: string; kind: string; bounds: Rect; minimumWidth: number; minimumHeight: number; layer: number; zIndex?: number; focused?: boolean };
export type LayoutRequest = {
  workspaceId: string; layoutRevision: string; windows?: 'all_floating' | string[];
  mode: 'tile' | 'pack' | 'stack' | 'custom' | 'undo';
  area?: Rect; columns?: number; gap?: number;
  anchor?: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  offset?: { x: number; y: number }; size?: { width: number; height: number };
  placements?: { windowId: string; bounds: Rect }[];
};

/** Pure, pixel-space planning. Area and custom rectangles use workspace fractions. */
export function planChatWindowLayout(viewport: { width: number; height: number }, windows: LayoutWindow[], request: LayoutRequest): Map<string, Rect> {
  if (!['tile', 'pack', 'stack', 'custom'].includes(request.mode)) throw new Error('INVALID_LAYOUT_MODE');
  const ids = request.windows === undefined || request.windows === 'all_floating' ? windows.map(w => w.windowId) : request.windows;
  if (Array.isArray(ids) && !ids.length) throw new Error('NO_FLOATING_CHAT_WINDOWS');
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('INVALID_WINDOW_SELECTION');
  const selected = ids.map(id => { const w = windows.find(w => w.windowId === id); if (!w) throw new Error('WINDOW_NOT_FOUND'); return w; });
  const area = scale(request.area ?? { x: 0, y: 0, width: 1, height: 1 }, viewport);
  const gap = request.gap ?? 8;
  if (!Number.isFinite(gap) || gap < 0 || gap > 128) throw new Error('INVALID_GAP');
  const anchor = request.anchor ?? 'bottom_right';
  if (!['top_left', 'top_right', 'bottom_left', 'bottom_right'].includes(anchor)) throw new Error('INVALID_ANCHOR');
  if (request.size && (![request.size.width, request.size.height].every(v => Number.isFinite(v) && v > 0))) throw new Error('INVALID_SIZE');
  if (['stack', 'custom'].includes(request.mode) && selected.some((w, i) => i > 0 && w.layer < selected[i - 1]!.layer)) throw new Error('WINDOW_LAYER_ORDER: detached windows must follow side chats');
  const n = selected.length;
  let rectangles: Rect[];
  if (request.mode === 'custom') {
    if (!Array.isArray(request.placements) || request.placements.length !== n || new Set(request.placements.map(p => p.windowId)).size !== n) throw new Error('INVALID_PLACEMENTS');
    rectangles = selected.map(w => { const p = request.placements!.find(p => p.windowId === w.windowId); if (!p) throw new Error('INVALID_PLACEMENTS'); return scale(p.bounds, viewport); });
  } else if (request.mode === 'stack') {
    const offset = request.offset ?? { x: 32, y: 32 };
    if (![offset.x, offset.y].every(v => Number.isFinite(v) && v >= 0)) throw new Error('INVALID_OFFSET');
    // Detached windows live above side-chat windows in the existing workspace.
    if (selected.some((w, i) => i > 0 && w.layer < selected[i - 1]!.layer)) throw new Error('WINDOW_LAYER_ORDER: detached windows must follow side chats');
    const width = request.size?.width ?? Math.max(...selected.map(w => w.bounds.width));
    const height = request.size?.height ?? Math.max(...selected.map(w => w.bounds.height));
    const totalWidth = width + offset.x * (n - 1), totalHeight = height + offset.y * (n - 1);
    const x = area.x + (anchor.endsWith('right') ? area.width - totalWidth : 0);
    const y = area.y + (anchor.startsWith('bottom') ? area.height - totalHeight : 0);
    rectangles = selected.map((_, i) => ({ x: x + offset.x * i, y: y + offset.y * i, width, height }));
  } else {
    const candidates = request.columns === undefined ? Array.from({ length: n }, (_, i) => i + 1) : [request.columns];
    if (candidates.some(c => !Number.isInteger(c) || c < 1 || c > n)) throw new Error('INVALID_COLUMNS');
    let best: { score: number; rectangles: Rect[] } | undefined;
    for (const columns of candidates) {
      if (request.mode === 'tile' && n % columns !== 0) continue;
      const rows = Math.ceil(n / columns);
      const maxWidth = (area.width - gap * (columns - 1)) / columns;
      const maxHeight = (area.height - gap * (rows - 1)) / rows;
      const width = request.mode === 'tile' ? maxWidth : Math.min(maxWidth, request.size?.width ?? Math.max(...selected.map(w => w.bounds.width)));
      const height = request.mode === 'tile' ? maxHeight : Math.min(maxHeight, request.size?.height ?? Math.max(...selected.map(w => w.bounds.height)));
      const result = selected.map((_, i) => {
        const row = Math.floor(i / columns), col = i % columns;
        const rowCount = Math.min(columns, n - row * columns);
        const w = request.mode === 'tile' ? (area.width - gap * (rowCount - 1)) / rowCount : width;
        return { x: area.x + (request.mode === 'pack' && anchor.endsWith('right') ? area.width - (col + 1) * w - col * gap : col * (w + gap)),
          y: area.y + (request.mode === 'pack' && anchor.startsWith('bottom') ? area.height - (row + 1) * height - row * gap : row * (height + gap)), width: w, height };
      });
      if (!result.every((r, i) => fits(r, selected[i]!, area))) continue;
      const score = request.mode === 'tile' ? Math.abs(Math.log(width / height / 1.5)) : -(width * height) + columns * rows;
      if (!best || score < best.score) best = { score, rectangles: result };
    }
    if (!best) throw new Error('LAYOUT_DOES_NOT_FIT');
    rectangles = best.rectangles;
  }
  if (!rectangles.every((r, i) => fits(r, selected[i]!, area))) throw new Error('LAYOUT_DOES_NOT_FIT');
  if (request.mode === 'tile' || request.mode === 'pack') {
    const others = windows.filter(w => !ids.includes(w.windowId));
    if (rectangles.some(r => others.some(w => overlaps(r, w.bounds)))) throw new Error('LAYOUT_DOES_NOT_FIT: unselected windows occupy this area');
  }
  return new Map(selected.map((w, i) => [w.windowId, rectangles[i]!]));
}

function scale(r: Rect, viewport: { width: number; height: number }): Rect {
  if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001) throw new Error('INVALID_LAYOUT_RECT');
  return { x: r.x * viewport.width, y: r.y * viewport.height, width: r.width * viewport.width, height: r.height * viewport.height };
}
function fits(r: Rect, w: LayoutWindow, area: Rect): boolean {
  return Object.values(r).every(Number.isFinite) && r.width >= w.minimumWidth && r.height >= w.minimumHeight && r.x >= area.x - .01 && r.y >= area.y - .01 && r.x + r.width <= area.x + area.width + .01 && r.y + r.height <= area.y + area.height + .01;
}
function overlaps(a: Rect, b: Rect): boolean { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
