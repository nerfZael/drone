import { describe, expect, test } from 'bun:test';

import { createDroneStatusRuntime } from '../src/hub/drone-status-runtime';

describe('drone status runtime', () => {
  test('refreshes a large fleet with bounded concurrency and reports status changes', async () => {
    const fleetSize = 144;
    const drones = Object.fromEntries(
      Array.from({ length: fleetSize }, (_, index) => [
        `drone-${index}`,
        {
          id: `drone-${index}`,
          name: `Drone ${index}`,
          runtime: 'container',
          hostPort: 10_000 + index,
          containerPort: 7_777,
          token: `token-${index}`,
        },
      ]),
    );
    const changedSources: string[] = [];
    const timings: any[] = [];
    let activeProbes = 0;
    let maxActiveProbes = 0;
    let processRunning = true;
    const failingPorts = new Set<number>();
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones }),
      log: () => {},
      makeClient: (hostPort) => ({ hostPort }),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      onChanged: (source) => changedSources.push(source),
      onTiming: (timing) => timings.push(timing),
      readStatus: async ({ hostPort }) => {
        activeProbes += 1;
        maxActiveProbes = Math.max(maxActiveProbes, activeProbes);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeProbes -= 1;
        if (failingPorts.has(hostPort)) throw new Error('offline');
        return { state: 'ready', process: { running: processRunning } };
      },
      resolveHostPort: async () => null,
    });

    await runtime.refreshNow('first');

    expect(maxActiveProbes).toBe(16);
    expect(changedSources).toEqual(['first']);
    expect(runtime.cachedForEntry(drones['drone-0'])).toMatchObject({
      hostPort: 10_000,
      statusOk: true,
      status: { state: 'ready', process: { running: true } },
      statusError: null,
    });
    expect(timings[0]).toMatchObject({
      source: 'first',
      droneCount: fleetSize,
      changedCount: fleetSize,
    });
    expect(timings[0].phases).toContainEqual(
      expect.objectContaining({ name: 'readStatuses', operationCount: fleetSize }),
    );

    await runtime.refreshNow('unchanged');
    expect(changedSources).toEqual(['first']);

    processRunning = false;
    await runtime.refreshNow('status-payload-update');
    expect(changedSources).toEqual(['first', 'status-payload-update']);

    failingPorts.add(10_000);
    await runtime.refreshNow('status-update');
    expect(changedSources).toEqual(['first', 'status-payload-update', 'status-update']);
    expect(runtime.cachedForEntry(drones['drone-0'])).toMatchObject({
      statusOk: false,
      statusError: 'offline',
    });
    expect(timings.at(-1)).toMatchObject({
      source: 'status-update',
      droneCount: fleetSize,
      changedCount: 1,
    });
  });

  test('keeps startup entries in checking state without probing them', async () => {
    let probes = 0;
    const draft = { id: 'draft', name: 'Draft', runtime: 'container', phase: 'draft' };
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones: {} }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      onChanged: () => {},
      readStatus: async () => {
        probes += 1;
        return {};
      },
      resolveHostPort: async () => null,
    });

    expect(runtime.cachedForEntry(draft)).toMatchObject({
      hostPort: null,
      statusOk: false,
      statusError: 'checking status',
      statusChecking: true,
    });
    expect(probes).toBe(0);
  });

  test('ignores timing callback failures', async () => {
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones: {} }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      onChanged: () => {},
      onTiming: () => {
        throw new Error('timing failed');
      },
      readStatus: async () => ({}),
      resolveHostPort: async () => null,
    });

    await runtime.refreshNow('timing-failure');
  });

  test('backs off unchanged entries across interval and registry-write refreshes', async () => {
    let nowMs = 0;
    let probes = 0;
    const timings: any[] = [];
    const drone = {
      id: 'stable-drone',
      name: 'Stable Drone',
      runtime: 'container',
      hostPort: 10_000,
      token: 'token',
    };
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones: { [drone.id]: drone } }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      now: () => nowMs,
      onChanged: () => {},
      onTiming: (timing) => timings.push(timing),
      readStatus: async () => {
        probes += 1;
        return { state: 'ready' };
      },
      resolveHostPort: async () => null,
    });

    await runtime.refreshNow('interval');
    nowMs = 30_000;
    await runtime.refreshNow('interval');
    nowMs = 45_000;
    await runtime.refreshNow('interval');

    expect(probes).toBe(2);
    expect(timings.at(-1).phases).toContainEqual(
      expect.objectContaining({ name: 'skipStableStatuses', operationCount: 1 }),
    );

    await runtime.refreshNow('registry-write');
    expect(probes).toBe(2);

    drone.hostPort = 10_001;
    await runtime.refreshNow('registry-write');
    expect(probes).toBe(3);

    await runtime.refreshNow('startup');
    expect(probes).toBe(4);
  });

  test('staggered interval batches do not reprobe a large fleet all at once', async () => {
    const fleetSize = 144;
    let nowMs = 0;
    let probes = 0;
    const timings: any[] = [];
    const drones = Object.fromEntries(
      Array.from({ length: fleetSize }, (_, index) => [
        `drone-${index}`,
        {
          id: `drone-${index}`,
          runtime: 'container',
          hostPort: 10_000 + index,
          token: `token-${index}`,
        },
      ]),
    );
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      now: () => nowMs,
      onChanged: () => {},
      onTiming: (timing) => timings.push(timing),
      readStatus: async () => {
        probes += 1;
        return { state: 'ready' };
      },
      resolveHostPort: async () => null,
    });

    await runtime.refreshNow('startup');
    expect(probes).toBe(fleetSize);

    nowMs = 30_000;
    await runtime.refreshNow('interval');

    expect(probes).toBe(fleetSize + 8);
    expect(timings.at(-1).phases).toContainEqual(
      expect.objectContaining({ name: 'readStatuses', operationCount: 8 }),
    );
    expect(timings.at(-1).phases).toContainEqual(
      expect.objectContaining({ name: 'skipStableStatuses', operationCount: fleetSize - 8 }),
    );
  });

  test('starts the quiet period after a slow probe completes', async () => {
    let nowMs = 0;
    let probes = 0;
    const drone = {
      id: 'slow-drone',
      name: 'Slow Drone',
      runtime: 'container',
      hostPort: 10_000,
      token: 'token',
    };
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones: { [drone.id]: drone } }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      now: () => nowMs,
      onChanged: () => {},
      readStatus: async () => {
        probes += 1;
        nowMs += 20_000;
        return { state: 'ready' };
      },
      resolveHostPort: async () => null,
    });

    await runtime.refreshNow('interval');
    await runtime.refreshNow('interval');

    expect(probes).toBe(1);
  });

  test('coalesces refresh requests received during a running fleet sweep', async () => {
    let releaseFirstProbe!: () => void;
    const firstProbeReleased = new Promise<void>((resolve) => {
      releaseFirstProbe = resolve;
    });
    let firstProbeStarted!: () => void;
    const firstProbeObserved = new Promise<void>((resolve) => {
      firstProbeStarted = resolve;
    });
    let refreshCompleted!: () => void;
    const refreshObserved = new Promise<void>((resolve) => {
      refreshCompleted = resolve;
    });
    let probes = 0;
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({
        drones: {
          drone: {
            id: 'drone',
            name: 'Drone',
            runtime: 'host',
            hostPort: 10_000,
            token: 'token',
          },
        },
      }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      onChanged: () => {},
      onTiming: () => refreshCompleted(),
      readStatus: async () => {
        probes += 1;
        firstProbeStarted();
        await firstProbeReleased;
        return { state: 'ready' };
      },
      resolveHostPort: async () => null,
    });

    runtime.start();
    await firstProbeObserved;
    runtime.schedule('api:drones', 0);
    releaseFirstProbe();
    await refreshObserved;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runtime.stop();

    expect(probes).toBe(1);
  });

  test('keeps an immediate registry refresh requested during a periodic batch', async () => {
    let releaseFirstProbe!: () => void;
    const firstProbeReleased = new Promise<void>((resolve) => {
      releaseFirstProbe = resolve;
    });
    let firstProbeStarted!: () => void;
    const firstProbeObserved = new Promise<void>((resolve) => {
      firstProbeStarted = resolve;
    });
    let secondProbeStarted!: () => void;
    const secondProbeObserved = new Promise<void>((resolve) => {
      secondProbeStarted = resolve;
    });
    let probes = 0;
    const drone = {
      id: 'drone',
      runtime: 'container',
      hostPort: 10_000,
      token: 'token',
    };
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones: { drone } }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      onChanged: () => {},
      readStatus: async () => {
        probes += 1;
        if (probes === 1) {
          firstProbeStarted();
          await firstProbeReleased;
        } else {
          secondProbeStarted();
        }
        return { state: 'ready' };
      },
      resolveHostPort: async () => null,
    });

    runtime.start();
    await firstProbeObserved;
    drone.hostPort = 10_001;
    runtime.schedule('registry-write');
    releaseFirstProbe();
    await secondProbeObserved;
    await runtime.stop();

    expect(probes).toBe(2);
  });
});
