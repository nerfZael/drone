import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  createRegistryBackup,
  resolveRegistryBackupStatusResponse,
  upsertStoredRegistryBackupSettings,
} from '../src/host/registry-backups';
import { updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

function backupPath(root: string, relOrAbs: string | null): string | null {
  if (!relOrAbs) return null;
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(root, relOrAbs);
}

async function seedFleet(count: number): Promise<void> {
  await updateRegistry((reg: any) => {
    reg.drones = {};
    reg.pending = {};
    reg.archived = {};
    for (let i = 0; i < count; i += 1) {
      const id = `drone-${i}`;
      reg.drones[id] = {
        id,
        name: `Drone ${i}`,
        containerName: `drone-${i}`,
        runtime: 'container',
        hostPort: 41000 + i,
        containerPort: 7777,
        token: `token-${i}`,
        createdAt: new Date(0).toISOString(),
      };
    }
  });
}

describe('registry backups', () => {
  test('creates a SQLite-safe manual backup with a registry JSON export and manifest', async () => {
    await withTempDroneDataDir('drone-registry-backups-', async (droneDataDir) => {
      await seedFleet(3);

      const manifest = await createRegistryBackup('manual', { force: true });

      expect(manifest?.kind).toBe('manual');
      expect(manifest?.counts.total).toBe(3);
      expect(manifest?.validation.registryJsonReadable).toBe(true);
      expect(fs.existsSync(backupPath(droneDataDir, manifest?.paths.registryJson ?? null)!)).toBe(true);
      if (manifest?.paths.sqlite) {
        expect(manifest.validation.sqliteReadable).toBe(true);
        expect(fs.existsSync(backupPath(droneDataDir, manifest.paths.sqlite)!)).toBe(true);
      }
      expect(fs.existsSync(backupPath(droneDataDir, manifest?.paths.manifest ?? null)!)).toBe(true);

      const status = await resolveRegistryBackupStatusResponse();
      expect(status.recent[0]?.id).toBe(manifest?.id);
    });
  });

  test('quarantines an empty current registry instead of writing a healthy scheduled backup', async () => {
    await withTempDroneDataDir('drone-registry-backup-suspect-', async () => {
      await seedFleet(10);
      const healthy = await createRegistryBackup('manual', { force: true });
      expect(healthy?.suspect).toBe(false);

      const prevOverride = process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE;
      process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE = '1';
      try {
        await updateRegistry((reg: any) => {
          reg.drones = {};
          reg.pending = {};
          reg.archived = {};
        });
      } finally {
        if (prevOverride == null) delete process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE;
        else process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE = prevOverride;
      }

      const suspect = await createRegistryBackup('hourly', { force: true });
      expect(suspect?.kind).toBe('suspect');
      expect(suspect?.suspect).toBe(true);
      expect(suspect?.counts.total).toBe(0);
      expect(suspect?.reason).toContain('previous healthy backup had 10');
    });
  });

  test('does not create repeated suspect backups for the same scheduled bucket', async () => {
    await withTempDroneDataDir('drone-registry-backup-suspect-once-', async (droneDataDir) => {
      await seedFleet(10);
      await createRegistryBackup('manual', { force: true });

      const prevOverride = process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE;
      process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE = '1';
      try {
        await updateRegistry((reg: any) => {
          reg.drones = {};
          reg.pending = {};
          reg.archived = {};
        });
      } finally {
        if (prevOverride == null) delete process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE;
        else process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE = prevOverride;
      }

      const first = await createRegistryBackup('hourly', { force: true });
      const second = await createRegistryBackup('hourly', { force: true });

      expect(first?.kind).toBe('suspect');
      expect(second?.id).toBe(first?.id);
      const status = await resolveRegistryBackupStatusResponse();
      expect(status.next.hourlyDue).toBe(false);
      const suspectManifests = fs
        .readdirSync(path.join(droneDataDir, 'backups', 'suspect'))
        .filter((name) => /^manifest-hourly-.*\.json$/.test(name));
      expect(suspectManifests).toHaveLength(1);
    });
  });

  test('persists backup policy through canonical settings storage', async () => {
    await withTempDroneDataDir('drone-registry-backup-settings-', async () => {
      await upsertStoredRegistryBackupSettings({
        enabled: false,
        hourlyEnabled: false,
        dailyEnabled: true,
        hourlyRetentionHours: 12,
        dailyRetentionDays: 14,
      });

      const status = await resolveRegistryBackupStatusResponse();
      expect(status.backupSettings.enabled).toBe(false);
      expect(status.backupSettings.hourlyEnabled).toBe(false);
      expect(status.backupSettings.dailyEnabled).toBe(true);
      expect(status.backupSettings.hourlyRetentionHours).toBe(12);
      expect(status.backupSettings.dailyRetentionDays).toBe(14);
      expect(status.backupSettings.source).toBe('settings');
    });
  });
});
