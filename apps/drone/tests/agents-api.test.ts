import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { startDroneHubApiServer } from '../src/hub/server';
import { loadRegistry } from '../src/host/registry';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('agents api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-agents-api-'));
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
    const data = text ? JSON.parse(text) : null;
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

  test('stores the default AGENTS.md content', async () => {
    const save = await apiFetch('/api/settings/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# Default instructions' }),
    });

    expect(save.r.status).toBe(200);
    expect(save.data.agents.enabled).toBe(true);
    expect(save.data.agents.content).toBe('# Default instructions');

    const read = await apiFetch('/api/settings/agents');
    expect(read.r.status).toBe(200);
    expect(read.data.agents.content).toBe('# Default instructions');

    const reg = await loadRegistry();
    expect((reg as any).settings?.agents?.content).toBe('# Default instructions');
  });

  test('stores per-repo override mode and resolves effective content', async () => {
    const save = await apiFetch('/api/repo-agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoPath: '/tmp/repo-a',
        mode: 'override',
        content: '# Repo-specific instructions',
      }),
    });

    expect(save.r.status).toBe(200);
    expect(save.data.mode).toBe('override');
    expect(save.data.effectiveSource).toBe('repo');
    expect(save.data.effectiveContent).toBe('# Repo-specific instructions\n');

    const disabled = await apiFetch('/api/repo-agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoPath: '/tmp/repo-a',
        mode: 'disabled',
        content: '# Repo-specific instructions',
      }),
    });

    expect(disabled.r.status).toBe(200);
    expect(disabled.data.mode).toBe('disabled');
    expect(disabled.data.effectiveContent).toBeNull();

    const read = await apiFetch('/api/repo-agents?repoPath=%2Ftmp%2Frepo-a');
    expect(read.r.status).toBe(200);
    expect(read.data.mode).toBe('disabled');
    expect(read.data.content).toBe('# Repo-specific instructions');

    const reg = await loadRegistry();
    expect((reg as any).repos?.['/tmp/repo-a']?.agents).toMatchObject({
      mode: 'disabled',
      content: '# Repo-specific instructions',
    });
  });
});
