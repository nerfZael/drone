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
    expect(String(created.data?.id ?? '').startsWith('grp_')).toBe(true);

    const listed = await apiFetch('/api/groups');
    expect(listed.data?.groups?.some((g: any) => g?.name === 'alpha' && g?.totalCount === 0)).toBe(true);

    const del = await apiFetch('/api/groups/alpha', { method: 'DELETE' });
    expect(del.r.status).toBe(200);
    expect(del.data?.ok).toBe(true);
    expect(del.data?.total).toBe(0);
  });

  test('renaming a group works even when empty', async () => {
    const created = await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'old' }),
    });

    const renamed = await apiFetch(`/api/groups/${encodeURIComponent(created.data?.id)}/rename`, {
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
    expect((listed.data?.groups ?? []).find((g: any) => g?.name === 'new')?.id).toBe(renamed.data?.id);
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
    const repoAGroup = await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'latest', repoPath: '/tmp/repo-a' }),
    });
    const repoBGroup = await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'latest', repoPath: '/tmp/repo-b' }),
    });
    expect(repoAGroup.r.status).toBe(201);
    expect(repoBGroup.r.status).toBe(201);
    expect(repoAGroup.data?.id).not.toBe(repoBGroup.data?.id);
    const repoAList = await apiFetch(`/api/groups?repoPath=${encodeURIComponent('/tmp/repo-a')}`);
    expect(repoAList.data?.groups?.map((group: any) => group.id)).toEqual([repoAGroup.data.id]);
    await updateRegistry((reg: any) => {
      reg.pending = reg.pending ?? {};
      reg.pending['repo-a-drone'] = {
        id: 'repo-a-drone',
        name: 'repo-a-drone',
        group: 'latest',
        groupId: repoAGroup.data.id,
        repoPath: '/tmp/repo-a',
        createdAt: new Date().toISOString(),
      };
      reg.pending['repo-b-drone'] = {
        id: 'repo-b-drone',
        name: 'repo-b-drone',
        group: 'latest',
        groupId: repoBGroup.data.id,
        repoPath: '/tmp/repo-b',
        createdAt: new Date().toISOString(),
      };
    });

    const deleted = await apiFetch(`/api/groups/${encodeURIComponent(repoAGroup.data.id)}`, { method: 'DELETE' });
    expect(deleted.r.status).toBe(200);
    expect(deleted.data?.ok).toBe(true);
    expect(deleted.data?.repoPath).toBe('/tmp/repo-a');
    expect(deleted.data?.deletedGroup).toBe(true);
    expect(deleted.data?.removed?.map((item: any) => item?.id)).toEqual(['repo-a-drone']);

    const listed = await apiFetch('/api/groups');
    const latest = (listed.data?.groups ?? []).find((g: any) =>
      g?.name === 'latest' && g?.repoPath === '/tmp/repo-b');
    expect(latest?.totalCount).toBe(1);
    expect((listed.data?.groups ?? []).some((g: any) =>
      g?.name === 'latest' && g?.repoPath === '/tmp/repo-a')).toBe(false);

    const registry: any = await loadRegistry();
    expect(registry?.pending?.['repo-a-drone']).toBeUndefined();
    expect(registry?.pending?.['repo-b-drone']?.group).toBe('latest');
    expect(latest?.id).toBe(repoBGroup.data.id);
  });

  test('deleting an empty repository group removes only that scoped group', async () => {
    const created = await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'scoped-empty', repoPath: '/tmp/repo-a' }),
    });

    const deleted = await apiFetch(
      `/api/groups/${encodeURIComponent(created.data.id)}`,
      { method: 'DELETE' },
    );
    expect(deleted.r.status).toBe(200);
    expect(deleted.data).toMatchObject({
      ok: true,
      group: 'scoped-empty',
      repoPath: '/tmp/repo-a',
      removed: [],
      total: 0,
      deletedGroup: true,
    });

    const listed = await apiFetch('/api/groups');
    expect(
      listed.data?.groups?.some(
        (group: any) => group?.name === 'scoped-empty' && group?.repoPath === '/tmp/repo-a',
      ),
    ).toBe(false);
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

  test('applies sidebar membership and ordering through the in-process command service', async () => {
    await updateRegistry((registry: any) => {
      registry.drones ??= {};
      registry.drones['sidebar-move-drone'] = {
        id: 'sidebar-move-drone',
        name: 'sidebar-move-drone',
        containerPort: 7777,
        token: 'x',
        repoPath: '',
        createdAt: new Date().toISOString(),
      };
    });

    const moved = await apiFetch('/api/sidebar/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mutationId: 'sidebar-direct-group-move',
        intent: {
          kind: 'move-into-folder',
          itemKind: 'drone',
          repoPath: '',
          droneId: 'sidebar-move-drone',
          sourceParentId: 'root',
          sourceSiblingNodeIds: ['drone:sidebar-move-drone', 'folder:Direct'],
          targetGroup: 'Direct',
          targetParentId: 'folder:Direct',
          targetSiblingNodeIds: [],
          placement: 'inside',
        },
      }),
    });

    expect(moved.r.status).toBe(200);
    expect(moved.data).toMatchObject({
      ok: true,
      mutationId: 'sidebar-direct-group-move',
      group: 'Direct',
      uiPreferences: {
        sidebarNodeOrderByParent: {
          root: ['folder:Direct'],
          'folder:Direct': ['drone:sidebar-move-drone'],
        },
      },
    });
    expect((await loadRegistry()).drones['sidebar-move-drone']?.group).toBe('Direct');
  });
});
