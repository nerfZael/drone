import React from 'react';
import type { RightPanelTab } from './app-config';

export const DEFAULT_PANE_MODULE_TIMEOUT_MS = 15_000;

export type AsyncPaneLoadState =
  | { status: 'loading' }
  | { status: 'timeout'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; component: React.ComponentType<any> };

export type PaneModuleLoader<T extends React.ComponentType<any> = React.ComponentType<any>> = () => Promise<T>;

export function paneModuleTimeoutMessage(label: string): string {
  return `${label} panel module is still loading. Retry after the current frontend finishes updating.`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? '').trim();
  return text || fallback;
}

type AsyncPaneBoundaryProps<T extends React.ComponentType<any>> = {
  tab: RightPanelTab;
  label: string;
  load: PaneModuleLoader<T>;
  timeoutMs?: number;
  loadingFallback: React.ReactNode;
  errorFallback: (message: string, retry: () => void) => React.ReactNode;
  children: (Component: T) => React.ReactNode;
};

export function AsyncPaneBoundary<T extends React.ComponentType<any>>({
  tab,
  label,
  load,
  timeoutMs = DEFAULT_PANE_MODULE_TIMEOUT_MS,
  loadingFallback,
  errorFallback,
  children,
}: AsyncPaneBoundaryProps<T>) {
  const [retryKey, setRetryKey] = React.useState(0);
  const request = React.useMemo(() => ({ load }), [tab, label, load, retryKey, timeoutMs]);
  const [result, setResult] = React.useState<{
    request: typeof request;
    state: AsyncPaneLoadState;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let settled = false;
    const setState = (state: AsyncPaneLoadState) => setResult({ request, state });
    setState({ status: 'loading' });

    const timeout = window.setTimeout(() => {
      if (cancelled || settled) return;
      setState({ status: 'timeout', message: paneModuleTimeoutMessage(label) });
    }, Math.max(1, Math.floor(timeoutMs)));

    void Promise.resolve().then(load)
      .then((component) => {
        settled = true;
        window.clearTimeout(timeout);
        if (!cancelled) setState({ status: 'ready', component });
      })
      .catch((error) => {
        settled = true;
        window.clearTimeout(timeout);
        if (!cancelled) setState({ status: 'error', message: errorMessage(error, `Failed to load ${label} panel module.`) });
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [label, load, request, timeoutMs]);

  // Editor and Changes reuse the same panel. Its render callback already has
  // the new pane's props before the loading effect runs; never pass that
  // callback a component (or error) belonging to the previous request.
  const state: AsyncPaneLoadState = result?.request === request ? result.state : { status: 'loading' };
  if (state.status === 'ready') return <>{children(state.component as T)}</>;
  if (state.status === 'error' || state.status === 'timeout') {
    return <>{errorFallback(state.message, () => setRetryKey((value) => value + 1))}</>;
  }
  return <>{loadingFallback}</>;
}
