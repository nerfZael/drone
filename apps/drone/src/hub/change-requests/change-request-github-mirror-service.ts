import crypto from 'node:crypto';

import type { RunResult } from '../../host/dvm';
import {
  closeGithubPullRequestForRepoRoot,
  createGithubPullRequestForRepoRoot,
  getGithubPullRequestForRepoRoot,
  isGithubPullRequestError,
  mergeGithubPullRequestForRepoRoot,
  updateGithubPullRequestForRepoRoot,
  type GithubPullRequestDetails,
  type GithubPullRequestMergeMethod,
} from '../github-pull-requests';
import type { ChangeRequestRepository } from './change-request-repository';
import { ChangeRequestOperationLock } from './change-request-operation-lock';
import { ChangeRequestError } from './change-request-service';
import type {
  ChangeRequestActor,
  ChangeRequestGithubMirrorRecord,
  ChangeRequestRecord,
} from './change-request-types';

type GithubMirrorClient = {
  createPullRequest: typeof createGithubPullRequestForRepoRoot;
  getPullRequest: typeof getGithubPullRequestForRepoRoot;
  updatePullRequest: typeof updateGithubPullRequestForRepoRoot;
  mergePullRequest: typeof mergeGithubPullRequestForRepoRoot;
  closePullRequest: typeof closeGithubPullRequestForRepoRoot;
};

export type ChangeRequestGithubMirrorServiceDependencies = {
  repository: ChangeRequestRepository;
  runHostCommand: (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ) => Promise<RunResult>;
  deleteHostRefBestEffort: (input: { repoRoot: string; refName: string }) => Promise<void>;
  now: () => string;
  operationLock?: ChangeRequestOperationLock;
  github?: GithubMirrorClient;
  onGithubChanged?: (repoRoot: string) => void;
};

const GIT_TIMEOUT_MS = 120_000;
const MANAGED_BRANCH_SUFFIX_PATTERN = /^[0-9a-f]{6}$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function mirrorBody(record: ChangeRequestRecord): string {
  const footer = `Mirrored from DroneHub change request #${record.number}.`;
  return record.description.trim() ? `${record.description.trim()}\n\n---\n${footer}` : footer;
}

function githubError(error: unknown): ChangeRequestError {
  if (error instanceof ChangeRequestError) return error;
  if (isGithubPullRequestError(error)) {
    return new ChangeRequestError(error.message, error.statusCode, error.code);
  }
  return new ChangeRequestError(
    error instanceof Error ? error.message : String(error),
    500,
    'github_mirror_failed',
  );
}

export class ChangeRequestGithubMirrorService {
  private readonly operationLock: ChangeRequestOperationLock;
  private readonly github: GithubMirrorClient;

  constructor(private readonly deps: ChangeRequestGithubMirrorServiceDependencies) {
    this.operationLock = deps.operationLock ?? new ChangeRequestOperationLock();
    this.github =
      deps.github ??
      ({
        createPullRequest: createGithubPullRequestForRepoRoot,
        getPullRequest: getGithubPullRequestForRepoRoot,
        updatePullRequest: updateGithubPullRequestForRepoRoot,
        mergePullRequest: mergeGithubPullRequestForRepoRoot,
        closePullRequest: closeGithubPullRequestForRepoRoot,
      } satisfies GithubMirrorClient);
  }

