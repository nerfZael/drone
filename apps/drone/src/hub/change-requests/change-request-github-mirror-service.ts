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
import { ChangeRequestLifecycle } from './change-request-lifecycle';
import type { ChangeRequestRepository } from './change-request-repository';
import { ChangeRequestOperationLock } from './change-request-operation-lock';
import { ChangeRequestError } from './change-request-error';
import { type RunHostCommand } from './change-request-git';
import { ChangeRequestMirrorBranchManager } from './change-request-mirror-branch-manager';
import type { ChangeRequestGithubMirrorRecord, ChangeRequestRecord } from './change-request-types';

type GithubMirrorClient = {
  createPullRequest: typeof createGithubPullRequestForRepoRoot;
  getPullRequest: typeof getGithubPullRequestForRepoRoot;
  updatePullRequest: typeof updateGithubPullRequestForRepoRoot;
  mergePullRequest: typeof mergeGithubPullRequestForRepoRoot;
  closePullRequest: typeof closeGithubPullRequestForRepoRoot;
};

export type ChangeRequestGithubMirrorServiceDependencies = {
  repository: ChangeRequestRepository;
  runHostCommand: RunHostCommand;
  deleteHostRefBestEffort: (input: { repoRoot: string; refName: string }) => Promise<void>;
  now: () => string;
  operationLock?: ChangeRequestOperationLock;
  lifecycle?: ChangeRequestLifecycle;
  github?: GithubMirrorClient;
  onGithubChanged?: (repoRoot: string) => void;
};

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
  private readonly lifecycle: ChangeRequestLifecycle;
  private readonly github: GithubMirrorClient;
  private readonly branches: ChangeRequestMirrorBranchManager;

  constructor(private readonly deps: ChangeRequestGithubMirrorServiceDependencies) {
    this.operationLock = deps.operationLock ?? new ChangeRequestOperationLock();
    this.branches = new ChangeRequestMirrorBranchManager(deps);
    this.lifecycle =
      deps.lifecycle ??
      new ChangeRequestLifecycle({
        repository: deps.repository,
        deleteHostRefBestEffort: deps.deleteHostRefBestEffort,
        now: deps.now,
      });
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
    const id = this.requiredRecord(idRaw).id;
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

      await this.branches.fetch(record.repoRoot);
      await this.branches.ensureDestination(record);
      const headBranch = this.branches.newHeadBranch(record);
      await this.branches.pushNew(record, headBranch);

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
        await this.branches
          .deleteRemote(record.repoRoot, headBranch, record.snapshotSha)
          .catch(() => {});
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
    const id = this.requiredRecord(idRaw).id;
    return await this.withLock(id, async () => await this.syncRecord(this.requiredOpenRecord(id)));
  }

  async setAutoUpdate(idRaw: string, enabled: boolean): Promise<ChangeRequestRecord> {
    const id = this.requiredRecord(idRaw).id;
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
    const id = this.requiredRecord(idRaw).id;
    return await this.withLock(id, async () => await this.mergeLocked(id, method));
  }

  async close(idRaw: string): Promise<ChangeRequestRecord> {
    const id = this.requiredRecord(idRaw).id;
    return await this.withLock(
      id,
      async () => await this.closeMirror(this.requiredRecord(id), true),
    );
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
      await this.persistPullRequestDetails(current, mirror, details, matchesNative);
      await this.reconcileTerminalMirror(id);
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
    try {
      await this.closeMirror(this.requiredRecord(record.id), false);
    } catch (error) {
      await this.storeMirrorError(this.requiredRecord(record.id), error);
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
        await this.persistPullRequestDetails(record, mirror, remote, false);
        await this.reconcileTerminalMirror(record.id);
        return this.requiredRecord(record.id);
      }
    } catch (error) {
      await this.storeMirrorError(this.requiredRecord(record.id), error);
      throw githubError(error);
    }
    let pushedHeadSha = mirror.headSha;
    try {
      await this.branches.fetch(record.repoRoot);
      await this.branches.ensureDestination(record);
      await this.branches.pushUpdated(record, mirror);
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
      await this.persistPullRequestDetails(record, mirror, details, details.state === 'open');
      await this.reconcileTerminalMirror(record.id);
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
      await this.reconcileTerminalMirror(id);
      return this.requiredRecord(id);
    } catch (error) {
      await this.storeMirrorError(this.requiredRecord(id), error);
      throw githubError(error);
    }
  }

  private async persistPullRequestDetails(
    record: ChangeRequestRecord,
    mirror: ChangeRequestGithubMirrorRecord,
    details: GithubPullRequestDetails,
    syncedWithNative: boolean,
  ): Promise<void> {
    const synced = syncedWithNative && details.state === 'open';
    await this.deps.repository.update(record.id, {
      githubMirror: {
        ...mirror,
        htmlUrl: details.htmlUrl,
        headSha: details.headSha,
        baseBranch: details.baseRefName,
        state: details.state,
        mergeCommitSha: details.mergeCommitSha,
        syncedRevision: synced ? record.revision : 0,
        syncedNativeUpdatedAt: synced ? record.updatedAt : '',
        lastError: null,
        updatedAt: this.deps.now(),
      },
    });
  }

  private async reconcileTerminalMirror(id: string): Promise<ChangeRequestRecord> {
    let current = this.requiredRecord(id);
    let mirror = this.requiredMirror(current);
    if (mirror.state === 'open') return current;

    if (mirror.state === 'merged' && current.status === 'open') {
      await this.lifecycle.completeMerge(current, {
        actor: {
          kind: 'user',
          id: null,
          label: 'DroneHub GitHub mirror',
        },
        mergeCommitSha: mirror.mergeCommitSha,
      });
      current = this.requiredRecord(id);
      mirror = this.requiredMirror(current);
    }

    const cleanupError = await this.branches.deleteOwned(current, mirror);
    await this.deps.repository.update(id, {
      githubMirror: {
        ...mirror,
        lastError: cleanupError,
        updatedAt: this.deps.now(),
      },
    });
    return this.requiredRecord(id);
  }

  private async closeMirror(
    record: ChangeRequestRecord,
    throwOnApiError: boolean,
  ): Promise<ChangeRequestRecord> {
    const mirror = this.requiredMirror(record);
    if (mirror.state === 'open') {
      try {
        await this.github.closePullRequest({
          repoRoot: record.repoRoot,
          pullNumber: mirror.pullNumber,
        });
        this.deps.onGithubChanged?.(record.repoRoot);
      } catch (error) {
        await this.storeMirrorError(record, error);
        if (throwOnApiError) throw githubError(error);
        return this.requiredRecord(record.id);
      }
      await this.deps.repository.update(record.id, {
        githubMirror: {
          ...mirror,
          state: 'closed',
          lastError: null,
          updatedAt: this.deps.now(),
        },
      });
    }
    return await this.reconcileTerminalMirror(record.id);
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
    if (!record.snapshotSha) {
      cleanupErrors.push(
        `could not safely delete mirror branch ${headBranch}: snapshot SHA missing`,
      );
    } else {
      try {
        await this.branches.deleteRemote(record.repoRoot, headBranch, record.snapshotSha);
      } catch (error) {
        cleanupErrors.push(
          `could not delete mirror branch ${headBranch}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const primary = githubError(cause);
    if (cleanupErrors.length === 0) return primary;
    return new ChangeRequestError(
      `${primary.message} Cleanup also failed: ${cleanupErrors.join('; ')}`,
      primary.statusCode,
      primary.code,
    );
  }

  private requiredRecord(id: string): ChangeRequestRecord {
    const reference = String(id ?? '').trim();
    const number = Number(reference);
    const record =
      Number.isSafeInteger(number) && number > 0
        ? this.deps.repository.getByNumber(number)
        : this.deps.repository.get(reference);
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
