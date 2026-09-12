const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket, WebSocketServer } = require('ws');

const {
  startDesktopStaticUiServer,
} = require('../../desktop/hub-electron-static-server.cjs');

async function uploadProxy(t, handler) {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-upload-proxy-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html></html>');
  const sockets = new Set();
  const upstream = http.createServer(handler);
  upstream.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = await startDesktopStaticUiServer({
    staticDir, apiHost: '127.0.0.1', apiPort: upstream.address().port, apiToken: 'upload-test-token',
  });
  t.after(async () => {
    await proxy.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(staticDir, { recursive: true, force: true });
  });
  return proxy;
}

test('streams fixed-length and chunked uploads before the client finishes, preserving bytes', { timeout: 5000 }, async t => {
  for (const fixedLength of [true, false]) {
    await t.test(fixedLength ? 'content-length' : 'chunked', async t => {
      let firstChunk;
      const started = new Promise(resolve => { firstChunk = resolve; });
      const first = crypto.randomBytes(256 * 1024);
      const last = crypto.randomBytes(128 * 1024);
      const expectedHash = crypto.createHash('sha256').update(first).update(last).digest('hex');
      const proxy = await uploadProxy(t, (req, res) => {
        assert.equal(req.headers.authorization, 'Bearer upload-test-token');
        assert.equal(req.headers['content-type'], 'application/octet-stream');
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        req.on('data', chunk => { bytes += chunk.length; hash.update(chunk); firstChunk(); });
        req.on('end', () => {
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ bytes, hash: hash.digest('hex') }));
        });
      });
      let request;
      const response = new Promise((resolve, reject) => {
        request = http.request(`${proxy.url}/api/upload`, {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            ...(fixedLength ? { 'content-length': first.length + last.length } : {}),
          },
        }, res => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { text += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, ...JSON.parse(text) }));
          res.on('error', reject);
        });
        request.on('error', reject);
      });
      t.after(() => request.destroy());
      request.write(first);
      await started; // Whole-body buffering would deadlock here.
      request.end(last);
      assert.deepEqual(await response, { status: 201, bytes: first.length + last.length, hash: expectedHash });
    });
  }
});

test('forwards JSON and empty POST bodies', { timeout: 5000 }, async t => {
  const connections = new Set();
  const proxy = await uploadProxy(t, (req, res) => {
    connections.add(req.socket);
    let text = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => res.end(text));
  });
  for (const body of ['', JSON.stringify({ message: 'hello 🌍' })]) {
    const response = await fetch(`${proxy.url}/api/echo`, { method: 'POST', body });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), body);
  }
  if (http.globalAgent.options.keepAlive) assert.equal(connections.size, 1);
});

test('continues uploading when the backend starts its response before the body is complete', { timeout: 5000 }, async t => {
  const proxy = await uploadProxy(t, (req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (!res.headersSent) res.write('ready\n');
    });
    req.on('end', () => res.end(body));
  });
  let request, ready;
  const acknowledged = new Promise(resolve => { ready = resolve; });
  const completed = new Promise((resolve, reject) => {
    request = http.request(`${proxy.url}/api/upload`, { method: 'POST' }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; ready(); });
      res.on('end', () => resolve(text));
      res.on('error', reject);
    });
    request.on('error', reject);
  });
  t.after(() => request.destroy());
  request.write('first');
  await acknowledged;
  request.end('last');
  assert.equal(await completed, 'ready\nfirstlast');
});

test('delivers an early backend rejection without waiting for the upload to finish', { timeout: 5000 }, async t => {
  const proxy = await uploadProxy(t, (_req, res) => {
    res.writeHead(413, { 'content-type': 'text/plain' });
    res.end('file too large');
  });
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(`${proxy.url}/api/upload`, { method: 'POST' }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
      res.on('error', reject);
    });
    request.on('error', reject);
  });
  t.after(() => request.destroy());
  request.write(Buffer.alloc(1024)); // Deliberately never call end().
  assert.deepEqual(await response, { status: 413, text: 'file too large' });
});

test('cancels an upstream upload when its desktop client disconnects', { timeout: 5000 }, async t => {
  let started, aborted;
  const sawData = new Promise(resolve => { started = resolve; });
  const sawAbort = new Promise(resolve => { aborted = resolve; });
  const proxy = await uploadProxy(t, (req, _res) => {
    req.on('data', started);
    req.on('aborted', aborted);
    req.on('error', () => {});
  });
  const request = http.request(`${proxy.url}/api/upload`, { method: 'POST' });
  request.on('error', () => {});
  t.after(() => request.destroy());
  request.write(Buffer.alloc(1024));
  await sawData;
  request.destroy();
  await sawAbort;
});

test('closing the desktop cancels an unfinished upload', { timeout: 5000 }, async t => {
  let started;
  const sawData = new Promise(resolve => { started = resolve; });
  const proxy = await uploadProxy(t, req => { req.on('data', started); });
  const request = http.request(`${proxy.url}/api/upload`, { method: 'POST' });
  request.on('error', () => {});
  t.after(() => request.destroy());
  request.write(Buffer.alloc(1024));
  await sawData;
  await proxy.close();
});

test('reports an upstream disconnect during upload as a proxy error', { timeout: 5000 }, async t => {
  const proxy = await uploadProxy(t, req => { req.once('data', () => req.socket.destroy()); });
  const response = await fetch(`${proxy.url}/api/upload`, { method: 'POST', body: Buffer.alloc(1024) });
  assert.equal(response.status, 502);
  await response.text();
});

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

test('desktop origin survives relaunch and refuses to switch origins when occupied', async (t) => {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-origin-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html><head></head></html>');
  const options = { staticDir, apiHost: '127.0.0.1', apiPort: 1, apiToken: 'test', portFile: path.join(staticDir, 'port') };
  let proxy;
  t.after(async () => {
    if (proxy) await proxy.close();
    fs.rmSync(staticDir, { recursive: true, force: true });
  });
  proxy = await startDesktopStaticUiServer(options);
  const origin = proxy.url;
  assert.match(await (await fetch(origin)).text(), /"desktop":true/);
  await proxy.close();
  proxy = await startDesktopStaticUiServer(options);
  assert.equal(proxy.url, origin);
  await assert.rejects(startDesktopStaticUiServer(options), { code: 'EADDRINUSE' });
});
