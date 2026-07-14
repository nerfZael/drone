import { describe, expect, test } from 'bun:test';
import {
  createDroneControlCapability,
  deviceMeshDroneSummary,
} from '../src/hub/device-mesh/drone-control-capability';

describe('device mesh drone summaries', () => {
  test('preserves the sidebar hierarchy fields needed by mobile clients', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'drone_child',
        name: 'Child',
        runtime: 'container',
        group: 'Review',
        repoPath: '/work/repo',
        fleetParentId: 'drone_parent',
        chats: ['default', 'review'],
        busyChats: ['review'],
        lastMessageAt: '2026-07-14T10:00:00.000Z',
        statusOk: false,
        statusError: 'offline',
      }),
    ).toMatchObject({
      id: 'drone_child',
      repoPath: '/work/repo',
      fleetParentId: 'drone_parent',
      group: 'Review',
      chats: ['default', 'review'],
      busyChats: ['review'],
      lastMessageAt: '2026-07-14T10:00:00.000Z',
      statusOk: false,
      statusError: 'offline',
    });
  });

  test('accepts registry chat maps and nested repo paths', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'drone_a',
        repoPath: '',
        repo: { path: '/nested/repo' },
        chats: { default: {}, planning: {} },
      }),
    ).toMatchObject({
      repoPath: '/nested/repo',
      chats: ['default', 'planning'],
      fleetParentId: null,
    });
  });

  test('returns timestamps and desktop sidebar ordering from drones.list', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const pathname = new URL(String(input)).pathname;
      const body =
        pathname === '/api/drones'
          ? {
              ok: true,
              drones: [
                {
                  id: 'one',
                  name: 'One',
                  repoPath: '/work/one',
                  lastMessageAt: '2026-07-14T10:00:00.000Z',
                },
                { id: 'loose', name: 'Loose', repoPath: '' },
              ],
            }
          : pathname === '/api/repos'
            ? { ok: true, repos: [{ path: '/work/one' }, { path: '/work/empty' }] }
            : pathname === '/api/groups'
              ? {
                  ok: true,
                  groups: [{ name: 'Review', createdAt: '2026-07-13T10:00:00.000Z' }],
                }
              : {
                  ok: true,
                  uiPreferences: {
                    sidebarGroupOrder: ['repo:repo:/work/one'],
                    sidebarDroneOrderByGroup: { 'group:Ungrouped': ['one'] },
                    sidebarNodeOrderByParent: { root: ['drone:one'] },
                  },
                };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(capability.invoke('drones.list', {})).resolves.toMatchObject({
        schemaVersion: 3,
        drones: [
          { id: 'one', lastMessageAt: '2026-07-14T10:00:00.000Z' },
          { id: 'loose' },
        ],
        repoPathByDroneId: { one: '/work/one' },
        sidebar: {
          registeredRepoPaths: ['/work/one', '/work/empty'],
          groupCreatedAtByName: { Review: '2026-07-13T10:00:00.000Z' },
          sidebarGroupOrder: ['repo:repo:/work/one'],
          sidebarDroneOrderByGroup: { 'group:Ungrouped': ['one'] },
          sidebarNodeOrderByParent: { root: ['drone:one'] },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards chat model discovery and updates', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return new Response(
        JSON.stringify(
          String(input).includes('/models')
            ? { ok: true, models: [{ id: 'gpt-5', label: 'GPT-5' }], source: 'live' }
            : { ok: true },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.models', {
          droneId: 'drone one',
          chatName: 'default',
          refresh: true,
        }),
      ).resolves.toMatchObject({
        models: [{ id: 'gpt-5', label: 'GPT-5' }],
        source: 'live',
      });
      await capability.invoke('chat.update', {
        droneId: 'drone one',
        chatName: 'default',
        model: 'gpt-5',
      });
      expect(requests.map((request) => request.url)).toEqual([
        'http://127.0.0.1:7777/api/drones/drone%20one/chats/default/models?refresh=1',
        'http://127.0.0.1:7777/api/drones/drone%20one/chats/default/config',
      ]);
      expect(requests[1]).toMatchObject({ method: 'POST', body: '{"model":"gpt-5"}' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
