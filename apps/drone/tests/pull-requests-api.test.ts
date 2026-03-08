import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { updateRegistry } from '../src/host/registry';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`pull requests api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping pull requests api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('pull requests api route matching', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-pr-api-'));
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
    return { r, data };
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

  test('GET /repo/pull-requests is matched (does not fall through to 404)', async () => {
    const droneId = 'drone-pr-route';
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        token: 'x',
        containerPort: 7777,
        createdAt: new Date().toISOString(),
        repoPath: '',
      };
    });

    const { r, data } = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests?state=open`);
    expect(r.status).toBe(400);
    expect(data?.ok).toBe(false);
    expect(data?.error).toBe('drone has no repo attached');
  });

  test('GET /repo/pull-requests/:number/changes is matched (does not fall through to 404)', async () => {
    const droneId = 'drone-pr-route';
    const { r, data } = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/123/changes`);
    expect(r.status).toBe(400);
    expect(data?.ok).toBe(false);
    expect(data?.error).toBe('drone has no repo attached');
  });

  test('POST /repo/push is matched (does not fall through to 404)', async () => {
    const droneId = 'drone-pr-route';
    const { r, data } = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/repo/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(400);
    expect(data?.ok).toBe(false);
    expect(data?.error).toBe('drone has no repo attached');
  });
});
