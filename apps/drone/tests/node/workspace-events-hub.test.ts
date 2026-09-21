// A real Hub on Node, as it runs in production: the workspace events socket end to end,
// including the upgrade route and its token check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { WebSocket } from 'ws';

import { resetDroneRootDirForTests } from '../../src/host/paths';
import { getDroneLifecycleRepository } from '../../src/host/drone-lifecycle-repository';
import { startDroneHubApiServer } from '../../src/hub/server';

const token = 'test-token';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-events-hub-'));
const previous = { xdg: process.env.XDG_DATA_HOME, data: process.env.DRONE_DATA_DIR };
let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
let baseUrl = '';

before(async () => {
  process.env.XDG_DATA_HOME = path.join(tempRoot, 'xdg-data');
  process.env.DRONE_DATA_DIR = path.join(tempRoot, 'data', 'drone');
  fs.mkdirSync(path.join(process.env.XDG_DATA_HOME, 'drone'), { recursive: true });
  fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
  resetDroneRootDirForTests();
  server = await startDroneHubApiServer({ port: 0, apiToken: token });
  baseUrl = `http://${server.host}:${server.port}`;
});

after(async () => {
  if (server) await server.close();
  for (const [key, value] of [['XDG_DATA_HOME', previous.xdg], ['DRONE_DATA_DIR', previous.data]] as const) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  resetDroneRootDirForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function until(found: () => unknown, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!found()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function openEvents(droneId: string, withToken = true) {
  const url = `${baseUrl.replace(/^http/, 'ws')}/api/drones/${encodeURIComponent(droneId)}/fs/events${withToken ? `?token=${token}` : ''}`;
  const socket = new WebSocket(url);
  const messages: any[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, messages };
}

test('the socket is behind the same token as the rest of the API', async () => {
  await assert.rejects(openEvents('any-drone', false), /401/);
});

test('an open host file and its folder are followed over the workspace events socket', async () => {
  const droneId = 'host-file-events';
  const droneRoot = path.join(tempRoot, droneId);
  const notePath = path.join(droneRoot, 'live.md');
  fs.mkdirSync(droneRoot, { recursive: true });
  fs.writeFileSync(notePath, '# First\n');
  const now = new Date().toISOString();
  const repository = await getDroneLifecycleRepository();
  assert.ok(repository, 'the drone store is available on Node');
  await repository.upsert('real', droneId, {
    id: droneId, name: droneId, runtime: 'host', hostPort: 4555, containerPort: 7777, token: 'host-token',
    cwd: droneRoot, repoPath: '', createdAt: now,
    chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
  } as any);

  const { socket, messages } = await openEvents(droneId);
  try {
    socket.send(JSON.stringify({ directories: [droneRoot], files: [notePath] }));
    await until(() => messages.find((message) => message.type === 'file' && message.event === 'snapshot'), 'snapshot');
    const snapshot = messages.find((message) => message.event === 'snapshot');
    assert.equal(snapshot.path, notePath);
    assert.match(snapshot.revision, /^sha256:[a-f0-9]{64}$/);

    fs.writeFileSync(notePath, '# Second\n');
    await until(() => messages.find((message) => message.event === 'changed'), 'changed');
    const changed = messages.find((message) => message.event === 'changed');
    assert.notEqual(changed.revision, snapshot.revision);
    // Writing into an existing file is not a change to the folder's entries.
    assert.equal(messages.some((message) => message.type === 'directory-changed'), false);

    fs.writeFileSync(path.join(droneRoot, 'new.md'), 'new');
    await until(() => messages.find((message) => message.type === 'directory-changed'), 'folder change');
    assert.equal(messages.find((message) => message.type === 'directory-changed').path, droneRoot);

    // Closing the tab stops its events; the folder is still followed.
    socket.send(JSON.stringify({ directories: [droneRoot], files: [] }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const seen = messages.length;
    fs.writeFileSync(notePath, '# Third\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(messages.slice(seen).some((message) => message.type === 'file'), false);
  } finally {
    socket.terminate();
  }
});

test('a host drone changes panel is told when git status changes, and its next read is not a cached one', async () => {
  const droneId = 'host-repo-events';
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot, 'repo-')));
  const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, 'app.ts'), 'export const one = 1;\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'first');
  const now = new Date().toISOString();
  const repository = await getDroneLifecycleRepository();
  assert.ok(repository, 'the drone store is available on Node');
  await repository.upsert('real', droneId, {
    id: droneId, name: droneId, runtime: 'host', hostPort: 4556, containerPort: 7777, token: 'host-token',
    cwd: repoRoot, repoPath: repoRoot, repoAttached: true, createdAt: now,
    chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
  } as any);
  const changedCount = async () => {
    const response = await fetch(`${baseUrl}/api/drones/${droneId}/repo/changes`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    return ((await response.json()) as any).counts.changed as number;
  };

  const { socket, messages } = await openEvents(droneId);
  try {
    socket.send(JSON.stringify({ directories: [], files: [], repo: true }));
    await until(() => messages.find((message) => message.type === 'repo-watch' && message.live === true), 'the watch to be in place');
    assert.equal(await changedCount(), 0);

    // Inside the two seconds the scan above stays cached for.
    fs.writeFileSync(path.join(repoRoot, 'app.ts'), 'export const one = 2;\n');
    await until(() => messages.find((message) => message.type === 'repo-changed'), 'the edit');
    assert.equal(await changedCount(), 1);

    const seen = messages.length;
    git('commit', '--quiet', '-am', 'second');
    await until(() => messages.slice(seen).find((message) => message.type === 'repo-changed'), 'the commit');
    assert.equal(await changedCount(), 0);

    // The Hub's own reads settle: they are not changes that ask for another read.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const settled = messages.length;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(messages.length, settled);
  } finally {
    socket.terminate();
  }
});

test('Companion home files and folders are followed like a host drone, with no watcher of their own', async () => {
  const listing = await fetch(`${baseUrl}/api/drones/companion-home/fs/list?path=`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(listing.status, 200);
  const home = String(((await listing.json()) as any)?.path ?? '');
  assert.ok(home.startsWith(tempRoot), `Companion home ${home} should be inside the test data folder`);
  const notePath = path.join(home, 'notes.md');
  fs.writeFileSync(notePath, 'first');

  const { socket, messages } = await openEvents('companion-home');
  try {
    socket.send(JSON.stringify({ directories: [home], files: [notePath] }));
    await until(() => messages.find((message) => message.event === 'snapshot'), 'snapshot');
    // Companion rewriting a file the user has open.
    fs.writeFileSync(notePath, 'second, written by Companion');
    await until(() => messages.find((message) => message.event === 'changed' && message.path === notePath), 'open tab change');
    // Companion saving an attachment into a shown folder.
    fs.writeFileSync(path.join(home, 'attachment.txt'), 'new');
    await until(() => messages.find((message) => message.type === 'directory-changed' && message.path === home), 'folder change');
  } finally {
    socket.terminate();
  }
});
