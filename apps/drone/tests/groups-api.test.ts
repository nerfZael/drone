import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { updateRegistry } from '../src/host/registry';

describe('groups api (decoupled from drone count)', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-groups-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';
  const prevXdg = process.env.XDG_DATA_HOME;

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

  test('can create empty groups and delete them while empty', async () => {
    const initial = await apiFetch('/api/groups');
    expect(initial.r.status).toBe(200);
    expect(initial.data?.ok).toBe(true);

    const created = await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alpha' }),
    });
    expect(created.r.status).toBe(201);
    expect(created.data?.ok).toBe(true);
    expect(created.data?.name).toBe('alpha');

    const listed = await apiFetch('/api/groups');
    expect(listed.data?.groups?.some((g: any) => g?.name === 'alpha' && g?.totalCount === 0)).toBe(true);

    const del = await apiFetch('/api/groups/alpha', { method: 'DELETE' });
    expect(del.r.status).toBe(200);
    expect(del.data?.ok).toBe(true);
    expect(del.data?.total).toBe(0);
  });

  test('renaming a group works even when empty', async () => {
    await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'old' }),
    });

    const renamed = await apiFetch('/api/groups/old/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newName: 'new' }),
    });
    expect(renamed.r.status).toBe(200);
    expect(renamed.data?.ok).toBe(true);
    expect(renamed.data?.oldName).toBe('old');
    expect(renamed.data?.newName).toBe('new');

    const listed = await apiFetch('/api/groups');
    const names = (listed.data?.groups ?? []).map((g: any) => String(g?.name ?? ''));
    expect(names.includes('old')).toBe(false);
    expect(names.includes('new')).toBe(true);
  });

  test('groups are not auto-deleted when the last drone is removed', async () => {
    // Seed a group and a fake drone in the registry (no container needed for this behavior).
    await updateRegistry((reg: any) => {
      reg.groups = reg.groups ?? {};
      reg.groups['persist'] = { name: 'persist', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      reg.drones = reg.drones ?? {};
      reg.drones['fake-drone'] = {
        name: 'fake-drone',
        group: 'persist',
        containerPort: 7777,
        token: 'x',
        repoPath: '',
        createdAt: new Date().toISOString(),
      };
    });

    const withDrone = await apiFetch('/api/groups');
    const persist1 = (withDrone.data?.groups ?? []).find((g: any) => g?.name === 'persist');
    expect(persist1?.totalCount).toBe(1);

    // Remove the last drone.
    await updateRegistry((reg: any) => {
      if (reg?.drones?.['fake-drone']) delete reg.drones['fake-drone'];
    });

    const after = await apiFetch('/api/groups');
    const persist2 = (after.data?.groups ?? []).find((g: any) => g?.name === 'persist');
    expect(persist2?.totalCount).toBe(0);
  });
});

