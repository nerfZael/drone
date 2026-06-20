import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { updateRegistry } from '../src/host/registry';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('drone summary api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-summary-api-'));
  const droneDataDir = path.join(tempRoot, 'data', 'drone');
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
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
    fs.mkdirSync(droneDataDir, { recursive: true });
    process.env.DRONE_DATA_DIR = droneDataDir;
    resetDroneRootDirForTests();
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns registry-only drone summaries', async () => {
    const now = new Date(0).toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = {
        'drone-1': {
          id: 'drone-1',
          name: 'Alpha',
          group: 'Review',
          runtime: 'container',
          repoPath: '/repo/alpha',
          createdAt: now,
          hub: { phase: 'seeding', message: 'Seeding...' },
          chats: {
            default: {
              createdAt: now,
              turns: [{ at: now, prompt: 'hello', ok: true, output: 'world' }],
              pendingPrompts: [],
            },
          },
        },
      };
      reg.pending = {
        'pending-1': {
          id: 'pending-1',
          name: 'Pending',
          group: '',
          runtime: 'host',
          repoPath: '',
          phase: 'starting',
          createdAt: now,
        },
      };
    });

    const resp = await apiFetch('/api/drones/summary');

    expect(resp.r.status).toBe(200);
    expect(resp.data?.ok).toBe(true);
    expect(resp.data?.drones).toHaveLength(2);
    const alpha = resp.data.drones.find((drone: any) => drone.name === 'Alpha');
    const pending = resp.data.drones.find((drone: any) => drone.name === 'Pending');
    expect(alpha).toMatchObject({
      id: 'drone-1',
      name: 'Alpha',
      group: 'Review',
      runtime: 'container',
      repoPath: '/repo/alpha',
      status: 'seeding',
      chats: ['default'],
    });
    expect(alpha).not.toHaveProperty('dockerSize');
    expect(alpha).not.toHaveProperty('hostPort');
    expect(alpha).not.toHaveProperty('statusOk');
    expect(pending).toMatchObject({
      id: 'pending-1',
      name: 'Pending',
      group: null,
      runtime: 'host',
      repoPath: '',
      status: 'starting',
      chats: ['default'],
    });
  });
});
