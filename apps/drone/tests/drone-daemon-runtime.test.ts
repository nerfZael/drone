import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { assertDroneDaemonRuntimeReady, resolveDroneDaemonJsPath, resolveDroneDaemonRuntimeDir } from '../src/hub/drone-daemon-runtime';
import { removeRetiredContainerCliScripts } from '../src/host/runtime';

const tmpRoots: string[] = [];

async function makeTempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-daemon-runtime-'));
  tmpRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('drone daemon runtime resolution', () => {
  test('removes retired fleet and task wrappers during container runtime refresh', () => {
    expect(removeRetiredContainerCliScripts()).toContain('rm -f /usr/local/bin/fleet /usr/local/bin/tasks');
  });

  test('resolves built runtime when Hub runs from source/dev mode', async () => {
    const root = await makeTempRepo();
    const sourceHubDir = path.join(root, 'src', 'hub');
    const distDir = path.join(root, 'dist');
    await fs.mkdir(sourceHubDir, { recursive: true });
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, 'daemon.js'), 'module.exports = {};\n');

    expect(resolveDroneDaemonJsPath(sourceHubDir)).toBe(path.join(distDir, 'daemon.js'));
    expect(resolveDroneDaemonRuntimeDir(sourceHubDir)).toBe(distDir);
  });

  test('fails local preflight when built daemon.js is missing', async () => {
    const root = await makeTempRepo();

    await expect(assertDroneDaemonRuntimeReady(root)).rejects.toThrow(/bun run --filter drone build/);
  });

  test('requires the daemon and supported container CLI entrypoint in the built runtime', async () => {
    const root = await makeTempRepo();
    await fs.writeFile(path.join(root, 'daemon.js'), 'module.exports = {};\n');
    await expect(assertDroneDaemonRuntimeReady(root)).rejects.toThrow(/blip\.js/);

    await fs.writeFile(path.join(root, 'blip.js'), 'module.exports = {};\n');
    await expect(assertDroneDaemonRuntimeReady(root)).resolves.toBeUndefined();
  });
});
