const { randomUUID } = require('node:crypto');
const path = require('node:path');

const OPEN_HTML_PREVIEW_CHANNEL = 'drone-hub:html-preview-open';
const CHUNK_BYTES = 512 * 1024;
const MAX_DOCUMENT_BYTES = 512 * 1024 * 1024;

function previewPolicy(origin) {
  return `default-src 'none'; sandbox allow-scripts; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: ${origin}; media-src data: blob: ${origin}; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
}

// The main process retains at most one chunk per stream. Neither React nor IPC
// receives the document's contents. Pulls stop when the preview stops reading.
function streamHtmlDocument({ readChunk, signal, size }) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DOCUMENT_BYTES) throw new Error('Separate HTML previews support files up to 512 MiB.');
  let offset = 0;
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  return new ReadableStream({
    async pull(stream) {
      try {
        combined.throwIfAborted();
        const chunk = await readChunk(offset, CHUNK_BYTES, combined);
        if (!chunk.ok) throw new Error(chunk.error || 'Could not read HTML preview.');
        if (typeof chunk.dataBase64 !== 'string' || chunk.dataBase64.length > Math.ceil(CHUNK_BYTES / 3) * 4) throw new Error('Invalid HTML preview chunk.');
        const bytes = Buffer.from(chunk.dataBase64, 'base64');
        if (chunk.offset !== offset || chunk.nextOffset !== offset + bytes.length || (!chunk.eof && !bytes.length)) throw new Error('Invalid HTML preview chunk.');
        if (chunk.nextOffset > MAX_DOCUMENT_BYTES || chunk.nextOffset > size) throw new Error('The HTML file changed while loading. Reopen its preview.');
        offset = chunk.nextOffset;
        if (bytes.length) stream.enqueue(bytes);
        if (chunk.eof) {
          if (offset !== size) throw new Error('The HTML file changed while loading. Reopen its preview.');
          stream.close();
        }
      } catch (error) { stream.error(error); controller.abort(); }
    },
    cancel() { controller.abort(); },
  });
}

function installHtmlPreviewWindows({ ipcMain, BrowserWindow, session, getWindow, getConnection, diagnostics }) {
  const windows = new Map();
  ipcMain.handle(OPEN_HTML_PREVIEW_CHANNEL, async (event, input) => {
    const owner = getWindow();
    if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Invalid preview request.');
    if (!input || typeof input.droneId !== 'string' || input.droneId.length > 200 || typeof input.path !== 'string' || input.path.length > 8192 || !/\.html?$/i.test(input.path)) throw new Error('Select an HTML file to preview.');
    const key = JSON.stringify([input.droneId, input.path]);
    const existing = windows.get(key);
    if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
    if (windows.size >= 2) throw new Error('Close a separate preview before opening another.');
    const connection = getConnection();
    if (!connection) throw new Error('The Hub is not connected.');
    const apiBase = `${connection.apiUrl}/api/drones/${encodeURIComponent(input.droneId)}/fs/`;
    const lifetime = new AbortController();
    async function request(kind, params, signal = lifetime.signal) {
      const response = await fetch(`${apiBase}${kind}?${new URLSearchParams(params)}`, {
        headers: { Authorization: `Bearer ${connection.apiToken}` },
        signal: AbortSignal.any([lifetime.signal, signal, AbortSignal.timeout(30000)]),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Could not load the preview file.'); }
      return response;
    }
    const meta = await (await request('file', { path: input.path, metadata: '1', revision: '0' })).json();
    if (!meta.ok || !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > MAX_DOCUMENT_BYTES) throw new Error('Separate HTML previews support files up to 512 MiB.');
    if (owner.isDestroyed()) return;
    // Recheck after metadata I/O so simultaneous clicks cannot create duplicates.
    if (windows.has(key)) { windows.get(key).focus(); return; }
    if (windows.size >= 2) throw new Error('Close a separate preview before opening another.');
    const previewSession = session.fromPartition(`drone-html-preview-${randomUUID()}`, { cache: false });
    const origin = `https://${randomUUID()}.drone-preview.invalid`;
    const filePaths = /^(?:[a-z]:[\\/]|\\\\)/i.test(input.path) ? path.win32 : path.posix;
    const documentPath = `/files/${filePaths.basename(input.path)}`;
    const documentUrl = `${origin}/files/${encodeURIComponent(filePaths.basename(input.path))}`;
    previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    previewSession.setPermissionCheckHandler(() => false);
    previewSession.on('will-download', event => event.preventDefault());
    previewSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !(details.url.startsWith(`${origin}/`) || /^(data|blob):/.test(details.url)) });
    });
    previewSession.protocol.handle('https', async req => {
      try {
        const url = new URL(req.url);
        if (url.origin !== origin || req.method !== 'GET') return new Response(null, { status: 403 });
        const target = path.posix.normalize(decodeURIComponent(url.pathname));
        if (target.includes('\\') || target.includes('\0')) return new Response(null, { status: 403 });
        if (target === documentPath) {
          return new Response(streamHtmlDocument({ size: meta.size, signal: lifetime.signal,
            readChunk: async (offset, limit, signal) => (await request('chunk', { path: input.path, offset: String(offset), limit: String(limit) }, signal)).json(),
          }), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': previewPolicy(origin), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), display-capture=(), autoplay=(), fullscreen=(), usb=(), serial=(), payment=()' } });
        }
        // Only sibling media is available to authored markup. There is no Hub API,
        // token, preload bridge, external network or persistent storage here.
        if (!target.startsWith('/files/') || !/\.(png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|ogg)$/i.test(target)) return new Response(null, { status: 403 });
        const mediaPath = filePaths.join(filePaths.dirname(input.path), target.slice('/files/'.length));
        const media = await request('media', { path: mediaPath, maxBytes: String(20 * 1024 * 1024) }, req.signal);
        const mime = media.headers.get('content-type') || '';
        if (!/^(image|video)\//.test(mime)) { await media.body?.cancel(); return new Response(null, { status: 403 }); }
        return new Response(media.body, { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
      } catch (error) {
        if (!lifetime.signal.aborted) diagnostics.write('html-preview-load-error', { message: String(error.message) });
        return new Response('The preview could not be loaded. Close this window and reopen the file.', { status: 500, headers: { 'Content-Type': 'text/plain' } });
      }
    });
    const preview = new BrowserWindow({ width: 1200, height: 850, title: 'HTML preview — Drone Hub',
      webPreferences: { session: previewSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
    });
    windows.set(key, preview);
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const eventName of ['will-navigate', 'will-redirect', 'will-frame-navigate']) preview.webContents.on(eventName, event => event.preventDefault());
    preview.webContents.on('render-process-gone', (_event, details) => {
      diagnostics.write('html-preview-crashed', details);
      lifetime.abort();
      setImmediate(() => {
        if (!preview.isDestroyed()) void preview.loadURL('data:text/html,<body style="background:%2311161e;color:white;font:18px system-ui;padding:32px"><h1>The HTML preview stopped</h1><p>Drone Hub is still running. Close this window and use Source to inspect the file.</p>').catch(() => {});
      });
    });
    const close = () => { if (!preview.isDestroyed()) preview.close(); };
    owner.once('closed', close);
    preview.once('closed', () => {
      lifetime.abort();
      windows.delete(key);
      owner.removeListener('closed', close);
      previewSession.protocol.unhandle('https');
      void previewSession.clearStorageData().catch(() => {});
    });
    void preview.loadURL(documentUrl).catch(error => {
      if (!lifetime.signal.aborted) {
        diagnostics.write('html-preview-load-error', { message: String(error.message) });
        lifetime.abort();
        if (!preview.isDestroyed()) void preview.loadURL('data:text/html,<body style="background:%2311161e;color:white;font:18px system-ui;padding:32px"><h1>The preview could not be loaded</h1><p>Close this window and reopen the file to try again.</p>').catch(() => {});
      }
    });
  });
}

module.exports = { installHtmlPreviewWindows, streamHtmlDocument, previewPolicy, MAX_DOCUMENT_BYTES, OPEN_HTML_PREVIEW_CHANNEL };
