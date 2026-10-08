import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createDeviceMeshService } from '../../src/hub/device-mesh';
import { loadOrCreateDeviceIdentity } from '../../src/hub/device-mesh/device-identity';
import {
  rewriteRuntimeConfig,
  viewerRoute,
} from '../../src/hub/device-mesh/hub-remote-viewers';

type ApiHandler = (request: http.IncomingMessage, response: http.ServerResponse, url: URL) => void;

type TestHub = {
  rootDir: string;
  url: string;
  token: string;
  service: Awaited<ReturnType<typeof createDeviceMeshService>>;
  close(): Promise<void>;
};

const cleanups: Array<() => Promise<void>> = [];

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  );
  return address.port;
}

async function startHub(api?: ApiHandler, upgrade?: (request: http.IncomingMessage, socket: any, head: Buffer) => void): Promise<TestHub> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-hub-remote-test-'));
  const token = `token-${crypto.randomUUID()}`;
  let url = '';
  const service = await createDeviceMeshService({
    rootDir,
    apiToken: token,
    localHubBaseUrl: () => url,
    sidebarCommands: undefined as any,
  });
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (await service.handleHttp(request, response, requestUrl)) return;
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    if (api) api(request, response, requestUrl);
    else response.writeHead(404).end();
  });
  server.on('upgrade', (request, socket, head) => {
    if (upgrade && request.headers.authorization === `Bearer ${token}`) upgrade(request, socket, head);
    else socket.destroy();
  });
  url = `http://127.0.0.1:${await listen(server)}`;
  await service.start();
  const ingress = await adminJson({ url, token }, '/api/device-mesh/ingress');
  await adminJson({ url, token }, '/api/device-mesh/ingress', {
    method: 'PUT',
    body: JSON.stringify({
      port: ingress.status.port,
      publicEndpoint: `http://127.0.0.1:${ingress.status.port}`,
    }),
  });
  const hub = {
    rootDir,
    url,
    token,
    service,
    async close() {
      await service.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
  cleanups.unshift(() => hub.close());
  return hub;
}

async function adminJson(hub: Pick<TestHub, 'url' | 'token'>, pathname: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${hub.url}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${hub.token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error ?? `request failed (${response.status})`), { body, status: response.status });
  return body;
}

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition timed out');
}

async function pair(target: TestHub, viewer: TestHub, grants: unknown[]): Promise<string> {
  const viewerSelf = (await adminJson(viewer, '/api/device-mesh')).selfDeviceId;
  await adminJson(viewer, `/api/device-mesh/devices/${viewerSelf}`, {
    method: 'PUT',
    body: JSON.stringify({ name: `Viewer ${viewerSelf.slice(-6)}` }),
  });
  const invitation = await adminJson(target, '/api/device-mesh/invitations', { method: 'POST' });
  const join = await adminJson(viewer, '/api/device-mesh/joins', {
    method: 'POST',
    body: JSON.stringify({ payload: JSON.stringify(invitation.payload) }),
  });
  const pending = await waitFor(async () => (await adminJson(target, '/api/device-mesh')).pending[0] ?? null);
  await adminJson(target, `/api/device-mesh/pending/${pending.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ administrator: true, grants }),
  });
  await waitFor(async () => {
    const status = await adminJson(viewer, `/api/device-mesh/joins/${join.joinId}`);
    return status.status === 'approved' ? status : null;
  });
  const targetId = (await loadOrCreateDeviceIdentity(target.rootDir)).id;
  const viewerId = pending.device.id as string;
  await waitFor(async () =>
    (await adminJson(target, '/api/device-mesh')).connectedDeviceIds.includes(viewerId) ? true : null,
  );
  return targetId;
}

/** A Hub UI server like the desktop one: an index page carrying runtime configuration, and assets. */
async function startHomeUi(): Promise<string> {
  const server = http.createServer((request, response) => {
    if (request.url === '/assets/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end('console.log("app")');
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(
        '<!doctype html><html><head><script>globalThis.__DRONE_HUB_RUNTIME_CONFIG__={"directApiBase":"http://localhost:1","desktop":true};</script></head><body>home</body></html>',
      );
  });
  return `http://127.0.0.1:${await listen(server)}`;
}

/** A drone's preview service on the remote machine. */
async function startPreview(): Promise<number> {
  const server = http.createServer((request, response) => {
    if (request.url === '/login') {
      response
        .writeHead(302, {
          location: `http://localhost:${port}/home`,
          'set-cookie': 'sid=1; Domain=localhost; Path=/',
        })
        .end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ host: request.headers.host, origin: request.headers.origin ?? null, path: request.url, cookie: request.headers.cookie ?? null }),
    );
  });
  const port = await listen(server);
  return port;
}

