import { spawn, type ChildProcess } from 'node:child_process';

import { describe, expect, test } from 'bun:test';

import { stopRemoteHubDetached } from '../src/hub/remote-control';
import {
  pidIsRunning,
  readRemoteNgrokState,
  writeRemoteHubState,
  writeRemoteNgrokState,
} from '../src/hub/remote-state';
import { withTempDroneDataDir } from './test-helpers';

function spawnSleep(): ChildProcess {
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  if (!child.pid) throw new Error('sleep did not report a pid');
  return child;
}

function killIfRunning(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid || !pidIsRunning(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore cleanup races
  }
}

describe('remote Hub control', () => {
  test('stopping remote Hub stops owned ngrok for the same port', async () => {
    await withTempDroneDataDir('drone-remote-control-', async () => {
      const hub = spawnSleep();
      const ngrok = spawnSleep();
      try {
        await writeRemoteHubState({
          version: 1,
          pid: hub.pid!,
          host: '127.0.0.1',
          port: 8790,
          publicUrl: 'https://example.ngrok-free.app',
          controlToken: 'test-token',
          startedAt: new Date().toISOString(),
          logPath: '/tmp/remote-hub.log',
        });
        await writeRemoteNgrokState({
          version: 1,
          pid: ngrok.pid!,
          port: 8790,
          startedAt: new Date().toISOString(),
          logPath: '/tmp/remote-ngrok.log',
        });

        const result = await stopRemoteHubDetached();

        expect(result.stopped).toBe(true);
        expect(result.pid).toBe(hub.pid);
        expect(result.ngrok).toEqual({ stopped: true, pid: ngrok.pid });
        expect(pidIsRunning(hub.pid!)).toBe(false);
        expect(pidIsRunning(ngrok.pid!)).toBe(false);
        expect(await readRemoteNgrokState()).toBeNull();
      } finally {
        killIfRunning(hub);
        killIfRunning(ngrok);
      }
    });
  });

  test('stopping remote Hub leaves owned ngrok on another port running', async () => {
    await withTempDroneDataDir('drone-remote-control-', async () => {
      const hub = spawnSleep();
      const ngrok = spawnSleep();
      try {
        await writeRemoteHubState({
          version: 1,
          pid: hub.pid!,
          host: '127.0.0.1',
          port: 8790,
          publicUrl: null,
          controlToken: 'test-token',
          startedAt: new Date().toISOString(),
          logPath: '/tmp/remote-hub.log',
        });
        await writeRemoteNgrokState({
          version: 1,
          pid: ngrok.pid!,
          port: 8791,
          startedAt: new Date().toISOString(),
          logPath: '/tmp/remote-ngrok.log',
        });

        const result = await stopRemoteHubDetached();

        expect(result.stopped).toBe(true);
        expect(result.ngrok).toBeUndefined();
        expect(pidIsRunning(hub.pid!)).toBe(false);
        expect(pidIsRunning(ngrok.pid!)).toBe(true);
        expect(await readRemoteNgrokState()).toMatchObject({ pid: ngrok.pid, port: 8791 });
      } finally {
        killIfRunning(hub);
        killIfRunning(ngrok);
      }
    });
  });

  test('internal remote Hub restart can keep owned ngrok running', async () => {
    await withTempDroneDataDir('drone-remote-control-', async () => {
      const hub = spawnSleep();
      const ngrok = spawnSleep();
      try {
        await writeRemoteHubState({
          version: 1,
          pid: hub.pid!,
          host: '127.0.0.1',
          port: 8790,
          publicUrl: 'https://example.ngrok-free.app',
          controlToken: 'test-token',
          startedAt: new Date().toISOString(),
          logPath: '/tmp/remote-hub.log',
        });
        await writeRemoteNgrokState({
          version: 1,
          pid: ngrok.pid!,
          port: 8790,
          startedAt: new Date().toISOString(),
          logPath: '/tmp/remote-ngrok.log',
        });

        const result = await stopRemoteHubDetached({ disableDesired: false, stopNgrok: false });

        expect(result.stopped).toBe(true);
        expect(result.ngrok).toBeUndefined();
        expect(pidIsRunning(hub.pid!)).toBe(false);
        expect(pidIsRunning(ngrok.pid!)).toBe(true);
        expect(await readRemoteNgrokState()).toMatchObject({ pid: ngrok.pid, port: 8790 });
      } finally {
        killIfRunning(hub);
        killIfRunning(ngrok);
      }
    });
  });
});
