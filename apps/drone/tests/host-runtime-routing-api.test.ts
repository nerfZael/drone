import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`host runtime routing api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping host runtime routing api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('host runtime routing api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-host-runtime-routing-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(tempRoot, 'data', 'drone');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';

  const apiFetch = async (p: string, init?: RequestInit) => {
    const r = await fetch(`${baseUrl}${p}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
    const text = await r.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    return { r, data, text };
  };

  const runGit = (repoRoot: string, args: string[]) => {
    const r = Bun.spawnSync({
      cmd: ['git', '-C', repoRoot, ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (r.exitCode !== 0) {
      const stderr = Buffer.from(r.stderr).toString('utf8').trim();
      const stdout = Buffer.from(r.stdout).toString('utf8').trim();
      throw new Error(`git ${args.join(' ')} failed: ${stderr || stdout || `exit ${r.exitCode}`}`);
    }
    return Buffer.from(r.stdout).toString('utf8');
  };

  const seedHostDrone = async (id: string, overrides?: Partial<any>) => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[id] = {
        id,
        name: id,
        runtime: 'host',
        hostPort: 4555,
        containerPort: 7777,
        token: 'host-token',
        cwd: tempRoot,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [],
          },
        },
        ...(overrides ?? {}),
      };
    });
  };

  beforeAll(async () => {
    fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
    fs.mkdirSync(droneDataDir, { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.DRONE_DATA_DIR = droneDataDir;
    resetDroneRootDirForTests();
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns synthetic ports for host runtime drone', async () => {
    const droneId = 'host-ports';
    await seedHostDrone(droneId, { hostPort: 4888, containerPort: 3000 });

    const resp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/ports`);
    expect(resp.r.status).toBe(200);
    expect(resp.data?.ok).toBe(true);
    expect(Array.isArray(resp.data?.ports)).toBe(true);
    expect(resp.data?.ports).toEqual([{ hostPort: 4888, containerPort: 3000 }]);
  });

  test('supports fs routes for host runtime drone', async () => {
    const droneId = 'host-fs';
    const droneRoot = path.join(tempRoot, 'host-fs-root');
    fs.mkdirSync(droneRoot, { recursive: true });

    const notePath = path.join(droneRoot, 'note.txt');
    const largeNotePath = path.join(droneRoot, 'large-note.txt');
    const imagePath = path.join(droneRoot, 'thumb.png');
    const videoPath = path.join(droneRoot, 'demo.mp4');
    fs.writeFileSync(notePath, 'hello\n', 'utf8');
    fs.writeFileSync(largeNotePath, `${'x'.repeat(700 * 1024)}\n`, 'utf8');
    fs.writeFileSync(
      imagePath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7bKJYAAAAASUVORK5CYII=', 'base64'),
    );
    fs.writeFileSync(videoPath, Buffer.alloc(2 * 1024 * 1024 + 1));

    await seedHostDrone(droneId, { cwd: droneRoot, repoPath: '' });

    const dronesResp = await apiFetch('/api/drones');
    expect(dronesResp.r.status).toBe(200);
    const listed = Array.isArray(dronesResp.data?.drones)
      ? (dronesResp.data.drones as Array<{ id?: string; cwd?: string }>).find((d) => String(d?.id ?? '') === droneId)
      : null;
    expect(String(listed?.cwd ?? '')).toBe(droneRoot);

    const listResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/list`);
    expect(listResp.r.status).toBe(200);
    expect(listResp.data?.ok).toBe(true);
    expect(String(listResp.data?.path ?? '')).toBe(droneRoot);
    const entryNames = ((listResp.data?.entries ?? []) as Array<{ name?: string }>).map((e) => String(e?.name ?? ''));
    expect(entryNames).toContain('note.txt');
    expect(entryNames).toContain('thumb.png');

    const readResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(notePath)}`,
    );
    expect(readResp.r.status).toBe(200);
    expect(readResp.data?.ok).toBe(true);
    expect(readResp.data?.kind).toBe('text');
    expect(String(readResp.data?.content ?? '')).toBe('hello\n');
    expect(String(readResp.data?.revision ?? '')).toMatch(/^sha256:[a-f0-9]{64}$/);

    const metadataResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(notePath)}&metadata=1`,
    );
    expect(metadataResp.r.status).toBe(200);
    expect(metadataResp.data?.revision).toBe(readResp.data?.revision);
    const fingerprintResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(notePath)}&metadata=1&revision=0`,
    );
    expect(fingerprintResp.r.status).toBe(200);
    expect(fingerprintResp.data?.revision).toBeNull();

    const largeReadResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(largeNotePath)}`,
    );
    expect(largeReadResp.r.status).toBe(200);
    expect(largeReadResp.data?.ok).toBe(true);
    expect(largeReadResp.data?.kind).toBe('text');
    expect(String(largeReadResp.data?.content ?? '').length).toBe(700 * 1024 + 1);

    const chunkResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/text-chunk?path=${encodeURIComponent(largeNotePath)}&offset=10&limit=32`,
    );
    expect(chunkResp.r.status).toBe(200);
    expect(chunkResp.data?.ok).toBe(true);
    expect(chunkResp.data?.kind).toBe('text-chunk');
    expect(chunkResp.data?.offset).toBe(10);
    expect(chunkResp.data?.nextOffset).toBe(42);
    expect(String(chunkResp.data?.content ?? '')).toBe('x'.repeat(32));

    const binaryChunkResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/chunk?path=${encodeURIComponent(imagePath)}&offset=2&limit=16`,
    );
    expect(binaryChunkResp.r.status).toBe(200);
    expect(binaryChunkResp.data?.kind).toBe('binary-chunk');
    expect(binaryChunkResp.data?.offset).toBe(2);
    expect(Buffer.from(String(binaryChunkResp.data?.dataBase64 ?? ''), 'base64').length).toBe(16);
    expect(binaryChunkResp.data?.content).toBeUndefined();

    const mediaMetadataResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(videoPath)}&metadata=1`,
    );
    expect(mediaMetadataResp.r.status).toBe(200);
    expect(mediaMetadataResp.data?.kind).toBe('video');
    expect(mediaMetadataResp.data?.mime).toBe('video/mp4');
    expect(mediaMetadataResp.data?.size).toBe(2 * 1024 * 1024 + 1);
    expect(mediaMetadataResp.data?.content).toBeUndefined();
    expect(String(mediaMetadataResp.data?.revision ?? '')).toMatch(/^sha256:[a-f0-9]{64}$/);

    fs.writeFileSync(notePath, 'changed elsewhere\n');
    const conflictResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: notePath,
        content: 'stale editor content\n',
        expectedRevision: readResp.data?.revision,
      }),
    });
    expect(conflictResp.r.status).toBe(409);
    expect(conflictResp.data?.code).toBe('FILE_CONFLICT');
    expect(String(conflictResp.data?.currentRevision ?? '')).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fs.readFileSync(notePath, 'utf8')).toBe('changed elsewhere\n');

    const writeResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: notePath, content: 'updated\n' }),
    });
    expect(writeResp.r.status).toBe(200);
    expect(writeResp.data?.ok).toBe(true);

    const rereadResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(notePath)}`,
    );
    expect(rereadResp.r.status).toBe(200);
    expect(String(rereadResp.data?.content ?? '')).toBe('updated\n');

    const uploadBody = {
      path: droneRoot,
      name: 'upload.txt',
      dataBase64: Buffer.from('uploaded\n', 'utf8').toString('base64'),
    };
    const uploadResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(uploadBody),
    });
    expect(uploadResp.r.status).toBe(200);
    expect(uploadResp.data?.ok).toBe(true);
    const uploadedPath = path.join(droneRoot, 'upload.txt');
    expect(String(uploadResp.data?.path ?? '')).toBe(uploadedPath);

    const createFolderResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create-directory', targetDir: droneRoot, name: 'nested' }),
    });
    expect(createFolderResp.r.status).toBe(200);
    expect(createFolderResp.data?.ok).toBe(true);
    const nestedDir = path.join(droneRoot, 'nested');
    expect(fs.statSync(nestedDir).isDirectory()).toBe(true);

    const createFileResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create-file', targetDir: nestedDir, name: 'draft.txt' }),
    });
    expect(createFileResp.r.status).toBe(200);
    const draftPath = path.join(nestedDir, 'draft.txt');
    expect(fs.statSync(draftPath).isFile()).toBe(true);

    const invalidNameResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create-file', targetDir: nestedDir, name: 'bad/name.txt' }),
    });
    expect(invalidNameResp.r.status).toBe(400);
    expect(invalidNameResp.data?.ok).toBe(false);

    const renameResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'rename', path: draftPath, name: 'renamed.txt' }),
    });
    expect(renameResp.r.status).toBe(200);
    const renamedPath = path.join(nestedDir, 'renamed.txt');
    expect(fs.existsSync(draftPath)).toBe(false);
    expect(fs.statSync(renamedPath).isFile()).toBe(true);

    const copyResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'copy', paths: [renamedPath], targetDir: droneRoot }),
    });
    expect(copyResp.r.status).toBe(200);
    const copiedPath = path.join(droneRoot, 'renamed.txt');
    expect(fs.statSync(copiedPath).isFile()).toBe(true);

    const moveResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'move', paths: [copiedPath], targetDir: nestedDir }),
    });
    expect(moveResp.r.status).toBe(409);
    expect(moveResp.data?.ok).toBe(false);

    const moveSourcePath = path.join(droneRoot, 'move-me.txt');
    fs.writeFileSync(moveSourcePath, 'move me\n', 'utf8');
    const moveOkResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'move', paths: [moveSourcePath], targetDir: nestedDir }),
    });
    expect(moveOkResp.r.status).toBe(200);
    expect(fs.existsSync(moveSourcePath)).toBe(false);
    expect(fs.statSync(path.join(nestedDir, 'move-me.txt')).isFile()).toBe(true);

    const copyIntoSelfResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'copy', paths: [nestedDir], targetDir: nestedDir }),
    });
    expect(copyIntoSelfResp.r.status).toBe(400);
    expect(copyIntoSelfResp.data?.ok).toBe(false);

    const deleteResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/fs/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', paths: [nestedDir] }),
    });
    expect(deleteResp.r.status).toBe(200);
    expect(fs.existsSync(nestedDir)).toBe(false);

    const downloadResp = await fetch(
      `${baseUrl}/api/drones/${encodeURIComponent(droneId)}/fs/download?path=${encodeURIComponent(uploadedPath)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(downloadResp.status).toBe(200);
    expect(String(downloadResp.headers.get('content-disposition') ?? '')).toContain('upload.txt');
    expect(await downloadResp.text()).toBe('uploaded\n');

    const mediaResp = await fetch(
      `${baseUrl}/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(imagePath)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(mediaResp.status).toBe(200);
    expect(String(mediaResp.headers.get('content-type') ?? '')).toContain('image/');

    const thumbResp = await fetch(
      `${baseUrl}/api/drones/${encodeURIComponent(droneId)}/fs/thumb?path=${encodeURIComponent(imagePath)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(thumbResp.status).toBe(200);
    expect(String(thumbResp.headers.get('content-type') ?? '')).toContain('image/');
  });

  test('streams hash revision changes for an open host file', async () => {
    const droneId = 'host-file-events';
    const droneRoot = path.join(tempRoot, 'host-file-events');
    const notePath = path.join(droneRoot, 'live.md');
    fs.mkdirSync(droneRoot, { recursive: true });
    fs.writeFileSync(notePath, '# First\n');
    await seedHostDrone(droneId, { cwd: droneRoot, repoPath: '' });

    const controller = new AbortController();
    const response = await fetch(
      `${baseUrl}/api/drones/${encodeURIComponent(droneId)}/fs/file-events?path=${encodeURIComponent(notePath)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let buffered = '';
    const readEvent = async (eventName: string) => {
      const deadline = Date.now() + 4_000;
      while (!buffered.includes(`event: ${eventName}\n`)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timed out waiting for ${eventName}`);
        const result = await Promise.race([
          reader!.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`timed out waiting for ${eventName}`)), remaining),
          ),
        ]);
        if (result.done) throw new Error(`file event stream closed before ${eventName}`);
        buffered += decoder.decode(result.value, { stream: true });
      }
      const marker = buffered.indexOf('\n\n');
      const event = marker >= 0 ? buffered.slice(0, marker) : buffered;
      if (marker >= 0) buffered = buffered.slice(marker + 2);
      return event;
    };

    try {
      const snapshot = await readEvent('snapshot');
      expect(snapshot).toMatch(/"revision":"sha256:[a-f0-9]{64}"/);
      fs.writeFileSync(notePath, '# Second\n');
      const changed = await readEvent('changed');
      expect(changed).toMatch(/"revision":"sha256:[a-f0-9]{64}"/);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
    }
  });

  test('supports repo routes for host runtime drone', async () => {
    const droneId = 'host-repo';
    const repoRoot = path.join(tempRoot, 'host-repo-root');
    fs.mkdirSync(repoRoot, { recursive: true });
    runGit(repoRoot, ['init']);
    runGit(repoRoot, ['config', 'user.email', 'host-runtime@example.com']);
    runGit(repoRoot, ['config', 'user.name', 'Host Runtime']);

    const trackedPath = path.join(repoRoot, 'tracked.txt');
    fs.writeFileSync(trackedPath, 'base\n', 'utf8');
    runGit(repoRoot, ['add', 'tracked.txt']);
    runGit(repoRoot, ['commit', '-m', 'init']);
    fs.writeFileSync(trackedPath, 'base\nchanged\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'new.txt'), 'new\n', 'utf8');

    await seedHostDrone(droneId, {
      cwd: repoRoot,
      repoPath: repoRoot,
    });

    const changesResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/repo/changes`);
    expect(changesResp.r.status).toBe(200);
    expect(changesResp.data?.ok).toBe(true);
    expect(String(changesResp.data?.repoRoot ?? '')).toBe(repoRoot);
    const changePaths = ((changesResp.data?.entries ?? []) as Array<{ path?: string }>).map((entry) =>
      String(entry?.path ?? ''),
    );
    expect(changePaths).toContain('tracked.txt');
    expect(changePaths).toContain('new.txt');

    const diffResp = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/repo/diff?path=${encodeURIComponent('tracked.txt')}&kind=unstaged`,
    );
    expect(diffResp.r.status).toBe(200);
    expect(diffResp.data?.ok).toBe(true);
    expect(String(diffResp.data?.path ?? '')).toBe('tracked.txt');
    expect(String(diffResp.data?.kind ?? '')).toBe('unstaged');
    expect(String(diffResp.data?.diff ?? '')).toContain('+changed');

    const changeAction = async (filePath: string, action: 'stage' | 'unstage' | 'discard') =>
      await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/repo/changes/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: filePath, action }),
      });

    const stageResp = await changeAction('tracked.txt', 'stage');
    expect(stageResp.r.status).toBe(200);
    expect(stageResp.data?.action).toBe('stage');
    expect(runGit(repoRoot, ['diff', '--cached', '--name-only'])).toContain('tracked.txt');

    const unstageResp = await changeAction('tracked.txt', 'unstage');
    expect(unstageResp.r.status).toBe(200);
    expect(unstageResp.data?.action).toBe('unstage');
    expect(runGit(repoRoot, ['diff', '--cached', '--name-only']).trim()).toBe('');

    const discardTrackedResp = await changeAction('tracked.txt', 'discard');
    expect(discardTrackedResp.r.status).toBe(200);
    expect(fs.readFileSync(trackedPath, 'utf8')).toBe('base\n');

    const discardUntrackedResp = await changeAction('new.txt', 'discard');
    expect(discardUntrackedResp.r.status).toBe(200);
    expect(fs.existsSync(path.join(repoRoot, 'new.txt'))).toBe(false);
  });

  test('returns host same-repo semantics for pull/push/reseed routes on host runtime', async () => {
    const droneId = 'host-repo-same-repo';
    const repoRoot = path.join(tempRoot, 'host-repo-same-repo-root');
    fs.mkdirSync(repoRoot, { recursive: true });
    runGit(repoRoot, ['init']);
    runGit(repoRoot, ['config', 'user.email', 'host-runtime@example.com']);
    runGit(repoRoot, ['config', 'user.name', 'Host Runtime']);
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'base\n', 'utf8');
    runGit(repoRoot, ['add', 'tracked.txt']);
    runGit(repoRoot, ['commit', '-m', 'init']);

    await seedHostDrone(droneId, {
      cwd: repoRoot,
      repoPath: repoRoot,
    });

    const checks: Array<{ method: 'GET' | 'POST'; endpoint: string; mode: string }> = [
      { method: 'GET', endpoint: '/repo/pull/changes', mode: 'host-same-repo' },
      { method: 'GET', endpoint: '/repo/pull/diff?path=tracked.txt', mode: 'host-same-repo' },
      { method: 'POST', endpoint: '/repo/reseed', mode: 'host-noop' },
      { method: 'POST', endpoint: '/repo/push', mode: 'host-noop' },
      { method: 'POST', endpoint: '/repo/pull', mode: 'host-noop' },
    ];

    for (const check of checks) {
      const resp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}${check.endpoint}`, {
        method: check.method,
      });
      if (resp.r.status !== 200) {
        throw new Error(`${check.endpoint} failed with ${resp.r.status}: ${JSON.stringify(resp.data)}`);
      }
      expect(resp.r.status).toBe(200);
      expect(resp.data?.ok).toBe(true);
      expect(String(resp.data?.mode ?? '')).toBe(check.mode);
      if (check.endpoint.startsWith('/repo/pull/changes')) {
        expect(Number(resp.data?.counts?.changed ?? -1)).toBe(0);
      }
      if (check.endpoint.startsWith('/repo/pull/diff')) {
        expect(String(resp.data?.path ?? '')).toBe('tracked.txt');
        expect(String(resp.data?.diff ?? '')).toBe('');
      }
    }
  });

  test('rejects peer drone sync route on host runtime targets, including probe requests', async () => {
    const droneId = 'host-peer-sync';
    const repoRoot = path.join(tempRoot, 'host-peer-sync-root');
    fs.mkdirSync(repoRoot, { recursive: true });
    runGit(repoRoot, ['init']);
    runGit(repoRoot, ['config', 'user.email', 'host-runtime@example.com']);
    runGit(repoRoot, ['config', 'user.name', 'Host Runtime']);
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'base\n', 'utf8');
    runGit(repoRoot, ['add', 'tracked.txt']);
    runGit(repoRoot, ['commit', '-m', 'init']);

    await seedHostDrone(droneId, {
      cwd: repoRoot,
      repoPath: repoRoot,
    });

    const resp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/repo/pull-from-drone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceDroneId: 'peer-source' }),
    });
    expect(resp.r.status).toBe(409);
    expect(resp.data?.ok).toBe(false);
    expect(String(resp.data?.code ?? '')).toBe('peer_sync_unsupported_runtime');

    const probeResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/repo/pull-from-drone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceDroneId: 'peer-source', probeOnly: true }),
    });
    expect(probeResp.r.status).toBe(409);
    expect(probeResp.data?.ok).toBe(false);
    expect(String(probeResp.data?.code ?? '')).toBe('peer_sync_unsupported_runtime');
  });

  test('stages deferred image attachments on host runtime prompts', async () => {
    const droneId = 'host-prompt-attachments';
    const droneRoot = path.join(tempRoot, 'host-prompt-root');
    fs.mkdirSync(droneRoot, { recursive: true });
    await seedHostDrone(droneId, {
      cwd: droneRoot,
      chats: {
        default: {
          createdAt: new Date().toISOString(),
          agent: { kind: 'builtin', id: 'cursor' },
          turns: [],
          pendingPrompts: [
            {
              id: 'prior-queued',
              at: new Date().toISOString(),
              prompt: 'prior',
              state: 'queued',
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      },
    });

    const promptResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'queued with image',
        attachments: [
          {
            name: 'pixel.png',
            mime: 'image/png',
            dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7bKJYAAAAASUVORK5CYII=',
          },
        ],
      }),
    });
    expect(promptResp.r.status).toBe(202);
    expect(String(promptResp.data?.pendingState ?? '')).toBe('queued');
    const promptId = String(promptResp.data?.promptId ?? '').trim();
    expect(promptId.length).toBeGreaterThan(0);

    const regAny: any = await loadRegistry();
    const pending = regAny?.drones?.[droneId]?.chats?.default?.pendingPrompts;
    const rows = Array.isArray(pending) ? pending : [];
    const row = rows.find((item: any) => String(item?.id ?? '').trim() === promptId);
    expect(row).toBeTruthy();
    const attachments = Array.isArray(row?.attachments) ? row.attachments : [];
    expect(attachments.length).toBe(1);
    const stagedPath = String(attachments[0]?.path ?? '').trim();
    expect(stagedPath.length).toBeGreaterThan(0);
    expect(fs.existsSync(stagedPath)).toBe(true);
  });

  test('queues prompt rows while drone is still pending startup', async () => {
    const droneId = 'pending-startup-prompt';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.pending = reg.pending ?? {};
      reg.pending[droneId] = {
        id: droneId,
        name: droneId,
        runtime: 'container',
        phase: 'starting',
        message: 'Starting…',
        createdAt: now,
        updatedAt: now,
      };
    });

    const promptResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello while starting' }),
    });
    expect(promptResp.r.status).toBe(202);
    expect(promptResp.data?.ok).toBe(true);
    expect(String(promptResp.data?.pendingState ?? '')).toBe('queued');
    const promptId = String(promptResp.data?.promptId ?? '').trim();
    expect(promptId.length).toBeGreaterThan(0);

    const pendingResp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    expect(pendingResp.r.status).toBe(200);
    const rows = Array.isArray(pendingResp.data?.pending) ? pendingResp.data.pending : [];
    const row = rows.find((entry: any) => String(entry?.id ?? '').trim() === promptId);
    expect(row).toBeTruthy();
    expect(String(row?.state ?? '')).toBe('queued');
    expect(String(row?.prompt ?? '')).toBe('hello while starting');
  });

  test('preview proxies directly to localhost port for host runtime drone', async () => {
    const upstream = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`upstream:${req.url ?? ''}`);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
    const addr = upstream.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    try {
      const droneId = 'host-preview';
      await seedHostDrone(droneId, { hostPort: 4999, containerPort: 7777 });
      const r = await fetch(`${baseUrl}/api/drones/${encodeURIComponent(droneId)}/preview/${port}/hello/world?x=1`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(text).toContain('/hello/world?x=1');
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