function viewerRequest(
  viewerUrl: string,
  pathname: string,
  options: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(viewerUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: Number(url.port),
        path: pathname,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? url.host, ...(options.headers ?? {}) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined);
});

describe('hub remote helpers', () => {
  test('routes only the viewer origin and preview subdomains', () => {
    assert.deepEqual(viewerRoute('127.0.0.1:4000', 4000), { kind: 'ui' });
    assert.deepEqual(viewerRoute('localhost:4000', 4000), { kind: 'ui' });
    assert.deepEqual(viewerRoute('p3000.localhost:4000', 4000), { kind: 'preview', port: 3000 });
    assert.equal(viewerRoute('p3000.localhost:4001', 4000), null);
    assert.equal(viewerRoute('evil.example:4000', 4000), null);
    assert.equal(viewerRoute('p70000.localhost:4000', 4000), null);
  });

  test('replaces the home runtime configuration and keeps the desktop flag', () => {
    const html = rewriteRuntimeConfig(
      '<html><head><script>globalThis.__DRONE_HUB_RUNTIME_CONFIG__={"directApiBase":"http://localhost:1","desktop":true};</script></head></html>',
      {
        directApiBase: 'http://localhost:9',
        remoteHub: { deviceId: 'b', deviceName: 'B</script>', homeDeviceId: 'a', homeOrigin: 'http://127.0.0.1:2' },
      },
    );
    assert.equal(html.match(/__DRONE_HUB_RUNTIME_CONFIG__/g)?.length, 1);
    assert.ok(html.includes('"directApiBase":"http://localhost:9"'));
    assert.ok(html.includes('"desktop":true'));
    assert.ok(!html.includes('B</script>'));
  });
});

