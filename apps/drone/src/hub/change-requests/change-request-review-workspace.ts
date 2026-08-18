import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { RunResult } from '../../host/dvm';
import { ChangeRequestError } from './change-request-error';
import {
  changeRequestConflictFiles,
  resolveChangeRequestBranch,
  resolveChangeRequestCommit,
  runChangeRequestGit,
  safeChangeRequestRefSegment,
  type RunHostCommand,
} from './change-request-git';
import { ChangeRequestObjectStore } from './change-request-object-store';
import type { ChangeRequestRepository } from './change-request-repository';
import type { ResolvedChangeRequestDrone } from './change-request-snapshot-service';
import type { ChangeRequestRecord, ChangeRequestRevisionRecord } from './change-request-types';

const REVIEW_TIMEOUT_MS = 120_000;
const REVIEW_DIRECTORY = '.dronehub-change-request-reviews';

export type ChangeRequestReviewWorkspaceDependencies = {
  repository: ChangeRequestRepository;
  runHostCommand: RunHostCommand;
  storagePath: (...segments: string[]) => string;
  resolveDrone: (ref: string) => Promise<ResolvedChangeRequestDrone>;
  withLockedDroneContainer: <T>(
    input: { requestedDroneName: string; droneEntry: any },
    operation: (context: { containerName: string; droneEntry: any }) => Promise<T>,
  ) => Promise<T>;
  copyToContainer?: (
    containerName: string,
    sourcePath: string,
    destinationPath: string,
    options?: { timeoutMs?: number; containerAlreadyReady?: boolean },
  ) => Promise<void>;
  runCommandInDrone?: (input: {
    containerName: string;
    command: string;
    args: string[];
    timeoutMs?: number;
  }) => Promise<RunResult>;
  exportFullHeadBundleFromDrone: (input: {
    containerName: string;
    repoPathInContainer: string;
    outDir: string;
    label?: string;
  }) => Promise<{ exportedPath: string }>;
  importBundleHeadToHostRef: (input: {
    repoRoot: string;
    bundlePath: string;
    refName: string;
  }) => Promise<string>;
  createHostAuthoredMirrorCommit: (input: {
    repoRoot: string;
    sourceRef: string;
    parentRef: string;
    message?: string;
  }) => Promise<string>;
  updateHostRef: (input: { repoRoot: string; refName: string; target: string }) => Promise<void>;
  deleteHostRefBestEffort: (input: { repoRoot: string; refName: string }) => Promise<void>;
};

export type ChangeRequestReviewWorkspace = {
  workspaceId: string;
  requestNumber: number;
  revision: number;
  currentRevision: number;
  isCurrentRevision: boolean;
  snapshotSha: string;
  sourceHeadSha: string;
  destinationBranch: string;
  destinationSha: string;
  candidateSha: string;
  candidateTreeSha: string;
  reviewerDroneId: string;
  reviewerDroneName: string;
  path: string;
  reused: boolean;
};

export type ChangeRequestReviewPromotion = {
  baseSha: string;
  snapshotRef: string;
  snapshotSha: string;
  sourceRef: string;
  sourceHeadSha: string;
  objectStorePath: string;
};

type PreparedCandidate = Omit<
  ChangeRequestReviewWorkspace,
  'workspaceId' | 'reviewerDroneId' | 'reviewerDroneName' | 'path' | 'reused'
> & {
  bundlePath: string;
};

/**
 * Materializes the exact current destination + retained CR snapshot in a
 * isolated, reusable worktree inside a reviewer drone. It never mutates the CR or its
 * destination and never copies host Git credentials into the container.
 */
export class ChangeRequestReviewWorkspaceService {
  private readonly objectStore: ChangeRequestObjectStore;

  constructor(private readonly deps: ChangeRequestReviewWorkspaceDependencies) {
    this.objectStore = new ChangeRequestObjectStore(deps);
  }

