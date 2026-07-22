import * as React from 'react';

export const dropdownPanelBaseClass =
  'rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-raised)] shadow-[0_16px_48px_var(--shadow-color)] overflow-hidden animate-slide-up';

export const dropdownMenuItemBaseClass = 'w-full text-left px-3 py-2.5 text-[var(--text-11)] font-[var(--weight-semibold)] transition-colors focus:outline-none';

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
