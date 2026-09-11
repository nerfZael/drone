import type { LayoutWindow, Rect } from './planChatWindowLayout';

export type WindowHandle = LayoutWindow & { apply(bounds: Rect, order: number): void; setOrder(order: number): void; restoreFocus(): void };
export type LayoutCollection = { workspaceId: string; sources: { width: number; height: number; windows: WindowHandle[] }[] };
export const CHAT_LAYOUT_READ = 'drone-hub:collect-chat-layout';
export const CHAT_LAYOUT_UNDO = 'drone-hub:chat-layout-undo';

export function collectChatWindows(workspaceId: string): LayoutCollection['sources'] {
  const detail: LayoutCollection = { workspaceId, sources: [] };
  window.dispatchEvent(new CustomEvent(CHAT_LAYOUT_READ, { detail }));
  return detail.sources;
}