  async prepare(input: {
    requestNumber: unknown;
    revision?: unknown;
    reviewerDroneRef: string;
  }): Promise<ChangeRequestReviewWorkspace> {
    if (!this.deps.copyToContainer || !this.deps.runCommandInDrone) {
      throw new ChangeRequestError('Change-request review workspaces are unavailable.', 503);
    }
    const record = this.requiredOpenRecord(input.requestNumber);
    const revision = this.requiredRevision(record, input.revision);
    const reviewer = await this.requireReviewerDrone(input.reviewerDroneRef);
    const candidate = await this.prepareCandidate(record, revision);
    try {
      return await this.materialize(reviewer, candidate);
    } finally {
      await fs.rm(candidate.bundlePath, { force: true }).catch(() => {});
    }
  }

  async capturePromotion(input: {
    record: ChangeRequestRecord;
    workspaceId: string;
    reviewerDroneRef: string;
  }): Promise<ChangeRequestReviewPromotion> {
    if (!this.deps.runCommandInDrone) {
      throw new ChangeRequestError('Change-request review workspaces are unavailable.', 503);
    }
    const revision = this.requiredRevision(input.record);
    const identity = parseWorkspaceId(input.workspaceId);
    if (
      identity.requestNumber !== input.record.number ||
      identity.revision !== revision.number ||
      identity.snapshotSha !== revision.snapshotSha ||
      identity.destinationBranchHash !== reviewDestinationBranchHash(input.record.destinationBranch)
    ) {
      throw new ChangeRequestError(
        'The review workspace does not belong to the current change-request revision.',
        409,
        'review_workspace_outdated',
      );
    }
    const reviewer = await this.requireReviewerDrone(input.reviewerDroneRef);
    const exported = await this.exportPromotionWorkspace(
      reviewer,
      input.record,
      revision,
      input.workspaceId,
      identity.destinationSha,
      identity.candidateSha,
    );
    const nextRevision = input.record.revision + 1;
    const sourceRef = sourceRevisionRef(input.record.id, nextRevision);
    const snapshotRef = snapshotRevisionRef(input.record.id, nextRevision);
    const importRef = temporaryPromotionImportRef(input.record.id);
    try {
      const importedHead = await this.deps.importBundleHeadToHostRef({
        repoRoot: input.record.repoRoot,
        bundlePath: exported.bundlePath,
        refName: importRef,
      });
      if (importedHead.trim().toLowerCase() !== exported.sourceHeadSha) {
        throw new ChangeRequestError(
          'The review workspace changed while its update was being captured. Try again.',
          409,
          'review_workspace_changed',
        );
      }
      await this.deps.updateHostRef({
        repoRoot: input.record.repoRoot,
        refName: sourceRef,
        target: importedHead,
      });
      const snapshotSha = await this.deps.createHostAuthoredMirrorCommit({
        repoRoot: input.record.repoRoot,
        sourceRef,
        parentRef: exported.destinationSha,
        message: `chore(drone): promote review update for change request ${input.record.id}`,
      });
      await this.assertHasChanges(input.record.repoRoot, exported.destinationSha, snapshotSha);
      await this.deps.updateHostRef({
        repoRoot: input.record.repoRoot,
        refName: snapshotRef,
        target: snapshotSha,
      });
      const objectStorePath = await this.objectStore.importRevision({
        requestId: input.record.id,
        sourceRepoRoot: input.record.repoRoot,
        sourceRef,
        snapshotRef,
      });
      return {
        baseSha: exported.destinationSha,
        snapshotRef,
        snapshotSha,
        sourceRef,
        sourceHeadSha: exported.sourceHeadSha,
        objectStorePath,
      };
    } catch (error) {
      await this.discardPromotion(input.record, {
        baseSha: exported.destinationSha,
        snapshotRef,
        snapshotSha: '',
        sourceRef,
        sourceHeadSha: exported.sourceHeadSha,
        objectStorePath: this.objectStore.pathForRequest(input.record.id),
      });
      throw error;
    } finally {
      await this.deps.deleteHostRefBestEffort({
        repoRoot: input.record.repoRoot,
        refName: importRef,
      });
      await fs.rm(exported.bundlePath, { force: true }).catch(() => {});
    }
  }

