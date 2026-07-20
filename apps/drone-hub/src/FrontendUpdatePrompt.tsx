import React from 'react';

type FrontendVersionResponse = {
  buildId?: unknown;
  buildTime?: unknown;
};

type FrontendUpdateState = {
  available: boolean;
  checking: boolean;
  buildId: string | null;
  buildTime: string | null;
};

const CURRENT_BUILD_ID = typeof __DRONE_HUB_BUILD_ID__ === 'string' ? __DRONE_HUB_BUILD_ID__ : 'dev';
const CHECK_INTERVAL_MS = 60_000;

function normalizeVersion(data: FrontendVersionResponse): { buildId: string; buildTime: string | null } | null {
  const buildId = typeof data.buildId === 'string' ? data.buildId.trim() : '';
  if (!buildId) return null;
  const buildTime = typeof data.buildTime === 'string' && data.buildTime.trim() ? data.buildTime.trim() : null;
  return { buildId, buildTime };
}

function reloadFrontend(): void {
  window.location.reload();
}

export function useFrontendUpdatePrompt(): FrontendUpdateState & { checkNow: () => Promise<void>; reload: () => void } {
  const [state, setState] = React.useState<FrontendUpdateState>({
    available: false,
    checking: false,
    buildId: null,
    buildTime: null,
  });
  const checkingRef = React.useRef(false);
  const hasControllerRef = React.useRef(typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller));

  const checkNow = React.useCallback(async () => {
    if (import.meta.env.DEV || CURRENT_BUILD_ID === 'dev' || checkingRef.current) return;
    checkingRef.current = true;
    setState((current) => ({ ...current, checking: true }));
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return;
      const version = normalizeVersion((await response.json()) as FrontendVersionResponse);
      if (!version) return;
      if (version.buildId !== CURRENT_BUILD_ID) {
        void navigator.serviceWorker?.getRegistration?.().then((registration) => registration?.update()).catch(() => {});
        setState({ available: true, checking: false, buildId: version.buildId, buildTime: version.buildTime });
      } else {
        setState({ available: false, checking: false, buildId: version.buildId, buildTime: version.buildTime });
      }
    } catch {
      // Keep the current app running if the version probe is unavailable.
    } finally {
      checkingRef.current = false;
      setState((current) => (current.checking ? { ...current, checking: false } : current));
    }
  }, []);

  React.useEffect(() => {
    if (import.meta.env.DEV || CURRENT_BUILD_ID === 'dev') return undefined;
    void checkNow();
    const interval = window.setInterval(() => void checkNow(), CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkNow();
    };
    const onFocus = () => void checkNow();
    const onControllerChange = () => {
      if (hasControllerRef.current) {
        setState((current) => ({ ...current, available: true, checking: false }));
      }
      hasControllerRef.current = true;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    navigator.serviceWorker?.addEventListener?.('controllerchange', onControllerChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      navigator.serviceWorker?.removeEventListener?.('controllerchange', onControllerChange);
    };
  }, [checkNow]);

  return { ...state, checkNow, reload: reloadFrontend };
}

export function FrontendUpdatePrompt() {
  const update = useFrontendUpdatePrompt();
  if (!update.available) return null;

  return (
    <div className="fixed bottom-3 left-3 right-3 z-[90] flex justify-center pointer-events-none md:bottom-4">
      <div
        className="pointer-events-auto flex w-full max-w-[420px] items-center justify-between gap-3 rounded border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2 shadow-[0_16px_50px_var(--shadow-color)]"
        role="status"
        aria-live="polite"
      >
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[var(--fg)]">New Drone Hub is ready</div>
          <div className="truncate text-[11px] text-[var(--muted)]">
            Refresh to load the latest frontend.
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded border border-[var(--accent-muted)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-fg)] hover:brightness-110"
          onClick={update.reload}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
