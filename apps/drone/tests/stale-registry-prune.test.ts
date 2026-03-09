import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { pruneMissingRegistryDrones } from '../src/hub/stale-registry-prune';

async function withTempHomes<T>(
  fn: (ctx: { tempRoot: string; homeDir: string; xdgDataHome: string }) => Promise<T>,
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-stale-registry-prune-'));
  const homeDir = path.join(tempRoot, 'home');
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(xdgDataHome, { recursive: true });

  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(xdgDataHome, 'drone');
  process.env.HOME = homeDir;
  process.env.XDG_DATA_HOME = xdgDataHome;
  process.env.DRONE_DATA_DIR = droneDataDir;
  fs.mkdirSync(droneDataDir, { recursive: true });
  resetDroneRootDirForTests();

  try {
    return await fn({ tempRoot, homeDir, xdgDataHome });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('pruneMissingRegistryDrones', () => {
  test('removes active drones whose containers no longer exist', async () => {
    await withTempHomes(async () => {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = reg.drones ?? {};
        reg.drones.keep = {
          id: 'keep',
          name: 'keep',
          containerName: 'drone-keep',
          containerPort: 7777,
          token: 'token-keep',
          repoPath: '',
          createdAt: now,
        };
        reg.drones.prune = {
          id: 'prune',
          name: 'prune',
          containerName: 'drone-prune',
          containerPort: 7777,
          token: 'token-prune',
          repoPath: '',
          createdAt: now,
        };
      });

      const removed = await pruneMissingRegistryDrones({
        listContainerNames: async () => ['drone-keep'],
      });

      expect(removed).toEqual([
        {
          id: 'prune',
          name: 'prune',
          containerName: 'drone-prune',
        },
      ]);

      const reg = await loadRegistry();
      expect(Object.keys(reg.drones).sort()).toEqual(['keep']);
    });
  });

  test('does not prune host-mode drones or when container listing is unavailable', async () => {
    await withTempHomes(async () => {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = reg.drones ?? {};
        reg.drones.host = {
          id: 'host',
          name: 'host',
          runtime: 'host',
          containerName: 'host-drone',
          containerPort: 7777,
          token: 'token-host',
          repoPath: '',
          createdAt: now,
        };
        reg.drones.unknown = {
          id: 'unknown',
          name: 'unknown',
          containerName: 'drone-unknown',
          containerPort: 7777,
          token: 'token-unknown',
          repoPath: '',
          createdAt: now,
        };
      });

      const removedOnFailure = await pruneMissingRegistryDrones({
        listContainerNames: async () => {
          throw new Error('docker unavailable');
        },
      });
      expect(removedOnFailure).toEqual([]);

      const removed = await pruneMissingRegistryDrones({
        listContainerNames: async () => [],
      });
      expect(removed).toEqual([
        {
          id: 'unknown',
          name: 'unknown',
          containerName: 'drone-unknown',
        },
      ]);

      const reg = await loadRegistry();
      expect(Object.keys(reg.drones)).toEqual(['host']);
    });
  });
});
