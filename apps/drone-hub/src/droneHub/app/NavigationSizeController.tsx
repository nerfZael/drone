import React from 'react';
import {
  clampWorkspaceExplorerZoom,
  readWorkspaceExplorerZoom,
  WORKSPACE_EXPLORER_ZOOM_DEFAULT,
  WORKSPACE_EXPLORER_ZOOM_STEP,
  writeWorkspaceExplorerZoom,
} from './workspace-explorer-preferences';

export type NavigationZoomAction = 'in' | 'out' | 'reset';

const TOAST_DURATION_MS = 1_200;

export function normalizeNavigationZoomAction(value: unknown): NavigationZoomAction | null {
  return value === 'in' || value === 'out' || value === 'reset' ? value : null;
}

export function navigationZoomActionForKeyboardEvent(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey'>,
): NavigationZoomAction | null {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
  const key = event.key.toLowerCase();
  const code = event.code.toLowerCase();
  if (key === '+' || key === '=' || key === 'add' || code === 'numpadadd') return 'in';
  if (key === '-' || key === '_' || key === 'subtract' || code === 'numpadsubtract') return 'out';
  if (key === '0' || code === 'numpad0') return 'reset';
  return null;
}

export function nextNavigationExplorerZoom(
  current: number,
  action: NavigationZoomAction,
): number {
  if (action === 'reset') return WORKSPACE_EXPLORER_ZOOM_DEFAULT;
  const offset = action === 'in' ? WORKSPACE_EXPLORER_ZOOM_STEP : -WORKSPACE_EXPLORER_ZOOM_STEP;
  return clampWorkspaceExplorerZoom(current + offset);
}

export function NavigationSizeController() {
  const [toast, setToast] = React.useState<string | null>(null);
  const dismissTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const bridge = window.droneHubDesktop;
    let lastApplication: {
      action: NavigationZoomAction;
      source: 'bridge' | 'keyboard';
      timestamp: number;
    } | null = null;

    const applyAction = (
      action: NavigationZoomAction,
      source: 'bridge' | 'keyboard',
    ) => {
      const timestamp = window.performance.now();
      if (
        lastApplication?.action === action &&
        lastApplication.source !== source &&
        timestamp - lastApplication.timestamp < 100
      ) {
        return;
      }
      lastApplication = { action, source, timestamp };

      const explorerZoom = nextNavigationExplorerZoom(readWorkspaceExplorerZoom(), action);
      writeWorkspaceExplorerZoom(explorerZoom);

      setToast(`Navigation items ${Math.round(explorerZoom * 100)}%`);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => {
        dismissTimer.current = null;
        setToast(null);
      }, TOAST_DURATION_MS);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const action = navigationZoomActionForKeyboardEvent(event);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyAction(action, 'keyboard');
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    const unsubscribe = bridge?.onNavigationZoom((payload) => {
      const action = normalizeNavigationZoomAction(payload?.action);
      if (action) applyAction(action, 'bridge');
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      unsubscribe?.();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] shadow-[0_12px_36px_var(--shadow-color)] animate-slide-up"
    >
      {toast}
    </div>
  );
}
