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
        return { state: 'ready' };
      },
      resolveHostPort: async () => null,
    });

    await runtime.refreshNow('first');

    expect(maxActiveProbes).toBeLessThanOrEqual(4);
    expect(changedSources).toEqual(['first']);
    expect(runtime.cachedForEntry(drones['drone-0'])).toMatchObject({
      hostPort: 10_000,
      statusOk: true,
      status: { state: 'ready' },
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

    failingPorts.add(10_000);
    await runtime.refreshNow('status-update');
    expect(changedSources).toEqual(['first', 'status-update']);
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
});
