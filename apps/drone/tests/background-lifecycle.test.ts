import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { resetDroneRootDirForTests } from '../src/host/paths';
import { startDroneHubApiServer } from '../src/hub/server';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('background lifecycle', () => {
  const token = 'background-lifecycle-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-background-lifecycle-'));
  const previousDroneDataDir = process.env.DRONE_DATA_DIR;
  const previousXdgDataHome = process.env.XDG_DATA_HOME;

  beforeAll(() => {
    process.env.DRONE_DATA_DIR = path.join(tempRoot, 'data');
    process.env.XDG_DATA_HOME = path.join(tempRoot, 'xdg');
    fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
    fs.mkdirSync(process.env.XDG_DATA_HOME, { recursive: true });
    resetDroneRootDirForTests();
  });

  afterAll(() => {
    if (previousDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDroneDataDir;
    if (previousXdgDataHome == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdgDataHome;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('cleans up workers after a partial startup failure', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolve);
    });
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('expected a TCP address');

    await expect(startDroneHubApiServer({ port: address.port, apiToken: token })).rejects.toThrow();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));

    const recovered = await startDroneHubApiServer({ port: address.port, apiToken: token });
    try {
      const response = await fetch(
        `http://${recovered.host}:${recovered.port}/api/settings/agents`,
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );
      expect(response.status).toBe(200);
    } finally {
      await recovered.close();
    }
  });

  test('starts cleanly after a previous server closes', async () => {
    const first = await startDroneHubApiServer({ port: 0, apiToken: token });
    await first.close();

    const second = await startDroneHubApiServer({ port: 0, apiToken: token });
    try {
      const response = await fetch(`http://${second.host}:${second.port}/api/settings/agents`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    } finally {
      await second.close();
    }
  });
});
