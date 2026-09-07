type DiagnosticAction = {
  action: string;
  droneId?: string;
  chatName?: string;
  path?: string;
  line?: number | null;
  column?: number | null;
};

let installed = false;
let sessionId = '';
const seenErrors = new WeakMap<object, string>();

function emit(record: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') return;
    if (!sessionId) sessionId = crypto.randomUUID();
    const payload = {
      ...record,
      at: new Date().toISOString(), sessionId,
      buildId: typeof __DRONE_HUB_BUILD_ID__ === 'string' ? __DRONE_HUB_BUILD_ID__ : 'development',
      url: `${location.origin}${location.pathname}`,
    };
    if (window.droneHubDesktop?.reportDiagnostic) window.droneHubDesktop.reportDiagnostic(payload);
    else if (record.type === 'error') console.error('[DroneHub] UI error', payload);
  } catch { /* Diagnostics must not interfere with the action or error recovery. */ }
}

export function recordUiAction(action: DiagnosticAction): void {
  emit({ type: 'breadcrumb', ...action });
}

export function reportUiError(kind: string, error: unknown, extra: { componentStack?: string; source?: string; line?: number; column?: number } = {}): string {
  let id = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    // Keep the React component stack even when the same Error reached window.onerror.
    if (error && typeof error === 'object') {
      const previousId = seenErrors.get(error);
      if (previousId && !extra.componentStack) return previousId;
      if (previousId) id = previousId;
      seenErrors.set(error, id);
    }
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    const stack = error instanceof Error ? error.stack : undefined;
    emit({ type: 'error', id, kind, message: message.slice(0, 4000), stack: stack?.slice(0, 12000), ...extra });
  } catch { /* Even malformed rejection values must not cause another failure. */ }
  return id;
}

export function installUiDiagnostics(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event: Event) => {
    if (event instanceof ErrorEvent) {
      reportUiError('uncaught-error', event.error ?? event.message, { source: event.filename, line: event.lineno, column: event.colno });
    } else if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement) {
      const target = event.target;
      const source = target instanceof HTMLScriptElement ? target.src : target.href;
      // Asset URLs can include credentials; strip their query and fragment.
      let asset = 'unknown asset';
      try { asset = new URL(source).pathname; } catch { /* Invalid resource URL. */ }
      reportUiError('asset-load-error', `Failed to load ${asset}`);
    }
  }, true);
  window.addEventListener('unhandledrejection', (event) => reportUiError('unhandled-rejection', event.reason));
  recordUiAction({ action: 'ui-startup' });
}

export function showStartupFailure(error: unknown): void {
  const id = reportUiError('startup-error', error);
  const root = document.getElementById('root');
  if (!root) return;
  const message = document.createElement('main');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'padding:48px;color:#e5e7eb;background:#11161e;font:16px system-ui;min-height:100vh';
  const title = document.createElement('h1');
  title.textContent = 'Drone Hub could not load';
  const text = document.createElement('p');
  text.textContent = `Reload the window to try again. Error reference: ${id}`;
  const button = document.createElement('button');
  button.textContent = 'Reload window';
  button.onclick = () => location.reload();
  message.append(title, text, button);
  root.replaceChildren(message);
}
