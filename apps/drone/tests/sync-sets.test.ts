import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildStoredSyncSet,
  computeSyncSetSourceSnapshot,
  mirrorLocalSourceToHostTarget,
  readStoredSyncSets,
  writeStoredSyncSets,
} from '../src/hub/sync-sets';
import { withTempDroneDataDir } from './test-helpers';

describe('sync set helpers', () => {
  test('computeSyncSetSourceSnapshot hashes directory contents and updates when files change', async () => {
    await withTempDroneDataDir('drone-sync-sets-', async (droneDataDir) => {
      const sourcePath = path.join(droneDataDir, 'source');
      await fs.mkdir(path.join(sourcePath, 'nested'), { recursive: true });
      await fs.writeFile(path.join(sourcePath, 'alpha.txt'), 'one\n');
      await fs.writeFile(path.join(sourcePath, 'nested', 'beta.txt'), 'two\n');

      const syncSet = buildStoredSyncSet({
        id: 'sync-1',
        label: 'Auth files',
        sourceType: 'host-path',
        sourcePath,
        targetPath: '/dvm-data/home/.codex',
        applyToHost: false,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      });

      const first = await computeSyncSetSourceSnapshot(syncSet);
      expect(first.sourceKind).toBe('directory');
      expect(first.fileCount).toBe(2);
      expect(first.totalBytes).toBeGreaterThan(0);

      await fs.writeFile(path.join(sourcePath, 'nested', 'beta.txt'), 'three\n');

      const second = await computeSyncSetSourceSnapshot(syncSet);
      expect(second.versionId).not.toBe(first.versionId);
      expect(second.fileCount).toBe(2);
      expect(second.totalBytes).toBeGreaterThan(first.totalBytes);
    });
  });

  test('computeSyncSetSourceSnapshot rejects symlinks', async () => {
    await withTempDroneDataDir('drone-sync-sets-', async (droneDataDir) => {
      const sourcePath = path.join(droneDataDir, 'source');
      await fs.mkdir(sourcePath, { recursive: true });
      await fs.writeFile(path.join(sourcePath, 'target.txt'), 'payload\n');
      await fs.symlink(path.join(sourcePath, 'target.txt'), path.join(sourcePath, 'link.txt'));

      const syncSet = buildStoredSyncSet({
        id: 'sync-1',
        label: 'Auth files',
        sourceType: 'host-path',
        sourcePath,
        targetPath: '/dvm-data/home/.codex',
        applyToHost: false,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      });

      await expect(computeSyncSetSourceSnapshot(syncSet)).rejects.toThrow('symlinks are not supported');
    });
  });

  test('mirrorLocalSourceToHostTarget fully mirrors directories and removes extras', async () => {
    await withTempDroneDataDir('drone-sync-sets-', async (droneDataDir) => {
      const sourcePath = path.join(droneDataDir, 'source');
      const targetPath = path.join(droneDataDir, 'target');
      await fs.mkdir(path.join(sourcePath, 'nested'), { recursive: true });
      await fs.mkdir(path.join(targetPath, 'stale-dir'), { recursive: true });
      await fs.writeFile(path.join(sourcePath, 'alpha.txt'), 'alpha\n');
      await fs.writeFile(path.join(sourcePath, 'nested', 'beta.txt'), 'beta\n');
      await fs.writeFile(path.join(targetPath, 'stale.txt'), 'stale\n');
      await fs.writeFile(path.join(targetPath, 'stale-dir', 'old.txt'), 'old\n');

      await mirrorLocalSourceToHostTarget({
        sourcePath,
        sourceKind: 'directory',
        targetPath,
      });

      expect(await fs.readFile(path.join(targetPath, 'alpha.txt'), 'utf8')).toBe('alpha\n');
      expect(await fs.readFile(path.join(targetPath, 'nested', 'beta.txt'), 'utf8')).toBe('beta\n');
      await expect(fs.lstat(path.join(targetPath, 'stale.txt'))).rejects.toThrow();
      await expect(fs.lstat(path.join(targetPath, 'stale-dir'))).rejects.toThrow();
    });
  });

  test('mirrorLocalSourceToHostTarget rejects overlapping host paths', async () => {
    await withTempDroneDataDir('drone-sync-sets-', async (droneDataDir) => {
      const sourcePath = path.join(droneDataDir, 'source');
      const targetPath = path.join(sourcePath, 'nested-target');
      await fs.mkdir(sourcePath, { recursive: true });
      await fs.writeFile(path.join(sourcePath, 'alpha.txt'), 'alpha\n');

      await expect(
        mirrorLocalSourceToHostTarget({
          sourcePath,
          sourceKind: 'directory',
          targetPath,
        }),
      ).rejects.toThrow('source and target cannot overlap');
    });
  });

  test('stored sync sets round-trip through registry serialization helpers', async () => {
    const reg: any = {};
    const syncSet = buildStoredSyncSet({
      id: 'sync-1',
      label: 'Shared codex auth',
      sourceType: 'hub-managed',
      sourcePath: null,
      targetPath: '/dvm-data/home/.codex',
      applyToHost: true,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
    });

    writeStoredSyncSets(reg, [syncSet], '2026-04-10T00:01:00.000Z');
    const stored = readStoredSyncSets(reg);

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: 'sync-1',
      sourceType: 'hub-managed',
      sourcePath: null,
      targetPath: '/dvm-data/home/.codex',
      applyToHost: true,
      scope: { type: 'all' },
    });
    expect(reg.settings.syncSets.updatedAt).toBe('2026-04-10T00:01:00.000Z');
  });
});
