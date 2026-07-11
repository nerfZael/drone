import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`groups api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping groups api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('groups api (decoupled from drone count)', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-groups-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(tempRoot, 'data', 'drone');

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

  test('group and drone cleanup transform the canonical Kanban board', async () => {
    const at = '2026-06-01T00:00:00.000Z';
    await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'cleanup-source' }),
    });
    await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'cleanup-source/api' }),
    });
    await updateRegistry((reg: any) => {
      reg.drones ??= {};
      reg.drones['cleanup-drone'] = {
        id: 'cleanup-drone',
        name: 'cleanup-drone',
        runtime: 'host',
        hostPort: null,
        token: 'cleanup-token',
        containerPort: 7777,
        repoPath: '',
        group: 'cleanup-source',
        createdAt: at,
        chats: {},
      };
    });
    const stored = await apiFetch('/api/settings/kanban-board', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kanbanBoard: {
          taskTypes: [{ id: 'task', label: 'Task', active: true }],
          lanes: [{
            id: 'todo',
            title: 'Todo',
            cards: [
              { id: 'group-task', title: 'Group task', description: '', typeId: 'task', scopeType: 'group', scopeValue: 'cleanup-source', createdAt: at, updatedAt: at },
              { id: 'group-child-task', title: 'Child group task', description: '', typeId: 'task', scopeType: 'group', scopeValue: 'cleanup-source/api', createdAt: at, updatedAt: at },
              { id: 'drone-task', title: 'Drone task', description: '', typeId: 'task', scopeType: 'drone', scopeValue: 'cleanup-drone', droneId: 'cleanup-drone', createdAt: at, updatedAt: at },
              { id: 'keep-task', title: 'Keep task', description: '', typeId: 'task', scopeType: 'global', createdAt: at, updatedAt: at },
            ],
          }],
        },
      }),
    });
    expect(stored.r.status).toBe(200);

    const renamed = await apiFetch('/api/groups/cleanup-source/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newName: 'cleanup-target' }),
    });
    expect(renamed.r.status).toBe(200);
    let board = (await apiFetch('/api/settings/kanban-board')).data?.kanbanBoard;
    let cards = board?.lanes?.flatMap((lane: any) => lane.cards ?? []) ?? [];
    expect(cards.find((card: any) => card.id === 'group-task')?.scopeValue).toBe('cleanup-target');
    expect(cards.find((card: any) => card.id === 'group-child-task')?.scopeValue).toBe('cleanup-target/api');

    const archived = await apiFetch('/api/drones/cleanup-drone/archive', { method: 'POST' });
    expect(archived.r.status).toBe(200);
    board = (await apiFetch('/api/settings/kanban-board')).data?.kanbanBoard;
    cards = board?.lanes?.flatMap((lane: any) => lane.cards ?? []) ?? [];
    expect(cards.some((card: any) => card.id === 'drone-task')).toBe(false);
    expect(cards.some((card: any) => card.id === 'group-task')).toBe(true);
    expect(cards.some((card: any) => card.id === 'group-child-task')).toBe(true);

    const deleted = await apiFetch('/api/groups/cleanup-target', { method: 'DELETE' });
    expect(deleted.r.status).toBe(200);
    board = (await apiFetch('/api/settings/kanban-board')).data?.kanbanBoard;
    cards = board?.lanes?.flatMap((lane: any) => lane.cards ?? []) ?? [];
    expect(cards.map((card: any) => card.id)).toEqual(['keep-task']);
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

  test('delete group can be scoped to one repo path', async () => {
    await updateRegistry((reg: any) => {
      reg.groups = reg.groups ?? {};
      reg.groups['latest'] = { name: 'latest', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      reg.pending = reg.pending ?? {};
      reg.pending['repo-a-drone'] = {
        id: 'repo-a-drone',
        name: 'repo-a-drone',
        group: 'latest',
        repoPath: '/tmp/repo-a',
        createdAt: new Date().toISOString(),
      };
      reg.pending['repo-b-drone'] = {
        id: 'repo-b-drone',
        name: 'repo-b-drone',
        group: 'latest',
        repoPath: '/tmp/repo-b',
        createdAt: new Date().toISOString(),
      };
    });

    const deleted = await apiFetch(`/api/groups/latest?repoPath=${encodeURIComponent('/tmp/repo-a')}`, { method: 'DELETE' });
    expect(deleted.r.status).toBe(200);
    expect(deleted.data?.ok).toBe(true);
    expect(deleted.data?.repoPath).toBe('/tmp/repo-a');
    expect(deleted.data?.deletedGroup).toBe(false);
    expect(deleted.data?.removed?.map((item: any) => item?.id)).toEqual(['repo-a-drone']);

    const listed = await apiFetch('/api/groups');
    const latest = (listed.data?.groups ?? []).find((g: any) => g?.name === 'latest');
    expect(latest?.totalCount).toBe(1);

    const registry: any = await loadRegistry();
    expect(registry?.pending?.['repo-a-drone']).toBeUndefined();
    expect(registry?.pending?.['repo-b-drone']?.group).toBe('latest');
    expect(registry?.groups?.latest?.name).toBe('latest');
  });

  test('can assign drones to groups and validates group names', async () => {
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones['group-move-drone'] = {
        id: 'group-move-drone',
        name: 'group-move-drone',
        containerPort: 7777,
        token: 'x',
        repoPath: '',
        createdAt: new Date().toISOString(),
      };
    });

    const moved = await apiFetch('/api/drones/group-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ droneIds: ['group-move-drone'], group: 'assigned' }),
    });
    expect(moved.r.status).toBe(200);
    expect(moved.data?.group).toBe('assigned');
    expect(moved.data?.moved?.[0]?.id).toBe('group-move-drone');

    const unchanged = await apiFetch('/api/drones/group-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ droneIds: ['group-move-drone'], group: 'assigned' }),
    });
    expect(unchanged.r.status).toBe(200);
    expect(unchanged.data?.group).toBe('assigned');
    expect(unchanged.data?.moved).toEqual([]);
    expect(unchanged.data?.rejected).toEqual([]);
    expect(unchanged.data?.total).toBe(1);

    const invalid = await apiFetch('/api/drones/group-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ droneIds: ['group-move-drone'], group: 'x'.repeat(65) }),
    });
    expect(invalid.r.status).toBe(400);
    expect(String(invalid.data?.error ?? '')).toContain('max 64 chars');
  });
});
