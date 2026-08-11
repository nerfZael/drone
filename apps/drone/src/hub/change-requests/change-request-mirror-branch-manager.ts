import crypto from 'node:crypto';

import { ChangeRequestError } from './change-request-error';
import { runChangeRequestGit, type RunHostCommand } from './change-request-git';
import type { ChangeRequestGithubMirrorRecord, ChangeRequestRecord } from './change-request-types';

export type ChangeRequestMirrorBranchManagerDependencies = {
  runHostCommand: RunHostCommand;
};

const GIT_TIMEOUT_MS = 120_000;
const MANAGED_BRANCH_SUFFIX_PATTERN = /^[0-9a-f]{6}$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export class ChangeRequestMirrorBranchManager {
  constructor(private readonly deps: ChangeRequestMirrorBranchManagerDependencies) {}

  async fetch(repoRoot: string): Promise<void> {
    await this.git(repoRoot, ['fetch', 'origin', '--prune']);
  }

  async ensureDestination(record: ChangeRequestRecord): Promise<void> {
    if (await this.remoteBranchSha(record.repoRoot, record.destinationBranch)) return;
    const baseSha = await this.remoteBranchSha(record.repoRoot, record.baseBranch);
    if (!baseSha) {
      throw new ChangeRequestError(
        `Base branch is unavailable on the remote: ${record.baseBranch}`,
        409,
        'base_branch_missing',
      );
    }
    await this.git(record.repoRoot, [
      'push',
      'origin',
      `${baseSha}:refs/heads/${record.destinationBranch}`,
    ]);
  }

  newHeadBranch(record: ChangeRequestRecord): string {
    return `drone/change-requests/${record.number}-${recordIdHash(record)}-${crypto.randomBytes(3).toString('hex')}`;
  }

  async pushNew(record: ChangeRequestRecord, branch: string): Promise<void> {
    if (await this.remoteBranchSha(record.repoRoot, branch)) {
      throw new ChangeRequestError(`Remote branch already exists: ${branch}`, 409);
    }
    await this.git(record.repoRoot, [
      'push',
      'origin',
      `${record.snapshotRef}:refs/heads/${branch}`,
    ]);
  }

  async pushUpdated(
    record: ChangeRequestRecord,
    mirror: ChangeRequestGithubMirrorRecord,
  ): Promise<void> {
    if (!mirror.branchOwnedByDroneHub || !isManagedBranch(record, mirror.headBranch)) {
      throw new ChangeRequestError('DroneHub does not own the linked pull request branch.', 409);
    }
    if (!FULL_SHA_PATTERN.test(mirror.headSha)) {
      throw new ChangeRequestError('The linked pull request branch has no safe lease SHA.', 409);
    }
    await this.git(record.repoRoot, [
      'push',
      `--force-with-lease=refs/heads/${mirror.headBranch}:${mirror.headSha}`,
      'origin',
      `${record.snapshotRef}:refs/heads/${mirror.headBranch}`,
    ]);
  }

  async deleteOwned(
    record: ChangeRequestRecord,
    mirror: ChangeRequestGithubMirrorRecord,
  ): Promise<string | null> {
    if (!mirror.branchOwnedByDroneHub) return null;
    if (!isManagedBranch(record, mirror.headBranch)) {
      return `Mirror branch ${mirror.headBranch || '(missing)'} was not deleted because it is not a DroneHub-managed mirror branch.`;
    }
    if (!FULL_SHA_PATTERN.test(mirror.headSha)) {
      return `Mirror branch ${mirror.headBranch} was not deleted because its expected remote head is unavailable.`;
    }
    try {
      const remoteSha = await this.remoteBranchSha(record.repoRoot, mirror.headBranch);
      if (!remoteSha) return null;
      if (remoteSha !== mirror.headSha) {
        return `Mirror branch ${mirror.headBranch} was not deleted because its remote head changed outside DroneHub.`;
      }
      await this.deleteRemote(record.repoRoot, mirror.headBranch);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async deleteRemote(repoRoot: string, branch: string): Promise<void> {
    if (!(await this.remoteBranchSha(repoRoot, branch))) return;
    await this.git(repoRoot, ['push', 'origin', '--delete', branch]);
  }

  private async remoteBranchSha(repoRoot: string, branch: string): Promise<string | null> {
    const result = await this.deps.runHostCommand(
      'git',
      ['-C', repoRoot, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
      { timeoutMs: GIT_TIMEOUT_MS },
    );
    if (result.code !== 0) {
      throw new ChangeRequestError(result.stderr || 'Unable to read remote branches.');
    }
    const sha = result.stdout.trim().split(/\s+/)[0] ?? '';
    return FULL_SHA_PATTERN.test(sha) ? sha.toLowerCase() : null;
  }

  private git(repoRoot: string, args: string[]) {
    return runChangeRequestGit(this.deps.runHostCommand, repoRoot, args, GIT_TIMEOUT_MS);
  }
}

function isManagedBranch(record: ChangeRequestRecord, branch: string): boolean {
  const prefix = `drone/change-requests/${record.number}-${recordIdHash(record)}-`;
  return (
    branch.startsWith(prefix) &&
    MANAGED_BRANCH_SUFFIX_PATTERN.test(branch.slice(prefix.length)) &&
    branch !== record.baseBranch &&
    branch !== record.destinationBranch
  );
}

function recordIdHash(record: ChangeRequestRecord): string {
  return crypto.createHash('sha256').update(record.id).digest('hex').slice(0, 8);
}
