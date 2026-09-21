import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { WebSocket } from 'ws';

import { DRONE_DAEMON_CAPABILITIES } from '../src/daemon-capabilities';
import { DaemonHttpError, handleDaemonWorkspaceRequest } from '../src/daemon-workspace';
import { subscribeDaemonDirectoryEvents, subscribeDaemonFileEvents } from '../src/hub/daemon-file-events';
import { createWorkspaceEventsWebSocketServer } from '../src/hub/workspace-events-websocket-server';
import { createFileRevisionWatcher } from '../src/hub/file-revision-watch';

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
    expect(DRONE_DAEMON_CAPABILITIES).toContain('workspace-repo-events-v1');
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
    const watchFileRevision = createFileRevisionWatcher({
      FS_EDITOR_MAX_BYTES: 1024 * 1024,
      droneRuntime: () => 'container',
      resolveDaemonClient: async () => ({ baseUrl, token: 'secret' }),
      withReadonlyDroneContainer: async (_input: unknown, run: (value: unknown) => Promise<unknown>) =>
        await run({ containerName: 'container-a' }),
      dvmExec: async (_container: string, _command: string, args: string[]) => {
        const size = Buffer.byteLength(containerContent);
        const digest = require('node:crypto').createHash('sha256').update(containerContent).digest('hex');
        return (args.at(-1) ?? '').includes('sha256sum')
          ? { code: 0, stdout: `__META__\t${size}\t1700000000\t${digest}\n`, stderr: '' }
          : { code: 0, stdout: `__META__\t${size}\t1700000000\n`, stderr: '' };
      },
    });
    const events: Array<{ event: string; revision?: unknown }> = [];
    const stop = watchFileRevision(
      { drone: { name: 'Drone A' }, droneId: 'drone-a', droneName: 'Drone A', targetPath: watchedPath },
      (event, data) => events.push({ event, revision: data.revision }),
    );
    try {
      await until(() => events.length === 1, 'snapshot');
      expect(events[0].event).toBe('snapshot');
      await until(() => streamsOpened === 1, 'daemon subscription');
      // Same size and same whole-second modification time: the case a timed stat check misses.
      containerContent = 'two';
      const startedAt = Date.now();
      fs.writeFileSync(watchedPath, 'two');
      await until(() => events.some((entry) => entry.event === 'changed'), 'changed');
      expect(Date.now() - startedAt).toBeLessThan(1_500);
      expect(events.filter((entry) => entry.event === 'changed').length).toBe(1);
      expect(events[1].revision).not.toBe(events[0].revision);
    } finally {
      stop();
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

describe('workspace events socket', () => {
  type SocketDependencies = Parameters<typeof createWorkspaceEventsWebSocketServer>[0];
  async function openExplorerSocket(
    deps: Omit<SocketDependencies, 'watchFileRevision' | 'resolveRepoPath' | 'onRepoChanged'> &
      Partial<Pick<SocketDependencies, 'resolveRepoPath' | 'onRepoChanged'>>,
  ) {
    const watched: string[] = [];
    const wss = createWorkspaceEventsWebSocketServer({
      resolveRepoPath: async () => null,
      onRepoChanged: () => undefined,
      ...deps,
      watchFileRevision: ({ targetPath }, publish) => {
        watched.push(targetPath);
        publish('snapshot', { revision: `sha256:${targetPath}` });
        return () => { watched.splice(watched.indexOf(targetPath), 1); };
      },
    });
    const hub = http.createServer();
    hub.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (webSocket) => wss.emit('connection', webSocket, req, { id: 'drone-a', drone: { name: 'Drone A' } }));
    });
    await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve));
    const client = new WebSocket(`ws://127.0.0.1:${(hub.address() as import('node:net').AddressInfo).port}`);
    const messages: Array<{ type: string; path?: string; event?: string; revision?: string; live?: boolean }> = [];
    client.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => client.once('open', () => resolve()));
    return {
      client, messages, watched,
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
      explorer.client.send(JSON.stringify({ directories: [rootAsRequested] }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(path.join(src, 'unwatched.ts'), '');
      fs.writeFileSync(path.join(dir, 'new.md'), 'new');
      await until(() => explorer.messages.length > 0, 'root change');
      expect(explorer.messages).toEqual([{ type: 'directory-changed', path: rootAsRequested }]);

      explorer.client.send(JSON.stringify({ directories: [rootAsRequested, src] }));
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
      explorer.client.send(JSON.stringify({ directories: [dir] }));
      await until(() => streamsOpened === 1, 'daemon stream');
      explorer.client.send(JSON.stringify({ directories: [dir, src] }));
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

  test('a container drone changes panel hears git status change through its daemon, and knows when it cannot', async () => {
    execFileSync('git', ['-C', dir, 'init', '--quiet']);
    fs.writeFileSync(path.join(dir, 'app.ts'), 'one');
    const order: string[] = [];
    const explorer = await openExplorerSocket({
      droneRuntime: () => 'container',
      normalizeFsPathForRuntime: (_drone, rawPath) => rawPath,
      resolveDaemonClient: async () => ({ baseUrl, token: 'secret' }) as any,
      resolveRepoPath: async () => dir,
      onRepoChanged: (context, repoPath) => order.push(`invalidate ${context.id} ${repoPath}`),
    });
    explorer.client.on('message', (raw) => order.push(JSON.parse(raw.toString()).type));
    try {
      explorer.client.send(JSON.stringify({ directories: [], files: [], repo: true }));
      await until(() => explorer.messages.some((m) => m.type === 'repo-watch' && m.live === true), 'the watch to be in place');
      expect(seenAuthorization).toBe('Bearer secret');

      fs.writeFileSync(path.join(dir, 'app.ts'), 'two');
      await until(() => explorer.messages.some((m) => m.type === 'repo-changed'), 'the edit');
      // The cached scan is dropped before the app is told to read again.
      expect(order.filter((entry) => entry !== 'repo-watch')).toEqual([`invalidate drone-a ${dir}`, 'repo-changed']);

      // The daemon goes away: the app is told to check on its own, then that it may stop, and to read again.
      const seen = explorer.messages.length;
      for (const socket of sockets) socket.destroy();
      await until(() => explorer.messages.slice(seen).some((m) => m.type === 'repo-watch' && m.live === false), 'the lost watch');
      await until(() => explorer.messages.slice(seen).some((m) => m.type === 'repo-watch' && m.live === true), 'the watch to return');
      await until(() => explorer.messages.slice(seen).some((m) => m.type === 'repo-changed'), 'the read after the gap');

      // Closing the panel ends the daemon stream.
      const streams = streamsOpened;
      explorer.client.send(JSON.stringify({ directories: [], files: [] }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const quietFrom = explorer.messages.length;
      fs.writeFileSync(path.join(dir, 'app.ts'), 'three');
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(explorer.messages.slice(quietFrom)).toEqual([]);
      expect(streamsOpened).toBe(streams);
    } finally {
      await explorer.close();
    }
  });

  test('a drone without a repository is told its git status is not watched', async () => {
    const explorer = await openExplorerSocket({
      droneRuntime: () => 'host',
      normalizeFsPathForRuntime: (_drone, rawPath) => rawPath,
      resolveDaemonClient: async () => null,
    });
    try {
      explorer.client.send(JSON.stringify({ repo: true }));
      await until(() => explorer.messages.some((m) => m.type === 'repo-watch'), 'the answer');
      expect(explorer.messages).toEqual([{ type: 'repo-watch', live: false }]);
    } finally {
      await explorer.close();
    }
  });

  test('open files are followed on the same socket, under the names the app used, until their tab closes', async () => {
    const explorer = await openExplorerSocket({
      droneRuntime: () => 'host',
      normalizeFsPathForRuntime: (_drone, rawPath) => rawPath.replace(/\/+$/, ''),
      resolveDaemonClient: async () => null,
    });
    try {
      const first = path.join(dir, 'one.md');
      const second = path.join(dir, 'two.md');
      explorer.client.send(JSON.stringify({ directories: [dir], files: [first] }));
      await until(() => explorer.messages.length === 1, 'first snapshot');
      expect(explorer.messages[0]).toEqual({ type: 'file', event: 'snapshot', path: first, revision: `sha256:${first}` });

      // Switching tabs: the first file is dropped, the second announced, the folder untouched.
      explorer.client.send(JSON.stringify({ directories: [dir], files: [second] }));
      await until(() => explorer.messages.length === 2, 'second snapshot');
      expect(explorer.messages[1].path).toBe(second);
      expect(explorer.watched).toEqual([second]);

      // Repeating what is already watched starts nothing new.
      explorer.client.send(JSON.stringify({ directories: [dir], files: [second] }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(explorer.messages.length).toBe(2);

      explorer.client.close();
      await until(() => explorer.watched.length === 0, 'watches released with the socket');
    } finally {
      await explorer.close();
    }
  });
});
