import { expect, test } from 'bun:test';
import http from 'node:http';
import { DeviceHtmlPreviewSessions } from '../src/hub/device-mesh/device-html-preview-sessions';

const GRANT = { capability: 'drone-control', version: 1, operations: ['file.preview'] };

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}` };
}

test('HTML preview sessions serve one drone media by URL while the grant lasts', async () => {
  const hubRequests: Array<{ url: string; range?: string; auth?: string }> = [];
  const hub = await listen((request, response) => {
    hubRequests.push({ url: request.url!, range: request.headers.range, auth: request.headers.authorization });
    const path = new URL(request.url!, 'http://hub').searchParams.get('path');
    if (path === '/work/site/notes.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('secret');
      return;
    }
    if (path === '/work/site/missing.png') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(request.headers.range ? 206 : 200, { 'content-type': 'image/png', 'content-length': '3' }).end('png');
  });
  let device: any = { id: 'phone', grants: [GRANT] };
  const listeners = new Set<() => void>();
  const store = {
    read: async () => ({ devices: { phone: device } }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let endpoint = '';
  const sessions = new DeviceHtmlPreviewSessions({ baseUrl: hub.base, apiToken: 'hub-token' }, store as any, () => endpoint);
  const publicServer = await listen((request, response) => {
    void sessions.handlePublic(request, response, new URL(request.url!, endpoint)).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  endpoint = publicServer.base;
  try {
    const { mediaBase } = sessions.create('phone', 'drone a');
    expect(mediaBase.startsWith(`${endpoint}/api/device-mesh/v2/html-preview/`)).toBe(true);

    const image = await fetch(new URL('img/a%20b.png', `${mediaBase}work/site/index.html`), { headers: { range: 'bytes=1-' } });
    expect(image.status).toBe(206);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(await image.text()).toBe('png');
    expect(hubRequests.at(-1)).toEqual({
      url: '/api/drones/drone%20a/fs/media?path=%2Fwork%2Fsite%2Fimg%2Fa%20b.png&maxBytes=33554432',
      range: 'bytes=1-',
      auth: 'Bearer hub-token',
    });

    // Only image and video bytes leave the Hub, and only for a live session.
    expect((await fetch(`${mediaBase}work/site/notes.txt`)).status).toBe(415);
    expect((await fetch(`${mediaBase}work/site/missing.png`)).status).toBe(404);
    expect((await fetch(`${mediaBase.replace(/[^/]+\/$/, 'wrong/')}work/a.png`)).status).toBe(401);
    expect((await fetch(`${mediaBase}work/a.png`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${mediaBase}%E0.png`)).status).toBe(400);

    // Many images at once queue for a slot instead of failing.
    const many = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(`${mediaBase}work/${i}.png`)));
    expect(many.map((response) => response.status).every((status) => status === 200)).toBe(true);

    device = { ...device, grants: [] };
    for (const listener of listeners) listener();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await fetch(`${mediaBase}work/a.png`)).status).toBe(401);
  } finally {
    sessions.close();
    publicServer.server.close();
    hub.server.close();
  }
});

test('each device keeps a bounded number of preview sessions', () => {
  const store = { read: async () => ({ devices: {} }), subscribe: () => () => {} };
  const sessions = new DeviceHtmlPreviewSessions({ baseUrl: 'http://hub', apiToken: 't' }, store as any, () => 'https://hub.test');
  const first = sessions.create('phone', 'd').mediaBase;
  for (let i = 0; i < 16; i += 1) sessions.create('phone', 'd');
  expect((sessions as any).sessions.size).toBe(16);
  expect(first).toStartWith('https://hub.test/api/device-mesh/v2/html-preview/');
  sessions.close();
});

test('queued media requests keep concurrent Hub reads within the limit', async () => {
  let running = 0;
  let peak = 0;
  const hub = await listen((_request, response) => {
    running += 1;
    peak = Math.max(peak, running);
    setTimeout(() => {
      running -= 1;
      response.writeHead(200, { 'content-type': 'image/png' }).end('png');
    }, 5);
  });
  const store = {
    read: async () => ({ devices: { phone: { id: 'phone', grants: [GRANT] } } }),
    subscribe: () => () => {},
  };
  let endpoint = '';
  const sessions = new DeviceHtmlPreviewSessions({ baseUrl: hub.base, apiToken: 't' }, store as any, () => endpoint);
  const publicServer = await listen((request, response) => {
    void sessions.handlePublic(request, response, new URL(request.url!, endpoint));
  });
  endpoint = publicServer.base;
  try {
    const { mediaBase } = sessions.create('phone', 'd');
    // Waves arrive while earlier ones finish. The slot handoff itself is a microtask-wide
    // window HTTP timing rarely hits; this checks the bound holds under steady load.
    const waves = await Promise.all(Array.from({ length: 6 }, (_, wave) =>
      new Promise((resolve) => setTimeout(resolve, wave * 3)).then(() =>
        Promise.all(Array.from({ length: 10 }, (_, i) => fetch(`${mediaBase}w/${wave}-${i}.png`).then((r) => r.status))),
      ),
    ));
    expect(waves.flat().every((status) => status === 200)).toBe(true);
    expect(peak).toBeLessThanOrEqual(8);
    expect((sessions as any).handedOff).toBe(0);
  } finally {
    sessions.close();
    publicServer.server.close();
    hub.server.close();
  }
});
