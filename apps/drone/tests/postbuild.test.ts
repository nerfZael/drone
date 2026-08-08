import { describe, expect, test } from 'bun:test';
import path from 'node:path';

const { blipBundleArgs, daemonBundleArgs, mcpBridgeBundleArgs } = require('../scripts/postbuild.cjs');

describe('postbuild bundles', () => {
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
