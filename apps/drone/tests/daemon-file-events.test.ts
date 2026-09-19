import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { WebSocket } from 'ws';

import { DRONE_DAEMON_CAPABILITIES } from '../src/daemon-capabilities';
import { DaemonHttpError, handleDaemonWorkspaceRequest } from '../src/daemon-workspace';
import { subscribeDaemonDirectoryEvents, subscribeDaemonFileEvents } from '../src/hub/daemon-file-events';
import { createDirectoryEventsWebSocketServer } from '../src/hub/directory-events-websocket-server';
import { createFilesystemRouteHandler } from '../src/hub/routes/filesystem-routes';

let dir = '';
let server: http.Server | null = null;
let baseUrl = '';
let streamsOpened = 0;
let seenAuthorization: string | undefined;
let sockets: Array<import('node:net').Socket> = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-file-events-'));
  streamsOpened = 0;
  sockets = [];
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://daemon');
    seenAuthorization = req.headers.authorization;
    if (req.method !== 'PUT') streamsOpened += 1;
    // The daemon's own request handler, so the routes and their validation are the real ones.
    handleDaemonWorkspaceRequest({ req, res, method: req.method ?? 'GET', pathname: url.pathname, url })
      .then((handled) => { if (!handled) { res.statusCode = 404; res.end(); } })
      .catch((error) => { res.statusCode = error instanceof DaemonHttpError ? error.statusCode : 500; res.end(String(error?.message ?? error)); });
  });
  server.on('connection', (socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  fs.rmSync(dir, { recursive: true, force: true });
});

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('container file events', () => {
  test('the daemon advertises the capability the Hub requires', () => {
    expect(DRONE_DAEMON_CAPABILITIES).toContain('workspace-file-events-v1');
  });

  test('the Hub hears writes, saves by rename, and deletion, but not neighbouring files', async () => {
    const filePath = path.join(dir, 'notes.md');
    fs.writeFileSync(filePath, 'one');
    let changes = 0;
    const stop = subscribeDaemonFileEvents(
      { resolveClient: async () => ({ baseUrl, token: 'secret' }) },
      filePath,
      () => { changes += 1; },
    );
    try {
      // Connecting counts as a possible change: nothing was watched before it.
      await until(() => changes === 1, 'ready');
      expect(seenAuthorization).toBe('Bearer secret');

      fs.writeFileSync(path.join(dir, 'other.md'), 'unrelated');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(changes).toBe(1);

      fs.writeFileSync(filePath, 'two');
      await until(() => changes === 2, 'in-place write');

      // How editors and agents usually save: a temporary file renamed over the target.
      const temporary = path.join(dir, '.notes.md.tmp');
      fs.writeFileSync(temporary, 'three');
      fs.renameSync(temporary, filePath);
      await until(() => changes === 3, 'save by rename');

      fs.writeFileSync(temporary, 'four');
      fs.renameSync(temporary, filePath);
      await until(() => changes === 4, 'second save by rename');

      fs.rmSync(filePath);
      await until(() => changes === 5, 'deletion');
    } finally {
      stop();
    }
  });

  test('reconnects after the stream drops and checks the file again', async () => {
    const filePath = path.join(dir, 'notes.md');
    fs.writeFileSync(filePath, 'one');
    let changes = 0;
    const sleeps: number[] = [];
    const stop = subscribeDaemonFileEvents(
      {
        resolveClient: async () => ({ baseUrl, token: 'secret' }),
        sleep: async (ms) => { sleeps.push(ms); },
      },
      filePath,
      () => { changes += 1; },
    );
    try {
      await until(() => changes === 1, 'first connection');
      for (const socket of sockets) socket.destroy();
      await until(() => changes === 2 && streamsOpened === 2, 'reconnection');
      expect(sleeps.length).toBe(1);
    } finally {
      stop();
    }
  });

  test('keeps retrying, with growing pauses, while the daemon cannot serve the stream', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    let stop = () => {};
    await new Promise<void>((resolve) => {
      stop = subscribeDaemonFileEvents(
        {
          resolveClient: async () => { attempts += 1; return attempts === 2 ? null : { baseUrl, token: 'secret' }; },
          fetch: (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
          sleep: async (ms) => { sleeps.push(ms); if (sleeps.length === 4) resolve(); },
        },
        '/work/notes.md',
        () => { throw new Error('no change should be reported'); },
      );
    });
    stop();
    expect(sleeps).toEqual([2_000, 4_000, 8_000, 16_000]);
  });

  test('an open container file reports a change as soon as its daemon sees the write', async () => {
    const watchedPath = path.join(dir, 'notes.md');
    fs.writeFileSync(watchedPath, 'one');
    // What the container would answer for the file; the real file above only drives the daemon's watch.
    let containerContent = 'one';
    const handler = createFilesystemRouteHandler({
      FS_EDITOR_MAX_BYTES: 1024 * 1024,
      droneRuntime: () => 'container',
      normalizeFsPathForRuntime: (_drone: unknown, rawPath: string) => rawPath,
      resolveDroneOrRespond: async () => ({ id: 'drone-a', drone: { name: 'Drone A' } }),
      resolveDroneDaemonClientForEntry: async () => ({ client: { baseUrl, token: 'secret' } }),
      withReadonlyDroneContainer: async (_input: unknown, run: (value: unknown) => unknown) =>
        await run({ containerName: 'container-a' }),
      dvmExec: async (_container: string, _command: string, args: string[]) => {
        const size = Buffer.byteLength(containerContent);
        const digest = require('node:crypto').createHash('sha256').update(containerContent).digest('hex');
        return (args.at(-1) ?? '').includes('sha256sum')
          ? { code: 0, stdout: `__META__\t${size}\t1700000000\t${digest}\n`, stderr: '' }
          : { code: 0, stdout: `__META__\t${size}\t1700000000\n`, stderr: '' };
      },
    } as any);
    let written = '';
    const closers: Array<() => void> = [];
    const res = {
      statusCode: 0, writableEnded: false, destroyed: false,
      setHeader() {}, flushHeaders() {},
      write(chunk: string) { written += chunk; return true; },
      on(event: string, listener: () => void) { if (event === 'close') closers.push(listener); },
      destroy() { this.destroyed = true; },
    };
    const req = {
      headers: {}, socket: { setTimeout() {} },
      on(event: string, listener: () => void) { if (event === 'close') closers.push(listener); },
      once() {},
    };
    await handler({
      req: req as any, res: res as any, method: 'GET',
      url: new URL(`http://hub.test/api/drones/drone-a/fs/file-events?path=${encodeURIComponent(watchedPath)}`),
      parts: ['api', 'drones', 'drone-a', 'fs', 'file-events'],
    });
    try {
      await until(() => written.includes('event: snapshot'), 'snapshot');
      await until(() => streamsOpened === 1, 'daemon subscription');
      // Same size and same whole-second modification time: the case the old timed check missed.
      containerContent = 'two';
      const startedAt = Date.now();
      fs.writeFileSync(watchedPath, 'two');
      await until(() => written.includes('event: changed'), 'changed');
      expect(Date.now() - startedAt).toBeLessThan(1_500);
      expect(written.split('event: changed').length - 1).toBe(1);
    } finally {
      for (const close of closers) close();
    }
  });

  test('the Hub hears entries come and go in the folders an explorer shows, and can swap folders on the open stream', async () => {
    const src = path.join(dir, 'src');
    const docs = path.join(dir, 'docs');
    fs.mkdirSync(src);
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(src, 'existing.ts'), 'one');
    const changed: string[] = [];
    let reconnects = 0;
    const events = subscribeDaemonDirectoryEvents(
      { resolveClient: async () => ({ baseUrl, token: 'secret' }) },
      [dir, src],
      (directory) => changed.push(directory),
      () => { reconnects += 1; },
    );
    try {
      await until(() => streamsOpened === 1, 'stream');
      await new Promise((resolve) => setTimeout(resolve, 100));

      fs.writeFileSync(path.join(src, 'new.ts'), 'new');
      await until(() => changed.includes(src), 'new file');
      expect(changed).not.toContain(dir);

      // Not watched yet: nothing is reported for it.
      fs.writeFileSync(path.join(docs, 'early.md'), 'early');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(changed).not.toContain(docs);

      // Expanding docs and collapsing src keeps the same stream.
      changed.length = 0;
      events.setDirectories([dir, docs]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(path.join(docs, 'later.md'), 'later');
      await until(() => changed.includes(docs), 'file in newly watched folder');
      fs.writeFileSync(path.join(src, 'ignored.ts'), 'ignored');
      fs.mkdirSync(path.join(dir, 'assets'));
      await until(() => changed.includes(dir), 'new folder in the root');
      expect(changed).not.toContain(src);
      expect(streamsOpened).toBe(1);
      expect(reconnects).toBe(0);

      // A dropped connection comes back watching the current folders and says so.
      for (const socket of sockets) socket.destroy();
      await until(() => reconnects === 1, 'reconnection');
      changed.length = 0;
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.rmSync(path.join(docs, 'later.md'));
      await until(() => changed.includes(docs), 'removal after reconnecting');
    } finally {
      events.close();
    }
  });
});

