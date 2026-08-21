import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ChangeRequestService } from '../src/hub/change-requests/change-request-service';
import {
  git,
  MemoryChangeRequestRepository,
  runCommand as run,
} from './helpers/change-request-test-support';

describe('ChangeRequestService', () => {
  test('materializes and reuses an exact merge candidate in a reviewer container worktree', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-cr-review-test-'));
    const origin = path.join(tempRoot, 'origin.git');
    const sourceRepo = path.join(tempRoot, 'source');
    const reviewerRepo = path.join(tempRoot, 'reviewer');
    const storageRoot = path.join(tempRoot, 'storage');
    const containerTemp = path.join(tempRoot, 'container-tmp');
    try {
      await run('git', ['init', '--bare', origin]);
      await run('git', ['init', '-b', 'main', sourceRepo]);
      await git(sourceRepo, ['config', 'user.name', 'Host User']);
      await git(sourceRepo, ['config', 'user.email', 'host@example.test']);
      await git(sourceRepo, ['remote', 'add', 'origin', origin]);
      await fs.writeFile(path.join(sourceRepo, 'README.md'), 'base\n');
      await git(sourceRepo, ['add', 'README.md']);
      await git(sourceRepo, ['commit', '-m', 'base']);
      await git(sourceRepo, ['push', '-u', 'origin', 'main']);
      await git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
      const baseSha = await git(sourceRepo, ['rev-parse', 'HEAD']);
      await git(sourceRepo, ['checkout', '-b', 'feature']);
      await fs.writeFile(path.join(sourceRepo, 'feature.txt'), 'review me\n');
      await git(sourceRepo, ['add', 'feature.txt']);
      await git(sourceRepo, ['commit', '-m', 'feature']);
      const sourceHeadSha = await git(sourceRepo, ['rev-parse', 'HEAD']);
      await git(sourceRepo, ['branch', 'alternate', baseSha]);
      const snapshotRef = 'refs/drone/change-requests/review-request/snapshots/1';
      await git(sourceRepo, ['update-ref', snapshotRef, sourceHeadSha]);
      await run('git', ['clone', origin, reviewerRepo]);
      await git(reviewerRepo, ['config', 'user.name', 'Reviewer']);
      await git(reviewerRepo, ['config', 'user.email', 'reviewer@example.test']);
      const reviewerHeadBefore = await git(reviewerRepo, ['rev-parse', 'HEAD']);

      const repository = new MemoryChangeRequestRepository();
      const created = await repository.insert(
        {
          id: 'review-request',
          status: 'open',
          droneId: 'source-drone',
          droneName: 'Source drone',
          chatId: 'source-chat',
          chatName: 'default',
          repoRoot: sourceRepo,
          baseBranch: 'main',
          baseSha,
          destinationBranch: 'main',
          snapshotRef,
          snapshotSha: sourceHeadSha,
          sourceHeadSha,
          revision: 1,
          title: 'Review candidate',
          description: '',
          createdBy: { kind: 'chat', id: 'source-chat', label: 'Source chat' },
          mergedBy: null,
          mergeCommitSha: null,
          lastError: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          mergedAt: null,
          closedAt: null,
          githubMirror: null,
        },
        {
          number: 1,
          baseBranch: 'main',
          baseSha,
          snapshotRef,
          snapshotSha: sourceHeadSha,
          sourceRef: snapshotRef,
          sourceHeadSha,
          objectStorePath: null,
          createdBy: { kind: 'chat', id: 'source-chat', label: 'Source chat' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      );
      const unused = async () => {
        throw new Error('unused test dependency');
      };
      const mapContainerPath = (value: string) =>
        value.startsWith('/tmp/drone-hub/')
          ? path.join(containerTemp, value.slice('/tmp/drone-hub/'.length))
          : value;
      const service = new ChangeRequestService({
        repository,
        resolveDrone: async (ref) =>
          ref === 'reviewer-drone'
            ? {
                kind: 'real' as const,
                id: 'reviewer-drone',
                drone: {
                  id: 'reviewer-drone',
                  name: 'Reviewer drone',
                  runtime: 'container',
                  repo: { dest: reviewerRepo },
                },
              }
            : null,
        withLockedDroneContainer: async (_input, operation) =>
          operation({ containerName: 'reviewer-container', droneEntry: {} }),
        exportFullHeadBundleFromDrone: async ({ repoPathInContainer, outDir }) => {
          await fs.mkdir(outDir, { recursive: true });
          const exportedPath = path.join(outDir, 'review-update.bundle');
          await git(repoPathInContainer, ['bundle', 'create', exportedPath, 'HEAD']);
          return { exportedPath };
        },
        importBundleHeadToHostRef: async ({ repoRoot, bundlePath, refName }) => {
          await git(repoRoot, ['fetch', bundlePath, `HEAD:${refName}`]);
          return await git(repoRoot, ['rev-parse', refName]);
        },
        createHostAuthoredMirrorCommit: async ({ repoRoot, sourceRef, parentRef, message }) => {
          const tree = await git(repoRoot, ['rev-parse', `${sourceRef}^{tree}`]);
          return await git(repoRoot, [
            'commit-tree',
            tree,
            '-p',
            parentRef,
            '-m',
            message ?? 'snapshot',
          ]);
        },
        updateHostRef: async ({ repoRoot, refName, target }) => {
          await git(repoRoot, ['update-ref', refName, target]);
        },
        deleteHostRefBestEffort: async ({ repoRoot, refName }) => {
          await run('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
        },
        gitTopLevel: unused,
        dvmRepoHeadSha: unused,
        runGitInDrone: unused,
        runHostCommand: run,
        copyToContainer: async (_container, sourcePath, destinationPath) => {
          const mappedDestination = mapContainerPath(destinationPath);
          await fs.mkdir(path.dirname(mappedDestination), { recursive: true });
          await fs.copyFile(sourcePath, mappedDestination);
        },
        runCommandInDrone: ({ command, args, timeoutMs }) =>
          run(command, args.map(mapContainerPath), { timeoutMs }),
        storagePath: (...segments) => path.join(storageRoot, ...segments),
        now: () => '2026-01-01T00:01:00.000Z',
      });

      const first = await service.prepareReviewWorkspace({
        requestNumber: created.number,
        reviewerDroneRef: 'reviewer-drone',
      });
      expect(first).toMatchObject({
        requestNumber: created.number,
        revision: 1,
        currentRevision: 1,
        isCurrentRevision: true,
        destinationSha: baseSha,
        snapshotSha: sourceHeadSha,
        reviewerDroneId: 'reviewer-drone',
        reused: false,
      });
      expect(await fs.readFile(path.join(first.path, 'feature.txt'), 'utf8')).toBe('review me\n');
      expect(await git(first.path, ['rev-parse', 'HEAD'])).toBe(first.candidateSha);
      expect(await git(first.path, ['rev-parse', 'HEAD^'])).toBe(baseSha);
      expect(await git(reviewerRepo, ['rev-parse', 'HEAD'])).toBe(reviewerHeadBefore);
      expect(await git(reviewerRepo, ['status', '--porcelain'])).toBe('');
      expect(
        await git(sourceRepo, [
          'for-each-ref',
          '--format=%(refname)',
          'refs/drone/review-preparations',
        ]),
      ).toBe('');

      const second = await service.prepareReviewWorkspace({
        requestNumber: created.number,
        reviewerDroneRef: 'reviewer-drone',
      });
      expect(second.path).toBe(first.path);
      expect(second.candidateSha).toBe(first.candidateSha);
      expect(second.reused).toBe(true);

      const retargeted = await service.update(created.number, {
        destinationBranch: 'alternate',
        refreshSnapshot: false,
        actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
      });
      expect(retargeted).toMatchObject({ revision: 1, destinationBranch: 'alternate' });
      await expect(
        service.updateFromReviewWorkspace({
          requestNumber: created.number,
          workspaceId: first.workspaceId,
          reviewerDroneRef: 'reviewer-drone',
          actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
        }),
      ).rejects.toMatchObject({ code: 'review_workspace_outdated' });
      await service.update(created.number, {
        destinationBranch: 'main',
        refreshSnapshot: false,
        actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
      });
      const restored = await service.prepareReviewWorkspace({
        requestNumber: created.number,
        reviewerDroneRef: 'reviewer-drone',
      });
      expect(restored).toMatchObject({ workspaceId: first.workspaceId, reused: true });

      await git(reviewerRepo, ['config', 'status.showUntrackedFiles', 'no']);
      await fs.writeFile(path.join(first.path, 'untracked.tmp'), 'must not affect review\n');
      await expect(
        service.prepareReviewWorkspace({
          requestNumber: created.number,
          reviewerDroneRef: 'reviewer-drone',
        }),
      ).rejects.toMatchObject({ code: 'review_workspace_dirty' });
      await fs.rm(path.join(first.path, 'untracked.tmp'));

      await fs.writeFile(path.join(first.path, 'feature.txt'), 'reviewed and fixed\n');
      await expect(
        service.prepareReviewWorkspace({
          requestNumber: created.number,
          reviewerDroneRef: 'reviewer-drone',
        }),
      ).rejects.toMatchObject({ code: 'review_workspace_dirty' });
      await expect(
        service.updateFromReviewWorkspace({
          requestNumber: created.number,
          workspaceId: first.workspaceId,
          reviewerDroneRef: 'reviewer-drone',
          actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
        }),
      ).rejects.toMatchObject({ code: 'review_workspace_dirty' });

      await git(first.path, ['add', 'feature.txt']);
      await git(first.path, ['commit', '-m', 'fix during review']);
      const reviewHead = await git(first.path, ['rev-parse', 'HEAD']);
      const updated = await service.updateFromReviewWorkspace({
        requestNumber: created.number,
        workspaceId: first.workspaceId,
        reviewerDroneRef: 'reviewer-drone',
        actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
      });
      expect(updated).toMatchObject({
        number: created.number,
        revision: 2,
        baseSha,
        sourceHeadSha: reviewHead,
      });
      const promotedRevision = repository.getRevision('review-request', 2);
      expect(promotedRevision).toMatchObject({
        number: 2,
        baseSha,
        sourceHeadSha: reviewHead,
        createdBy: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
      });
      expect(promotedRevision?.objectStorePath).toBeTruthy();
      expect(
        await git(promotedRevision!.objectStorePath!, [
          'show',
          `${promotedRevision!.snapshotSha}:feature.txt`,
        ]),
      ).toBe('reviewed and fixed');
      expect(repository.getRevision('review-request', 1)?.snapshotSha).toBe(sourceHeadSha);
      const maliciousHooksPath = path.join(tempRoot, 'malicious-hooks');
      await fs.mkdir(maliciousHooksPath, { recursive: true });
      await fs.writeFile(
        path.join(maliciousHooksPath, 'pre-commit'),
        '#!/bin/sh\nprintf "hook injected\\n" > hook-injected.txt\ngit add hook-injected.txt\n',
      );
      await fs.chmod(path.join(maliciousHooksPath, 'pre-commit'), 0o755);
      await git(promotedRevision!.objectStorePath!, [
        'config',
        'core.hooksPath',
        maliciousHooksPath,
      ]);
      await expect(
        service.updateFromReviewWorkspace({
          requestNumber: created.number,
          workspaceId: first.workspaceId,
          reviewerDroneRef: 'reviewer-drone',
          actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
        }),
      ).rejects.toMatchObject({ code: 'review_workspace_outdated' });

      const nextReview = await service.prepareReviewWorkspace({
        requestNumber: created.number,
        reviewerDroneRef: 'reviewer-drone',
      });
      expect(nextReview).toMatchObject({
        revision: 2,
        currentRevision: 2,
        isCurrentRevision: true,
        reused: false,
      });
      expect(nextReview.workspaceId).not.toBe(first.workspaceId);
      expect(nextReview.candidateTreeSha).toMatch(/^[0-9a-f]{40}$/);
      expect(await git(nextReview.path, ['rev-parse', 'HEAD^{tree}'])).toBe(
        nextReview.candidateTreeSha,
      );
      expect(await fs.readFile(path.join(nextReview.path, 'feature.txt'), 'utf8')).toBe(
        'reviewed and fixed\n',
      );
      expect(
        (
          await run('git', [
            '-C',
            nextReview.path,
            'cat-file',
            '-e',
            `${nextReview.candidateSha}:hook-injected.txt`,
          ])
        ).code,
      ).not.toBe(0);
      await expect(
        service.merge(created.number, {
          actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
          expectedRevision: nextReview.revision,
          expectedDestinationBranch: 'alternate',
          expectedDestinationSha: nextReview.destinationSha,
          expectedCandidateTreeSha: nextReview.candidateTreeSha,
        }),
      ).rejects.toThrow('destination branch changed after the reviewed candidate');
      await expect(
        service.merge(created.number, {
          actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
          expectedRevision: nextReview.revision,
          expectedDestinationBranch: nextReview.destinationBranch,
          expectedDestinationSha: nextReview.destinationSha,
          expectedCandidateTreeSha: 'f'.repeat(40),
        }),
      ).rejects.toThrow('prepared merge tree differs from the reviewed candidate');
      const merged = await service.merge(created.number, {
        actor: { kind: 'chat', id: 'reviewer-chat', label: 'Reviewer chat' },
        expectedRevision: nextReview.revision,
        expectedDestinationBranch: nextReview.destinationBranch,
        expectedDestinationSha: nextReview.destinationSha,
        expectedCandidateTreeSha: nextReview.candidateTreeSha,
      });
      expect(merged.status).toBe('merged');
      expect(await git(origin, ['show', 'refs/heads/main:feature.txt'])).toBe('reviewed and fixed');
      expect(
        (await run('git', ['-C', origin, 'cat-file', '-e', 'refs/heads/main:hook-injected.txt']))
          .code,
      ).not.toBe(0);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('recovers a direct merge pushed before lifecycle persistence completed', async () => {
    const repository = new MemoryChangeRequestRepository();
    const mergeSha = '7'.repeat(40);
    const targetSha = '6'.repeat(40);
    const created = await repository.insert(
      {
        id: 'recover-request',
        status: 'open',
        droneId: 'drone-1',
        droneName: 'Drone',
        chatId: null,
        chatName: 'default',
        repoRoot: '/tmp/recover-repo',
        baseBranch: 'main',
        baseSha: targetSha,
        destinationBranch: 'dev',
        snapshotRef: 'refs/drone/change-requests/recover-request/snapshots/1',
        snapshotSha: '5'.repeat(40),
        sourceHeadSha: '4'.repeat(40),
        revision: 1,
        title: 'Recover merge',
        description: '',
        createdBy: { kind: 'user', id: null, label: 'Test user' },
        mergedBy: null,
        mergeCommitSha: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        mergedAt: null,
        closedAt: null,
        githubMirror: null,
      },
      {
        number: 1,
        baseBranch: 'main',
        baseSha: targetSha,
        snapshotRef: 'refs/drone/change-requests/recover-request/snapshots/1',
        snapshotSha: '5'.repeat(40),
        sourceRef: 'refs/drone/change-requests/recover-request/sources/1',
        sourceHeadSha: '4'.repeat(40),
        objectStorePath: null,
        createdBy: { kind: 'user', id: null, label: 'Test user' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    );
    await repository.insertMergeAttempt({
      id: 'attempt-1',
      requestId: created.id,
      revision: 1,
      destinationBranch: 'dev',
      expectedTargetSha: targetSha,
      mergeCommitSha: mergeSha,
      actor: { kind: 'user', id: 'user-1', label: 'Recovering user' },
      status: 'prepared',
      error: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    const unused = async () => {
      throw new Error('unused test dependency');
    };
    const service = new ChangeRequestService({
      repository,
      resolveDrone: unused,
      withLockedDroneContainer: unused as any,
      exportFullHeadBundleFromDrone: unused,
      importBundleHeadToHostRef: unused,
      createHostAuthoredMirrorCommit: unused,
      updateHostRef: unused,
      deleteHostRefBestEffort: async () => {},
      gitTopLevel: unused,
      dvmRepoHeadSha: unused,
      runGitInDrone: unused,
      runHostCommand: async (_command, args) => {
        if (args.includes('fetch')) return { code: 0, stdout: '', stderr: '' };
        if (args.includes('rev-parse') && args.some((arg) => arg.includes('origin/dev'))) {
          return { code: 0, stdout: `${mergeSha}\n`, stderr: '' };
        }
        return { code: 1, stdout: '', stderr: 'not found' };
      },
      storagePath: (...segments) => path.join('/tmp', ...segments),
      now: () => '2026-01-02T00:01:00.000Z',
    });

    await service.recoverPendingMerges();

    expect(repository.get(created.id)?.status).toBe('merged');
    expect(repository.get(created.id)?.mergeCommitSha).toBe(mergeSha);
    expect(repository.listPreparedMergeAttempts()).toEqual([]);
  });

  test('captures a durable host snapshot and directly squash-merges a planned branch', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-change-request-test-'));
    const origin = path.join(tempRoot, 'origin.git');
    const repoRoot = path.join(tempRoot, 'repo');
    const unrelatedRepo = path.join(tempRoot, 'unrelated');
    const upstreamRepo = path.join(tempRoot, 'upstream');
    const storageRoot = path.join(tempRoot, 'storage');
    try {
      await run('git', ['init', '--bare', origin]);
      await run('git', ['init', '-b', 'main', repoRoot]);
      await run('git', ['init', '-b', 'main', unrelatedRepo]);
      await git(repoRoot, ['config', 'user.name', 'Host User']);
      await git(repoRoot, ['config', 'user.email', 'host@example.test']);
      await git(repoRoot, ['remote', 'add', 'origin', origin]);
      await fs.writeFile(path.join(repoRoot, 'README.md'), 'base\n');
      await git(repoRoot, ['add', 'README.md']);
      await git(repoRoot, ['commit', '-m', 'base']);
      await git(repoRoot, ['push', '-u', 'origin', 'main']);
      await git(repoRoot, ['checkout', '-b', 'feature']);
      await fs.writeFile(path.join(repoRoot, 'feature.txt'), 'captured change\n');
      await fs.writeFile(path.join(repoRoot, 'README.md'), 'base updated\nextra\n');
      await fs.writeFile(path.join(repoRoot, 'image.bin'), Buffer.from([0, 1, 2, 3]));
      await git(repoRoot, ['add', 'feature.txt', 'README.md', 'image.bin']);
      await git(repoRoot, ['commit', '-m', 'container-authored change']);

      const repository = new MemoryChangeRequestRepository();
      let usedChangeRequestWorktree = false;
      const service = new ChangeRequestService({
        repository,
        resolveDrone: async (ref) => {
          const resolvedRepoPath = ref === 'unrelated-drone' ? unrelatedRepo : repoRoot;
          return {
            kind: 'real',
            id: ref,
            drone: {
              id: ref,
              name: ref === 'drone-1' ? 'Test drone' : ref,
              runtime: 'host',
              repoPath: resolvedRepoPath,
              repo: { baseRef: 'main' },
              chats: { default: { id: 'chat-1' } },
            },
          };
        },
        withLockedDroneContainer: async () => {
          throw new Error('container access was not expected');
        },
        exportFullHeadBundleFromDrone: async () => {
          throw new Error('container export was not expected');
        },
        importBundleHeadToHostRef: async () => {
          throw new Error('bundle import was not expected');
        },
        createHostAuthoredMirrorCommit: async ({ repoRoot, sourceRef, parentRef, message }) => {
          const tree = await git(repoRoot, ['rev-parse', `${sourceRef}^{tree}`]);
          return await git(repoRoot, [
            'commit-tree',
            tree,
            '-p',
            parentRef,
            '-m',
            message ?? 'snapshot',
          ]);
        },
        updateHostRef: async ({ repoRoot, refName, target }) => {
          await git(repoRoot, ['update-ref', refName, target]);
        },
        deleteHostRefBestEffort: async ({ repoRoot, refName }) => {
          await run('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
        },
        gitTopLevel: async (repoPath) => await git(repoPath, ['rev-parse', '--show-toplevel']),
        dvmRepoHeadSha: async () => {
          throw new Error('container HEAD was not expected');
        },
        runGitInDrone: async () => {
          throw new Error('container git was not expected');
        },
        runHostCommand: async (command, args, options) => {
          if (args.includes('worktree')) usedChangeRequestWorktree = true;
          return await run(command, args, {
            cwd: options?.cwd,
            timeoutMs: options?.timeoutMs,
          });
        },
        storagePath: (...segments) => path.join(storageRoot, ...segments),
        now: () => new Date().toISOString(),
      });

      await git(repoRoot, ['remote', 'remove', 'origin']);
      const created = await service.create({
        droneRef: 'drone-1',
        chatName: 'default',
        title: 'Add the captured feature',
        destinationBranch: 'integration/42',
        actor: { kind: 'user', id: null, label: 'Test user' },
      });
      await git(repoRoot, ['remote', 'add', 'origin', origin]);

      expect(created.status).toBe('open');
      expect('id' in created).toBe(false);
      expect(created.destinationExists).toBe(false);
      expect(created.snapshotSha).toMatch(/^[0-9a-f]{40}$/);
      expect(created.lineStats).toEqual({
        files: 3,
        additions: 2,
        modifications: 1,
        deletions: 0,
        total: 3,
      });
      expect((await service.getByNumber(created.number, 'drone-1')).number).toBe(created.number);
      expect((await service.getByNumber(created.number, 'sibling-drone')).number).toBe(
        created.number,
      );
      expect(
        (await service.list({ droneId: 'sibling-drone' })).map((request) => request.number),
      ).toEqual([created.number]);
      await expect(service.getByNumber(created.number, 'unrelated-drone')).rejects.toThrow(
        `unknown change request: #${created.number}`,
      );
      expect(await service.list({ droneId: 'unrelated-drone' })).toEqual([]);
      expect((await service.changes(created.number)).entries.map((entry) => entry.path)).toEqual([
        'feature.txt',
        'image.bin',
        'README.md',
      ]);
      const internalId = repository.getByNumber(created.number)!.id;

      await fs.writeFile(path.join(repoRoot, 'follow-up.txt'), 'second revision\n');
      await git(repoRoot, ['add', 'follow-up.txt']);
      await git(repoRoot, ['commit', '-m', 'second container-authored change']);
      repository.failNextUpdateMessage = 'database unavailable';
      await expect(service.update(created.number, {})).rejects.toThrow('database unavailable');
      expect(repository.get(internalId)?.revision).toBe(1);
      expect(
        (await run('git', ['-C', repoRoot, 'rev-parse', '--verify', created.snapshotRef!])).code,
      ).toBe(0);
      expect(
        (
          await run('git', [
            '-C',
            repoRoot,
            'rev-parse',
            '--verify',
            `refs/drone/change-requests/${internalId}/snapshots/2`,
          ])
        ).code,
      ).not.toBe(0);

      const updated = await service.update(created.number, {});
      expect(updated.snapshotRef).not.toBe(created.snapshotRef);
      expect(updated.revision).toBe(2);
      expect(
        (await run('git', ['-C', repoRoot, 'rev-parse', '--verify', created.snapshotRef!])).code,
      ).toBe(0);
      expect(
        (await run('git', ['-C', repoRoot, 'rev-parse', '--verify', updated.snapshotRef!])).code,
      ).toBe(0);
      expect((await service.revisions(created.number)).map((revision) => revision.number)).toEqual([
        2, 1,
      ]);
      expect(
        (await service.revisions(created.number))[0]?.commits.map((commit) => commit.subject),
      ).toEqual(['container-authored change', 'second container-authored change']);
      expect((await service.changes(created.number, 1)).entries.map((entry) => entry.path)).toEqual(
        ['feature.txt', 'image.bin', 'README.md'],
      );

      await run('git', ['clone', '-b', 'main', origin, upstreamRepo]);
      await git(upstreamRepo, ['config', 'user.name', 'Upstream User']);
      await git(upstreamRepo, ['config', 'user.email', 'upstream@example.test']);
      await fs.writeFile(path.join(upstreamRepo, 'remote.txt'), 'new destination work\n');
      await git(upstreamRepo, ['add', 'remote.txt']);
      await git(upstreamRepo, ['commit', '-m', 'advance main']);
      await git(upstreamRepo, ['push', 'origin', 'main']);

      const refreshed = await service.refreshAssessment(created.number);
      expect(refreshed.stale).toBe(true);
      expect(refreshed.destinationSha).toBe(await git(upstreamRepo, ['rev-parse', 'HEAD']));

      await expect(
        service.merge(created.number, {
          actor: { kind: 'user', id: null, label: 'Test user' },
          expectedRevision: 2,
        }),
      ).rejects.toMatchObject({ code: 'review_pins_incomplete' });
      await expect(
        service.merge(created.number, {
          actor: { kind: 'user', id: null, label: 'Test user' },
          expectedRevision: 1,
          expectedDestinationBranch: 'integration/42',
          expectedDestinationSha: refreshed.destinationSha!,
          expectedCandidateTreeSha: 'f'.repeat(40),
        }),
      ).rejects.toThrow('revision changed after the reviewed candidate');
      await expect(
        service.merge(created.number, {
          actor: { kind: 'user', id: null, label: 'Test user' },
          expectedRevision: 2,
          expectedDestinationBranch: 'main',
          expectedDestinationSha: refreshed.destinationSha!,
          expectedCandidateTreeSha: 'f'.repeat(40),
        }),
      ).rejects.toThrow('destination branch changed after the reviewed candidate');
      await expect(
        service.merge(created.number, {
          actor: { kind: 'user', id: null, label: 'Test user' },
          expectedRevision: 2,
          expectedDestinationBranch: 'integration/42',
          expectedDestinationSha: 'f'.repeat(40),
          expectedCandidateTreeSha: 'f'.repeat(40),
        }),
      ).rejects.toThrow('destination changed after the reviewed candidate');

      const sourceBranchBeforeMerge = await git(repoRoot, ['branch', '--show-current']);
      const merged = await service.merge(created.number, {
        actor: { kind: 'user', id: null, label: 'Test user' },
        commitMessage: 'Custom squash message',
      });

      expect(merged.status).toBe('merged');
      expect(merged.snapshotSha).toBe(updated.snapshotSha);
      expect(merged.mergeCommitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(usedChangeRequestWorktree).toBe(false);
      expect(await git(repoRoot, ['branch', '--show-current'])).toBe(sourceBranchBeforeMerge);
      expect(await git(repoRoot, ['status', '--porcelain'])).toBe('');
      expect(await git(origin, ['show', 'refs/heads/integration/42:feature.txt'])).toBe(
        'captured change',
      );
      expect(await git(origin, ['show', '-s', '--format=%an', 'refs/heads/integration/42'])).toBe(
        'Host User',
      );
      expect(await git(origin, ['show', '-s', '--format=%s', 'refs/heads/integration/42'])).toBe(
        'Custom squash message',
      );
      expect(
        (await run('git', ['-C', repoRoot, 'rev-parse', '--verify', updated.snapshotRef!])).code,
      ).toBe(0);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('derives a container CR base after a fast-forward and keeps its snapshot reviewable', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-change-request-container-'));
    const origin = path.join(tempRoot, 'origin.git');
    const repoRoot = path.join(tempRoot, 'host-repo');
    const containerRepo = path.join(tempRoot, 'container-repo');
    const upstreamRepo = path.join(tempRoot, 'upstream-repo');
    const storageRoot = path.join(tempRoot, 'storage');
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

      await run('git', ['clone', '-b', 'main', origin, containerRepo]);
      await git(containerRepo, ['config', 'user.name', 'Container User']);
      await git(containerRepo, ['config', 'user.email', 'container@example.test']);
      await git(containerRepo, ['config', 'dvm.baseSha', baseSha]);

      await run('git', ['clone', '-b', 'main', origin, upstreamRepo]);
      await git(upstreamRepo, ['config', 'user.name', 'Upstream User']);
      await git(upstreamRepo, ['config', 'user.email', 'upstream@example.test']);
      await fs.writeFile(path.join(upstreamRepo, 'upstream.txt'), 'upstream change\n');
      await git(upstreamRepo, ['add', 'upstream.txt']);
      await git(upstreamRepo, ['commit', '-m', 'advance main']);
      await git(upstreamRepo, ['push', 'origin', 'main']);
      const advancedMainSha = await git(upstreamRepo, ['rev-parse', 'HEAD']);

      await git(containerRepo, ['fetch', 'origin']);
      await git(containerRepo, ['merge', '--ff-only', 'origin/main']);
      await git(containerRepo, ['checkout', '-b', 'feature']);
      await fs.writeFile(path.join(containerRepo, 'container.txt'), 'container change\n');
      await git(containerRepo, ['add', 'container.txt']);
      await git(containerRepo, ['commit', '-m', 'container change']);

      const repository = new MemoryChangeRequestRepository();
      const service = new ChangeRequestService({
        repository,
        resolveDrone: async () => ({
          kind: 'real',
          id: 'container-drone',
          drone: {
            id: 'container-drone',
            name: 'Container drone',
            runtime: 'container',
            repoPath: repoRoot,
            repo: { baseRef: 'main', dest: '/work/repo' },
            chats: { default: { id: 'container-chat' } },
          },
        }),
        withLockedDroneContainer: async (_input, operation) =>
          await operation({ containerName: 'fake-container', droneEntry: {} }),
        exportFullHeadBundleFromDrone: async ({ outDir }) => {
          await fs.mkdir(outDir, { recursive: true });
          const exportedPath = path.join(outDir, 'snapshot.bundle');
          await git(containerRepo, ['bundle', 'create', exportedPath, 'HEAD']);
          return { exportedPath };
        },
        importBundleHeadToHostRef: async ({ repoRoot, bundlePath, refName }) => {
          await git(repoRoot, ['fetch', bundlePath, `HEAD:${refName}`]);
          return await git(repoRoot, ['rev-parse', refName]);
        },
        createHostAuthoredMirrorCommit: async ({ repoRoot, sourceRef, parentRef, message }) => {
          const tree = await git(repoRoot, ['rev-parse', `${sourceRef}^{tree}`]);
          return await git(repoRoot, [
            'commit-tree',
            tree,
            '-p',
            parentRef,
            '-m',
            message ?? 'snapshot',
          ]);
        },
        updateHostRef: async ({ repoRoot, refName, target }) => {
          await git(repoRoot, ['update-ref', refName, target]);
        },
        deleteHostRefBestEffort: async ({ repoRoot, refName }) => {
          await run('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
        },
        gitTopLevel: async (repoPath) => await git(repoPath, ['rev-parse', '--show-toplevel']),
        dvmRepoHeadSha: async () => await git(containerRepo, ['rev-parse', 'HEAD']),
        runGitInDrone: async ({ args }) => await run('git', ['-C', containerRepo, ...args]),
        runHostCommand: run,
        storagePath: (...segments) => path.join(storageRoot, ...segments),
        now: () => new Date().toISOString(),
      });

      expect(await git(repoRoot, ['rev-parse', 'origin/main'])).toBe(baseSha);
      const created = await service.create({
        droneRef: 'container-drone',
        chatName: 'default',
        title: 'Capture the container change',
        actor: { kind: 'chat', id: 'container-chat', label: 'Container chat' },
      });

      expect(await git(containerRepo, ['config', '--get', 'dvm.baseSha'])).toBe(baseSha);
      await fs.rm(containerRepo, { recursive: true, force: true });

      expect(created.snapshotSha).toMatch(/^[0-9a-f]{40}$/);
      expect(created.baseSha).toBe(advancedMainSha);
      expect(created.stale).toBe(false);
      expect(await git(repoRoot, ['rev-parse', 'origin/main'])).toBe(advancedMainSha);
      expect((await service.changes(created.number)).entries.map((entry) => entry.path)).toEqual([
        'container.txt',
      ]);
      expect((await service.diff(created.number, 'container.txt')).diff).toContain(
        '+container change',
      );
      expect(await fs.readdir(path.join(storageRoot, 'change-request-exports'))).toEqual([]);

      const closed = await service.close(created.number);
      expect(closed.status).toBe('closed');
      expect(
        (await run('git', ['-C', repoRoot, 'rev-parse', '--verify', created.snapshotRef!])).code,
      ).toBe(0);
      await fs.rm(repoRoot, { recursive: true, force: true });
      expect((await service.changes(created.number)).entries.map((entry) => entry.path)).toEqual([
        'container.txt',
      ]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
