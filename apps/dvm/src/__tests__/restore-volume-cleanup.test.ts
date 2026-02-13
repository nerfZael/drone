import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContainerManager } from '../container/manager';

describe('dvm restore volume cleanup', () => {
  test('removes restore target volume even when container is absent', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvm-restore-unit-'));
    const archivePath = path.join(tmpDir, 'snapshot.tar.gz');
    fs.writeFileSync(archivePath, 'stub', 'utf8');

    const manager = new ContainerManager();
    const removedVolumes: string[] = [];
    const imported: Array<{ archivePath: string; options: any }> = [];

    (manager as any).docker = {
      containerExists: async () => false,
      removeVolume: async (name: string) => {
        removedVolumes.push(String(name));
      },
    };
    (manager as any).importContainer = async (archive: string, options: any) => {
      imported.push({ archivePath: archive, options });
    };

    try {
      await manager.restoreContainer('restore-target', archivePath, { start: false });
      expect(removedVolumes).toEqual(['dvm-restore-target-data']);
      expect(imported).toHaveLength(1);
      expect(imported[0]?.archivePath).toBe(archivePath);
      expect(imported[0]?.options?.name).toBe('restore-target');
      expect(imported[0]?.options?.start).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
