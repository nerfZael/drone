import { describe, expect, test } from 'bun:test';

import {
  DroneDaemonRecovery,
  type DroneDaemonRecoveryDependencies,
  type DroneDaemonRecoveryTarget,
} from '../src/hub/drone-daemon-recovery';

type Client = { id: string };

const target = (
  overrides: Partial<DroneDaemonRecoveryTarget<Client>> = {},
): DroneDaemonRecoveryTarget<Client> => ({
  droneId: 'drone-1',
  runtime: 'container',
  client: { id: 'client-1' },
  containerName: 'drone-container-1',
  containerPort: 8787,
  hostPort: 32_001,
  token: 'test-token',
  readyTimeoutMs: 15_000,
  ...overrides,
});

function dependencies(
  overrides: Partial<DroneDaemonRecoveryDependencies<Client>> = {},
): DroneDaemonRecoveryDependencies<Client> {
  return {
    probe: async () => {},
    shouldRecoverProbeError: () => true,
    ensureContainer: async () => {},
    launchHost: async () => 12_345,
    persistHostPid: async () => {},
    waitUntilReady: async () => {},
    ...overrides,
  };
}

describe('lazy drone daemon recovery', () => {
  test('does nothing when the target daemon is already healthy', async () => {
    let containerRecoveries = 0;
    let hostRecoveries = 0;
    const recovery = new DroneDaemonRecovery(
      dependencies({
        ensureContainer: async () => {
          containerRecoveries += 1;
        },
        launchHost: async () => {
          hostRecoveries += 1;
          return 12_345;
        },
      }),
    );

    await expect(recovery.ensure(target())).resolves.toEqual({ recovered: false });
    expect(containerRecoveries).toBe(0);
    expect(hostRecoveries).toBe(0);
  });

  test('does not relaunch when the probe reached a daemon that rejected the request', async () => {
    const responseError = new Error('unauthorized');
    let recoveries = 0;
    const recovery = new DroneDaemonRecovery(
      dependencies({
        probe: async () => {
          throw responseError;
        },
        shouldRecoverProbeError: (error) => error !== responseError,
        ensureContainer: async () => {
          recoveries += 1;
        },
      }),
    );

    await expect(recovery.ensure(target())).rejects.toBe(responseError);
    expect(recoveries).toBe(0);
  });

  test('does not restart after one transient probe failure', async () => {
    let probes = 0;
    let recoveries = 0;
    const recovery = new DroneDaemonRecovery(
      dependencies({
        probe: async () => {
          probes += 1;
          if (probes === 1) throw new Error('request timeout after 3000ms');
        },
        ensureContainer: async () => {
          recoveries += 1;
        },
      }),
    );

    await expect(recovery.ensure(target())).resolves.toEqual({ recovered: false });
    expect(probes).toBe(2);
    expect(recoveries).toBe(0);
  });

  test('single-flights concurrent recovery for the same container drone', async () => {
    let containerRecoveries = 0;
    let readyChecks = 0;
    let releaseRecovery!: () => void;
    const recoveryStarted = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const recovery = new DroneDaemonRecovery(
      dependencies({
        probe: async () => {
          throw new Error('daemon unavailable');
        },
        ensureContainer: async () => {
          containerRecoveries += 1;
          await recoveryStarted;
        },
        waitUntilReady: async () => {
          readyChecks += 1;
        },
      }),
    );

    const first = recovery.ensure(target());
    const second = recovery.ensure(target());
    await Bun.sleep(0);
    expect(containerRecoveries).toBe(1);

    releaseRecovery();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { recovered: true },
      { recovered: true },
    ]);
    expect(containerRecoveries).toBe(1);
    expect(readyChecks).toBe(1);
  });

  test('relaunches a dead host daemon and persists its replacement pid', async () => {
    const calls: string[] = [];
    const recovery = new DroneDaemonRecovery(
      dependencies({
        probe: async () => {
          throw new Error('daemon unavailable');
        },
        launchHost: async ({ droneId, hostPort, token }) => {
          calls.push(`launch:${droneId}:${hostPort}:${token}`);
          return 45_678;
        },
        persistHostPid: async ({ droneId, pid }) => {
          calls.push(`persist:${droneId}:${pid}`);
        },
        waitUntilReady: async (_client, timeoutMs) => {
          calls.push(`ready:${timeoutMs}`);
        },
      }),
    );

    await expect(
      recovery.ensure(
        target({
          runtime: 'host',
          hostPort: 39_591,
          readyTimeoutMs: 20_000,
        }),
      ),
    ).resolves.toEqual({ recovered: true });
    expect(calls).toEqual([
      'launch:drone-1:39591:test-token',
      'ready:20000',
      'persist:drone-1:45678',
    ]);
  });
});
