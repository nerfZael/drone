import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ChangeRequestError } from './change-request-error';
import {
  changeRequestConflictFiles,
  runChangeRequestGit,
  safeChangeRequestRefSegment,
  type RunHostCommand,
} from './change-request-git';
import type { ChangeRequestRecord, ChangeRequestRevisionRecord } from './change-request-types';

export type ChangeRequestCheckoutApplierDependencies = {
  runHostCommand: RunHostCommand;
  storagePath: (...segments: string[]) => string;
};

export type ChangeRequestCheckoutApplicationReceipt = {
  revision: number;
  checkoutRoot: string;
  destinationBranch: string;
  checkoutHeadSha: string;
  candidateTreeSha: string;
  applied: boolean;
  stagedFiles: string[];
};

const APPLY_TIMEOUT_MS = 120_000;

/**
 * Materializes a CR's squash result in a clean host checkout without committing
 * or updating any ref. The candidate is prepared away from the user's checkout,
 * then applied to both its index and working tree as one preflighted patch.
 */
export class ChangeRequestCheckoutApplier {
  constructor(private readonly deps: ChangeRequestCheckoutApplierDependencies) {}

  async apply(
    record: ChangeRequestRecord,
    revision: ChangeRequestRevisionRecord,
    checkoutRootRaw: string,
  ): Promise<ChangeRequestCheckoutApplicationReceipt> {
    const checkoutRoot = path.resolve(checkoutRootRaw);
    const initial = await this.assertCheckoutReady(checkoutRoot, record.destinationBranch);
    const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const label = `${safeChangeRequestRefSegment(record.id)}-${runId}`;
    const worktreePath = this.deps.storagePath('change-request-apply-worktrees', label);
    const patchDirectory = this.deps.storagePath('change-request-apply-patches', label);
    const patchPath = path.join(patchDirectory, 'candidate.diff');
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    await fs.mkdir(patchDirectory, { recursive: true });

    try {
      await this.git(
        checkoutRoot,
        ['worktree', 'add', '--detach', worktreePath, initial.headSha],
        APPLY_TIMEOUT_MS,
      );
      const merged = await this.deps.runHostCommand(
        'git',
        ['-C', worktreePath, 'merge', '--squash', '--no-commit', revision.snapshotRef],
        { timeoutMs: APPLY_TIMEOUT_MS },
      );
      if (merged.code !== 0) {
        throw new ChangeRequestError(
          `The change request conflicts with the host checkout's ${record.destinationBranch} branch.`,
          409,
          'checkout_apply_conflict',
          { conflictFiles: changeRequestConflictFiles(`${merged.stdout}\n${merged.stderr}`) },
        );
      }

      const candidateTreeSha = (await this.git(worktreePath, ['write-tree'])).stdout
        .trim()
        .toLowerCase();
      const diff = await this.git(worktreePath, [
        'diff',
        '--cached',
        '--binary',
        '--full-index',
        '--find-renames',
        '--no-color',
        '--no-ext-diff',
        initial.headSha,
      ]);
      const stagedFiles = splitNullTerminated(
        (await this.git(worktreePath, ['diff', '--cached', '--name-only', '-z', initial.headSha]))
          .stdout,
      );
      if (!diff.stdout) {
        return {
          revision: revision.number,
          checkoutRoot,
          destinationBranch: record.destinationBranch,
          checkoutHeadSha: initial.headSha,
          candidateTreeSha,
          applied: false,
          stagedFiles: [],
        };
      }

      await fs.writeFile(patchPath, diff.stdout, 'utf8');
      const beforeApply = await this.assertCheckoutReady(checkoutRoot, record.destinationBranch);
      if (beforeApply.headSha !== initial.headSha) {
        throw new ChangeRequestError(
          'The host checkout changed while the change request was being prepared. Try again.',
          409,
          'checkout_changed',
        );
      }
      const checked = await this.deps.runHostCommand(
        'git',
        ['-C', checkoutRoot, 'apply', '--check', '--index', '--whitespace=nowarn', patchPath],
        { timeoutMs: APPLY_TIMEOUT_MS },
      );
      if (checked.code !== 0) throw checkoutApplyError(checked, false);

      const applied = await this.deps.runHostCommand(
        'git',
        ['-C', checkoutRoot, 'apply', '--index', '--whitespace=nowarn', patchPath],
        { timeoutMs: APPLY_TIMEOUT_MS },
      );
      if (applied.code !== 0) throw checkoutApplyError(applied, true);

      const appliedTreeSha = (await this.git(checkoutRoot, ['write-tree'])).stdout
        .trim()
        .toLowerCase();
      if (appliedTreeSha !== candidateTreeSha) {
        throw new ChangeRequestError(
          'The staged host tree differs from the prepared change-request candidate. Inspect the checkout before continuing.',
          409,
          'checkout_apply_tree_changed',
          { expectedCandidateTreeSha: candidateTreeSha, candidateTreeSha: appliedTreeSha },
        );
      }
      return {
        revision: revision.number,
        checkoutRoot,
        destinationBranch: record.destinationBranch,
        checkoutHeadSha: initial.headSha,
        candidateTreeSha,
        applied: true,
        stagedFiles,
      };
    } finally {
      await this.deps
        .runHostCommand(
          'git',
          ['-C', checkoutRoot, 'worktree', 'remove', '--force', worktreePath],
          {
            timeoutMs: 30_000,
          },
        )
        .catch(() => null);
      await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
      await fs.rm(patchDirectory, { recursive: true, force: true }).catch(() => {});
      await this.deps
        .runHostCommand('git', ['-C', checkoutRoot, 'worktree', 'prune'])
        .catch(() => null);
    }
  }

