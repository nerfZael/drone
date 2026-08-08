import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  captureDroneRunFileChangesBaseline,
  combineAgentRunFileChanges,
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

  test('marks mixed attributed and unavailable workspaces as partial', () => {
    const summary = combineAgentRunFileChanges([
      {
        targetId: 'drone:exact',
        droneId: 'exact',
        label: 'Exact drone',
        counts: { changed: 1, additions: 2, deletions: 0, modified: 0 },
        previewEntries: [
          { path: 'run.txt', status: 'added', additions: 2, deletions: 0, modified: 0 },
        ],
        attribution: 'exact',
      },
      {
        targetId: 'drone:unavailable',
        droneId: 'unavailable',
        label: 'Unavailable drone',
        counts: { changed: 0, additions: 0, deletions: 0, modified: 0 },
        previewEntries: [],
        attribution: 'unavailable',
        baseMoved: true,
      },
    ]);

    expect(summary).toMatchObject({
      attribution: 'partial',
      baseMoved: true,
      counts: { changed: 1, additions: 2, deletions: 0, modified: 0 },
      workspaces: [{ attribution: 'exact' }, { attribution: 'unavailable' }],
    });
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

  test('excludes an adopted upstream base when the run starts clean and adds changes', async () => {
    const repoPath = createRepository();
    git(repoPath, 'switch', '--quiet', '-c', 'dvm/work');
    const drone = {
      runtime: 'host',
      repoAttached: true,
      repoPath,
      name: 'Host drone',
      repo: { baseRef: 'main' },
    };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });

    fs.writeFileSync(path.join(repoPath, 'run.txt'), 'added by run\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'run change');

    git(repoPath, 'switch', '--quiet', '-c', 'upstream', 'refs/remotes/origin/main');
    fs.writeFileSync(path.join(repoPath, 'upstream.txt'), 'unrelated upstream change\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'upstream');
    git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repoPath, 'switch', '--quiet', 'dvm/work');
    git(repoPath, 'rebase', '--quiet', 'refs/remotes/origin/main');

    // The remote can advance again after the rebase but before attribution is finalized.
    // The adopted base is the merge base with the final checkout, not necessarily the
    // latest remote tip.
    git(repoPath, 'switch', '--quiet', 'upstream');
    fs.writeFileSync(path.join(repoPath, 'later-upstream.txt'), 'arrived after the rebase\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'later upstream');
    git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repoPath, 'switch', '--quiet', 'dvm/work');

    const summary = await finalizeDroneRunFileChanges({ baseline: baseline!, drone });

    expect(summary).toMatchObject({
      version: 2,
      attribution: 'base-normalized',
      baseMoved: true,
      counts: { changed: 1, additions: 1, deletions: 0, modified: 0 },
      workspaces: [
        {
          attribution: 'base-normalized',
          baseMoved: true,
          previewEntries: [expect.objectContaining({ path: 'run.txt', additions: 1 })],
        },
      ],
    });
  });

  test('normalizes pre-existing branch changes onto an adopted upstream base', async () => {
    const repoPath = createRepository();
    git(repoPath, 'switch', '--quiet', '-c', 'dvm/work');
    fs.writeFileSync(path.join(repoPath, 'before-run.txt'), 'pre-existing branch change\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'pre-existing feature');
    const drone = {
      runtime: 'host',
      repoAttached: true,
      repoPath,
      name: 'Host drone',
      repo: { baseRef: 'main' },
    };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });

    fs.writeFileSync(path.join(repoPath, 'run.txt'), 'added by run\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'run change');
    git(repoPath, 'switch', '--quiet', '-c', 'upstream', 'refs/remotes/origin/main');
    fs.writeFileSync(path.join(repoPath, 'upstream.txt'), 'unrelated upstream change\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'upstream');
    git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repoPath, 'switch', '--quiet', 'dvm/work');
    git(repoPath, 'rebase', '--quiet', 'refs/remotes/origin/main');

    const summary = await finalizeDroneRunFileChanges({ baseline: baseline!, drone });

    expect(summary).toMatchObject({
      attribution: 'base-normalized',
      baseMoved: true,
      counts: { changed: 1, additions: 1, deletions: 0, modified: 0 },
      workspaces: [
        {
          previewEntries: [expect.objectContaining({ path: 'run.txt' })],
        },
      ],
    });
  });

  test('uses the exact run diff when the remote base moves but is not adopted', async () => {
    const repoPath = createRepository();
    git(repoPath, 'switch', '--quiet', '-c', 'dvm/work');
    const drone = {
      runtime: 'host',
      repoAttached: true,
      repoPath,
      name: 'Host drone',
      repo: { baseRef: 'main' },
    };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });

    git(repoPath, 'switch', '--quiet', '-c', 'upstream', 'refs/remotes/origin/main');
    fs.writeFileSync(path.join(repoPath, 'upstream.txt'), 'unrelated upstream change\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'upstream');
    git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repoPath, 'switch', '--quiet', 'dvm/work');
    fs.writeFileSync(path.join(repoPath, 'run.txt'), 'added by run\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'run change');

    const summary = await finalizeDroneRunFileChanges({ baseline: baseline!, drone });

    expect(summary).toMatchObject({
      attribution: 'exact',
      baseMoved: true,
      counts: { changed: 1, additions: 1, deletions: 0, modified: 0 },
      workspaces: [
        {
          attribution: 'exact',
          previewEntries: [expect.objectContaining({ path: 'run.txt' })],
        },
      ],
    });
  });

  test('reports attribution unavailable when the base history is rewritten', async () => {
    const repoPath = createRepository();
    git(repoPath, 'switch', '--quiet', '-c', 'dvm/work');
    const drone = {
      runtime: 'host',
      repoAttached: true,
      repoPath,
      name: 'Host drone',
      repo: { baseRef: 'main' },
    };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });

    git(repoPath, 'switch', '--quiet', '--orphan', 'rewritten-main');
    fs.writeFileSync(path.join(repoPath, 'rewritten.txt'), 'rewritten base history\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'rewritten upstream');
    git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repoPath, 'switch', '--quiet', 'dvm/work');
    fs.writeFileSync(path.join(repoPath, 'run.txt'), 'added by run\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'run change');

    const summary = await finalizeDroneRunFileChanges({ baseline: baseline!, drone });

    expect(summary).toMatchObject({
      attribution: 'unavailable',
      baseMoved: true,
      counts: { changed: 0, additions: 0, deletions: 0, modified: 0 },
    });
  });

  test('reports attribution unavailable when replaying starting changes conflicts', async () => {
    const repoPath = createRepository();
    git(repoPath, 'switch', '--quiet', '-c', 'dvm/work');
    fs.writeFileSync(path.join(repoPath, 'src', 'existing.ts'), 'feature before run\ntwo\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'pre-existing feature');
    const drone = {
      runtime: 'host',
      repoAttached: true,
      repoPath,
      name: 'Host drone',
      repo: { baseRef: 'main' },
    };
    const baseline = await captureDroneRunFileChangesBaseline({ droneId: 'host-1', drone });

    fs.writeFileSync(path.join(repoPath, 'run.txt'), 'added by run\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'run change');
    git(repoPath, 'switch', '--quiet', '-c', 'upstream', 'refs/remotes/origin/main');
    fs.writeFileSync(path.join(repoPath, 'src', 'existing.ts'), 'upstream change\ntwo\n');
    git(repoPath, 'add', '-A');
    git(repoPath, 'commit', '--quiet', '-m', 'conflicting upstream');
    git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repoPath, 'switch', '--quiet', 'dvm/work');
    const rebase = spawnSync(
      'git',
      ['-C', repoPath, 'rebase', '--quiet', 'refs/remotes/origin/main'],
      { encoding: 'utf8' },
    );
    expect(rebase.status).not.toBe(0);
    fs.writeFileSync(path.join(repoPath, 'src', 'existing.ts'), 'resolved during run\ntwo\n');
    git(repoPath, 'add', '-A');
    git(repoPath, '-c', 'core.editor=true', 'rebase', '--continue');

    const summary = await finalizeDroneRunFileChanges({ baseline: baseline!, drone });

    expect(summary).toMatchObject({
      version: 2,
      attribution: 'unavailable',
      baseMoved: true,
      counts: { changed: 0, additions: 0, deletions: 0, modified: 0 },
      workspaces: [
        {
          attribution: 'unavailable',
          baseMoved: true,
          previewEntries: [],
        },
      ],
    });
  });
});
