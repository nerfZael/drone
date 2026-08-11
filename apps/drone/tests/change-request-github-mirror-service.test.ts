import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ChangeRequestGithubMirrorService } from '../src/hub/change-requests/change-request-github-mirror-service';
import { ChangeRequestOperationLock } from '../src/hub/change-requests/change-request-operation-lock';
import {
  git,
  MemoryChangeRequestRepository,
  runCommand as run,
  snapshotCommit,
} from './helpers/change-request-test-support';

describe('ChangeRequestGithubMirrorService', () => {
  test('serializes native and GitHub operations that share a request lock', async () => {
    const lock = new ChangeRequestOperationLock();
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = lock.withLock('request-1', async () => {
      events.push('first started');
      await firstGate;
      events.push('first finished');
    });
    await Promise.resolve();
    const second = lock.withLock('request-1', async () => {
      events.push('second started');
    });

    await Promise.resolve();
    expect(events).toEqual(['first started']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first started', 'first finished', 'second started']);
  });

  test('publishes, auto-updates, safely leases, merges, and cleans up its branch', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-github-mirror-'));
    const origin = path.join(tempRoot, 'origin.git');
    const repoRoot = path.join(tempRoot, 'repo');
    try {
      await run('git', ['init', '--bare', origin]);
      await run('git', ['init', '-b', 'main', repoRoot]);
      await git(repoRoot, ['config', 'user.name', 'Host User']);
      await git(repoRoot, ['config', 'user.email', 'host@example.test']);
      await git(repoRoot, ['remote', 'add', 'origin', origin]);
      await fs.writeFile(path.join(repoRoot, 'README.md'), 'base\n');
      await git(repoRoot, ['add', 'README.md']);
      await git(repoRoot, ['commit', '-m', 'base']);
      const baseSha = await git(repoRoot, ['rev-parse', 'HEAD']);
      await git(repoRoot, ['push', '-u', 'origin', 'main']);

      const firstSnapshot = await snapshotCommit(repoRoot, baseSha, 'feature.txt', 'first\n');
      const snapshotRef = 'refs/drone/change-requests/request-1/snapshot';
      await git(repoRoot, ['update-ref', snapshotRef, firstSnapshot]);

      const repository = new MemoryChangeRequestRepository();
      await repository.insert({
        id: 'request-1',
        status: 'open',
        droneId: 'drone-1',
        droneName: 'Test drone',
        chatId: 'chat-1',
        chatName: 'default',
        repoRoot,
        baseBranch: 'main',
        baseSha,
        destinationBranch: 'integration/42',
        snapshotRef,
        snapshotSha: firstSnapshot,
        sourceHeadSha: firstSnapshot,
        revision: 1,
        title: 'Mirror this change',
        description: 'A mirrored description.',
        createdBy: { kind: 'user', id: null, label: 'Test user' },
        mergedBy: null,
        mergeCommitSha: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        mergedAt: null,
        closedAt: null,
        githubMirror: null,
      });

      let pullNumber = 40;
      const closedPullNumbers: number[] = [];
      const createdHeadBranches: string[] = [];
      const service = new ChangeRequestGithubMirrorService({
        repository,
        runHostCommand: run,
        deleteHostRefBestEffort: async ({ repoRoot, refName }) => {
          await run('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
        },
        now: () => '2026-01-02T00:00:00.000Z',
        github: {
          createPullRequest: async (input) => {
            createdHeadBranches.push(input.headBranch);
            return {
              repo: { owner: 'example', repo: 'repo' },
              number: ++pullNumber,
              title: input.title,
              body: input.body,
              state: 'open',
              htmlUrl: `https://github.com/example/repo/pull/${pullNumber}`,
              baseRefName: input.baseBranch,
              headRefName: input.headBranch,
              headSha: await git(origin, ['rev-parse', `refs/heads/${input.headBranch}`]),
              mergeCommitSha: null,
            };
          },
          getPullRequest: async (input) => {
            const record = repository.get('request-1')!;
            const mirror = record.githubMirror!;
            return {
              repo: { owner: 'example', repo: 'repo' },
              number: input.pullNumber,
              title: record.title,
              body: `${record.description}\n\n---\nMirrored from DroneHub change request #1.`,
              state: 'open',
              htmlUrl: mirror.htmlUrl,
              baseRefName: record.destinationBranch,
              headRefName: mirror.headBranch,
              headSha: await git(origin, ['rev-parse', `refs/heads/${mirror.headBranch}`]),
              mergeCommitSha: null,
            };
          },
          updatePullRequest: async (input) => {
            const mirror = repository.get('request-1')!.githubMirror!;
            return {
              repo: { owner: 'example', repo: 'repo' },
              number: input.pullNumber,
              title: input.title,
              body: input.body,
              state: 'open',
              htmlUrl: mirror.htmlUrl,
              baseRefName: input.baseBranch,
              headRefName: mirror.headBranch,
              headSha: await git(origin, ['rev-parse', `refs/heads/${mirror.headBranch}`]),
              mergeCommitSha: null,
            };
          },
          mergePullRequest: async (input) => {
            expect(input.expectedHeadSha).toBe(repository.get('request-1')?.snapshotSha);
            return {
              repo: { owner: 'example', repo: 'repo' },
              number: input.pullNumber,
              merged: true,
              message: 'Merged',
              sha: baseSha,
            };
          },
          closePullRequest: async (input) => {
            closedPullNumbers.push(input.pullNumber);
            return {
              repo: { owner: 'example', repo: 'repo' },
              number: input.pullNumber,
              state: 'closed',
              htmlUrl: `https://github.com/example/repo/pull/${input.pullNumber}`,
              title: 'Closed',
            };
          },
        },
      });

      const published = await service.publish('request-1');
      const publishedMirror = published.githubMirror!;
      expect(publishedMirror.autoUpdate).toBe(true);
      expect(publishedMirror.branchOwnedByDroneHub).toBe(true);
      expect(await git(origin, ['rev-parse', `refs/heads/${publishedMirror.headBranch}`])).toBe(
        firstSnapshot,
      );
      expect(await git(origin, ['rev-parse', 'refs/heads/integration/42'])).toBe(baseSha);

      await repository.update('request-1', {
        githubMirror: {
          ...publishedMirror,
          headBranch: 'main',
          headSha: baseSha,
        },
      });
      await expect(service.sync('request-1')).rejects.toThrow(
        'DroneHub does not own the linked pull request branch',
      );
      expect(await git(origin, ['rev-parse', 'refs/heads/main'])).toBe(baseSha);
      await repository.update('request-1', { githubMirror: publishedMirror });

      await service.setAutoUpdate('request-1', false);
      const secondSnapshot = await snapshotCommit(repoRoot, baseSha, 'feature.txt', 'second\n');
      await git(repoRoot, ['update-ref', snapshotRef, secondSnapshot]);
      const secondRecord = await repository.update('request-1', {
        snapshotSha: secondSnapshot,
        sourceHeadSha: secondSnapshot,
        revision: 2,
        updatedAt: '2026-01-03T00:00:00.000Z',
      });
      await service.syncAfterNativeUpdate(secondRecord);
      expect(await git(origin, ['rev-parse', `refs/heads/${publishedMirror.headBranch}`])).toBe(
        firstSnapshot,
      );

      const autoUpdated = await service.setAutoUpdate('request-1', true);
      expect(autoUpdated.githubMirror?.syncedRevision).toBe(2);
      expect(await git(origin, ['rev-parse', `refs/heads/${publishedMirror.headBranch}`])).toBe(
        secondSnapshot,
      );

      await git(origin, ['update-ref', `refs/heads/${publishedMirror.headBranch}`, baseSha]);
      const thirdSnapshot = await snapshotCommit(repoRoot, baseSha, 'feature.txt', 'third\n');
      await git(repoRoot, ['update-ref', snapshotRef, thirdSnapshot]);
      await repository.update('request-1', {
        snapshotSha: thirdSnapshot,
        sourceHeadSha: thirdSnapshot,
        revision: 3,
        updatedAt: '2026-01-04T00:00:00.000Z',
      });
      await expect(service.sync('request-1')).rejects.toThrow();
      expect(await git(origin, ['rev-parse', `refs/heads/${publishedMirror.headBranch}`])).toBe(
        baseSha,
      );
      expect(repository.get('request-1')?.githubMirror?.lastError).toBeTruthy();

      await git(origin, ['update-ref', `refs/heads/${publishedMirror.headBranch}`, secondSnapshot]);
      const resynced = await service.sync('request-1');
      expect(resynced.githubMirror?.syncedRevision).toBe(3);

      const merged = await service.merge('request-1', 'squash');
      expect(merged.status).toBe('merged');
      expect(merged.githubMirror?.state).toBe('merged');
      expect(
        (
          await run('git', [
            '-C',
            origin,
            'rev-parse',
            '--verify',
            `refs/heads/${publishedMirror.headBranch}`,
          ])
        ).code,
      ).not.toBe(0);
      expect(
        (await run('git', ['-C', repoRoot, 'rev-parse', '--verify', snapshotRef])).code,
      ).not.toBe(0);

      const rollbackSnapshot = await snapshotCommit(
        repoRoot,
        baseSha,
        'rollback.txt',
        'rollback\n',
      );
      const rollbackRef = 'refs/drone/change-requests/request-rollback/snapshot';
      await git(repoRoot, ['update-ref', rollbackRef, rollbackSnapshot]);
      await repository.insert({
        id: 'request-rollback',
        status: 'open',
        droneId: 'drone-1',
        droneName: 'Test drone',
        chatId: null,
        chatName: 'default',
        repoRoot,
        baseBranch: 'main',
        baseSha,
        destinationBranch: 'main',
        snapshotRef: rollbackRef,
        snapshotSha: rollbackSnapshot,
        sourceHeadSha: rollbackSnapshot,
        revision: 1,
        title: 'Rollback failed persistence',
        description: '',
        createdBy: { kind: 'user', id: null, label: 'Test user' },
        mergedBy: null,
        mergeCommitSha: null,
        lastError: null,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-05T00:00:00.000Z',
        mergedAt: null,
        closedAt: null,
        githubMirror: null,
      });
      repository.failNextMirrorUpdate('database unavailable');
      await expect(service.publish('request-rollback')).rejects.toThrow('database unavailable');
      expect(repository.get('request-rollback')?.githubMirror).toBeNull();
      expect(closedPullNumbers).toContain(42);
      const remoteBranches = await git(origin, [
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads',
      ]);
      expect(remoteBranches).not.toContain(createdHeadBranches[1]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('never deletes an unowned or externally changed branch', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-github-mirror-owned-'));
    const origin = path.join(tempRoot, 'origin.git');
    const repoRoot = path.join(tempRoot, 'repo');
    try {
      await run('git', ['init', '--bare', origin]);
      await run('git', ['init', '-b', 'main', repoRoot]);
      await git(repoRoot, ['config', 'user.name', 'Host User']);
      await git(repoRoot, ['config', 'user.email', 'host@example.test']);
      await git(repoRoot, ['remote', 'add', 'origin', origin]);
      await fs.writeFile(path.join(repoRoot, 'README.md'), 'base\n');
      await git(repoRoot, ['add', 'README.md']);
      await git(repoRoot, ['commit', '-m', 'base']);
      const baseSha = await git(repoRoot, ['rev-parse', 'HEAD']);
      await git(repoRoot, ['push', 'origin', 'main']);
      await git(repoRoot, ['push', 'origin', `${baseSha}:refs/heads/user-branch`]);

      const repository = new MemoryChangeRequestRepository();
      await repository.insert({
        id: 'request-2',
        status: 'open',
        droneId: 'drone-1',
        droneName: 'Test drone',
        chatId: null,
        chatName: 'default',
        repoRoot,
        baseBranch: 'main',
        baseSha,
        destinationBranch: 'main',
        snapshotRef: null,
        snapshotSha: null,
        sourceHeadSha: baseSha,
        revision: 1,
        title: 'Keep user branch',
        description: '',
        createdBy: { kind: 'user', id: null, label: 'Test user' },
        mergedBy: null,
        mergeCommitSha: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        mergedAt: null,
        closedAt: null,
        githubMirror: {
          owner: 'example',
          repo: 'repo',
          pullNumber: 50,
          htmlUrl: 'https://github.com/example/repo/pull/50',
          headBranch: 'user-branch',
          headSha: baseSha,
          baseBranch: 'main',
          state: 'open',
          autoUpdate: false,
          branchOwnedByDroneHub: false,
          syncedRevision: 1,
          syncedNativeUpdatedAt: '2026-01-01T00:00:00.000Z',
          mergeCommitSha: null,
          lastError: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      const service = new ChangeRequestGithubMirrorService({
        repository,
        runHostCommand: run,
        deleteHostRefBestEffort: async () => {},
        now: () => '2026-01-02T00:00:00.000Z',
        github: {
          createPullRequest: async () => {
            throw new Error('not expected');
          },
          getPullRequest: async () => {
            throw new Error('not expected');
          },
          updatePullRequest: async () => {
            throw new Error('not expected');
          },
          mergePullRequest: async () => {
            throw new Error('not expected');
          },
          closePullRequest: async (input) => ({
            repo: { owner: 'example', repo: 'repo' },
            number: input.pullNumber,
            state: 'closed',
            htmlUrl: 'https://github.com/example/repo/pull/50',
            title: 'Closed',
          }),
        },
      });

      await service.close('request-2');
      expect(await git(origin, ['rev-parse', 'refs/heads/user-branch'])).toBe(baseSha);

      const closedMirror = repository.get('request-2')!.githubMirror!;
      await repository.update('request-2', {
        githubMirror: {
          ...closedMirror,
          pullNumber: 51,
          state: 'open',
          branchOwnedByDroneHub: true,
          headSha: 'f'.repeat(40),
          lastError: null,
        },
      });
      await service.close('request-2');
      expect(await git(origin, ['rev-parse', 'refs/heads/user-branch'])).toBe(baseSha);
      expect(repository.get('request-2')?.githubMirror?.lastError).toContain(
        'not a DroneHub-managed mirror branch',
      );

      const unsafeMirror = repository.get('request-2')!.githubMirror!;
      await repository.update('request-2', {
        githubMirror: {
          ...unsafeMirror,
          pullNumber: 52,
          state: 'open',
          headBranch: 'main',
          headSha: baseSha,
          lastError: null,
        },
      });
      await service.close('request-2');
      expect(await git(origin, ['rev-parse', 'refs/heads/main'])).toBe(baseSha);
      expect(repository.get('request-2')?.githubMirror?.lastError).toContain(
        'not a DroneHub-managed mirror branch',
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('reconciles a pull request that merges while it is being updated', async () => {
    const oldSha = 'a'.repeat(40);
    const snapshotSha = 'b'.repeat(40);
    const mergeSha = 'c'.repeat(40);
    const headBranch = 'drone/change-requests/1-38e57862-123abc';
    const snapshotRef = 'refs/drone/change-requests/request-race/snapshot';
    const repository = new MemoryChangeRequestRepository();
    await repository.insert({
      id: 'request-race',
      status: 'open',
      droneId: 'drone-1',
      droneName: 'Test drone',
      chatId: null,
      chatName: 'default',
      repoRoot: '/repo',
      baseBranch: 'main',
      baseSha: oldSha,
      destinationBranch: 'main',
      snapshotRef,
      snapshotSha,
      sourceHeadSha: snapshotSha,
      revision: 2,
      title: 'Merged during update',
      description: '',
      createdBy: { kind: 'user', id: null, label: 'Test user' },
      mergedBy: null,
      mergeCommitSha: null,
      lastError: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      mergedAt: null,
      closedAt: null,
      githubMirror: {
        owner: 'example',
        repo: 'repo',
        pullNumber: 60,
        htmlUrl: 'https://github.com/example/repo/pull/60',
        headBranch,
        headSha: oldSha,
        baseBranch: 'main',
        state: 'open',
        autoUpdate: true,
        branchOwnedByDroneHub: true,
        syncedRevision: 1,
        syncedNativeUpdatedAt: '2026-01-01T00:00:00.000Z',
        mergeCommitSha: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const gitCalls: string[][] = [];
    const deletedRefs: string[] = [];
    let mergeCalls = 0;
    const service = new ChangeRequestGithubMirrorService({
      repository,
      runHostCommand: async (_command, args) => {
        gitCalls.push(args);
        if (args.includes('ls-remote')) {
          const ref = args.at(-1) ?? '';
          const sha = ref.endsWith(headBranch) ? snapshotSha : oldSha;
          return { code: 0, stdout: `${sha}\t${ref}\n`, stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      deleteHostRefBestEffort: async ({ refName }) => {
        deletedRefs.push(refName);
      },
      now: () => '2026-01-03T00:00:00.000Z',
      github: {
        createPullRequest: async () => {
          throw new Error('not expected');
        },
        getPullRequest: async () => ({
          repo: { owner: 'example', repo: 'repo' },
          number: 60,
          title: 'Merged during update',
          body: 'Mirrored from DroneHub change request #1.',
          state: 'open',
          htmlUrl: 'https://github.com/example/repo/pull/60',
          baseRefName: 'main',
          headRefName: headBranch,
          headSha: oldSha,
          mergeCommitSha: null,
        }),
        updatePullRequest: async () => ({
          repo: { owner: 'example', repo: 'repo' },
          number: 60,
          title: 'Merged during update',
          body: 'Mirrored from DroneHub change request #1.',
          state: 'merged',
          htmlUrl: 'https://github.com/example/repo/pull/60',
          baseRefName: 'main',
          headRefName: headBranch,
          headSha: snapshotSha,
          mergeCommitSha: mergeSha,
        }),
        mergePullRequest: async () => {
          mergeCalls += 1;
          throw new Error('not expected');
        },
        closePullRequest: async () => {
          throw new Error('not expected');
        },
      },
    });

    const result = await service.merge('request-race', 'squash');
    expect(result.status).toBe('merged');
    expect(result.githubMirror?.state).toBe('merged');
    expect(result.mergeCommitSha).toBe(mergeSha);
    expect(mergeCalls).toBe(0);
    expect(deletedRefs).toEqual([snapshotRef]);
    expect(gitCalls.some((args) => args.includes('--delete') && args.includes(headBranch))).toBe(
      true,
    );
  });
});