describe('full remote Hub access', () => {
  test('refuses devices without the hub-remote grant', async () => {
    const target = await startHub();
    const viewer = await startHub();
    const targetId = await pair(target, viewer, [
      { capability: 'drone-control', version: 1, operations: ['drones.list'] },
    ]);
    const home = await startHomeUi();
    const failure = await adminJson(viewer, '/api/device-mesh/remote-hub/open', {
      method: 'POST',
      body: JSON.stringify({ targetDeviceId: targetId, homeOrigin: home }),
    }).catch((error) => error);
    assert.equal(failure.status, 403);
    assert.equal(failure.body.code, 'HUB_REMOTE_NOT_GRANTED');
  });

  test('serves the home UI and forwards API, streams, WebSockets and previews', async () => {
    const previewPort = await startPreview();
    const sockets = new WebSocketServer({ noServer: true });
    const seen: Array<{ authorization?: string; origin?: string; cookie?: string; remoteDevice?: string }> = [];
    const target = await startHub(
      (request, response, url) => {
        seen.push({
          authorization: request.headers.authorization,
          origin: request.headers.origin,
          cookie: request.headers.cookie,
          remoteDevice: request.headers['x-drone-remote-device'] as string | undefined,
        });
        if (url.pathname === '/api/stream') {
          response.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
          response.write('data: first\n\n');
          return;
        }
        if (request.method === 'POST') {
          const chunks: Buffer[] = [];
          request.on('data', (chunk) => chunks.push(chunk));
          request.on('end', () =>
            response.writeHead(200, { 'content-type': 'application/json' }).end(
              JSON.stringify({ echoed: Buffer.concat(chunks).toString('utf8') }),
            ),
          );
          return;
        }
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ path: `${url.pathname}${url.search}` }));
      },
      (request, socket, head) => {
        sockets.handleUpgrade(request, socket, head, (ws) => {
          ws.on('message', (data) => ws.send(`echo:${data}`));
        });
      },
    );
    const viewer = await startHub();
    const targetId = await pair(target, viewer, [
      { capability: 'hub-remote', version: 1, operations: ['hub.connect'] },
    ]);
    const home = await startHomeUi();
    const opened = await adminJson(viewer, '/api/device-mesh/remote-hub/open', {
      method: 'POST',
      body: JSON.stringify({ targetDeviceId: targetId, homeOrigin: home }),
    });
    const viewerUrl = String(opened.url);
    assert.match(viewerUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const viewerPort = Number(new URL(viewerUrl).port);

    const page = await viewerRequest(viewerUrl, '/');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('home'));
    assert.ok(page.body.includes(`"directApiBase":"http://localhost:${viewerPort}"`));
    assert.ok(page.body.includes(`"homeOrigin":"${home}"`));
    assert.ok(page.body.includes('"desktop":true'));
    assert.equal((await viewerRequest(viewerUrl, '/assets/app.js')).body, 'console.log("app")');

    const api = await viewerRequest(viewerUrl, '/api/drones/a%2Fb/fs?x=1', {
      headers: { origin: `http://127.0.0.1:${viewerPort}`, cookie: 'secret=1', 'x-drone-remote-device': 'Spoofed' },
    });
    assert.equal(api.status, 200);
    assert.equal(JSON.parse(api.body).path, '/api/drones/a%2Fb/fs?x=1');
    assert.equal(api.headers['access-control-allow-origin'], `http://127.0.0.1:${viewerPort}`);
    // The target names the viewing device itself; a viewer cannot choose the label.
    const { remoteDevice, ...forwarded } = seen.at(-1)!;
    assert.deepEqual(forwarded, { authorization: `Bearer ${target.token}`, origin: undefined, cookie: undefined });
    assert.match(decodeURIComponent(remoteDevice ?? ''), /^Viewer /);

    const posted = await viewerRequest(viewerUrl, '/api/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://localhost:${viewerPort}` },
      body: '{"hello":1}',
    });
    assert.equal(JSON.parse(posted.body).echoed, '{"hello":1}');

    const foreign = await viewerRequest(viewerUrl, '/api/echo', { headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const embedded = await viewerRequest(viewerUrl, '/api/echo', { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(embedded.status, 403);
    const rebound = await viewerRequest(viewerUrl, '/api/echo', { host: 'evil.example' });
    assert.equal(rebound.status, 421);
    // Dot segments are resolved before routing, as the next server would resolve them.
    const dotted = await viewerRequest(viewerUrl, '/assets/../api/echo', { headers: { origin: 'https://evil.example' } });
    assert.equal(dotted.status, 403);
    const dottedPreview = await viewerRequest(viewerUrl, '/../../api/echo', { host: `p${previewPort}.localhost:${viewerPort}` });
    assert.equal(JSON.parse(dottedPreview.body).path, '/api/echo');

    const stream = await fetch(`${viewerUrl}api/stream`);
    const reader = stream.body!.getReader();
    assert.ok(new TextDecoder().decode((await reader.read()).value).includes('data: first'));
    await reader.cancel();

    const ws = new WebSocket(`ws://localhost:${viewerPort}/api/drones/x/terminal/main/stream`, {
      headers: { origin: `http://127.0.0.1:${viewerPort}` },
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const reply = new Promise<string>((resolve) => ws.once('message', (data) => resolve(String(data))));
    ws.send('ping');
    assert.equal(await reply, 'echo:ping');
    ws.close();

    const previewHost = `p${previewPort}.localhost:${viewerPort}`;
    const preview = await viewerRequest(viewerUrl, '/page?q=1', {
      host: previewHost,
      headers: { origin: `http://${previewHost}`, cookie: 'sid=1' },
    });
    assert.deepEqual(JSON.parse(preview.body), {
      host: `localhost:${previewPort}`,
      origin: `http://localhost:${previewPort}`,
      path: '/page?q=1',
      cookie: 'sid=1',
    });
    const closed = await viewerRequest(viewerUrl, '/', { host: `p1.localhost:${viewerPort}` }).then(
      () => 'answered',
      () => 'failed',
    );
    assert.equal(closed, 'failed');
    const redirect = await viewerRequest(viewerUrl, '/login', { host: previewHost });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, `http://${previewHost}/home`);
    assert.deepEqual(redirect.headers['set-cookie'], ['sid=1; Path=/']);
  });

  test('revoking the grant cuts open streams and new requests', async () => {
    const target = await startHub((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: open\n\n');
    });
    const viewer = await startHub();
    const targetId = await pair(target, viewer, [
      { capability: 'hub-remote', version: 1, operations: ['hub.connect'] },
    ]);
    const home = await startHomeUi();
    const { url } = await adminJson(viewer, '/api/device-mesh/remote-hub/open', {
      method: 'POST',
      body: JSON.stringify({ targetDeviceId: targetId, homeOrigin: home }),
    });
    const stream = await fetch(`${url}api/events`);
    const reader = stream.body!.getReader();
    await reader.read();
    const viewerId = (await loadOrCreateDeviceIdentity(viewer.rootDir)).id;
    await adminJson(target, `/api/device-mesh/devices/${viewerId}`, {
      method: 'PUT',
      body: JSON.stringify({ grants: [] }),
    });
    const ended = await Promise.race([
      reader.read().then(
        (result) => result.done,
        () => true,
      ),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    assert.equal(ended, true);
    const after = await viewerRequest(url, '/api/events');
    assert.equal(after.status, 403);
  });
});
