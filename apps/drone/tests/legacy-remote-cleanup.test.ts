import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import {
  cleanupLegacyRemoteHub,
  isLegacyRemoteHubCommand,
  isLegacyRemoteNgrokCommand,
} from '../src/hub/legacy-remote-cleanup';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-remote-cleanup-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('legacy RemoteHub cleanup', () => {
  test('matches only the legacy detached process commands', () => {
    expect(isLegacyRemoteHubCommand('node /repo/apps/drone/dist/cli.js hub remote-run --port 3200')).toBe(true);
    expect(isLegacyRemoteHubCommand('node /repo/apps/drone/dist/cli.js hub run --port 5174')).toBe(false);
    expect(isLegacyRemoteNgrokCommand('/usr/bin/ngrok http 3200', 3200)).toBe(true);
    expect(isLegacyRemoteNgrokCommand('/usr/bin/ngrok http 8787', 3200)).toBe(false);
  });

  test('stops verified processes and removes legacy state, desired state, and logs', async () => {
    const root = await tempRoot();
    await Promise.all([
      fs.writeFile(path.join(root, 'remote-hub.json'), JSON.stringify({ pid: 101, port: 3200 })),
      fs.writeFile(path.join(root, 'remote-ngrok.json'), JSON.stringify({ pid: 202, port: 3200 })),
      fs.writeFile(path.join(root, 'remote-hub-desired.json'), JSON.stringify({ enabled: true })),
      fs.writeFile(path.join(root, 'remote-hub.log'), 'remote'),
      fs.writeFile(path.join(root, 'remote-ngrok.log'), 'ngrok'),
    ]);
    const running = new Set([101, 202]);
    const stopped: number[] = [];
    const result = await cleanupLegacyRemoteHub(root, {
      isPidRunning: (pid) => running.has(pid),
      commandForPid: async (pid) =>
        pid === 101 ? 'node /repo/dist/cli.js hub remote-run --port 3200' : '/usr/bin/ngrok http 3200',
      stopPid: async (pid) => {
        stopped.push(pid);
        running.delete(pid);
        return true;
      },
    });

    expect(stopped).toEqual([101, 202]);
    expect(result.stoppedPids).toEqual([101, 202]);
    expect((await fs.readdir(root)).sort()).toEqual([]);
  });

  test('does not signal a recycled PID', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'remote-hub.json'), JSON.stringify({ pid: 303, port: 3200 }));
    let stopCalled = false;
    const result = await cleanupLegacyRemoteHub(root, {
      isPidRunning: () => true,
      commandForPid: async () => 'node unrelated-server.js',
      stopPid: async () => {
        stopCalled = true;
        return true;
      },
    });
    expect(stopCalled).toBe(false);
    expect(result.warnings[0]).toContain('recycled PID 303');
    expect(await fs.readdir(root)).toEqual([]);
  });

  test('preserves live process state when command verification is unavailable', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'remote-hub.json'), JSON.stringify({ pid: 404, port: 3200 }));
    await fs.writeFile(path.join(root, 'remote-hub-desired.json'), JSON.stringify({ enabled: true }));
    const result = await cleanupLegacyRemoteHub(root, {
      isPidRunning: () => true,
      commandForPid: async () => null,
    });
    expect(result.warnings[0]).toContain('Could not verify');
    expect(await fs.readdir(root)).toEqual(['remote-hub.json']);
  });
});
