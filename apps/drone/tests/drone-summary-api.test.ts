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

  test('reports in-flight first messages as busy without treating queued work as active', async () => {
    const now = new Date(0).toISOString();
    const makeDrone = (id: string, state: string, turns: any[] = []) => ({
      id,
      name: id,
      runtime: 'container',
      repoPath: '',
      createdAt: now,
      chats: {
        default: {
          createdAt: now,
          turns,
          pendingPrompts: [
            {
              id: 'first-message',
              at: now,
              updatedAt: now,
              prompt: 'first message',
              state,
            },
          ],
        },
      },
    });

    await updateRegistry((reg: any) => {
      reg.drones = {
        'drone-first-message-sent': makeDrone('drone-first-message-sent', 'sent'),
        'drone-first-message-sending': makeDrone('drone-first-message-sending', 'sending'),
        'drone-first-message-queued': makeDrone('drone-first-message-queued', 'queued'),
        'drone-first-message-completed': makeDrone('drone-first-message-completed', 'sent', [
          { id: 'first-message', at: now, prompt: 'first message', ok: true, output: 'done' },
        ]),
      };
      reg.pending = {};
    });

    const resp = await apiFetch('/api/drones/summary');

    expect(resp.r.status).toBe(200);
    for (const id of ['drone-first-message-sent', 'drone-first-message-sending']) {
      expect(resp.data?.drones?.find((item: any) => item.id === id)).toMatchObject({
        id,
        status: 'busy',
        busy: true,
        busyChats: ['default'],
      });
    }
    expect(resp.data?.drones?.find((item: any) => item.id === 'drone-first-message-queued')).toMatchObject({
      id: 'drone-first-message-queued',
      status: 'ready',
    });
    expect(resp.data?.drones?.find((item: any) => item.id === 'drone-first-message-queued')).not.toHaveProperty('busy');
    expect(resp.data?.drones?.find((item: any) => item.id === 'drone-first-message-completed')).toMatchObject({
      id: 'drone-first-message-completed',
      status: 'ready',
    });
    expect(resp.data?.drones?.find((item: any) => item.id === 'drone-first-message-completed')).not.toHaveProperty('busy');
  });
});
