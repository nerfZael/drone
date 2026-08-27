import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const {
  blipBundleArgs,
  CONTAINER_RUNTIME_FILES,
  daemonBundleArgs,
  DRONE_HUB_BUILD_ID_FILE,
  DRONE_HUB_ELECTRON_ICON_FILE,
  mcpBridgeBundleArgs,
  runtimeBuildId,
} = require('../scripts/postbuild.cjs');
import { requiredDroneDaemonRuntimeFiles } from '../src/hub/drone-daemon-runtime';

describe('postbuild bundles', () => {
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

  test('creates a stable build identity from all runtime JavaScript', async () => {
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
    expect(DRONE_HUB_BUILD_ID_FILE).toBe('build-id');
  });

  test('refuses to create a build identity without runtime JavaScript', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-empty-build-id-'));
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });

    await expect(runtimeBuildId(root)).rejects.toThrow('No runtime JavaScript found');
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