  async discardPromotion(
    record: ChangeRequestRecord,
    promotion: ChangeRequestReviewPromotion,
  ): Promise<void> {
    await Promise.all([
      this.deps.deleteHostRefBestEffort({
        repoRoot: record.repoRoot,
        refName: promotion.sourceRef,
      }),
      this.deps.deleteHostRefBestEffort({
        repoRoot: record.repoRoot,
        refName: promotion.snapshotRef,
      }),
      this.objectStore.deleteRevisionRefsBestEffort(record.id, [
        promotion.sourceRef,
        promotion.snapshotRef,
      ]),
    ]);
  }

  private async prepareCandidate(
    record: ChangeRequestRecord,
    revision: ChangeRequestRevisionRecord,
  ): Promise<PreparedCandidate> {
    const gitRoot = revision.objectStorePath || record.repoRoot;
    if (revision.objectStorePath) {
      await this.objectStore.refreshTargets(revision.objectStorePath, record.repoRoot);
    } else {
      await this.git(gitRoot, ['fetch', 'origin', '--prune'], REVIEW_TIMEOUT_MS);
    }
    const destinationRef = await resolveChangeRequestBranch(
      this.deps.runHostCommand,
      gitRoot,
      record.destinationBranch,
    );
    const baseRef = await resolveChangeRequestBranch(
      this.deps.runHostCommand,
      gitRoot,
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
    const destinationSha = await resolveChangeRequestCommit(
      this.deps.runHostCommand,
      gitRoot,
      targetRef,
    );
    if (!destinationSha) {
      throw new ChangeRequestError(
        'Unable to resolve the review destination.',
        409,
        'destination_missing',
      );
    }

    const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const safeRequest = safeChangeRequestRefSegment(record.id);
    const worktreePath = this.deps.storagePath(
      'change-request-review-preparations',
      `${safeRequest}-${runId}`,
    );
    const bundleDirectory = this.deps.storagePath('change-request-review-bundles');
    const bundlePath = path.join(bundleDirectory, `${safeRequest}-${runId}.bundle`);
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    await fs.mkdir(bundleDirectory, { recursive: true });
    try {
      await this.git(
        gitRoot,
        ['worktree', 'add', '--detach', worktreePath, destinationSha],
        REVIEW_TIMEOUT_MS,
      );
      const merged = await this.deps.runHostCommand(
        'git',
        ['-C', worktreePath, 'merge', '--squash', '--no-commit', revision.snapshotRef],
        { timeoutMs: REVIEW_TIMEOUT_MS },
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
      let candidateSha = destinationSha;
      if (staged.code === 1) {
        const disabledHooksPath = this.deps.storagePath('disabled-git-hooks');
        await fs.mkdir(disabledHooksPath, { recursive: true });
        const identity = {
          ...process.env,
          GIT_AUTHOR_NAME: 'DroneHub Review',
          GIT_AUTHOR_EMAIL: 'review@dronehub.local',
          GIT_AUTHOR_DATE: revision.createdAt,
          GIT_COMMITTER_NAME: 'DroneHub Review',
          GIT_COMMITTER_EMAIL: 'review@dronehub.local',
          GIT_COMMITTER_DATE: revision.createdAt,
        };
        const committed = await this.deps.runHostCommand(
          'git',
          [
            '-C',
            worktreePath,
            '-c',
            `core.hooksPath=${disabledHooksPath}`,
            '-c',
            'commit.gpgsign=false',
            'commit',
            '--no-verify',
            '-m',
            `chore(drone): review change request #${record.number} revision ${revision.number}`,
          ],
          { timeoutMs: REVIEW_TIMEOUT_MS, env: identity },
        );
        if (committed.code !== 0) {
          throw new ChangeRequestError(
            committed.stderr || committed.stdout || 'Unable to commit the review candidate.',
            409,
            'git_failed',
          );
        }
        candidateSha = (
          await this.git(worktreePath, ['rev-parse', 'HEAD'], REVIEW_TIMEOUT_MS)
        ).stdout
          .trim()
          .toLowerCase();
      } else if (staged.code !== 0) {
        throw new ChangeRequestError(
          staged.stderr || staged.stdout || 'Unable to inspect the review candidate.',
          409,
          'git_failed',
        );
      }
      const candidateTreeSha = (
        await this.git(worktreePath, ['rev-parse', `${candidateSha}^{tree}`], REVIEW_TIMEOUT_MS)
      ).stdout
        .trim()
        .toLowerCase();
      await this.git(worktreePath, ['bundle', 'create', bundlePath, 'HEAD'], REVIEW_TIMEOUT_MS);
      return {
        requestNumber: record.number,
        revision: revision.number,
        currentRevision: record.revision,
        isCurrentRevision: revision.number === record.revision,
        snapshotSha: revision.snapshotSha,
        sourceHeadSha: revision.sourceHeadSha,
        destinationBranch: record.destinationBranch,
        destinationSha,
        candidateSha,
        candidateTreeSha,
        bundlePath,
      };
    } catch (error) {
      await fs.rm(bundlePath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await this.deps
        .runHostCommand('git', ['-C', gitRoot, 'worktree', 'remove', '--force', worktreePath], {
          timeoutMs: 30_000,
        })
        .catch(() => null);
      await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
      await this.deps.runHostCommand('git', ['-C', gitRoot, 'worktree', 'prune']).catch(() => null);
    }
  }

  private async exportPromotionWorkspace(
    reviewer: Extract<ResolvedChangeRequestDrone, { kind: 'real' }>,
    record: ChangeRequestRecord,
    revision: ChangeRequestRevisionRecord,
    workspaceId: string,
    expectedDestinationSha: string,
    expectedCandidateSha: string,
  ): Promise<{ bundlePath: string; sourceHeadSha: string; destinationSha: string }> {
    const drone = reviewer.drone;
    const runtime = String(drone?.runtime ?? 'container')
      .trim()
      .toLowerCase();
    if (runtime === 'host') {
      throw new ChangeRequestError(
        'Review workspaces currently require a container drone.',
        409,
        'reviewer_not_container',
      );
    }
    const reviewerDroneName = String(drone?.name ?? reviewer.id).trim() || reviewer.id;
    const repoPath = String(drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
    const reviewPath = path.posix.join(repoPath, REVIEW_DIRECTORY, workspaceId);
    const reviewRef = reviewCandidateRef(record.number, workspaceId);
    return await this.deps.withLockedDroneContainer(
      { requestedDroneName: reviewerDroneName, droneEntry: drone },
      async ({ containerName }) => {
        const worktrees = await this.container(
          containerName,
          'git',
          ['-C', repoPath, 'worktree', 'list', '--porcelain'],
          30_000,
        );
        const sourceHeadSha = worktreeHead(worktrees.stdout, reviewPath);
        if (!sourceHeadSha) {
          throw new ChangeRequestError(
            'The review workspace is unavailable in this reviewer drone.',
            404,
            'review_workspace_not_found',
          );
        }
        await this.assertReviewWorkspaceClean(containerName, reviewPath);
        const candidateSha = (
          await this.container(containerName, 'git', [
            '-C',
            repoPath,
            'rev-parse',
            '--verify',
            `${reviewRef}^{commit}`,
          ])
        ).stdout
          .trim()
          .toLowerCase();
        if (candidateSha !== expectedCandidateSha) {
          throw new ChangeRequestError(
            'The review workspace no longer matches its prepared change-request candidate.',
            409,
            'review_workspace_changed',
          );
        }
        if (sourceHeadSha === candidateSha) {
          throw new ChangeRequestError(
            'The review workspace has no committed changes to publish.',
            409,
            'review_workspace_unchanged',
          );
        }
        const ancestry = await this.deps.runCommandInDrone!({
          containerName,
          command: 'git',
          args: ['-C', reviewPath, 'merge-base', '--is-ancestor', candidateSha, sourceHeadSha],
          timeoutMs: 30_000,
        });
        if (ancestry.code !== 0) {
          throw new ChangeRequestError(
            'The review workspace history no longer descends from its prepared candidate.',
            409,
            'review_workspace_history_changed',
          );
        }
        let destinationSha = candidateSha;
        if (candidateSha !== expectedDestinationSha) {
          destinationSha = (
            await this.container(containerName, 'git', [
              '-C',
              repoPath,
              'rev-parse',
              '--verify',
              `${reviewRef}^`,
            ])
          ).stdout
            .trim()
            .toLowerCase();
        }
        if (
          !/^[0-9a-f]{40}$/.test(destinationSha) ||
          destinationSha !== expectedDestinationSha ||
          revision.snapshotSha !== parseWorkspaceId(workspaceId).snapshotSha
        ) {
          throw new ChangeRequestError(
            'The review workspace no longer matches its prepared change-request candidate.',
            409,
            'review_workspace_changed',
          );
        }
        const exported = await this.deps.exportFullHeadBundleFromDrone({
          containerName,
          repoPathInContainer: reviewPath,
          outDir: this.deps.storagePath('change-request-review-exports'),
          label: `cr-${record.number}-review-update`,
        });
        return {
          bundlePath: exported.exportedPath,
          sourceHeadSha,
          destinationSha,
        };
      },
    );
  }

  private async materialize(
    reviewer: Extract<ResolvedChangeRequestDrone, { kind: 'real' }>,
    candidate: PreparedCandidate,
  ): Promise<ChangeRequestReviewWorkspace> {
    const drone = reviewer.drone;
    const runtime = String(drone?.runtime ?? 'container')
      .trim()
      .toLowerCase();
    if (runtime === 'host') {
      throw new ChangeRequestError(
        'Review workspaces currently require a container drone.',
        409,
        'reviewer_not_container',
      );
    }
    const reviewerDroneName = String(drone?.name ?? reviewer.id).trim() || reviewer.id;
    const repoPath = String(drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
    return await this.deps.withLockedDroneContainer(
      { requestedDroneName: reviewerDroneName, droneEntry: drone },
      async ({ containerName }) => {
        const key = reviewWorkspaceId(candidate);
        const relativeReviewPath = `${REVIEW_DIRECTORY}/${key}`;
        const reviewPath = path.posix.join(repoPath, relativeReviewPath);
        const reviewRef = reviewCandidateRef(candidate.requestNumber, key);
        const containerBundlePath = `/tmp/drone-hub/change-request-reviews/${key}.bundle`;
        const existing = await this.container(
          containerName,
          'git',
          ['-C', repoPath, 'worktree', 'list', '--porcelain'],
          30_000,
        );
        const registeredHead = worktreeHead(existing.stdout, reviewPath);
        if (registeredHead) {
          if (registeredHead !== candidate.candidateSha) {
            throw new ChangeRequestError(
              `The existing review workspace has an unexpected HEAD: ${reviewPath}`,
              409,
              'review_workspace_changed',
            );
          }
          await this.assertReviewWorkspaceClean(containerName, reviewPath);
          return {
            ...withoutBundle(candidate),
            workspaceId: key,
            reviewerDroneId: reviewer.id,
            reviewerDroneName,
            path: reviewPath,
            reused: true,
          };
        }

        await this.container(containerName, 'mkdir', [
          '-p',
          path.posix.dirname(containerBundlePath),
        ]);
        await this.deps.copyToContainer!(containerName, candidate.bundlePath, containerBundlePath, {
          timeoutMs: REVIEW_TIMEOUT_MS,
          containerAlreadyReady: true,
        });
        try {
          await this.container(
            containerName,
            'git',
            [
              '-C',
              repoPath,
              'fetch',
              '--no-tags',
              '--force',
              containerBundlePath,
              `HEAD:${reviewRef}`,
            ],
            REVIEW_TIMEOUT_MS,
          );
          const importedSha = (
            await this.container(containerName, 'git', [
              '-C',
              repoPath,
              'rev-parse',
              '--verify',
              `${reviewRef}^{commit}`,
            ])
          ).stdout
            .trim()
            .toLowerCase();
          if (importedSha !== candidate.candidateSha) {
            throw new ChangeRequestError(
              'The imported review candidate did not match the prepared candidate.',
              409,
              'review_candidate_changed',
            );
          }
          await this.excludeReviewDirectory(containerName, repoPath);
          const occupied = await this.deps.runCommandInDrone!({
            containerName,
            command: 'test',
            args: ['-e', reviewPath],
            timeoutMs: 30_000,
          });
          if (occupied.code === 0) {
            throw new ChangeRequestError(
              `The review workspace path already exists: ${reviewPath}`,
              409,
              'review_workspace_exists',
            );
          }
          await this.container(containerName, 'mkdir', ['-p', path.posix.dirname(reviewPath)]);
          await this.container(
            containerName,
            'git',
            ['-C', repoPath, 'worktree', 'add', '--detach', reviewPath, reviewRef],
            REVIEW_TIMEOUT_MS,
          );
          return {
            ...withoutBundle(candidate),
            workspaceId: key,
            reviewerDroneId: reviewer.id,
            reviewerDroneName,
            path: reviewPath,
            reused: false,
          };
        } finally {
          await this.deps.runCommandInDrone!({
            containerName,
            command: 'rm',
            args: ['-f', containerBundlePath],
            timeoutMs: 30_000,
          }).catch(() => null);
        }
      },
    );
  }

  private async excludeReviewDirectory(containerName: string, repoPath: string): Promise<void> {
    const excludeResult = await this.container(containerName, 'git', [
      '-C',
      repoPath,
      'rev-parse',
      '--git-path',
      'info/exclude',
    ]);
    const rawExcludePath = excludeResult.stdout.trim();
    const excludePath = path.posix.isAbsolute(rawExcludePath)
      ? rawExcludePath
      : path.posix.join(repoPath, rawExcludePath);
    await this.container(containerName, 'mkdir', ['-p', path.posix.dirname(excludePath)]);
    await this.container(containerName, 'sh', [
      '-c',
      'grep -Fqx "$2" "$1" 2>/dev/null || printf "%s\\n" "$2" >> "$1"',
      'dronehub-review-exclude',
      excludePath,
      `/${REVIEW_DIRECTORY}/`,
    ]);
  }

  private async assertReviewWorkspaceClean(
    containerName: string,
    reviewPath: string,
  ): Promise<void> {
    const status = await this.container(containerName, 'git', [
      '-C',
      reviewPath,
      'status',
      '--porcelain',
      '--untracked-files=all',
    ]);
    if (status.stdout.trim()) {
      throw new ChangeRequestError(
        'Commit or discard every review-workspace change before using it.',
        409,
        'review_workspace_dirty',
      );
    }
  }

  private async container(
    containerName: string,
    command: string,
    args: string[],
    timeoutMs = 30_000,
  ): Promise<RunResult> {
    const result = await this.deps.runCommandInDrone!({
      containerName,
      command,
      args,
      timeoutMs,
    });
    if (result.code !== 0) {
      throw new ChangeRequestError(
        result.stderr || result.stdout || `${command} failed in the reviewer container.`,
        409,
        'review_workspace_failed',
      );
    }
    return result;
  }

  private requiredOpenRecord(requestNumberRaw: unknown): ChangeRequestRecord {
    const requestNumber = Number(requestNumberRaw);
    if (!Number.isSafeInteger(requestNumber) || requestNumber <= 0) {
      throw new ChangeRequestError('change request number must be a positive integer');
    }
    const record = this.deps.repository.getByNumber(requestNumber);
    if (!record) {
      throw new ChangeRequestError(`unknown change request: #${requestNumber}`, 404, 'not_found');
    }
    if (record.status !== 'open') {
      throw new ChangeRequestError(`Change request is ${record.status}.`, 409, 'not_open');
    }
    return record;
  }

  private requiredRevision(
    record: ChangeRequestRecord,
    revisionNumberRaw?: unknown,
  ): ChangeRequestRevisionRecord {
    const revisionNumber =
      revisionNumberRaw == null || String(revisionNumberRaw).trim() === ''
        ? record.revision
        : Number(revisionNumberRaw);
    if (!Number.isSafeInteger(revisionNumber) || revisionNumber <= 0) {
      throw new ChangeRequestError('revision must be a positive integer');
    }
    const revision = this.deps.repository.getRevision(record.id, revisionNumber);
    if (!revision) {
      throw new ChangeRequestError(
        `Change request #${record.number} has no revision ${revisionNumber}.`,
        404,
        'revision_not_found',
      );
    }
    return revision;
  }

  private async requireReviewerDrone(
    reviewerDroneRefRaw: string,
  ): Promise<Extract<ResolvedChangeRequestDrone, { kind: 'real' }>> {
    const reviewerDroneRef = String(reviewerDroneRefRaw ?? '').trim();
    if (!reviewerDroneRef) throw new ChangeRequestError('reviewer drone is required');
    const reviewer = await this.deps.resolveDrone(reviewerDroneRef);
    if (!reviewer) {
      throw new ChangeRequestError(
        `unknown reviewer drone: ${reviewerDroneRef}`,
        404,
        'drone_not_found',
      );
    }
    if (reviewer.kind !== 'real') {
      throw new ChangeRequestError(
        `reviewer drone is still starting: ${reviewerDroneRef}`,
        409,
        'drone_starting',
      );
    }
    return reviewer;
  }

  private async assertHasChanges(
    repoRoot: string,
    baseSha: string,
    snapshotSha: string,
  ): Promise<void> {
    const result = await this.deps.runHostCommand('git', [
      '-C',
      repoRoot,
      'diff',
      '--quiet',
      baseSha,
      snapshotSha,
    ]);
    if (result.code === 0) {
      throw new ChangeRequestError(
        'The promoted review would leave the change request with no changes.',
        409,
        'no_changes',
      );
    }
    if (result.code !== 1) {
      throw new ChangeRequestError(
        result.stderr || 'Unable to compare the promoted review workspace.',
        500,
      );
    }
  }

  private git(repoRoot: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
    return runChangeRequestGit(this.deps.runHostCommand, repoRoot, args, timeoutMs);
  }
}

function withoutBundle(candidate: PreparedCandidate) {
  const { bundlePath: _bundlePath, ...result } = candidate;
  return result;
}

function worktreeHead(output: string, expectedPath: string): string | null {
  for (const block of String(output ?? '').split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    if (worktree !== expectedPath) continue;
    const head = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length) ?? '';
    return /^[0-9a-f]{40}$/i.test(head) ? head.toLowerCase() : null;
  }
  return null;
}

function reviewWorkspaceId(candidate: PreparedCandidate): string {
  return `cr-${candidate.requestNumber}-r${candidate.revision}-${reviewDestinationBranchHash(candidate.destinationBranch)}-${candidate.destinationSha}-${candidate.snapshotSha}-${candidate.candidateSha}`;
}

function parseWorkspaceId(value: string): {
  requestNumber: number;
  revision: number;
  destinationBranchHash: string;
  destinationSha: string;
  snapshotSha: string;
  candidateSha: string;
} {
  const match = String(value ?? '')
    .trim()
    .match(/^cr-([1-9]\d*)-r([1-9]\d*)-([0-9a-f]{64})-([0-9a-f]{40})-([0-9a-f]{40})-([0-9a-f]{40})$/);
  if (!match) {
    throw new ChangeRequestError('Invalid review workspace identifier.', 400);
  }
  return {
    requestNumber: Number(match[1]),
    revision: Number(match[2]),
    destinationBranchHash: match[3],
    destinationSha: match[4],
    snapshotSha: match[5],
    candidateSha: match[6],
  };
}

function reviewDestinationBranchHash(destinationBranch: string): string {
  return crypto.createHash('sha256').update(destinationBranch, 'utf8').digest('hex');
}

function reviewCandidateRef(requestNumber: number, workspaceId: string): string {
  return `refs/drone/reviews/change-request-${requestNumber}/${workspaceId}`;
}

function snapshotRevisionRef(id: string, revision: number): string {
  return `refs/drone/change-requests/${safeChangeRequestRefSegment(id)}/snapshots/${revision}`;
}

function sourceRevisionRef(id: string, revision: number): string {
  return `refs/drone/change-requests/${safeChangeRequestRefSegment(id)}/sources/${revision}`;
}

function temporaryPromotionImportRef(id: string): string {
  return `refs/drone/change-requests/${safeChangeRequestRefSegment(id)}/review-import-${crypto.randomBytes(5).toString('hex')}`;
}
