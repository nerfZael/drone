import { describe, expect, test } from 'bun:test';
import {
  DroneRegistryBroadcaster,
  type DroneRegistrySnapshot,
} from '../src/hub/drone-registry-broadcaster';

describe('drone registry broadcaster', () => {
  test('publishes matching UI preferences with a drone membership delta', async () => {
    let snapshot: DroneRegistrySnapshot = {
      ok: true,
      drones: [{ id: 'host', group: null }],
      groups: [{ id: 'review', name: 'Review' }],
      uiPreferences: { sidebarNodeOrderByParent: { root: ['drone:host'] } },
      preferenceUpdatedAt: '2026-08-06T10:00:00.000Z',
      preferenceVersion: 1,
    };
    const events: Array<{ event: string; data: any }> = [];
    const timings: any[] = [];
    const broadcaster = new DroneRegistryBroadcaster({
      buildSnapshot: async () => snapshot,
      onTiming: (timing) => timings.push(timing),
      writeSseEvent: (_response, event, data) => events.push({ event, data }),
    });
    broadcaster.clients.add({ destroyed: false, writableEnded: false } as any);

    await broadcaster.refresh({ broadcastSnapshot: true });
    snapshot = {
      ok: true,
      drones: [{ id: 'host', group: 'Review' }],
      groups: [{ id: 'review', name: 'Review' }],
      uiPreferences: {
        sidebarNodeOrderByParent: {
          'folder:Review': ['drone:a', 'drone:host', 'drone:b'],
        },
      },
      preferenceUpdatedAt: '2026-08-06T10:00:01.000Z',
      preferenceVersion: 2,
    };
    await broadcaster.refresh();

    expect(events.at(-1)).toEqual({
      event: 'delta',
      data: {
        ok: true,
        upserts: [{ id: 'host', group: 'Review' }],
        removedIds: [],
        order: ['host'],
        groups: snapshot.groups,
        uiPreferences: snapshot.uiPreferences,
        preferenceUpdatedAt: snapshot.preferenceUpdatedAt,
        preferenceVersion: 2,
      },
    });
    expect(timings.at(-1)).toMatchObject({
      droneCount: 1,
      event: 'delta',
      phases: [{ name: 'buildSnapshot' }, { name: 'format' }, { name: 'broadcast' }],
    });
  });

  test('publishes a preference-only delta for an empty group move', async () => {
    let version = 1;
    const events: Array<{ event: string; data: any }> = [];
    const broadcaster = new DroneRegistryBroadcaster({
      buildSnapshot: async () => ({
        ok: true,
        drones: [],
        uiPreferences: { sidebarGroupOrder: [`version:${version}`] },
        preferenceUpdatedAt: `2026-08-06T10:00:0${version}.000Z`,
        preferenceVersion: version,
      }),
      writeSseEvent: (_response, event, data) => events.push({ event, data }),
    });
    broadcaster.clients.add({ destroyed: false, writableEnded: false } as any);

    await broadcaster.refresh({ broadcastSnapshot: true });
    version = 2;
    await broadcaster.refresh();

    expect(events.at(-1)).toMatchObject({
      event: 'delta',
      data: {
        upserts: [],
        removedIds: [],
        preferenceVersion: 2,
        uiPreferences: { sidebarGroupOrder: ['version:2'] },
      },
    });
  });

  test('publishes progress and runs a follow-up when a write arrives during snapshot construction', async () => {
    let releaseFirstBuild: () => void = () => {};
    const firstBuildBlocked = new Promise<void>((resolve) => {
      releaseFirstBuild = resolve;
    });
    let buildCount = 0;
    let publishedVersion = 1;
    let resolveSecondBuild: () => void = () => {};
    const secondBuildFinished = new Promise<void>((resolve) => {
      resolveSecondBuild = resolve;
    });
    let resolveLatestPublished: () => void = () => {};
    const latestPublished = new Promise<void>((resolve) => {
      resolveLatestPublished = resolve;
    });
    const events: Array<{ event: string; data: any }> = [];
    const broadcaster = new DroneRegistryBroadcaster({
      buildSnapshot: async () => {
        buildCount += 1;
        const versionAtStart = publishedVersion;
        if (buildCount === 1) await firstBuildBlocked;
        if (buildCount === 2) resolveSecondBuild();
        return {
          ok: true,
          drones: [{ id: 'host', group: versionAtStart === 1 ? null : 'Review' }],
          uiPreferences: { sidebarNodeOrderByParent: { root: [`version:${versionAtStart}`] } },
          preferenceVersion: versionAtStart,
        };
      },
      writeSseEvent: (_response, event, data) => {
        events.push({ event, data });
        if (data?.preferenceVersion === 2) resolveLatestPublished();
      },
    });
    broadcaster.clients.add({ destroyed: false, writableEnded: false } as any);

    const firstRefresh = broadcaster.refresh({ broadcastSnapshot: true });
    publishedVersion = 2;
    await broadcaster.refresh();
    releaseFirstBuild();
    await firstRefresh;
    await secondBuildFinished;
    await latestPublished;

    expect(buildCount).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: 'snapshot',
      data: {
        drones: [{ id: 'host', group: null }],
        preferenceVersion: 1,
      },
    });
    expect(events[1]).toMatchObject({
      event: 'delta',
      data: {
        upserts: [{ id: 'host', group: 'Review' }],
        preferenceVersion: 2,
      },
    });
  });

  test('does not starve publishing when consecutive builds are superseded', async () => {
    const releaseBuilds: Array<() => void> = [];
    const buildStarted: Array<Promise<void>> = [];
    const resolveBuildStarted: Array<() => void> = [];
    for (let index = 0; index < 3; index += 1) {
      buildStarted.push(
        new Promise<void>((resolve) => {
          resolveBuildStarted.push(resolve);
        }),
      );
    }
    let buildCount = 0;
    const events: Array<{ event: string; data: any }> = [];
    let resolveThirdPublished: () => void = () => {};
    const thirdPublished = new Promise<void>((resolve) => {
      resolveThirdPublished = resolve;
    });
    const broadcaster = new DroneRegistryBroadcaster({
      buildSnapshot: async () => {
        const version = ++buildCount;
        resolveBuildStarted[version - 1]?.();
        await new Promise<void>((resolve) => releaseBuilds.push(resolve));
        return {
          ok: true,
          drones: [{ id: 'host', version }],
          preferenceVersion: version,
        };
      },
      writeSseEvent: (_response, event, data) => {
        events.push({ event, data });
        if (data?.preferenceVersion === 3) resolveThirdPublished();
      },
    });
    broadcaster.clients.add({ destroyed: false, writableEnded: false } as any);

    const firstRefresh = broadcaster.refresh({ broadcastSnapshot: true });
    await buildStarted[0];
    await broadcaster.refresh();
    releaseBuilds.shift()?.();
    await buildStarted[1];
    await broadcaster.refresh();
    releaseBuilds.shift()?.();
    await buildStarted[2];

    expect(events).toMatchObject([
      {
        event: 'snapshot',
        data: { drones: [{ id: 'host', version: 1 }], preferenceVersion: 1 },
      },
      {
        event: 'delta',
        data: { upserts: [{ id: 'host', version: 2 }], preferenceVersion: 2 },
      },
    ]);

    releaseBuilds.shift()?.();
    await firstRefresh;
    await thirdPublished;
  });

  test('continues refreshing when timing diagnostics fail', async () => {
    let buildCount = 0;
    const events: string[] = [];
    const broadcaster = new DroneRegistryBroadcaster({
      buildSnapshot: async () => ({
        ok: true,
        drones: [{ id: 'drone-1', version: ++buildCount }],
      }),
      onTiming: () => {
        throw new Error('timing failed');
      },
      writeSseEvent: (_response, event) => events.push(event),
    });
    broadcaster.clients.add({ destroyed: false, writableEnded: false } as any);

    await broadcaster.refresh();
    await broadcaster.refresh();

    expect(buildCount).toBe(2);
    expect(events).toEqual(['snapshot', 'delta']);
  });
});
