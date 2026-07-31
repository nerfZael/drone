import * as React from 'react';

export const dropdownPanelBaseClass =
  'rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] shadow-[var(--edge-highlight),var(--shadow-menu)] backdrop-blur-md overflow-hidden animate-menu-in motion-reduce:animate-none';

export const dropdownMenuItemBaseClass = 'w-full text-left px-3 py-2.5 dh-type-menu-item transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:bg-[var(--hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]';

export const contextMenuPanelBaseClass = `${dropdownPanelBaseClass} p-1`;

export const contextMenuItemBaseClass =
  'flex min-h-8 w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left dh-type-menu-item transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40';

export const contextMenuSeparatorClass =
  '-mx-1 my-1 border-t border-[var(--border-subtle)] opacity-70';

export type DropdownVerticalPlacement = 'above' | 'below';

type DropdownVerticalPlacementArgs = {
  anchorTop: number;
  anchorBottom: number;
  panelHeight: number;
  viewportTop?: number;
  viewportBottom: number;
  gap?: number;
};

export function chooseDropdownVerticalPlacement({
  anchorTop,
  anchorBottom,
  panelHeight,
  viewportTop = 0,
  viewportBottom,
  gap = 4,
}: DropdownVerticalPlacementArgs): DropdownVerticalPlacement {
  const spaceAbove = Math.max(0, anchorTop - viewportTop - gap);
  const spaceBelow = Math.max(0, viewportBottom - anchorBottom - gap);
  if (spaceBelow >= panelHeight) return 'below';
  if (spaceAbove >= panelHeight) return 'above';
  return spaceBelow >= spaceAbove ? 'below' : 'above';
}

export function dropdownViewportBounds(element: HTMLElement): {
  top: number;
  bottom: number;
} {
  let parent = element.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY)) {
      const rect = parent.getBoundingClientRect();
      return {
        top: Math.max(0, rect.top),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
    }
    parent = parent.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

export function useDropdownDismiss(
  menuRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
): void {
  React.useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) setOpen(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuRef, open, setOpen]);
}
