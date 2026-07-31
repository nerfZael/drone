import React from 'react';

const ZOOM_TOAST_DURATION_MS = 1_200;

export function normalizeDesktopZoomPercent(value: unknown): number | null {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 50 || percent > 200) return null;
  return Math.round(percent);
}

export function DesktopZoomToast() {
  const [percent, setPercent] = React.useState<number | null>(null);
  const dismissTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const bridge = window.droneHubDesktop;
    if (!bridge) return undefined;

    const unsubscribe = bridge.onZoomChanged((payload) => {
      const nextPercent = normalizeDesktopZoomPercent(payload?.percent);
      if (nextPercent == null) return;
      setPercent(nextPercent);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => {
        dismissTimer.current = null;
        setPercent(null);
      }, ZOOM_TOAST_DURATION_MS);
    });

    return () => {
      unsubscribe();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  if (percent == null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Zoom ${percent}%`}
      className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] tabular-nums text-[var(--fg-secondary)] shadow-[0_12px_36px_var(--shadow-color)] animate-slide-up"
    >
      {percent}%
    </div>
  );
}