  async publish(
    idRaw: string,
    input: { merge?: boolean; mergeMethod?: GithubPullRequestMergeMethod } = {},
  ): Promise<ChangeRequestRecord> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => {
      const record = this.requiredOpenRecord(id);
      if (record.githubMirror?.state === 'open') {
        throw new ChangeRequestError(
          `GitHub pull request #${record.githubMirror.pullNumber} is already linked.`,
          409,
          'github_mirror_exists',
        );
      }
      if (!record.snapshotRef || !record.snapshotSha) {
        throw new ChangeRequestError(
          'Change request snapshot is unavailable.',
          409,
          'snapshot_missing',
        );
      }

      await this.fetch(record.repoRoot);
      await this.ensureDestination(record);
      const headBranch = this.newHeadBranch(record);
      await this.pushNewMirrorBranch(record, headBranch);

      let details: GithubPullRequestDetails;
      try {
        details = await this.github.createPullRequest({
          repoRoot: record.repoRoot,
          title: record.title,
          body: mirrorBody(record),
          headBranch,
          baseBranch: record.destinationBranch,
        });
      } catch (error) {
        await this.deleteRemoteBranch(record.repoRoot, headBranch).catch(() => {});
        throw githubError(error);
      }
      this.deps.onGithubChanged?.(record.repoRoot);

      try {
        this.assertPublishedPullRequest(record, headBranch, details);
      } catch (error) {
        throw await this.cleanupFailedPublish(record, headBranch, details, error);
      }

      const now = this.deps.now();
      const mirror: ChangeRequestGithubMirrorRecord = {
        owner: details.repo.owner,
        repo: details.repo.repo,
        pullNumber: details.number,
        htmlUrl: details.htmlUrl,
        headBranch,
        headSha: details.headSha,
        baseBranch: record.destinationBranch,
        state: details.state,
        autoUpdate: true,
        branchOwnedByDroneHub: true,
        syncedRevision: record.revision,
        syncedNativeUpdatedAt: record.updatedAt,
        mergeCommitSha: details.mergeCommitSha,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.deps.repository.update(id, { githubMirror: mirror });
      } catch (error) {
        throw await this.cleanupFailedPublish(record, headBranch, details, error);
      }

      if (input.merge) {
        try {
          return await this.mergeLocked(id, input.mergeMethod ?? 'squash');
        } catch {
          // Publishing succeeded. Keep the open mirror and its merge error visible for retry.
          return this.requiredRecord(id);
        }
      }
      return this.requiredRecord(id);
    });
  }

  async sync(idRaw: string): Promise<ChangeRequestRecord> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => await this.syncRecord(this.requiredOpenRecord(id)));
  }

  async setAutoUpdate(idRaw: string, enabled: boolean): Promise<ChangeRequestRecord> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => {
      const current = this.requiredRecord(id);
      const mirror = this.requiredMirror(current);
      await this.deps.repository.update(id, {
        githubMirror: { ...mirror, autoUpdate: enabled, updatedAt: this.deps.now() },
      });
      if (enabled && current.status === 'open' && mirror.state === 'open') {
        return await this.syncRecord(this.requiredOpenRecord(id));
      }
      return this.requiredRecord(id);
    });
  }

  async merge(
    idRaw: string,
    method: GithubPullRequestMergeMethod = 'squash',
  ): Promise<ChangeRequestRecord> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => await this.mergeLocked(id, method));
  }

  async close(idRaw: string): Promise<ChangeRequestRecord> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => {
      const current = this.requiredRecord(id);
      const mirror = this.requiredMirror(current);
      if (mirror.state === 'open') {
        try {
          await this.github.closePullRequest({
            repoRoot: current.repoRoot,
            pullNumber: mirror.pullNumber,
          });
          this.deps.onGithubChanged?.(current.repoRoot);
        } catch (error) {
          await this.storeMirrorError(current, error);
          throw githubError(error);
        }
      }
      const cleanupError = await this.deleteOwnedBranch(current, mirror);
      await this.deps.repository.update(id, {
        githubMirror: {
          ...mirror,
          state: mirror.state === 'merged' ? 'merged' : 'closed',
          lastError: cleanupError,
          updatedAt: this.deps.now(),
        },
      });
      return this.requiredRecord(id);
    });
  }

  async refresh(recordOrId: ChangeRequestRecord | string): Promise<void> {
    const id = typeof recordOrId === 'string' ? recordOrId : recordOrId.id;
    if (!id) return;
    await this.withLock(id, async () => await this.refreshRecord(this.requiredRecord(id)));
  }

  async refreshAfterNativeAssessment(record: ChangeRequestRecord): Promise<void> {
    await this.refreshRecord(record);
  }

  private async refreshRecord(record: ChangeRequestRecord): Promise<void> {
    const id = record.id;
    const current = this.requiredRecord(id);
    const mirror = current.githubMirror;
    if (!mirror) return;
    try {
      const details = await this.github.getPullRequest({
        repoRoot: current.repoRoot,
        pullNumber: mirror.pullNumber,
      });
      this.assertLinkedPullRequest(mirror, details);
      const matchesNative =
        current.status === 'open' &&
        details.state === 'open' &&
        details.headRefName === mirror.headBranch &&
        details.headSha === current.snapshotSha &&
        details.baseRefName === current.destinationBranch &&
        details.title === current.title &&
        details.body === mirrorBody(current);
      const updatedMirror: ChangeRequestGithubMirrorRecord = {
        ...mirror,
        htmlUrl: details.htmlUrl,
        headSha: details.headSha,
        baseBranch: details.baseRefName,
        state: details.state,
        mergeCommitSha: details.mergeCommitSha,
        syncedRevision: matchesNative ? current.revision : 0,
        syncedNativeUpdatedAt: matchesNative ? current.updatedAt : '',
        lastError: null,
        updatedAt: this.deps.now(),
      };
      await this.deps.repository.update(id, { githubMirror: updatedMirror });
      if (details.state === 'merged' && current.status === 'open') {
        await this.finalizeNativeMerge(this.requiredRecord(id), details.mergeCommitSha);
      } else if (details.state === 'closed') {
        const latest = this.requiredRecord(id);
        const latestMirror = this.requiredMirror(latest);
        const cleanupError = await this.deleteOwnedBranch(latest, latestMirror);
        await this.deps.repository.update(id, {
          githubMirror: {
            ...latestMirror,
            lastError: cleanupError,
            updatedAt: this.deps.now(),
          },
        });
      }
    } catch (error) {
      await this.storeMirrorError(this.requiredRecord(id), error);
    }
  }

  async syncAfterNativeUpdate(record: ChangeRequestRecord): Promise<void> {
    const mirror = record.githubMirror;
    if (!mirror || !mirror.autoUpdate || mirror.state !== 'open' || record.status !== 'open')
      return;
    const current = this.requiredRecord(record.id);
    try {
      await this.syncRecord(current);
    } catch {
      // The native update remains successful. The mirror stores the error and stays out of date.
    }
  }

  async closeAfterNativeCompletion(record: ChangeRequestRecord): Promise<void> {
    const mirror = record.githubMirror;
    if (!mirror || mirror.state !== 'open') return;
    const current = this.requiredRecord(record.id);
    const currentMirror = current.githubMirror;
    if (!currentMirror || currentMirror.state !== 'open') return;
    try {
      await this.github.closePullRequest({
        repoRoot: current.repoRoot,
        pullNumber: currentMirror.pullNumber,
      });
      this.deps.onGithubChanged?.(current.repoRoot);
      const cleanupError = await this.deleteOwnedBranch(current, currentMirror);
      await this.deps.repository.update(current.id, {
        githubMirror: {
          ...currentMirror,
          state: 'closed',
          lastError: cleanupError,
          updatedAt: this.deps.now(),
        },
      });
    } catch (error) {
      await this.storeMirrorError(current, error);
    }
  }

  private async syncRecord(record: ChangeRequestRecord): Promise<ChangeRequestRecord> {
    const mirror = this.requiredMirror(record);
    if (record.status !== 'open' || mirror.state !== 'open') {
      throw new ChangeRequestError(
        'Only an open change request with an open mirror can update.',
        409,
      );
    }
    if (!record.snapshotRef || !record.snapshotSha) {
      throw new ChangeRequestError(
        'Change request snapshot is unavailable.',
        409,
        'snapshot_missing',
      );
    }
    try {
      const remote = await this.github.getPullRequest({
        repoRoot: record.repoRoot,
        pullNumber: mirror.pullNumber,
      });
      this.assertLinkedPullRequest(mirror, remote);
      if (remote.state !== 'open') {
        await this.deps.repository.update(record.id, {
          githubMirror: {
            ...mirror,
            htmlUrl: remote.htmlUrl,
            headSha: remote.headSha,
            baseBranch: remote.baseRefName,
            state: remote.state,
            mergeCommitSha: remote.mergeCommitSha,
            syncedRevision: 0,
            syncedNativeUpdatedAt: '',
            lastError: null,
            updatedAt: this.deps.now(),
          },
        });
        if (remote.state === 'merged') {
          await this.finalizeNativeMerge(this.requiredRecord(record.id), remote.mergeCommitSha);
        } else {
          const current = this.requiredRecord(record.id);
          const currentMirror = this.requiredMirror(current);
          const cleanupError = await this.deleteOwnedBranch(current, currentMirror);
          await this.deps.repository.update(record.id, {
            githubMirror: {
              ...currentMirror,
              lastError: cleanupError,
              updatedAt: this.deps.now(),
            },
          });
        }
        return this.requiredRecord(record.id);
      }
    } catch (error) {
      await this.storeMirrorError(this.requiredRecord(record.id), error);
      throw githubError(error);
    }
    let pushedHeadSha = mirror.headSha;
    try {
      await this.fetch(record.repoRoot);
      await this.ensureDestination(record);
      await this.pushUpdatedMirrorBranch(record, mirror);
      pushedHeadSha = record.snapshotSha;
      const details = await this.github.updatePullRequest({
        repoRoot: record.repoRoot,
        pullNumber: mirror.pullNumber,
        title: record.title,
        body: mirrorBody(record),
        baseBranch: record.destinationBranch,
      });
      this.assertSyncedPullRequest(record, mirror, details);
      this.deps.onGithubChanged?.(record.repoRoot);
      await this.deps.repository.update(record.id, {
        githubMirror: {
          ...mirror,
          htmlUrl: details.htmlUrl,
          headSha: details.headSha,
          baseBranch: details.baseRefName,
          state: details.state,
          mergeCommitSha: details.mergeCommitSha,
          syncedRevision: details.state === 'open' ? record.revision : 0,
          syncedNativeUpdatedAt: details.state === 'open' ? record.updatedAt : '',
          lastError: null,
          updatedAt: this.deps.now(),
        },
      });
      if (details.state === 'merged') {
        await this.finalizeNativeMerge(this.requiredRecord(record.id), details.mergeCommitSha);
      } else if (details.state === 'closed') {
        const current = this.requiredRecord(record.id);
        const currentMirror = this.requiredMirror(current);
        const cleanupError = await this.deleteOwnedBranch(current, currentMirror);
        await this.deps.repository.update(record.id, {
          githubMirror: {
            ...currentMirror,
            lastError: cleanupError,
            updatedAt: this.deps.now(),
          },
        });
      }
      return this.requiredRecord(record.id);
    } catch (error) {
      const latest = this.requiredRecord(record.id);
      const latestMirror = this.requiredMirror(latest);
      await this.deps.repository.update(record.id, {
        githubMirror: {
          ...latestMirror,
          headSha: latestMirror.state === 'open' ? pushedHeadSha : latestMirror.headSha,
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: this.deps.now(),
        },
      });
      throw githubError(error);
    }
  }

  private async mergeLocked(
    id: string,
    method: GithubPullRequestMergeMethod,
  ): Promise<ChangeRequestRecord> {
    let current = this.requiredOpenRecord(id);
    let mirror = this.requiredMirror(current);
    if (mirror.state !== 'open') {
      throw new ChangeRequestError('The linked GitHub pull request is not open.', 409);
    }
    current = await this.syncRecord(current);
    mirror = this.requiredMirror(current);
    if (current.status !== 'open' || mirror.state !== 'open') {
      if (current.status === 'merged' && mirror.state === 'merged') return current;
      throw new ChangeRequestError('The linked GitHub pull request is not open.', 409);
    }
    try {
      const merged = await this.github.mergePullRequest({
        repoRoot: current.repoRoot,
        pullNumber: mirror.pullNumber,
        method,
        expectedHeadSha: current.snapshotSha,
      });
      if (!merged.merged) {
        throw new ChangeRequestError(
          merged.message || 'GitHub did not merge the pull request.',
          409,
        );
      }
      this.deps.onGithubChanged?.(current.repoRoot);
      await this.deps.repository.update(id, {
        githubMirror: {
          ...mirror,
          state: 'merged',
          mergeCommitSha: merged.sha,
          lastError: null,
          updatedAt: this.deps.now(),
        },
      });
      await this.finalizeNativeMerge(this.requiredRecord(id), merged.sha);
      return this.requiredRecord(id);
    } catch (error) {
      await this.storeMirrorError(this.requiredRecord(id), error);
      throw githubError(error);
    }
  }

  private async finalizeNativeMerge(
    record: ChangeRequestRecord,
    mergeCommitSha: string | null,
  ): Promise<void> {
    if (record.status !== 'open') return;
    const snapshotRef = record.snapshotRef;
    const now = this.deps.now();
    await this.deps.repository.update(record.id, {
      status: 'merged',
      snapshotRef: null,
      mergedBy: {
        kind: 'user',
        id: null,
        label: 'DroneHub GitHub mirror',
      } satisfies ChangeRequestActor,
      mergeCommitSha,
      lastError: null,
      updatedAt: now,
      mergedAt: now,
    });
    if (snapshotRef) {
      await this.deps.deleteHostRefBestEffort({ repoRoot: record.repoRoot, refName: snapshotRef });
    }
    const latest = this.requiredRecord(record.id);
    const mirror = latest.githubMirror;
    if (!mirror) return;
    const cleanupError = await this.deleteOwnedBranch(latest, mirror);
    await this.deps.repository.update(record.id, {
      githubMirror: { ...mirror, lastError: cleanupError, updatedAt: this.deps.now() },
    });
  }

  private async ensureDestination(record: ChangeRequestRecord): Promise<void> {
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

  private async pushNewMirrorBranch(record: ChangeRequestRecord, branch: string): Promise<void> {
    if (await this.remoteBranchSha(record.repoRoot, branch)) {
      throw new ChangeRequestError(`Remote branch already exists: ${branch}`, 409);
    }
    await this.git(record.repoRoot, [
      'push',
      'origin',
      `${record.snapshotRef}:refs/heads/${branch}`,
    ]);
  }

  private async pushUpdatedMirrorBranch(
    record: ChangeRequestRecord,
    mirror: ChangeRequestGithubMirrorRecord,
  ): Promise<void> {
    if (!mirror.branchOwnedByDroneHub || !this.isManagedBranch(record, mirror.headBranch)) {
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

  private async deleteOwnedBranch(
    record: ChangeRequestRecord,
    mirror: ChangeRequestGithubMirrorRecord,
  ): Promise<string | null> {
    if (!mirror.branchOwnedByDroneHub) return null;
    if (!this.isManagedBranch(record, mirror.headBranch)) {
      return `Mirror branch ${mirror.headBranch || '(missing)'} was not deleted because it is not a DroneHub-managed mirror branch.`;
    }
    if (!FULL_SHA_PATTERN.test(mirror.headSha)) {
      return `Mirror branch ${mirror.headBranch} was not deleted because its expected remote head is unavailable.`;
    }
    try {
      const remoteSha = await this.remoteBranchSha(record.repoRoot, mirror.headBranch);
      if (!remoteSha) return null;
      if (mirror.headSha && remoteSha !== mirror.headSha) {
        return `Mirror branch ${mirror.headBranch} was not deleted because its remote head changed outside DroneHub.`;
      }
      await this.deleteRemoteBranch(record.repoRoot, mirror.headBranch);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async deleteRemoteBranch(repoRoot: string, branch: string): Promise<void> {
    if (!(await this.remoteBranchSha(repoRoot, branch))) return;
    await this.git(repoRoot, ['push', 'origin', '--delete', branch]);
  }

  private async remoteBranchSha(repoRoot: string, branch: string): Promise<string | null> {
    const result = await this.deps.runHostCommand(
      'git',
      ['-C', repoRoot, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`],
      { timeoutMs: GIT_TIMEOUT_MS },
    );
    if (result.code !== 0)
      throw new ChangeRequestError(result.stderr || 'Unable to read remote branches.');
    const sha = result.stdout.trim().split(/\s+/)[0] ?? '';
    return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
  }

  private newHeadBranch(record: ChangeRequestRecord): string {
    const idHash = this.recordIdHash(record);
    return `drone/change-requests/${record.number}-${idHash}-${crypto.randomBytes(3).toString('hex')}`;
  }

  private isManagedBranch(record: ChangeRequestRecord, branch: string): boolean {
    const idHash = this.recordIdHash(record);
    const prefix = `drone/change-requests/${record.number}-${idHash}-`;
    return (
      branch.startsWith(prefix) &&
      MANAGED_BRANCH_SUFFIX_PATTERN.test(branch.slice(prefix.length)) &&
      branch !== record.baseBranch &&
      branch !== record.destinationBranch
    );
  }

  private assertPublishedPullRequest(
    record: ChangeRequestRecord,
    headBranch: string,
    details: GithubPullRequestDetails,
  ): void {
    if (
      !Number.isInteger(details.number) ||
      details.number <= 0 ||
      details.state !== 'open' ||
      details.headRefName !== headBranch ||
      details.baseRefName !== record.destinationBranch ||
      details.headSha !== record.snapshotSha
    ) {
      throw new ChangeRequestError(
        'GitHub returned pull request data that does not match the published change request.',
        502,
        'github_mirror_mismatch',
      );
    }
  }

  private assertLinkedPullRequest(
    mirror: ChangeRequestGithubMirrorRecord,
    details: GithubPullRequestDetails,
  ): void {
    if (details.number !== mirror.pullNumber || details.headRefName !== mirror.headBranch) {
      throw new ChangeRequestError(
        'The linked GitHub pull request no longer points to its DroneHub mirror branch.',
        409,
        'github_mirror_mismatch',
      );
    }
  }

  private assertSyncedPullRequest(
    record: ChangeRequestRecord,
    mirror: ChangeRequestGithubMirrorRecord,
    details: GithubPullRequestDetails,
  ): void {
    this.assertLinkedPullRequest(mirror, details);
    if (
      details.headSha !== record.snapshotSha ||
      details.baseRefName !== record.destinationBranch
    ) {
      throw new ChangeRequestError(
        'GitHub returned pull request data that does not match the updated change request.',
        502,
        'github_mirror_mismatch',
      );
    }
  }

  private async cleanupFailedPublish(
    record: ChangeRequestRecord,
    headBranch: string,
    details: GithubPullRequestDetails,
    cause: unknown,
  ): Promise<ChangeRequestError> {
    const cleanupErrors: string[] = [];
    if (
      Number.isInteger(details.number) &&
      details.number > 0 &&
      details.headRefName === headBranch
    ) {
      try {
        await this.github.closePullRequest({
          repoRoot: record.repoRoot,
          pullNumber: details.number,
        });
        this.deps.onGithubChanged?.(record.repoRoot);
      } catch (error) {
        cleanupErrors.push(
          `could not close PR #${details.number}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      cleanupErrors.push('could not safely identify the pull request to close');
    }
    try {
      await this.deleteRemoteBranch(record.repoRoot, headBranch);
    } catch (error) {
      cleanupErrors.push(
        `could not delete mirror branch ${headBranch}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const primary = githubError(cause);
    if (cleanupErrors.length === 0) return primary;
    return new ChangeRequestError(
      `${primary.message} Cleanup also failed: ${cleanupErrors.join('; ')}`,
      primary.statusCode,
      primary.code,
    );
  }

  private recordIdHash(record: ChangeRequestRecord): string {
    return crypto.createHash('sha256').update(record.id).digest('hex').slice(0, 8);
  }

  private async fetch(repoRoot: string): Promise<void> {
    await this.git(repoRoot, ['fetch', 'origin', '--prune']);
  }

  private async git(repoRoot: string, args: string[]): Promise<RunResult> {
    const result = await this.deps.runHostCommand('git', ['-C', repoRoot, ...args], {
      timeoutMs: GIT_TIMEOUT_MS,
    });
    if (result.code !== 0) {
      throw new ChangeRequestError(
        String(result.stderr || result.stdout || `git ${args[0] ?? 'operation'} failed`).trim(),
        409,
        'git_failed',
      );
    }
    return result;
  }

  private requiredRecord(id: string): ChangeRequestRecord {
    const record = this.deps.repository.get(String(id ?? '').trim());
    if (!record) throw new ChangeRequestError(`unknown change request: ${id}`, 404, 'not_found');
    return record;
  }

  private requiredOpenRecord(id: string): ChangeRequestRecord {
    const record = this.requiredRecord(id);
    if (record.status !== 'open') {
      throw new ChangeRequestError(`Change request is ${record.status}.`, 409, 'not_open');
    }
    return record;
  }

  private requiredMirror(record: ChangeRequestRecord): ChangeRequestGithubMirrorRecord {
    if (!record.githubMirror) {
      throw new ChangeRequestError('This change request does not have a GitHub mirror.', 404);
    }
    return record.githubMirror;
  }

  private async storeMirrorError(record: ChangeRequestRecord, error: unknown): Promise<void> {
    if (!record.githubMirror) return;
    await this.deps.repository.update(record.id, {
      githubMirror: {
        ...record.githubMirror,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: this.deps.now(),
      },
    });
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return await this.operationLock.withLock(id, operation);
  }
}
