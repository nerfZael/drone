const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  startDesktopStaticUiServer,
} = require('../../desktop/hub-electron-static-server.cjs');

test('Electron static proxy cancels in-flight upstream fetches while closing', async (t) => {
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

  const nativeFetch = global.fetch;
  let proxyFetchSignal = null;
  global.fetch = (input, init) => {
    if (String(input).startsWith(`http://127.0.0.1:${address.port}/`)) {
      proxyFetchSignal = init?.signal || null;
    }
    return nativeFetch(input, init);
  };

  let proxy = null;
  t.after(async () => {
    global.fetch = nativeFetch;
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
  const response = await nativeFetch(`${proxy.url}/api/slow`);
  const body = response.text();

  assert.ok(proxyFetchSignal, 'expected the upstream fetch to receive a shutdown signal');
  assert.equal(proxyFetchSignal.aborted, false);
  await proxy.close();
  assert.equal(proxyFetchSignal.aborted, true);
  await assert.rejects(body);
});
