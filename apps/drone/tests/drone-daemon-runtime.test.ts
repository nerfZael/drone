import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertDroneDaemonRuntimeReady,
  hostDroneDaemonLaunchEnvironment,
  isDroneDaemonCommandForPort,
  resolveDroneDaemonJsPath,
  resolveDroneDaemonRuntimeDir,
} from '../src/hub/drone-daemon-runtime';
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

  test('requires the daemon, supported CLI, and managed MCP bridge in the built runtime', async () => {
    const root = await makeTempRepo();
    await fs.writeFile(path.join(root, 'daemon.js'), 'module.exports = {};\n');
    await expect(assertDroneDaemonRuntimeReady(root)).rejects.toThrow(/blip\.js/);

    await fs.writeFile(path.join(root, 'blip.js'), 'module.exports = {};\n');
    await expect(assertDroneDaemonRuntimeReady(root)).rejects.toThrow(/mcp-http-stdio-bridge\.js/);

    await fs.writeFile(path.join(root, 'mcp-http-stdio-bridge.js'), 'module.exports = {};\n');
    await expect(assertDroneDaemonRuntimeReady(root)).resolves.toBeUndefined();
  });

  test('keeps the node executable directory on the host daemon PATH', () => {
    const executablePath = path.join(path.sep, 'opt', 'node', 'bin', 'node');
    const inheritedPath = [path.join(path.sep, 'usr', 'bin'), path.join(path.sep, 'bin')].join(
      path.delimiter,
    );
    const env = hostDroneDaemonLaunchEnvironment(
      { PATH: inheritedPath, DRONE_TEST_VALUE: 'preserved' },
      executablePath,
    );

    expect(env.PATH?.split(path.delimiter)[0]).toBe(path.dirname(executablePath));
    expect(env.DRONE_TEST_VALUE).toBe('preserved');
  });

  test('recognizes only the expected host daemon process and port', () => {
    expect(
      isDroneDaemonCommandForPort(
        '/usr/bin/node /opt/drone/dist/daemon.js --host 127.0.0.1 --port 8787',
        8787,
      ),
    ).toBe(true);
    expect(
      isDroneDaemonCommandForPort(
        '/usr/bin/node /opt/drone/dist/daemon.js --host 127.0.0.1 --port 9999',
        8787,
      ),
    ).toBe(false);
    expect(isDroneDaemonCommandForPort('/usr/bin/node unrelated.js --port 8787', 8787)).toBe(
      false,
    );
  });
});
