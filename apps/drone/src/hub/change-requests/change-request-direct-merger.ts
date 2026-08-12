import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ChangeRequestError } from './change-request-error';
import {
  changeRequestConflictFiles,
  resolveChangeRequestBranch,
  resolveChangeRequestCommit,
  runChangeRequestGit,
  safeChangeRequestRefSegment,
  type RunHostCommand,
} from './change-request-git';
import type { ChangeRequestRecord } from './change-request-types';

export type ChangeRequestDirectMergerDependencies = {
  runHostCommand: RunHostCommand;
  storagePath: (...segments: string[]) => string;
};

const MERGE_TIMEOUT_MS = 120_000;

export class ChangeRequestDirectMerger {
  constructor(private readonly deps: ChangeRequestDirectMergerDependencies) {}

  async merge(record: ChangeRequestRecord, commitMessage: string): Promise<string> {
    await this.git(record.repoRoot, ['fetch', 'origin', '--prune'], MERGE_TIMEOUT_MS);
    const destinationRef = await resolveChangeRequestBranch(
      this.deps.runHostCommand,
      record.repoRoot,
      record.destinationBranch,
    );
    const baseRef = await resolveChangeRequestBranch(
      this.deps.runHostCommand,
      record.repoRoot,
      record.baseBranch,
    );
    const targetRef = destinationRef ?? baseRef;
    if (!targetRef) {
      throw new ChangeRequestError(
        `Base branch is unavailable: ${record.baseBranch}`,
        409,
        'base_branch_missing',
      );
    }
    const targetSha = await resolveChangeRequestCommit(
      this.deps.runHostCommand,
      record.repoRoot,
      targetRef,
    );
    if (!targetSha) {
      throw new ChangeRequestError(
        'Unable to resolve merge destination.',
        409,
        'destination_missing',
      );
    }
    const worktreePath = this.worktreePath(record.id);
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    try {
      await this.git(
        record.repoRoot,
        ['worktree', 'add', '--detach', worktreePath, targetSha],
        MERGE_TIMEOUT_MS,
      );
      const merged = await this.deps.runHostCommand(
        'git',
        ['-C', worktreePath, 'merge', '--squash', '--no-commit', record.snapshotRef!],
        { timeoutMs: MERGE_TIMEOUT_MS },
      );
      if (merged.code !== 0) {
        throw new ChangeRequestError(
          'The change request conflicts with its destination.',
          409,
          'merge_conflict',
          { conflictFiles: changeRequestConflictFiles(`${merged.stdout}\n${merged.stderr}`) },
        );
      }
      const staged = await this.deps.runHostCommand('git', [
        '-C',
        worktreePath,
        'diff',
        '--cached',
        '--quiet',
      ]);
      let mergeCommitSha = targetSha;
      if (staged.code === 1) {
        await this.git(
          worktreePath,
          ['commit', '-m', requiredCommitMessage(commitMessage)],
          MERGE_TIMEOUT_MS,
        );
        mergeCommitSha = (await this.git(worktreePath, ['rev-parse', 'HEAD'])).stdout
          .trim()
          .toLowerCase();
      } else if (staged.code !== 0) {
        throw new ChangeRequestError(staged.stderr || 'Unable to inspect the prepared merge.', 500);
      }
      await this.git(
        worktreePath,
        ['push', 'origin', `HEAD:refs/heads/${record.destinationBranch}`],
        MERGE_TIMEOUT_MS,
      );
      return mergeCommitSha;
    } finally {
      await this.deps
        .runHostCommand(
          'git',
          ['-C', record.repoRoot, 'worktree', 'remove', '--force', worktreePath],
          { timeoutMs: 30_000 },
        )
        .catch(() => null);
      await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
      await this.deps
        .runHostCommand('git', ['-C', record.repoRoot, 'worktree', 'prune'])
        .catch(() => null);
    }
  }

  private worktreePath(internalId: string): string {
    const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    return this.deps.storagePath(
      'change-request-worktrees',
      `${safeChangeRequestRefSegment(internalId)}-${runId}`,
    );
  }

  private git(repoRoot: string, args: string[], timeoutMs = 30_000) {
    return runChangeRequestGit(this.deps.runHostCommand, repoRoot, args, timeoutMs);
  }
}

function requiredCommitMessage(value: string): string {
  const message = String(value ?? '').trim();
  if (!message) throw new ChangeRequestError('commit message is required');
  if (message.length > 10_000) throw new ChangeRequestError('commit message is too long');
  return message;
}
