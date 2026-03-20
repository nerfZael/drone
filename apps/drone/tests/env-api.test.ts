import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('env api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-env-api-'));
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

  test('stores repo env config and per-drone env overrides', async () => {
    await updateRegistry((regAny: any) => {
      regAny.repos = {
        '/tmp/repo-a': {
          path: '/tmp/repo-a',
          addedAt: '2026-03-20T00:00:00.000Z',
        },
      };
      regAny.drones = {
        'drone-1': {
          id: 'drone-1',
          name: 'alpha',
          containerName: 'drone-drone-1',
          runtime: 'container',
          containerPort: 7777,
          token: 'token',
          repoPath: '/tmp/repo-a',
          createdAt: '2026-03-20T00:00:00.000Z',
        },
      };
    });

    const repoSave = await apiFetch('/api/repo-env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoPath: '/tmp/repo-a',
        autoApplyToNewContainerDrones: true,
        vars: { API_KEY: 'secret', DEBUG: 'true' },
      }),
    });
    expect(repoSave.r.status).toBe(200);
    expect(repoSave.data.autoApplyToNewContainerDrones).toBe(true);
    expect(repoSave.data.entries).toEqual([
      { key: 'API_KEY', value: 'secret', source: 'repo' },
      { key: 'DEBUG', value: 'true', source: 'repo' },
    ]);

    const droneSave = await apiFetch('/api/drones/drone-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        useRepoVars: true,
        disabledRepoKeys: ['DEBUG'],
        vars: { LOCAL_ONLY: '1' },
      }),
    });
    expect(droneSave.r.status).toBe(200);
    expect(droneSave.data.useRepoVars).toBe(true);
    expect(droneSave.data.disabledRepoKeys).toEqual(['DEBUG']);
    expect(droneSave.data.resolvedEntries).toEqual([
      { key: 'API_KEY', value: 'secret', source: 'repo' },
      { key: 'LOCAL_ONLY', value: '1', source: 'drone' },
    ]);

    const reg = await loadRegistry();
    expect((reg as any).repos['/tmp/repo-a'].environment).toMatchObject({
      autoApplyToNewContainerDrones: true,
      vars: { API_KEY: 'secret', DEBUG: 'true' },
    });
    expect((reg as any).drones['drone-1'].environment).toMatchObject({
      useRepoVars: true,
      disabledRepoKeys: ['DEBUG'],
      vars: { LOCAL_ONLY: '1' },
    });
  });

  test('supports the shared no-repository scope', async () => {
    const save = await apiFetch('/api/repo-env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoPath: '',
        autoApplyToNewContainerDrones: false,
        vars: { SHARED_TOKEN: 'abc123' },
      }),
    });
    expect(save.r.status).toBe(200);
    expect(save.data.repoPath).toBe('');
    expect(save.data.label).toBe('No Repository');

    const read = await apiFetch('/api/repo-env?repoPath=');
    expect(read.r.status).toBe(200);
    expect(read.data.entries).toEqual([
      { key: 'SHARED_TOKEN', value: 'abc123', source: 'repo' },
    ]);
  });
});
