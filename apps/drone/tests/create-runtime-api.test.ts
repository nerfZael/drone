import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`create runtime api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping create runtime api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('create runtime api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-create-runtime-api-'));
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

  test('rejects invalid runtime in single create request', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'runtime-invalid-one', runtime: 'invalid-runtime' }),
    });
    expect(resp.r.status).toBe(400);
    expect(String(resp.data?.error ?? '')).toContain('invalid runtime');
  });

  test('rejects invalid runtime item in batch create request', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drones: [{ name: 'runtime-invalid-batch', runtime: 'vm' }],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    expect(Array.isArray(resp.data?.accepted)).toBe(true);
    expect((resp.data?.accepted ?? []).length).toBe(0);
    expect(Array.isArray(resp.data?.rejected)).toBe(true);
    expect((resp.data?.rejected ?? []).length).toBe(1);
    expect(String(resp.data?.rejected?.[0]?.error ?? '')).toContain('invalid runtime');
  });
});
