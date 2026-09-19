import React from 'react';
import { SidebarContextMenu, type SidebarContextMenuItem } from './SidebarContextMenu';

const NATIVE_MENU_TARGETS =
  'a[href], input, textarea, select, [contenteditable="true"], img, video, canvas, .monaco-editor, [role="menu"]';

/**
 * Right-clicks that keep the browser's own menu: on selected text (copy), in
 * fields (paste, spelling), on links and media. Elements from a chat's desktop
 * window belong to that window, so this reads them without instanceof checks.
 */
export function keepsNativeContextMenu(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (typeof element?.closest !== 'function') return true;
  if (element.closest(NATIVE_MENU_TARGETS)) return true;
  // Only a click on the selection itself; a selection left elsewhere in the window does not count.
  const selection = element.ownerDocument.defaultView?.getSelection();
  return Boolean(selection && selection.toString().trim() && selection.containsNode(element, true));
}

/**
 * A right-click menu for a chat surface. Put `onContextMenu` on the chat's
 * root element and render `menu` anywhere; the menu opens in whichever window
 * the click came from. With no items, right-click is left alone.
 */
export function useChatContextMenu(label: string, getItems: () => SidebarContextMenuItem[]) {
  const [open, setOpen] = React.useState<{ x: number; y: number; view: Window; items: SidebarContextMenuItem[] } | null>(null);
  const getItemsRef = React.useRef(getItems);
  getItemsRef.current = getItems;
  const onContextMenu = React.useCallback((event: React.MouseEvent) => {
    // React also bubbles events here from dialogs and popovers the chat opened; those are not the chat.
    if (!event.currentTarget.contains(event.target as Node | null)) return;
    if (event.defaultPrevented || keepsNativeContextMenu(event.target)) return;
    const items = getItemsRef.current();
    const view = (event.target as Element).ownerDocument.defaultView;
    if (items.length === 0 || !view) return;
    event.preventDefault();
    setOpen({ x: event.clientX, y: event.clientY, view, items });
  }, []);
  const close = React.useCallback(() => setOpen(null), []);
  const menu = open
    ? <SidebarContextMenu x={open.x} y={open.y} view={open.view} label={label} items={open.items} onClose={close} />
    : null;
  return { onContextMenu, menu };
}
