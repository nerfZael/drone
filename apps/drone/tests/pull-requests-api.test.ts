import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { updateRegistry } from '../src/host/registry';

describe('pull requests api route matching', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-pr-api-'));
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
    return { r, data };
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
});
