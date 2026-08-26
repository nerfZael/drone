import { describe, expect, test } from 'bun:test';

import { resolveDetachedCliLaunchSpec, waitForDetachedHubState } from '../src/hub/hub-launch';

describe('resolveDetachedCliLaunchSpec', () => {
  test('uses plain node for built cli entrypoints', () => {
    const spec = resolveDetachedCliLaunchSpec({
      cliFilename: '/repo/apps/drone/dist/cli.js',
      nodeExecPath: '/usr/bin/node',
    });

    expect(spec).toEqual({
      command: '/usr/bin/node',
      args: ['/repo/apps/drone/dist/cli.js'],
    });
  });

  test('uses ts-node register when running from source', () => {
    const spec = resolveDetachedCliLaunchSpec({
      cliFilename: '/repo/apps/drone/src/cli.ts',
      nodeExecPath: '/usr/bin/node',
      resolveModulePath: (moduleId) => {
        expect(moduleId).toBe('ts-node/register');
        return '/repo/node_modules/ts-node/register/index.js';
      },
    });

    expect(spec).toEqual({
      command: '/usr/bin/node',
      args: ['-r', '/repo/node_modules/ts-node/register/index.js', '/repo/apps/drone/src/cli.ts'],
    });
  });

  test('falls back to built cli when ts-node is unavailable', () => {
    const spec = resolveDetachedCliLaunchSpec({
      cliFilename: '/repo/apps/drone/src/cli.ts',
      nodeExecPath: '/usr/bin/node',
      resolveModulePath: () => {
        throw new Error('not installed');
      },
      fileExists: (filePath) => filePath === '/repo/apps/drone/dist/cli.js',
    });

    expect(spec).toEqual({
      command: '/usr/bin/node',
      args: ['/repo/apps/drone/dist/cli.js'],
    });
  });
});

describe('waitForDetachedHubState', () => {
  test('waits through slow startup and returns only the expected process state', async () => {
    const states = [null, { pid: 41, uiPort: 5001 }, { pid: 42, uiPort: 5002 }];
    let sleeps = 0;

    const state = await waitForDetachedHubState({
      expectedPid: 42,
      readState: async () => states.shift() ?? null,
      readProcessStatus: () => ({ exitCode: null, signalCode: null }),
      logPath: '/tmp/hub.log',
      maxAttempts: 4,
      sleep: async () => {
        sleeps += 1;
      },
    });

    expect(state).toEqual({ pid: 42, uiPort: 5002 });
    expect(sleeps).toBe(2);
  });

  test('fails explicitly when startup never publishes connection state', async () => {
    await expect(
      waitForDetachedHubState({
        expectedPid: 42,
        readState: async () => null,
        readProcessStatus: () => ({ exitCode: null, signalCode: null }),
        logPath: '/tmp/hub.log',
        maxAttempts: 2,
        sleep: async () => {},
      }),
    ).rejects.toThrow('Timed out waiting for Drone Hub to become ready. Log: /tmp/hub.log');
  });

  test('reports a daemon exit instead of returning incomplete success output', async () => {
    await expect(
      waitForDetachedHubState({
        expectedPid: 42,
        readState: async () => null,
        readProcessStatus: () => ({ exitCode: 1, signalCode: null }),
        logPath: '/tmp/hub.log',
        sleep: async () => {},
      }),
    ).rejects.toThrow('process exited before becoming ready');
  });
});
