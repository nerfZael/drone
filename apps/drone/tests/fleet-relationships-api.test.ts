import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { startDroneHubApiServer } from '../src/hub/server';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`fleet relationship API tests require local socket binding support: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('fleet relationship API', () => {
  const token = 'relationship-test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-fleet-relationships-'));
  const previousDataDir = process.env.DRONE_DATA_DIR;
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';

  const apiFetch = async (pathname: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : null };
  };

  beforeAll(async () => {
    process.env.DRONE_DATA_DIR = path.join(tempRoot, 'data');
    fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
    resetDroneRootDirForTests();
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (previousDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('reads parent-child and assigned relationships using stable drone ids', async () => {
    const now = new Date().toISOString();
    await updateRegistry((registry: any) => {
      registry.drones = {
        owner: {
          id: 'owner-id',
          name: 'owner',
          runtime: 'host',
          createdAt: now,
          fleet: { assigned: ['worker'], createdBy: null },
        },
        worker: {
          id: 'worker-id',
          name: 'worker',
          runtime: 'host',
          createdAt: now,
          fleet: { assigned: [], createdBy: 'owner' },
        },
      };
      registry.pending = {};
    });

    const actor = await apiFetch('/api/fleet/actors/owner-id');
    expect(actor.response.status).toBe(200);
    expect(actor.data?.relationships).toEqual({
      assigned: [{ id: 'worker-id', name: 'worker', kind: 'real' }],
      children: [{ id: 'worker-id', name: 'worker', kind: 'real', phase: null }],
    });

    const drones = await apiFetch('/api/drones');
    const byId = Object.fromEntries((drones.data?.drones ?? []).map((drone: any) => [drone.id, drone]));
    expect(byId['owner-id']?.fleetAssignedIds).toEqual(['worker-id']);
    expect(byId['worker-id']?.fleetParentId).toBe('owner-id');
  });

  test('updates assigned relationships and rejects parent cycles', async () => {
    const now = new Date().toISOString();
    await updateRegistry((registry: any) => {
      registry.drones = {
        parent: { id: 'parent', name: 'parent', runtime: 'host', createdAt: now },
        child: {
          id: 'child',
          name: 'child',
          runtime: 'host',
          createdAt: now,
          fleet: { assigned: [], createdBy: 'parent' },
        },
        target: { id: 'target', name: 'target', runtime: 'host', createdAt: now },
      };
      registry.pending = {};
    });

    const assigned = await apiFetch('/api/fleet/actors/parent/assigned', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'target' }),
    });
    expect(assigned.response.status).toBe(200);
    expect(assigned.data?.relationships?.assigned).toEqual([{ id: 'target', name: 'target', kind: 'real' }]);

    const cycle = await apiFetch('/api/fleet/actors/parent/parent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent: 'child' }),
    });
    expect(cycle.response.status).toBe(400);
    expect(String(cycle.data?.error ?? '')).toMatch(/descendant/i);

    const removed = await apiFetch('/api/fleet/actors/parent/assigned/target', { method: 'DELETE' });
    expect(removed.response.status).toBe(200);
    expect(removed.data?.relationships?.assigned).toEqual([]);

    const registry = await loadRegistry();
    expect(registry?.drones?.parent?.fleet?.assigned).toEqual([]);
    expect(registry?.drones?.child?.fleet?.createdBy).toBe('parent');
  });
});
