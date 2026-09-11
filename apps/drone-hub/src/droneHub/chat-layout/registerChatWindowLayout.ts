import type { DockviewApi } from 'dockview';
import { measureSideChatBounds } from '../app/side-chat-workspace-state';
import { CHAT_LAYOUT_READ, type LayoutCollection, type WindowHandle } from './chat-window-layout-events';
import type { Rect } from './planChatWindowLayout';

type Options = {
  workspaceId: string; api(): DockviewApi | null; root(): HTMLElement | null; available(): boolean;
  identity(panelId: string): { droneId: string; chatName: string; kind: string } | null;
  layer: number; persist(panelId: string, bounds: Rect): void;
};

export function registerChatWindowLayout(options: Options): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<LayoutCollection>).detail;
    if (detail.workspaceId !== options.workspaceId || !options.available()) return;
    const api = options.api(), root = options.root();
    if (!api || !root?.isConnected || root.closest('[aria-hidden="true"]') || api.width <= 0 || api.height <= 0) return;
    const visibleBounds = root.getBoundingClientRect();
    if (visibleBounds.width <= 0 || visibleBounds.height <= 0) return;
    const active = api.activePanel;
    const windows: WindowHandle[] = [];
    for (const panel of api.panels) {
      const identity = options.identity(panel.id);
      if (!identity || panel.group.api.location.type !== 'floating') continue;
      // Moving one tab in a shared group would change the user's docking structure.
      if (panel.group.panels.length !== 1 || panel.group.api.isMaximized()) continue;
      const bounds = measureSideChatBounds(panel.group.element, root);
      const container = () => panel.group.element.closest<HTMLElement>('.dv-resize-container');
      windows.push({ ...identity, zIndex: Number(container()?.getAttribute('aria-level') ?? 0), focused: Boolean(panel.group.element.querySelector('[data-side-chat-active]')),  windowId: `${options.layer}:${panel.id}`, bounds,
        minimumWidth: Math.max(1, panel.group.minimumWidth ?? 320), minimumHeight: Math.max(1, panel.group.minimumHeight ?? 220), layer: options.layer,
        apply(next, order) {
          api.addFloatingGroup(panel, next);

          options.persist(panel.id, next);
        },
        setOrder(order) { const element = container(); if (element) { element.setAttribute('aria-level', String(order)); element.style.zIndex = `calc(var(--dv-overlay-z-index, 999) + ${order * 2})`; } },
        restoreFocus() { active?.api.setActive(); },
      });
    }
    detail.sources.push({ width: api.width, height: api.height, windows });
  };
  window.addEventListener(CHAT_LAYOUT_READ, listener);
  return () => window.removeEventListener(CHAT_LAYOUT_READ, listener);
}
