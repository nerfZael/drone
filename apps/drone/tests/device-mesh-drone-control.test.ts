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

  test('returns a versioned repository map from drones.list', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          drones: [
            { id: 'one', name: 'One', repoPath: '/work/one' },
            { id: 'loose', name: 'Loose', repoPath: '' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(capability.invoke('drones.list', {})).resolves.toMatchObject({
        schemaVersion: 2,
        repoPathByDroneId: { one: '/work/one' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
