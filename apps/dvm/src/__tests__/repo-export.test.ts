import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DvmApi } from '../api';

describe('repoExport revisions', () => {
  test('exports a named snapshot ref incrementally or with full history', async () => {
    const scripts: string[] = [];
    const execCommand = jest.fn(async (_container: string, args: string[]) => {
      if (args[0] === 'bash' && args[1] === '-lc') scripts.push(String(args[2] ?? ''));
      return '';
    });
    const copyFromContainer = jest.fn(async () => {});
    const api = new DvmApi({
      manager: {
        docker: {
          execCommand,
          copyFromContainer,
        },
        startContainer: jest.fn(async () => {}),
        ensureGit: jest.fn(async () => {}),
      } as any,
      baseConfig: {} as any,
    });
    const outRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dvm-repo-export-test-'));
    const base = '1'.repeat(40);
    const snapshotRef = 'refs/drone/local-snapshots/alpha';

    try {
      await api.repoExport({
        containerName: 'alpha',
        outRoot,
        format: 'bundle',
        base,
        head: snapshotRef,
      });
      expect(scripts.at(-1)).toContain(`${base}..${snapshotRef}`);

      await api.repoExport({
        containerName: 'alpha',
        outRoot,
        format: 'bundle',
        head: snapshotRef,
        full: true,
      });
      expect(scripts.at(-1)).toContain(`git bundle create`);
      expect(scripts.at(-1)).toContain(`"${snapshotRef}"`);
      expect(scripts.at(-1)).not.toContain(`${base}..${snapshotRef}`);
    } finally {
      await fs.rm(outRoot, { recursive: true, force: true });
    }
  });
});
