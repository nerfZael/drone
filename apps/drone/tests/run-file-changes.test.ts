import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  captureDroneRunFileChangesBaseline,
  finalizeDroneRunFileChanges,
  isMutatingWorkspaceTool,
} from '../src/hub/run-file-changes';

const temporaryDirectories: string[] = [];

function git(repoPath: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `git ${args.join(' ')} failed`));
  }
  return result.stdout;
}

function createRepository(): string {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-run-file-changes-'));
  temporaryDirectories.push(repoPath);
  git(repoPath, 'init', '--quiet');
  git(repoPath, 'config', 'user.email', 'test@example.com');
  git(repoPath, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(repoPath, 'src'));
  fs.writeFileSync(path.join(repoPath, 'src', 'existing.ts'), 'one\ntwo\n');
  fs.writeFileSync(path.join(repoPath, 'deleted.txt'), 'delete me\n');
  fs.writeFileSync(path.join(repoPath, 'renamed.txt'), 'rename me\n');
  git(repoPath, 'add', '-A');
  git(repoPath, 'commit', '--quiet', '-m', 'base');
  git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return repoPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('agent run file changes', () => {
  test('recognizes every write-capable workspace tool', () => {
    for (const tool of [
      'bash',
      'write_file',
      'apply_patch',
      'delete_file',
      'move_path',
      'create_directory',
      'delete_directory',
      'transfer_mkdir',
      'transfer_prepare',
      'transfer_write',
      'transfer_commit',
    ]) {
      expect(isMutatingWorkspaceTool(tool)).toBe(true);
    }
    expect(isMutatingWorkspaceTool('read_file')).toBe(false);
  });

  test('reports only changes made after the run baseline', async () => {
    const repoPath = createRepository();
    fs.appendFileSync(path.join(repoPath, 'src', 'existing.ts'), 'dirty before run\n');
    fs.writeFileSync(path.join(repoPath, 'before-run.txt'), 'already dirty\n');
    const drone = {
      runtime: 'host',
      repoAttached: true,
      repoPath,
      name: 'Host drone',
    };

    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });
    expect(baseline).not.toBeNull();

    fs.writeFileSync(
      path.join(repoPath, 'src', 'existing.ts'),
      'ONE\ntwo\ndirty before run\nadded by run\n',
    );
    fs.appendFileSync(path.join(repoPath, 'before-run.txt'), 'changed by run\n');
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'new file\n');
    fs.unlinkSync(path.join(repoPath, 'deleted.txt'));
    fs.renameSync(path.join(repoPath, 'renamed.txt'), path.join(repoPath, 'moved.txt'));

    const summary = await finalizeDroneRunFileChanges({ baseline: baseline!, drone });

    expect(summary?.version).toBe(2);
    expect(summary?.counts).toEqual({
      changed: 5,
      additions: 4,
      deletions: 2,
      modified: 1,
    });
    expect(summary?.workspaces[0]).toMatchObject({
      droneId: 'host-1',
      label: 'Host drone',
      counts: { changed: 5, additions: 4, deletions: 2, modified: 1 },
    });
    expect(summary?.workspaces[0]?.previewEntries).toEqual([
      expect.objectContaining({
        path: 'before-run.txt',
        status: 'modified',
        additions: 1,
        deletions: 0,
      }),
      expect.objectContaining({
        path: 'deleted.txt',
        status: 'deleted',
        additions: 0,
        deletions: 1,
      }),
      expect.objectContaining({
        path: 'moved.txt',
        originalPath: 'renamed.txt',
        status: 'renamed',
      }),
      expect.objectContaining({ path: 'new.txt', status: 'added', additions: 1, deletions: 0 }),
      expect.objectContaining({
        path: 'src/existing.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        modified: 1,
      }),
    ]);
  });

  test('returns no widget data when the run did not change files', async () => {
    const repoPath = createRepository();
    const drone = { runtime: 'host', repoAttached: true, repoPath, name: 'Host drone' };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });

    expect(await finalizeDroneRunFileChanges({ baseline: baseline!, drone })).toBeNull();
  });

  test('ignores upstream changes adopted while opening a pull request', async () => {
    const repoPath = createRepository();
    git(repoPath, 'switch', '--quiet', '-c', 'dvm/work');
    fs.writeFileSync(path.join(repoPath, 'feature.txt'), 'feature change\n');
    const drone = {
      runtime: 'host',
      repoAttached: true,
      repoPath,
      name: 'Host drone',
      repo: { baseRef: 'main' },
    };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });

    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'feature');
    git(repoPath, 'switch', '--quiet', '-c', 'upstream', 'refs/remotes/origin/main');
    fs.writeFileSync(path.join(repoPath, 'upstream.txt'), 'unrelated upstream change\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'upstream');
    git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repoPath, 'switch', '--quiet', 'dvm/work');
    git(repoPath, 'rebase', '--quiet', 'refs/remotes/origin/main');

    expect(await finalizeDroneRunFileChanges({ baseline: baseline!, drone })).toBeNull();
  });
});