  private async assertCheckoutReady(
    checkoutRoot: string,
    destinationBranch: string,
  ): Promise<{ branch: string; headSha: string }> {
    const branchResult = await this.deps.runHostCommand('git', [
      '-C',
      checkoutRoot,
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ]);
    const branch = branchResult.stdout.trim();
    if (branchResult.code !== 0 || !branch) {
      throw new ChangeRequestError(
        'The host checkout must be on a branch before applying a change request.',
        409,
        'checkout_detached',
      );
    }
    if (branch !== destinationBranch) {
      throw new ChangeRequestError(
        `Check out ${destinationBranch} on the host before applying this change request (currently on ${branch}).`,
        409,
        'checkout_branch_mismatch',
        { destinationBranch, checkoutBranch: branch },
      );
    }
    const status = await this.git(checkoutRoot, ['status', '--porcelain', '--untracked-files=all']);
    if (status.stdout.trim()) {
      throw new ChangeRequestError(
        'The host checkout must be clean before applying a change request.',
        409,
        'checkout_dirty',
      );
    }
    const headSha = (await this.git(checkoutRoot, ['rev-parse', 'HEAD'])).stdout
      .trim()
      .toLowerCase();
    return { branch, headSha };
  }

  private git(repoRoot: string, args: string[], timeoutMs = 30_000) {
    return runChangeRequestGit(this.deps.runHostCommand, repoRoot, args, timeoutMs);
  }
}

function splitNullTerminated(value: string): string[] {
  return value.split('\0').filter((entry) => entry.length > 0);
}

function checkoutApplyError(
  result: { stdout: string; stderr: string },
  preflightPassed: boolean,
): ChangeRequestError {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const conflictFiles = new Set(changeRequestConflictFiles(output));
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/(?:patch failed|does not apply):\s*(.+?)(?::\d+)?$/i);
    if (match?.[1]) conflictFiles.add(match[1].trim());
  }
  return new ChangeRequestError(
    preflightPassed
      ? 'The host checkout changed while the reviewed patch was being applied. Inspect it before continuing.'
      : 'The reviewed change-request candidate cannot be applied cleanly. The host checkout was not modified.',
    409,
    preflightPassed ? 'checkout_changed_during_apply' : 'checkout_apply_conflict',
    { conflictFiles: [...conflictFiles].sort((left, right) => left.localeCompare(right)) },
  );
}
