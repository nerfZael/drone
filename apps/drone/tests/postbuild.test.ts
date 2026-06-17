import { describe, expect, test } from 'bun:test';
import path from 'node:path';

const { blipBundleArgs, fleetBundleArgs, tasksBundleArgs } = require('../scripts/postbuild.cjs');

describe('postbuild bundles', () => {
  test('bundles fleet for Node into dist/fleet.js', () => {
    const root = path.resolve(__dirname, '..');
    expect(fleetBundleArgs(root)).toEqual([
      'build',
      path.join(root, 'src', 'fleet.ts'),
      '--target=node',
      '--format=cjs',
      `--outfile=${path.join(root, 'dist', 'fleet.js')}`,
    ]);
  });

  test('bundles tasks for Node into dist/tasks.js', () => {
    const root = path.resolve(__dirname, '..');
    expect(tasksBundleArgs(root)).toEqual([
      'build',
      path.join(root, 'src', 'tasks.ts'),
      '--target=node',
      '--format=cjs',
      `--outfile=${path.join(root, 'dist', 'tasks.js')}`,
    ]);
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
});
