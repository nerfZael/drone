import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
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
    process.env.XDG_DATA_HOME = xdgDataHome;
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
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
    const imagePath = path.join(droneRoot, 'thumb.png');
    fs.writeFileSync(notePath, 'hello\n', 'utf8');
    fs.writeFileSync(
      imagePath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7bKJYAAAAASUVORK5CYII=', 'base64'),
    );

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
      repo: { dest: repoRoot },
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
  });

  test('returns explicit unsupported response for container-only repo routes on host runtime', async () => {
    const droneId = 'host-repo-unsupported';
    await seedHostDrone(droneId, {
      repoPath: tempRoot,
      repo: { dest: '/work/repo' },
    });

    const checks: Array<{ method: 'GET' | 'POST'; endpoint: string }> = [
      { method: 'GET', endpoint: '/repo/pull/changes' },
      { method: 'GET', endpoint: '/repo/pull/diff' },
      { method: 'POST', endpoint: '/repo/reseed' },
      { method: 'POST', endpoint: '/repo/push' },
      { method: 'POST', endpoint: '/repo/pull' },
    ];

    for (const check of checks) {
      const resp = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}${check.endpoint}`, {
        method: check.method,
      });
      expect(resp.r.status).toBe(409);
      expect(String(resp.data?.code ?? '')).toBe('host_repo_endpoint_unsupported');
      expect(String(resp.data?.endpoint ?? '')).toBe(check.endpoint);
    }
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
