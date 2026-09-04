const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
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

function runtimeConfigScript(config) {
  const serialized = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script>globalThis.__DRONE_HUB_RUNTIME_CONFIG__=${serialized};</script>`;
}

function injectRuntimeConfig(html, config) {
  const script = runtimeConfigScript(config);
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${script}`)
    : `${script}${html}`;
}

function allowProxyCors(req, res, allowedOrigin) {
  const origin = String(req.headers.origin || '').trim().toLowerCase();
  if (!origin) return true;
  if (!allowedOrigin || origin !== allowedOrigin.toLowerCase()) return false;
  res.setHeader('access-control-allow-origin', allowedOrigin);
  res.setHeader('timing-allow-origin', allowedOrigin);
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    [
      'content-type',
      'authorization',
      'if-none-match',
      'mcp-session-id',
      'x-drone-transcription-quality',
      'x-drone-transcription-language',
      'x-drone-transcription-prompt-base64',
      'x-drone-companion-message-id',
    ].join(', '),
  );
  res.setHeader('access-control-expose-headers', 'etag,mcp-session-id,server-timing');
  res.setHeader('access-control-max-age', '600');
  res.setHeader('vary', 'origin');
  return true;
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
  for (const [key, value] of Object.entries(response.headers)) {
    if (value != null && !HOP_BY_HOP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function proxyApiRequest({ req, res, apiHost, apiPort, apiToken, signal }) {
  const method = String(req.method || 'GET').toUpperCase();
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const body = method === 'GET' || method === 'HEAD' ? null : await readBody(req);
  await new Promise((resolve, reject) => {
    let upstreamResponse = null;
    const upstream = http.request({
      host: apiHost,
      port: apiPort,
      method,
      path: `${requestUrl.pathname}${requestUrl.search}`,
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
    });
    const cleanup = () => signal.removeEventListener('abort', abort);
    const succeed = () => {
      cleanup();
      resolve();
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      const error = new Error('Drone Hub desktop proxy is closing');
      upstream.destroy(error);
      upstreamResponse?.destroy(error);
    };
    signal.addEventListener('abort', abort, { once: true });
    upstream.once('error', fail);
    upstream.once('response', (response) => {
      upstreamResponse = response;
      res.statusCode = response.statusCode || 502;
      copyResponseHeaders(response, res);
      void pipeline(response, res).then(succeed, fail);
    });
    if (signal.aborted) abort();
    else upstream.end(body ?? undefined);
  });
}

function proxyApiUpgrade({ req, socket, head, apiHost, apiPort, apiToken, proxyOrigin }) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (!requestUrl.pathname.startsWith('/api/')) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return null;
  }
  let requestOrigin;
  try {
    requestOrigin = new URL(String(req.headers.origin || '')).origin;
  } catch {
    requestOrigin = '';
  }
  if (!requestOrigin || requestOrigin !== proxyOrigin) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return null;
  }
  const upstream = net.connect(apiPort, apiHost);
  upstream.once('connect', () => {
    const headers = new Map();
    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (
        value == null ||
        lowerKey === 'host' ||
        lowerKey === 'authorization' ||
        lowerKey === 'origin' ||
        HOP_BY_HOP_HEADERS.has(lowerKey)
      )
        continue;
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
  let proxyOrigin = '';
  let directApiBase = '';
  const server = http.createServer((req, res) => {
    const request = (async () => {
      try {
        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        if (requestUrl.pathname.startsWith('/api/')) {
          if (!allowProxyCors(req, res, proxyOrigin)) {
            res.statusCode = 403;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }));
            return;
          }
          if (String(req.method || 'GET').toUpperCase() === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
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
        if (path.extname(filePath).toLowerCase() === '.html') {
          const html = await fs.promises.readFile(filePath, 'utf8');
          res.end(injectRuntimeConfig(html, { directApiBase }));
          return;
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
    const upstream = proxyApiUpgrade({
      req,
      socket,
      head,
      apiHost,
      apiPort,
      apiToken,
      proxyOrigin,
    });
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
  proxyOrigin = `http://127.0.0.1:${port}`;
  // Chromium applies its HTTP/1.1 connection limit per origin. EventSource
  // streams stay on 127.0.0.1 while fetch/WebSocket traffic uses localhost,
  // giving critical API requests an independent connection pool.
  directApiBase = `http://localhost:${port}`;
  let closePromise = null;
  return {
    url: `http://127.0.0.1:${port}`,
    directApiBase,
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
  injectRuntimeConfig,
  resolveDesktopStaticUiDir,
  resolveHubApiTokenPath,
  startDesktopStaticUiServer,
};
