import { describe, expect, test } from 'bun:test';

import { resolveDetachedCliLaunchSpec } from '../src/hub/hub-launch';

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
