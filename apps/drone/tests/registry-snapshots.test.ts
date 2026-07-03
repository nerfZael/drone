import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

describe('registry hourly snapshots', () => {
  test('captures the prior registry state at most once per hour', async () => {
    await withTempDroneDataDir('drone-registry-snapshots-', async (droneDataDir) => {
      const writeAutomationLabel = async (label: string) => {
        await updateRegistry((reg: any) => {
          reg.settings ??= {};
          reg.settings.uiPreferences = {
            sidebarGroupingMode: 'groups',
            sidebarDensityMode: 'default',
            sidebarGroupOrder: [],
            sidebarDroneOrderByGroup: {},
            sidebarNodeOrderByParent: {},
            sidebarChatOrderByDrone: {},
            hiddenSidebarGroups: [],
            autoDelete: false,
            automations: [
              {
                id: 'automation-1',
                label,
                prompt: `prompt:${label}`,
                onFailurePrompt: '',
                runs: 1,
                sleepAmount: 0,
                sleepUnit: 'seconds',
                stopPhrase: '<DONE>',
                stopPhraseCaseSensitive: true,
              },
            ],
            updatedAt: new Date().toISOString(),
          };
        });
      };

      const snapshotFiles = () =>
        fs.readdirSync(droneDataDir)
          .filter((name) => /^registry\.snapshot-.*\.json$/.test(name))
          .sort();

      await writeAutomationLabel('first');
      expect(snapshotFiles()).toEqual([]);

      await writeAutomationLabel('second');
      const [snapshotName] = snapshotFiles();
      expect(snapshotName).toBeTruthy();
      expect(snapshotFiles()).toHaveLength(1);

      const snapshotPath = path.join(droneDataDir, snapshotName);
      const snapshotAfterSecondWrite = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(snapshotAfterSecondWrite?.settings?.uiPreferences?.automations?.[0]?.label).toBe('first');

      await writeAutomationLabel('third');
      expect(snapshotFiles()).toHaveLength(1);

      const snapshotAfterThirdWrite = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(snapshotAfterThirdWrite?.settings?.uiPreferences?.automations?.[0]?.label).toBe('first');
    });
  });

  test('blocks accidental bulk fleet overwrite to empty registry', async () => {
    await withTempDroneDataDir('drone-registry-empty-guard-', async (droneDataDir) => {
      await updateRegistry((reg: any) => {
        reg.drones = {};
        for (let i = 0; i < 10; i += 1) {
          const id = `drone-${i}`;
          reg.drones[id] = {
            id,
            name: `Drone ${i}`,
            containerName: `drone-${i}`,
            runtime: 'container',
            hostPort: 40000 + i,
            containerPort: 7777,
            token: `token-${i}`,
            createdAt: new Date(0).toISOString(),
          };
        }
      });

      await expect(
        updateRegistry((reg: any) => {
          reg.drones = {};
          reg.pending = {};
          reg.archived = {};
        }),
      ).rejects.toThrow(/refusing to overwrite registry fleet with zero entries/);

      const guardSnapshots = fs
        .readdirSync(droneDataDir)
        .filter((name) => /^registry\.guard-(before|after)-.*\.json$/.test(name))
        .sort();
      expect(guardSnapshots.length).toBeGreaterThanOrEqual(2);

      const auditPath = path.join(droneDataDir, 'registry.write-audit.jsonl');
      expect(fs.readFileSync(auditPath, 'utf8')).toContain('"blocked":true');

      const hubLogPath = path.join(droneDataDir, 'hub.log');
      const hubLog = fs.readFileSync(hubLogPath, 'utf8');
      expect(hubLog).toContain('registry fleet write blocked');
      expect(hubLog).toContain('"event":"empty-fleet-write"');
    });
  });
});
