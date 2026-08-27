const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function resolveDesktopStaticUiDir(baseDir, explicitPath = '') {
  const candidates = [
    String(explicitPath || '').trim(),
    path.join(baseDir, 'hub-ui'),
    path.resolve(baseDir, '..', '..', 'drone-hub', 'dist'),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) || null;
}

function resolveHubApiTokenPath(payload) {
  const logPath = String(payload?.state?.logPath || payload?.logPath || '').trim();
  return logPath ? path.join(path.dirname(logPath), 'hub.token') : null;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.webmanifest') return 'application/manifest+json; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function staticAssetPath(staticDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(pathname || '/'));
  } catch {
    return null;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(staticDir, relative);
  const root = path.resolve(staticDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  if (fs.existsSync(resolved)) return resolved;
  return path.posix.extname(decoded) ? null : path.join(root, 'index.html');
}

function copyResponseHeaders(response, res) {
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function proxyApiRequest({ req, res, apiHost, apiPort, apiToken, signal }) {
  const method = String(req.method || 'GET').toUpperCase();
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const response = await fetch(`http://${apiHost}:${apiPort}${requestUrl.pathname}${requestUrl.search}`, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(req.headers['content-type'] ? { 'content-type': String(req.headers['content-type']) } : {}),
      ...(req.headers['if-none-match'] ? { 'if-none-match': String(req.headers['if-none-match']) } : {}),
      ...(req.headers['mcp-session-id'] ? { 'mcp-session-id': String(req.headers['mcp-session-id']) } : {}),
      ...(req.headers['x-drone-transcription-quality'] ? { 'x-drone-transcription-quality': String(req.headers['x-drone-transcription-quality']) } : {}),
      ...(req.headers['x-drone-transcription-language'] ? { 'x-drone-transcription-language': String(req.headers['x-drone-transcription-language']) } : {}),
      ...(req.headers['x-drone-transcription-prompt-base64'] ? { 'x-drone-transcription-prompt-base64': String(req.headers['x-drone-transcription-prompt-base64']) } : {}),
      ...(req.headers['x-drone-companion-message-id'] ? { 'x-drone-companion-message-id': String(req.headers['x-drone-companion-message-id']) } : {}),
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : await readBody(req),
    signal,
  });
  res.statusCode = response.status;
  copyResponseHeaders(response, res);
  if (!response.body) return void res.end();
  await pipeline(Readable.fromWeb(response.body), res);
}

function proxyApiUpgrade({ req, socket, head, apiHost, apiPort, apiToken }) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (!requestUrl.pathname.startsWith('/api/')) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return null;
  }
  const upstream = net.connect(apiPort, apiHost);
  upstream.once('connect', () => {
    const headers = new Map();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null || key.toLowerCase() === 'host' || key.toLowerCase() === 'authorization') continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    headers.set('Host', `${apiHost}:${apiPort}`);
    headers.set('Authorization', `Bearer ${apiToken}`);
    headers.set('Connection', 'Upgrade');
    headers.set('Upgrade', 'websocket');
    const lines = [`${req.method || 'GET'} ${requestUrl.pathname}${requestUrl.search} HTTP/${req.httpVersion}`];
    for (const [key, value] of headers) lines.push(`${key}: ${value}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once('error', () => socket.destroy());
  return upstream;
}

async function startDesktopStaticUiServer({ staticDir, apiHost, apiPort, apiToken }) {
  const sockets = new Set();
  const upstreamSockets = new Set();
  const requests = new Set();
  const shutdown = new AbortController();
  const server = http.createServer((req, res) => {
    const request = (async () => {
      try {
        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        if (requestUrl.pathname.startsWith('/api/')) {
          await proxyApiRequest({ req, res, apiHost, apiPort, apiToken, signal: shutdown.signal });
          return;
        }
        const filePath = staticAssetPath(staticDir, requestUrl.pathname);
        if (!filePath || !fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', contentType(filePath));
        if (path.extname(filePath) === '.html' || path.basename(filePath) === 'pwa-sw.js' || path.basename(filePath) === 'version.json') {
          res.setHeader('cache-control', 'no-store');
        } else if (requestUrl.pathname.startsWith('/assets/')) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        }
        fs.createReadStream(filePath).pipe(res);
      } catch (error) {
        if (!res.headersSent) res.statusCode = 502;
        if (!res.destroyed) res.end(String(error?.message || error));
      }
    })();
    requests.add(request);
    void request.then(
      () => requests.delete(request),
      () => requests.delete(request),
    );
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    const upstream = proxyApiUpgrade({ req, socket, head, apiHost, apiPort, apiToken });
    if (!upstream) return;
    upstreamSockets.add(upstream);
    upstream.once('close', () => upstreamSockets.delete(upstream));
    socket.once('close', () => upstream.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  let closePromise = null;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        shutdown.abort();
        for (const upstream of upstreamSockets) upstream.destroy();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
        await Promise.allSettled([...requests]);
      })();
      return closePromise;
    },
  };
}

module.exports = {
  resolveDesktopStaticUiDir,
  resolveHubApiTokenPath,
  startDesktopStaticUiServer,
};
