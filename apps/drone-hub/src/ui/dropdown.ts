import * as React from 'react';

export const dropdownPanelBaseClass =
  'rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] shadow-[0_16px_48px_rgba(0,0,0,.3)] overflow-hidden animate-slide-up';

export const dropdownMenuItemBaseClass = 'w-full text-left px-3 py-2 text-[11px] font-semibold transition-colors focus:outline-none';

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