describe('explorer folder events socket', () => {
  async function openExplorerSocket(deps: Parameters<typeof createDirectoryEventsWebSocketServer>[0]) {
    const wss = createDirectoryEventsWebSocketServer(deps);
    const hub = http.createServer();
    hub.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (webSocket) => wss.emit('connection', webSocket, req, { drone: { name: 'Drone A' } }));
    });
    await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve));
    const client = new WebSocket(`ws://127.0.0.1:${(hub.address() as import('node:net').AddressInfo).port}`);
    const messages: Array<{ type: string; path?: string }> = [];
    client.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => client.once('open', () => resolve()));
    return {
      client, messages,
      close: async () => {
        const connected = [client, ...wss.clients];
        const closed = connected.map((socket) => new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) resolve();
          else socket.once('close', () => resolve());
        }));
        for (const socket of connected) socket.terminate();
        await Promise.all(closed);
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        hub.closeAllConnections();
        await new Promise<void>((resolve) => hub.close(() => resolve()));
      },
    };
  }

  test('a host drone explorer hears changes under the names it used, and swaps folders on the open socket', async () => {
    const src = path.join(dir, 'src');
    fs.mkdirSync(src);
    const explorer = await openExplorerSocket({
      droneRuntime: () => 'host',
      normalizeFsPathForRuntime: (_drone, rawPath) => rawPath.replace(/\/+$/, ''),
      resolveDaemonClient: async () => null,
    });
    try {
      // The explorer names the root with a trailing slash; events must use that same name.
      const rootAsRequested = `${dir}/`;
      explorer.client.send(JSON.stringify({ paths: [rootAsRequested] }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(path.join(src, 'unwatched.ts'), '');
      fs.writeFileSync(path.join(dir, 'new.md'), 'new');
      await until(() => explorer.messages.length > 0, 'root change');
      expect(explorer.messages).toEqual([{ type: 'changed', path: rootAsRequested }]);

      explorer.client.send(JSON.stringify({ paths: [rootAsRequested, src] }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(path.join(src, 'inner.ts'), 'inner');
      await until(() => explorer.messages.some((message) => message.path === src), 'expanded folder change');
    } finally {
      await explorer.close();
    }
  });

  test('a container drone explorer hears its daemon, through one daemon stream', async () => {
    const src = path.join(dir, 'src');
    fs.mkdirSync(src);
    const explorer = await openExplorerSocket({
      droneRuntime: () => 'container',
      normalizeFsPathForRuntime: (_drone, rawPath) => rawPath,
      resolveDaemonClient: async () => ({ baseUrl, token: 'secret' }),
    });
    try {
      explorer.client.send(JSON.stringify({ paths: [dir] }));
      await until(() => streamsOpened === 1, 'daemon stream');
      explorer.client.send(JSON.stringify({ paths: [dir, src] }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(path.join(src, 'inner.ts'), 'inner');
      await until(() => explorer.messages.some((message) => message.path === src), 'expanded folder change');
      expect(streamsOpened).toBe(1);

      for (const socket of sockets) socket.destroy();
      await until(() => explorer.messages.some((message) => message.type === 'resync'), 'resync after the daemon link dropped');
    } finally {
      await explorer.close();
    }
  });
});
