import * as React from 'react';

export function useDropdownDismiss(
  menuRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  React.useEffect(() => {
    if (!open) return undefined;

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
