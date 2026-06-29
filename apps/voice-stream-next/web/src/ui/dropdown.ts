import * as React from 'react';

export function useDropdownDismiss(
  menuRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: React.Dispatch<React.SetStateAction<boolean>>,
  ...additionalRefs: Array<React.RefObject<HTMLElement | null>>
): void {
  const additionalRefsRef = React.useRef(additionalRefs);
  additionalRefsRef.current = additionalRefs;

  React.useEffect(() => {
    if (!open) return undefined;

    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      const refs = [menuRef, ...additionalRefsRef.current];
      if (refs.some((ref) => ref.current?.contains(event.target as Node))) return;
      setOpen(false);
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
