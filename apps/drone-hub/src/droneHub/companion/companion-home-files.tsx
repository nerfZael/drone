import React from 'react';

const OPEN_EVENT = 'drone-hub:companion-home-files';
/** Dispatched when the Hub reports that something in Companion home changed on disk. */
export const COMPANION_HOME_CHANGED_EVENT = 'drone-hub:companion-home-changed';
// The explorer and editor are heavy; load them only when the window is first opened.
const CompanionHomeFilesDialog = React.lazy(() => import('./CompanionHomeFilesDialog'));

/** A path from a Companion reply: relative to Companion home, or absolute inside it. */
export type CompanionHomeTarget = { path: string; line?: number | null; column?: number | null };

export function openCompanionHomeFiles(target?: CompanionHomeTarget): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: target }));
}

/** Lives beside the overlay rather than inside it, so closing or hiding Companion never discards open editors. */
export function CompanionHomeFiles() {
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState<(CompanionHomeTarget & { sequence: number }) | null>(null);
  React.useEffect(() => {
    let sequence = 0;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<CompanionHomeTarget | undefined>).detail;
      if (detail?.path) setTarget({ ...detail, sequence: ++sequence });
      setOpen(true);
      // The click may come from the floating window; the files open in the main one.
      window.droneHubDesktop?.companionWindow?.control('focus-owner');
      window.focus();
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  return open ? <React.Suspense fallback={null}><CompanionHomeFilesDialog target={target} onClose={() => { setOpen(false); setTarget(null); }} /></React.Suspense> : null;
}
