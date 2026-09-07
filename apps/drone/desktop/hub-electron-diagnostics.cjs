const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DIAGNOSTICS_CHANNEL = 'drone-hub:diagnostic';

function cleanText(value, limit = 8000) {
  return String(value ?? '').slice(0, limit)
    .replace(/([?&](?:token|key|api_key|access_token|authorization)=)[^&#\s)]+/gi, '$1[redacted]')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]');
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:', 'file:'].includes(url.protocol)
      ? `${url.protocol}//${url.host}${url.pathname}`.slice(0, 2000)
      : url.protocol;
  } catch {
    return '';
  }
}

// Allow only diagnostic metadata across the renderer boundary. In particular,
// never serialize arbitrary application state, message bodies, or file contents.
function normalizeRendererDiagnostic(input) {
  if (!input || typeof input !== 'object' || !['error', 'breadcrumb'].includes(input.type)) return null;
  const out = { type: input.type };
  for (const key of ['id', 'sessionId', 'buildId', 'kind', 'at', 'droneId', 'chatName', 'path', 'action']) {
    if (typeof input[key] === 'string') out[key] = cleanText(input[key], 2000);
  }
  for (const key of ['message', 'stack', 'componentStack']) {
    if (typeof input[key] === 'string') out[key] = cleanText(input[key], key === 'message' ? 4000 : 12000);
  }
  if (typeof input.url === 'string') out.url = cleanUrl(input.url);
  if (typeof input.source === 'string') out.source = cleanUrl(input.source);
  for (const key of ['line', 'column']) {
    if (Number.isSafeInteger(input[key]) && input[key] >= 0) out[key] = input[key];
  }
  return out;
}

function createDesktopDiagnostics({ logPath, maxBytes = 5 * 1024 * 1024, now = Date.now }) {
  const sessionId = randomUUID();
  let hubLogPath = null;
  let uiBuild = null;
  const breadcrumbs = [];
  let rateStart = now();
  let errorCount = 0;
  let actionCount = 0;
  let suppressed = 0;

  function write(kind, details = {}, level = 'error') {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      if (fs.existsSync(logPath) && fs.statSync(logPath).size >= maxBytes) {
        fs.rmSync(`${logPath}.2`, { force: true });
        if (fs.existsSync(`${logPath}.1`)) fs.renameSync(`${logPath}.1`, `${logPath}.2`);
        fs.renameSync(logPath, `${logPath}.1`);
      }
      const entry = {
        at: new Date(now()).toISOString(), level, kind, sessionId, pid: process.pid,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        uiBuild, details,
        ...(level === 'error' ? { breadcrumbs: breadcrumbs.slice(), memory: process.memoryUsage() } : {}),
      };
      const line = `${JSON.stringify(entry)}\n`;
      // Synchronous writes also preserve evidence during fatal main-process exits.
      fs.appendFileSync(logPath, line, { mode: 0o600 });
      if (hubLogPath && level === 'error') {
        try { fs.appendFileSync(hubLogPath, `[DroneHubDesktop] ${line}`); } catch { /* Local log remains available. */ }
      }
      return true;
    } catch {
      return false; // Logging must never take down the app.
    }
  }

  function renderer(input) {
    const record = normalizeRendererDiagnostic(input);
    if (!record) return false;
    if (now() - rateStart >= 60_000) {
      if (suppressed) write('diagnostics-suppressed', { count: suppressed }, 'warn');
      rateStart = now(); errorCount = 0; actionCount = 0; suppressed = 0;
    }
    // Bound disk activity during console/error loops without losing the first failure.
    if (record.type === 'error' ? ++errorCount > 60 : ++actionCount > 120) { suppressed++; return false; }
    if (record.type === 'breadcrumb') {
      breadcrumbs.push(record);
      if (breadcrumbs.length > 30) breadcrumbs.shift();
    }
    return write(record.type === 'error' ? 'renderer-error' : 'renderer-action', record,
      record.type === 'error' ? 'error' : 'info');
  }

  return {
    write, renderer,
    setHubLogPath(value) { hubLogPath = typeof value === 'string' && path.isAbsolute(value) ? value : null; },
    setUiBuild(value) { uiBuild = value; },
  };
}

function observeWindowDiagnostics(window, diagnostics) {
  const contents = window.webContents;
  // Includes a missing entry bundle, before the UI can install its own handlers.
  contents.session?.webRequest.onErrorOccurred((details) => {
    if (details.webContentsId !== contents.id || details.error === 'net::ERR_ABORTED' ||
        !['mainFrame', 'script', 'stylesheet'].includes(details.resourceType)) return;
    diagnostics.renderer({ type: 'error', kind: 'resource-load-error', message: details.error, url: details.url });
  });
  contents.on('console-message', (event) => {
    if (event.level !== 'error') return;
    diagnostics.renderer({ type: 'error', kind: `console-${event.level}`, message: event.message,
      url: event.sourceId, line: event.lineNumber });
  });
  contents.on('preload-error', (_event, preloadPath, error) => {
    diagnostics.write('preload-error', { path: preloadPath, message: cleanText(error.message), stack: cleanText(error.stack, 12000) });
  });
  contents.on('render-process-gone', (_event, details) => {
    diagnostics.write('render-process-gone', { ...details, url: cleanUrl(contents.getURL()) });
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (code === -3) return; // A superseded navigation is not a load failure.
    diagnostics.write('did-fail-load', { code, description: cleanText(description), url: cleanUrl(url), isMainFrame });
  });
  window.on('unresponsive', () => diagnostics.write('window-unresponsive', { url: cleanUrl(contents.getURL()) }));
  window.on('responsive', () => diagnostics.write('window-responsive', {}, 'info'));
}

module.exports = { DIAGNOSTICS_CHANNEL, createDesktopDiagnostics, observeWindowDiagnostics, normalizeRendererDiagnostic, cleanText };
