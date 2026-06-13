import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('desktop voice model settings api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-desktop-voice-model-api-'));
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
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
    fs.mkdirSync(xdgDataHome, { recursive: true });
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

  test('reports bundled Vosk model and catalog metadata', async () => {
    const read = await apiFetch('/api/settings/desktop-voice/model');
    expect(read.r.status).toBe(200);
    expect(read.data?.ok).toBe(true);
    expect(read.data?.state).toBe('installed');
    expect(read.data?.installed).toBe(true);
    expect(String(read.data?.modelDir ?? '')).toContain('model-en-us');
    expect(read.data?.selectedModelId).toBe('vosk-model-small-en-us-0.15');
    expect(read.data?.effectiveModelId).toBe('vosk-model-small-en-us-0.15');
    expect(read.data?.catalog?.[0]?.id).toBe('vosk-model-small-en-us-0.15');
    expect(read.data?.catalog?.[1]?.id).toBe('vosk-model-en-us-0.22-lgraph');
  });

  test('selects the bundled small model without downloading', async () => {
    const response = await apiFetch('/api/settings/desktop-voice/model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'vosk-model-small-en-us-0.15' }),
    });
    expect(response.r.status).toBe(202);
    expect(response.data?.selectedModelId).toBe('vosk-model-small-en-us-0.15');
    expect(response.data?.installing).toBe(false);
  });

  test('rejects unknown model install requests', async () => {
    const response = await apiFetch('/api/settings/desktop-voice/model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'not-a-model' }),
    });
    expect(response.r.status).toBe(400);
    expect(response.data?.ok).toBe(false);
    expect(String(response.data?.error ?? '')).toContain('Unknown desktop voice model');
  });
});
