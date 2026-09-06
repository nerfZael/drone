import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer, createWebSocketStream } from 'ws';
import { DeviceBrowserSessions } from '../../src/hub/device-mesh/device-browser-sessions';
import type { DroneBrowserSession } from '@drone/device-protocol';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return (server.address() as { port: number }).port;
}
async function fixture(runtime: 'host' | 'container' = 'container') {
  const app = http.createServer(async (req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: second\n\n'), 30);
      return;
    }
    const body: Buffer[] = [];
    for await (const chunk of req) body.push(Buffer.from(chunk));
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': 'app=session; HttpOnly; Path=/',
    });
    res.end(
      JSON.stringify({
        method: req.method,
        path: req.url,
        cookie: req.headers.cookie,
        body: Buffer.concat(body).toString(),
      }),
    );
  });
  const appPort = await listen(app);
  const echo = new WebSocketServer({ server: app });
  echo.on('connection', (ws) => ws.on('message', (data, binary) => ws.send(data, { binary })));
  cleanups.push(() => {
    for (const ws of echo.clients) ws.terminate();
    echo.close();
  });
  let hostPort = appPort;
  let revoked = false;
  let lookupStatus = 200;
  let lookups = 0;
  const listeners = new Set<() => void>();
  let nextRead: { entered(): void; wait: Promise<void> } | null = null;
  const hub = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer hub-secret');
    if (req.url !== '/api/drones/drone/ports') {
      res.writeHead(404).end();
      return;
    }
    lookups++;
    res.statusCode = lookupStatus;
    res.setHeader('content-type', 'application/json');
    const held = nextRead;
    nextRead = null;
    if (held) {
      held.entered();
      await held.wait;
    }
    res.end(JSON.stringify({ runtime, ports: [{ containerPort: 3000, hostPort }] }));
  });
  const hubPort = await listen(hub);
  const ingress = http.createServer((_req, res) => res.writeHead(404).end());
  const ingressPort = await listen(ingress);
  const sessions = new DeviceBrowserSessions(
    { baseUrl: () => `http://127.0.0.1:${hubPort}`, apiToken: 'hub-secret' },
    {
      read: async () => ({
        devices: {
          phone: {
            id: 'phone',
            revokedAt: revoked ? 'now' : null,
            grants: [
              {
                capability: 'drone-control',
                version: 1,
                operations: ['browser.targets', 'browser.open', 'browser.close'],
              },
            ],
          },
          reader: {
            id: 'reader',
            grants: [{ capability: 'drone-control', version: 1, operations: ['file.preview'] }],
          },
        },
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as any,
    () => 'https://hub.example:8791',
    () => ingressPort,
  );
  cleanups.push(() => sessions.close());
  ingress.on('upgrade', (req, socket, head) => {
    void sessions.upgrade(req, socket, head);
  });
  const open = (port = runtime === 'host' ? appPort : 3000) =>
    sessions.invoke(
      'browser.open',
      { droneId: 'drone', port },
      'phone',
    ) as Promise<DroneBrowserSession>;
  const connect = (session: DroneBrowserSession, token = session.token, origin?: string) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${ingressPort}/api/device-mesh/v2/browser/${session.sessionId}`,
      {
        headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
        perMessageDeflate: false,
      },
    );
    cleanups.push(() => ws.terminate());
    return ws;
  };
  return {
    sessions,
    lookupCount: () => lookups,
    failLookups: (status: number) => {
      lookupStatus = status;
    },
    open,
    connect,
    appPort,
    hubPort,
    ingressPort,
    holdNextRead: () => {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextRead = { entered, wait };
      cleanups.push(release);
      return { started, release };
    },
    remap: () => {
      hostPort++;
    },
    revoke: () => {
      revoked = true;
      for (const listener of listeners) listener();
    },
  };
}

for (const runtime of ['host', 'container'] as const)
  test(
    `${runtime} browser streams POST bodies, cookies, paths and responses`,
    { timeout: 10000 },
    async () => {
      const f = await fixture(runtime);
      const session = await f.open();
      assert.equal(session.upstreamAuthority, `127.0.0.1:${f.appPort}`);
      const ws = f.connect(session);
      await once(ws, 'open');
      const chunks: Buffer[] = [];
      ws.on('message', (data) => chunks.push(Buffer.from(data as Buffer)));
      const closed = once(ws, 'close');
      const body = 'test-data-'.repeat(100_000);
      ws.send(
        Buffer.from(
          `POST /api/save?q=1 HTTP/1.1\r\nHost: localhost\r\nCookie: app=abc\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
        ),
      );
      for (let offset = 0; offset < body.length; offset += 16384)
        ws.send(Buffer.from(body.slice(offset, offset + 16384)));
      await closed;
      const response = Buffer.concat(chunks).toString();
      assert.ok(response.includes('200 OK'));
      assert.ok(response.includes('app=session'));
      assert.ok(response.includes('"method":"POST"'));
      assert.ok(response.includes('"path":"/api/save?q=1"'));
      assert.ok(response.includes('"cookie":"app=abc"'));
      // Node may chunk the body; strip framing before checking the complete large value.
      const payload = response
        .slice(response.indexOf('\r\n\r\n') + 4)
        .replace(/(?:^|\r\n)[0-9a-f]+\r\n/g, '')
        .replace(/\r\n$/, '');
      assert.ok(payload.includes(body));
    },
  );

