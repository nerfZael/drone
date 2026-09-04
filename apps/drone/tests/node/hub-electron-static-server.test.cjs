const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket, WebSocketServer } = require('ws');

const {
  startDesktopStaticUiServer,
} = require('../../desktop/hub-electron-static-server.cjs');

test('Electron static UI separates fetch traffic onto a CORS-protected localhost origin', async (t) => {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-static-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><head><title>Hub</title></head></html>');

  let upstreamRequests = 0;
  let upstreamAuthorization = '';
  const upstream = http.createServer((req, res) => {
    upstreamRequests += 1;
    upstreamAuthorization = String(req.headers.authorization || '');
    res.writeHead(200, { 'content-type': 'application/json', 'server-timing': 'total;dur=1' });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Expected an upstream TCP address.');

  let proxy = null;
  t.after(async () => {
    if (proxy) await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  proxy = await startDesktopStaticUiServer({
    staticDir,
    apiHost: '127.0.0.1',
    apiPort: address.port,
    apiToken: 'test-token',
  });
  const html = await (await fetch(proxy.url)).text();
  assert.match(html, new RegExp(`directApiBase.*http://localhost:${new URL(proxy.url).port}`));

  const preflight = await fetch(`${proxy.directApiBase}/api/test`, {
    method: 'OPTIONS',
    headers: {
      origin: proxy.url,
      'access-control-request-method': 'GET',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), proxy.url);

  const response = await fetch(`${proxy.directApiBase}/api/test`, {
    headers: { origin: proxy.url },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), proxy.url);
  assert.equal(response.headers.get('timing-allow-origin'), proxy.url);
  assert.equal(response.headers.get('server-timing'), 'total;dur=1');
  assert.equal(upstreamAuthorization, 'Bearer test-token');
  assert.equal(upstreamRequests, 1);

  const rejected = await fetch(`${proxy.directApiBase}/api/test`, {
    headers: { origin: 'https://attacker.example' },
  });
  assert.equal(rejected.status, 403);
  assert.equal(upstreamRequests, 1);
});

test('Electron static proxy cancels in-flight upstream requests while closing', async (t) => {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-static-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Hub</title>');

  const upstreamSockets = new Set();
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('still running');
  });
  upstream.on('connection', (socket) => {
    upstreamSockets.add(socket);
    socket.once('close', () => upstreamSockets.delete(socket));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Expected an upstream TCP address.');

  let proxy = null;
  t.after(async () => {
    if (proxy) await proxy.close();
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  proxy = await startDesktopStaticUiServer({
    staticDir,
    apiHost: '127.0.0.1',
    apiPort: address.port,
    apiToken: 'test-token',
  });
  const response = await fetch(`${proxy.url}/api/slow`);
  const body = response.text();

  await proxy.close();
  await assert.rejects(body);
  assert.equal(upstreamSockets.size, 0);
});

test('Electron static proxy authenticates same-origin WebSockets without forwarding its temporary origin', async (t) => {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-static-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Hub</title>');

  let upstreamUpgradeCount = 0;
  let upstreamHeaders = null;
  const upstream = http.createServer();
  const upstreamWebSockets = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (req, socket, head) => {
    upstreamUpgradeCount += 1;
    upstreamHeaders = req.headers;
    upstreamWebSockets.handleUpgrade(req, socket, head, (webSocket) => {
      upstreamWebSockets.emit('connection', webSocket, req);
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Expected an upstream TCP address.');

  let proxy = null;
  const clients = new Set();
  t.after(async () => {
    for (const client of clients) client.terminate();
    if (proxy) await proxy.close();
    await new Promise((resolve) => upstreamWebSockets.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  proxy = await startDesktopStaticUiServer({
    staticDir,
    apiHost: '127.0.0.1',
    apiPort: address.port,
    apiToken: 'test-token',
  });
  const webSocketUrl = proxy.url.replace(/^http:/, 'ws:') + '/api/companion/stream';
  const client = new WebSocket(webSocketUrl, { origin: proxy.url });
  clients.add(client);
  await new Promise((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });

  assert.equal(upstreamUpgradeCount, 1);
  assert.equal(upstreamHeaders.authorization, 'Bearer test-token');
  assert.equal(upstreamHeaders.origin, undefined);

  const rejected = new WebSocket(webSocketUrl, { origin: 'https://attacker.example' });
  clients.add(rejected);
  const rejectionStatus = await new Promise((resolve, reject) => {
    rejected.once('unexpected-response', (_request, response) => resolve(response.statusCode));
    rejected.once('open', () =>
      reject(new Error('Expected the cross-origin WebSocket to be rejected.')),
    );
    rejected.once('error', () => undefined);
  });
  assert.equal(rejectionStatus, 403);
  assert.equal(upstreamUpgradeCount, 1);
});
