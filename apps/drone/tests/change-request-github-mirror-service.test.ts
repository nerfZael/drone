import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ChangeRequestPatch,
  ChangeRequestRepository,
} from '../src/hub/change-requests/change-request-repository';
import { ChangeRequestGithubMirrorService } from '../src/hub/change-requests/change-request-github-mirror-service';
import type { ChangeRequestRecord } from '../src/hub/change-requests/change-request-types';
import type { RunResult } from '../src/host/dvm';

class MemoryChangeRequestRepository implements ChangeRequestRepository {
  private readonly records = new Map<string, ChangeRequestRecord>();

  async insert(input: Omit<ChangeRequestRecord, 'number'>): Promise<ChangeRequestRecord> {
    const record = { ...input, number: this.records.size + 1 };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  get(id: string): ChangeRequestRecord | null {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  list(): ChangeRequestRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  async update(id: string, patch: ChangeRequestPatch): Promise<ChangeRequestRecord> {
    const current = this.records.get(id);
    if (!current) throw new Error(`unknown change request: ${id}`);
    const updated = { ...current, ...patch };
    this.records.set(id, updated);
    return structuredClone(updated);
  }
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await run('git', ['-C', cwd, ...args]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

async function snapshotCommit(
  repoRoot: string,
  baseSha: string,
  fileName: string,
  contents: string,
): Promise<string> {
  await git(repoRoot, ['reset', '--hard', baseSha]);
  await fs.writeFile(path.join(repoRoot, fileName), contents);
  await git(repoRoot, ['add', fileName]);
  const tree = await git(repoRoot, ['write-tree']);
  const commit = await git(repoRoot, [
    'commit-tree',
    tree,
    '-p',
    baseSha,
    '-m',
    `snapshot ${fileName}`,
  ]);
  await git(repoRoot, ['reset', '--hard', baseSha]);
  return commit;
}

describe('ChangeRequestGithubMirrorService', () => {
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
      const service = new ChangeRequestGithubMirrorService({
        repository,
        runHostCommand: run,
        deleteHostRefBestEffort: async ({ repoRoot, refName }) => {
          await run('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
        },
        now: () => '2026-01-02T00:00:00.000Z',
        github: {
          createPullRequest: async (input) => ({
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
          }),
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
          mergePullRequest: async (input) => ({
            repo: { owner: 'example', repo: 'repo' },
            number: input.pullNumber,
            merged: true,
            message: 'Merged',
            sha: baseSha,
          }),
          closePullRequest: async (input) => ({
            repo: { owner: 'example', repo: 'repo' },
            number: input.pullNumber,
            state: 'closed',
            htmlUrl: `https://github.com/example/repo/pull/${input.pullNumber}`,
            title: 'Closed',
          }),
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
        'changed outside DroneHub',
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