test(
  'browser streams events before the response completes and carries nested WebSockets',
  { timeout: 10000 },
  async () => {
    const f = await fixture();
    const session = await f.open();
    const ws = f.connect(session);
    await once(ws, 'open');
    const received: string[] = [];
    ws.on('message', (data) => received.push(data.toString()));
    const first = once(ws, 'message');
    const closed = once(ws, 'close');
    ws.send(Buffer.from('GET /events HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
    await first;
    assert.ok(received.join('').includes('data: first'));
    assert.ok(!received.join('').includes('data: second'));
    await closed;
    assert.ok(received.join('').includes('data: second'));
    const tunnel = f.connect(session);
    await once(tunnel, 'open');
    const transport = createWebSocketStream(tunnel);
    const inner = new WebSocket('ws://localhost/live', {
      createConnection: () => transport as any,
    });
    cleanups.push(() => inner.terminate());
    await once(inner, 'open');
    const echo = once(inner, 'message');
    inner.send('live reload');
    assert.equal((await echo)[0].toString(), 'live reload');
  },
);

test('browser grants, mapped targets and Hub control ports are enforced', async () => {
  const f = await fixture('host');
  await assert.rejects(
    f.sessions.invoke('browser.open', { droneId: 'drone', port: f.appPort }, 'reader'),
    /not permitted/,
  );
  await assert.rejects(f.open(f.hubPort), /control port/);
  await assert.rejects(f.open(f.ingressPort), /control port/);
  await assert.rejects(f.open(65536), /between/);
  const container = await fixture();
  await assert.rejects(container.open(9999), /not mapped/);
});

test('bad credentials, web origins, remapped ports and closed sessions cannot connect', async () => {
  const f = await fixture();
  const session = await f.open();
  for (const [token, origin] of [
    ['wrong', undefined],
    [session.token, 'https://untrusted.example'],
  ]) {
    const [error] = await once(f.connect(session, token, origin), 'error');
    assert.match(error.message, /403/);
  }
  f.remap();
  assert.match((await once(f.connect(session), 'error'))[0].message, /403/);
  const next = await f.open();
  await f.sessions.invoke(
    'browser.close',
    { droneId: 'drone', sessionId: next.sessionId },
    'phone',
  );
  assert.match((await once(f.connect(next), 'error'))[0].message, /403/);
});

test('revoking a device closes active browser streams', async () => {
  const f = await fixture();
  const session = await f.open();
  const ws = f.connect(session);
  await once(ws, 'open');
  const closed = once(ws, 'close');
  f.revoke();
  await closed;
  await assert.rejects(f.open(), /not permitted/);
});

test('opening a new browser closes the old session and expired credentials cannot reconnect', async (context) => {
  const f = await fixture();
  const first = await f.open();
  const ws = f.connect(first);
  await once(ws, 'open');
  const closed = once(ws, 'close');
  const second = await f.open();
  await closed;
  assert.match((await once(f.connect(first), 'error'))[0].message, /403/);
  context.mock.method(Date, 'now', () => Date.parse(second.expiresAt) + 1);
  assert.match((await once(f.connect(second), 'error'))[0].message, /403/);
});

test('a cancelled browser open cannot create a session or evict the current one', async () => {
  const f = await fixture();
  const current = await f.open();
  const held = f.holdNextRead();
  const controller = new AbortController();
  const pending = f.sessions.invoke(
    'browser.open',
    { droneId: 'drone', port: 3000 },
    'phone',
    controller.signal,
  );
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await held.started;
  controller.abort();
  await rejected;
  held.release();
  const ws = f.connect(current);
  await once(ws, 'open');
});

test('an older slow browser open cannot replace a newer session', async () => {
  const f = await fixture();
  const held = f.holdNextRead();
  const older = f.open();
  const rejected = assert.rejects(older, { name: 'AbortError' });
  await held.started;
  const newer = await f.open();
  await rejected;
  held.release();
  const ws = f.connect(newer);
  await once(ws, 'open');
});

test(
  'concurrent browser assets share an in-flight mapping check and release their streams',
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const session = await f.open();
    for (let batch = 0; batch < 8; batch++) {
      const held = f.holdNextRead();
      const before = f.lookupCount();
      const sockets = Array.from({ length: 12 }, () => f.connect(session));
      const opened = Promise.all(sockets.map((ws) => once(ws, 'open')));
      void opened.catch(() => undefined);
      await held.started;
      // Wait until all upgrade handlers are sharing the held read.
      while ((f.sessions as any).sessions.get(session.sessionId).pending < sockets.length)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(f.lookupCount(), before + 1);
      held.release();
      await opened;
      await Promise.all(
        sockets.map(async (ws) => {
          const chunks: Buffer[] = [];
          ws.on('message', (data) => chunks.push(Buffer.from(data as Buffer)));
          const closed = once(ws, 'close');
          ws.send(
            Buffer.from('GET /asset.js HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'),
          );
          await closed;
          assert.match(Buffer.concat(chunks).toString(), /200 OK/);
        }),
      );
    }
    f.remap();
    assert.match((await once(f.connect(session), 'error'))[0].message, /403/);
  },
);

test('temporary target lookup failures preserve sessions without admitting unchecked streams', async (context) => {
  const f = await fixture();
  const session = await f.open();
  const ws = f.connect(session);
  await once(ws, 'open');
  context.mock.method(
    globalThis,
    'fetch',
    async () => {
      throw new DOMException('Timed out', 'TimeoutError');
    },
    { times: 1 },
  );
  await (f.sessions as any).checkSessions(true);
  assert.equal(ws.readyState, WebSocket.OPEN);
  f.failLookups(503);
  await (f.sessions as any).checkSessions(true);
  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.match((await once(f.connect(session), 'error'))[0].message, /403/);
  f.failLookups(200);
  await once(f.connect(session), 'open');
  f.failLookups(404);
  const closed = once(ws, 'close');
  await (f.sessions as any).checkSessions(true);
  await closed;
  assert.match((await once(f.connect(session), 'error'))[0].message, /403/);
});
