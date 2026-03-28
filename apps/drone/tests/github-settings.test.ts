import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('GitHub settings api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-github-settings-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const prevGithubToken = process.env.GITHUB_TOKEN;
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
    process.env.GITHUB_TOKEN = 'env-github-token';
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
    if (prevGithubToken == null) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevGithubToken;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('reports host GitHub auth status and transport', async () => {
    const { r, data } = await apiFetch('/api/settings/github');
    expect(r.status).toBe(200);
    expect(data?.ok).toBe(true);
    expect(data?.github?.pullRequestTransport).toBe('github-api');
    expect(data?.github?.authReady).toBe(true);
    expect(data?.github?.authSource).toBe('environment');
    expect(data?.github?.authEnvKey).toBe('GITHUB_TOKEN');
  });

  test('includes GitHub auth in setup dependency checks', async () => {
    const { r, data } = await apiFetch('/api/setup/status');
    expect(r.status).toBe(200);
    const githubDependency = Array.isArray(data?.dependencies) ? data.dependencies.find((item: any) => item?.id === 'github') : null;
    expect(githubDependency).toBeTruthy();
    expect(githubDependency?.status).toBe('ready');
    expect(githubDependency?.blocking).toBe(false);
    expect(githubDependency?.requiredFor).toBe('pull request actions');
  });
});
