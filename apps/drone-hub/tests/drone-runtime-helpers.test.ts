import { describe, expect, test } from 'bun:test';
import {
  droneHomePath,
  isHostRuntimeDrone,
  normalizeDroneRuntime,
  resolveDroneFileOpenPath,
} from '../src/droneHub/app/helpers';

describe('runtime helpers', () => {
  test('normalizes runtime values', () => {
    expect(normalizeDroneRuntime('host')).toBe('host');
    expect(normalizeDroneRuntime('HOST')).toBe('host');
    expect(normalizeDroneRuntime('container')).toBe('container');
    expect(normalizeDroneRuntime('')).toBe('container');
    expect(normalizeDroneRuntime(null)).toBe('container');
  });

  test('detects host runtime drones', () => {
    expect(isHostRuntimeDrone({ runtime: 'host' } as any)).toBe(true);
    expect(isHostRuntimeDrone({ runtime: 'container' } as any)).toBe(false);
    expect(isHostRuntimeDrone({} as any)).toBe(false);
  });

  test('resolves home path by runtime and repo attachment', () => {
    expect(droneHomePath({ runtime: 'container', repoAttached: true, repoPath: '/tmp/repo' } as any)).toBe('/work/repo');
    expect(droneHomePath({ runtime: 'container', repoAttached: false, repoPath: '' } as any)).toBe('/dvm-data/home');
    expect(droneHomePath({ runtime: 'host', repoAttached: false, repoPath: '', cwd: '/tmp/host-home' } as any)).toBe('/tmp/host-home');
    expect(droneHomePath({ runtime: 'host', repoAttached: true, repoPath: '/Users/me/repo' } as any)).toBe('/Users/me/repo');
    expect(droneHomePath({ runtime: 'host', repoAttached: false, repoPath: '' } as any)).toBe('/');
  });

  test('resolves file-open paths for container drones', () => {
    const drone = { runtime: 'container', repoAttached: true, repoPath: '/home/me/project' } as any;

    expect(resolveDroneFileOpenPath(drone, 'src/main.ts')).toBe('/work/repo/src/main.ts');
    expect(resolveDroneFileOpenPath(drone, '/work/repo/src/main.ts')).toBe('/work/repo/src/main.ts');
    expect(resolveDroneFileOpenPath(drone, '/home/me/project/src/main.ts')).toBe('/work/repo/src/main.ts');
    expect(resolveDroneFileOpenPath(drone, '/home/me/project-other/src/main.ts')).toBe('/home/me/project-other/src/main.ts');
  });

  test('resolves file-open paths for host runtime drones', () => {
    const drone = { runtime: 'host', repoAttached: true, repoPath: '/Users/me/project', cwd: '/Users/me/project' } as any;

    expect(resolveDroneFileOpenPath(drone, 'src/main.ts')).toBe('/Users/me/project/src/main.ts');
    expect(resolveDroneFileOpenPath(drone, '/work/repo/src/main.ts')).toBe('/Users/me/project/src/main.ts');
    expect(resolveDroneFileOpenPath(drone, '/Users/me/project/src/main.ts')).toBe('/Users/me/project/src/main.ts');
  });
});
