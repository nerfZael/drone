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
  tone?: 'neutral' | 'danger';
  onSelect: () => void;
};

export function SidebarContextMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: SidebarContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const padding = 6;
    setPosition({
      left: Math.max(padding, Math.min(x, window.innerWidth - menu.offsetWidth - padding)),
      top: Math.max(padding, Math.min(y, window.innerHeight - menu.offsetHeight - padding)),
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  React.useEffect(() => {
    const dismissFromPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const dismissFromKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const dismissFromViewportChange = () => onClose();
    window.addEventListener('pointerdown', dismissFromPointer);
    window.addEventListener('keydown', dismissFromKey);
    window.addEventListener('blur', dismissFromViewportChange);
    window.addEventListener('resize', dismissFromViewportChange);
    window.addEventListener('scroll', dismissFromViewportChange, true);
    return () => {
      window.removeEventListener('pointerdown', dismissFromPointer);
      window.removeEventListener('keydown', dismissFromKey);
      window.removeEventListener('blur', dismissFromViewportChange);
      window.removeEventListener('resize', dismissFromViewportChange);
      window.removeEventListener('scroll', dismissFromViewportChange, true);
    };
  }, [onClose]);

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
            role="menuitem"
            disabled={item.disabled}
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
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut ? (
              <span className="ml-4 shrink-0 font-mono text-[length:var(--text-11)] text-[var(--muted-dim)] opacity-75">
                {item.shortcut}
              </span>
            ) : null}
          </button>
        </React.Fragment>
      ))}
    </div>
  );

  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
}
