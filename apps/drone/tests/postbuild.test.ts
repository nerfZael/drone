import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const {
  blipBundleArgs,
  copyDroneHubElectronMain,
  CONTAINER_RUNTIME_FILES,
  daemonBundleArgs,
  DRONE_HUB_BUILD_ID_FILE,
  DRONE_HUB_ELECTRON_ICON_FILE,
  mcpBridgeBundleArgs,
  runtimeBuildId,
} = require('../scripts/postbuild.cjs');
import { requiredDroneDaemonRuntimeFiles } from '../src/hub/drone-daemon-runtime';

describe('postbuild bundles', () => {
  test('packages every local module required by the desktop entry points', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-desktop-build-'));
    try {
      await fs.symlink(path.resolve(__dirname, '../desktop'), path.join(root, 'desktop'), 'dir');
      await fs.mkdir(path.join(root, 'dist'));
      await copyDroneHubElectronMain(root);
      const pending = ['hub-electron-main.cjs', 'hub-electron-preload.cjs'];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const filename = pending.pop()!;
        if (visited.has(filename)) continue;
        visited.add(filename);
        const source = await fs.readFile(path.join(root, 'dist', filename), 'utf8');
        for (const match of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) {
          pending.push(path.join(path.dirname(filename), match[1]));
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('packages exactly the files required by a container daemon', () => {
    expect(CONTAINER_RUNTIME_FILES).toEqual([...requiredDroneDaemonRuntimeFiles()]);
  });
  test('bundles blip for Node into dist/blip.js', () => {
    const root = path.resolve(__dirname, '..');
    expect(blipBundleArgs(root)).toEqual([
      'build',
      path.resolve(root, '..', '..', 'blip', 'packages', 'cli', 'src', 'cli.ts'),
      '--target=node',
      '--format=cjs',
      `--outfile=${path.join(root, 'dist', 'blip.js')}`,
    ]);
  });
  test('packages the Drone Hub desktop icon', () => {
    expect(DRONE_HUB_ELECTRON_ICON_FILE).toBe('drone-hub-icon.png');
  });

  test('creates a stable build identity from all runtime sources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-build-id-'));
    await fs.mkdir(path.join(root, 'dist', 'hub'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist', 'cli.js'), 'cli-v1');
    await fs.writeFile(path.join(root, 'dist', 'hub', 'server.js'), 'server-v1');
    await fs.writeFile(path.join(root, 'dist', 'ignored.css'), 'theme-v1');

    const first = await runtimeBuildId(root);
    await fs.writeFile(path.join(root, 'dist', 'ignored.css'), 'theme-v2');
    expect(await runtimeBuildId(root)).toBe(first);
    await fs.writeFile(path.join(root, 'dist', 'hub', 'server.js'), 'server-v2');
    expect(await runtimeBuildId(root)).not.toBe(first);
    const beforeHelper = await runtimeBuildId(root);
    await fs.writeFile(path.join(root, 'dist', 'hub-x11-backquote.py'), 'helper-v1');
    expect(await runtimeBuildId(root)).not.toBe(beforeHelper);
    expect(DRONE_HUB_BUILD_ID_FILE).toBe('build-id');
  });

  test('refuses to create a build identity without runtime sources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-empty-build-id-'));
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });

    await expect(runtimeBuildId(root)).rejects.toThrow('No runtime sources found');
  });

  test('bundles the credential-free MCP bridge for Node', () => {
    const root = path.resolve(__dirname, '..');
    expect(mcpBridgeBundleArgs(root)).toEqual([
      'build',
      path.join(root, 'src', 'mcp-http-stdio-bridge.ts'),
      '--target=node',
      '--format=cjs',
      `--outfile=${path.join(root, 'dist', 'mcp-http-stdio-bridge.js')}`,
    ]);
  });

  test('bundles the container daemon with its workspace dependencies', () => {
    const root = path.resolve(__dirname, '..');
    expect(daemonBundleArgs(root)).toEqual([
      'build',
      path.join(root, 'src', 'daemon.ts'),
      '--target=node',
      '--format=cjs',
      `--outfile=${path.join(root, 'dist', 'daemon.bundle.js')}`,
    ]);
  });
});
