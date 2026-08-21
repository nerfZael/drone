import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareChangeRequestCandidate } from '../src/hub/change-requests/prepare-change-request-candidate';
import { git, runCommand as run } from './helpers/change-request-test-support';

describe('prepareChangeRequestCandidate', () => {
  test('computes an exact tree without creating a worktree', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-cr-candidate-test-'));
    try {
      await run('git', ['init', '-b', 'main', tempRoot]);
      await git(tempRoot, ['config', 'user.name', 'Test User']);
      await git(tempRoot, ['config', 'user.email', 'test@example.test']);
      await fs.writeFile(path.join(tempRoot, 'README.md'), 'base\n');
      await git(tempRoot, ['add', 'README.md']);
      await git(tempRoot, ['commit', '-m', 'base']);
      const baseSha = await git(tempRoot, ['rev-parse', 'HEAD']);

      await git(tempRoot, ['checkout', '-b', 'feature']);
      await fs.writeFile(path.join(tempRoot, 'feature.txt'), 'candidate\n');
      await git(tempRoot, ['add', 'feature.txt']);
      await git(tempRoot, ['commit', '-m', 'feature']);
      const snapshotSha = await git(tempRoot, ['rev-parse', 'HEAD']);
      await git(tempRoot, ['checkout', 'main']);

      const candidate = await prepareChangeRequestCandidate(run, {
        gitRoot: tempRoot,
        baseSha,
        snapshotRef: snapshotSha,
      });

      expect(candidate).toMatchObject({ status: 'ready', baseSha, changed: true });
      if (candidate.status !== 'ready') throw new Error('expected a ready candidate');
      expect(await git(tempRoot, ['show', `${candidate.candidateTreeSha}:feature.txt`])).toBe(
        'candidate',
      );
      expect(
        (await git(tempRoot, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm),
      ).toHaveLength(1);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('separates merge conflicts from operational Git failures', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-cr-conflict-test-'));
    try {
      await run('git', ['init', '-b', 'main', tempRoot]);
      await git(tempRoot, ['config', 'user.name', 'Test User']);
      await git(tempRoot, ['config', 'user.email', 'test@example.test']);
      await fs.writeFile(path.join(tempRoot, 'shared.txt'), 'base\n');
      await git(tempRoot, ['add', 'shared.txt']);
      await git(tempRoot, ['commit', '-m', 'base']);
      const baseSha = await git(tempRoot, ['rev-parse', 'HEAD']);

      await git(tempRoot, ['checkout', '-b', 'feature']);
      await fs.writeFile(path.join(tempRoot, 'shared.txt'), 'feature\n');
      await git(tempRoot, ['commit', '-am', 'feature']);
      const snapshotSha = await git(tempRoot, ['rev-parse', 'HEAD']);
      await git(tempRoot, ['checkout', 'main']);
      await fs.writeFile(path.join(tempRoot, 'shared.txt'), 'destination\n');
      await git(tempRoot, ['commit', '-am', 'destination']);
      const destinationSha = await git(tempRoot, ['rev-parse', 'HEAD']);

      await expect(
        prepareChangeRequestCandidate(run, {
          gitRoot: tempRoot,
          baseSha: destinationSha,
          snapshotRef: snapshotSha,
        }),
      ).resolves.toEqual({
        status: 'conflicted',
        baseSha: destinationSha,
        conflictFiles: ['shared.txt'],
      });
      await expect(
        prepareChangeRequestCandidate(run, {
          gitRoot: tempRoot,
          baseSha,
          snapshotRef: 'refs/does-not-exist',
        }),
      ).rejects.toMatchObject({ code: 'git_failed' });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
