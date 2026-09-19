import React from 'react';
import { createPortal } from 'react-dom';
import {
  contextMenuItemBaseClass,
  contextMenuPanelBaseClass,
  contextMenuSeparatorClass,
} from '../../ui/dropdown';

export type SidebarContextMenuItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  separatorBefore?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Set for an on/off item; it is announced as a checkbox and shows a check mark when on. */
  checked?: boolean;
  tone?: 'neutral' | 'danger';
  onSelect: () => void;
};

export function SidebarContextMenu({
  x,
  y,
  label,
  items,
  onClose,
  view: ownView,
}: {
  x: number;
  y: number;
  label: string;
  items: SidebarContextMenuItem[];
  onClose: () => void;
  /** The window the menu opens in; a chat in its own desktop window passes that window. */
  view?: Window;
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  // Server rendering has no window; the effects below never run there.
  const view = ownView ?? (typeof window === 'undefined' ? (undefined as unknown as Window) : window);
  const [position, setPosition] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const padding = 6;
    setPosition({
      left: Math.max(padding, Math.min(x, view.innerWidth - menu.offsetWidth - padding)),
      top: Math.max(padding, Math.min(y, view.innerHeight - menu.offsetHeight - padding)),
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y, view]);

  React.useEffect(() => {
    const dismissFromPointer = (event: PointerEvent) => {
      // Not instanceof Node: a node in another window has that window's Node class.
      if (menuRef.current?.contains(event.target as Node | null)) return;
      onClose();
    };
    const dismissFromKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const dismissFromViewportChange = () => onClose();
    view.addEventListener('pointerdown', dismissFromPointer);
    view.addEventListener('keydown', dismissFromKey);
    view.addEventListener('blur', dismissFromViewportChange);
    view.addEventListener('resize', dismissFromViewportChange);
    view.addEventListener('scroll', dismissFromViewportChange, true);
    return () => {
      view.removeEventListener('pointerdown', dismissFromPointer);
      view.removeEventListener('keydown', dismissFromKey);
      view.removeEventListener('blur', dismissFromViewportChange);
      view.removeEventListener('resize', dismissFromViewportChange);
      view.removeEventListener('scroll', dismissFromViewportChange, true);
    };
  }, [onClose, view]);

  const moveFocus = (current: HTMLButtonElement, offset: -1 | 1) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    if (buttons.length === 0) return;
    const currentIndex = Math.max(0, buttons.indexOf(current));
    buttons[(currentIndex + offset + buttons.length) % buttons.length]?.focus();
  };

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className={`fixed z-[200] min-w-56 max-w-[calc(100vw-0.75rem)] ${contextMenuPanelBaseClass}`}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <React.Fragment key={item.id}>
          {item.separatorBefore && index > 0 ? (
            <div role="separator" className={contextMenuSeparatorClass} />
          ) : null}
          <button
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            disabled={item.disabled}
            title={item.disabledReason}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const buttons = Array.from(
                  menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
                );
                buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
              }
            }}
            className={`${contextMenuItemBaseClass} ${
              item.tone === 'danger'
                ? 'text-[var(--red)] hover:bg-[var(--red-subtle)]'
                : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
              {item.checked ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
              ) : item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.disabledReason && <span className="block text-11 font-normal whitespace-normal">{item.disabledReason}</span>}
            </span>
            {item.shortcut ? (
              <span className="ml-4 shrink-0 font-mono text-11 text-[var(--muted-dim)] opacity-75">
                {item.shortcut}
              </span>
            ) : null}
          </button>
        </React.Fragment>
      ))}
    </div>
  );

  return typeof document === 'undefined' ? menu : createPortal(menu, view.document.body);
}
