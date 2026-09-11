import { collectChatWindows, CHAT_LAYOUT_UNDO } from './chat-window-layout-events';
import { planChatWindowLayout, type LayoutRequest, type Rect } from './planChatWindowLayout';

export class ChatWindowLayoutController {
  private signature = '';
  private revision = 0;
  private previous: { workspaceId: string; revision: string; bounds: Map<string, Rect>; order: Map<string, number> } | null = null;

  read(workspaceId: string) {
    const sources = collectChatWindows(workspaceId);
    if (!sources.length) return { supported: false as const, workspaceId, reason: 'No desktop floating-chat workspace is available' };
    const viewport = { width: sources[0]!.width, height: sources[0]!.height };
    if (sources.some(s => Math.abs(s.width - viewport.width) > 1 || Math.abs(s.height - viewport.height) > 1)) throw new Error('LAYOUT_NOT_READY');
    const windows = sources.flatMap(s => s.windows).sort((a, b) => a.layer - b.layer).map(({ apply, restoreFocus, setOrder, ...w }) => w);
    const signature = JSON.stringify({ workspaceId, viewport, windows: windows.map(({ focused, ...w }) => w) });
    if (this.signature !== signature) { this.signature = signature; this.revision++; }
    return { supported: true as const, workspaceId, layoutRevision: String(this.revision), viewport, windows,
      coordinateUnits: 'pixels; area and custom placement inputs use workspace fractions',
      limitations: 'Only unmaximized, single-tab floating groups are movable. Detached chats render above side chats.' };
  }

  arrange(workspaceId: string, args: Record<string, unknown>) {
    const current = this.read(workspaceId);
    if (!current.supported) throw new Error('CHAT_LAYOUT_UNSUPPORTED');
    if (args.workspaceId !== workspaceId || args.layoutRevision !== current.layoutRevision) throw new Error('STALE_CHAT_LAYOUT: read get_chat_window_layout again');
    const request = args as unknown as LayoutRequest;
    let planned: Map<string, Rect>;
    if (request.mode === 'undo') {
      if (!this.previous || this.previous.workspaceId !== workspaceId || this.previous.revision !== current.layoutRevision) throw new Error('NO_CURRENT_LAYOUT_UNDO');
      planned = this.previous.bounds;
    } else planned = planChatWindowLayout(current.viewport, current.windows, request);
    const handles = collectChatWindows(workspaceId).flatMap(s => s.windows);
    const before = new Map(handles.filter(w => planned.has(w.windowId)).map(w => [w.windowId, w.bounds]));
    const oldOrder = new Map(handles.map(w => [w.windowId, w.zIndex ?? 0]));
    const topOrder = Math.max(0, ...oldOrder.values()) + 1;
    const desiredOrder = request.mode === 'undo' ? this.previous!.order : new Map([...planned.keys()].map((id, i) => [id, topOrder + i]));
    const activeElement = document.activeElement as HTMLElement | null;
    let applied = false;
    try {
      let order = 0;
      for (const [id, bounds] of planned) {
        const handle = handles.find(w => w.windowId === id);
        if (!handle) throw new Error('STALE_CHAT_LAYOUT');
        handle.apply(bounds, order++);
      }
      applied = true;
    } catch (error) {
      for (const handle of handles) { const rect = before.get(handle.windowId); if (rect) handle.apply(rect, 0); }
      throw error;
    } finally {
      handles.forEach(w => w.restoreFocus());
      activeElement?.focus({ preventScroll: true });
      if (!applied) handles.forEach(w => w.setOrder(oldOrder.get(w.windowId) ?? 0));
    }
    handles.forEach(w => { const order = desiredOrder.get(w.windowId); if (order !== undefined) w.setOrder(order); });
    const result = this.read(workspaceId);
    this.previous = request.mode === 'undo' ? null : { workspaceId, revision: result.supported ? result.layoutRevision : '', bounds: before, order: oldOrder };
    window.dispatchEvent(new CustomEvent(CHAT_LAYOUT_UNDO, { detail: { workspaceId, undo: this.previous ? () => this.arrange(workspaceId, { workspaceId, layoutRevision: this.previous!.revision, mode: 'undo' }) : null } }));
    return { ok: true, ...result };
  }
}
