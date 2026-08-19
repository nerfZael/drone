import crypto from 'node:crypto';
import path from 'node:path';

import type { RunResult } from '../../host/dvm';
import { ChangeRequestCheckoutApplier } from './change-request-checkout-applier';
import {
  ChangeRequestDirectMerger,
  type ChangeRequestDirectMergerDependencies,
} from './change-request-direct-merger';
import { ChangeRequestError } from './change-request-error';
import {
  changeRequestConflictFiles,
  normalizeChangeRequestBranch,
  resolveChangeRequestBranch,
  resolveChangeRequestCommit,
  runChangeRequestGit,
  type RunHostCommand,
} from './change-request-git';
import { ChangeRequestLifecycle, normalizeChangeRequestActor } from './change-request-lifecycle';
import type { ChangeRequestRepository } from './change-request-repository';
import { ChangeRequestOperationLock } from './change-request-operation-lock';
import { ChangeRequestObjectStore } from './change-request-object-store';
import {
  ChangeRequestReviewWorkspaceService,
  type ChangeRequestReviewPromotion,
  type ChangeRequestReviewWorkspace,
  type ChangeRequestReviewWorkspaceDependencies,
} from './change-request-review-workspace';
import {
  ChangeRequestSnapshotService,
  type ChangeRequestSnapshot,
  type ChangeRequestSnapshotDependencies,
} from './change-request-snapshot-service';
import type {
  ChangeRequestActor,
  ChangeRequestCheckoutApplication,
  ChangeRequestChanges,
  ChangeRequestCreateInput,
  ChangeRequestFileChange,
  ChangeRequestLineStats,
  ChangeRequestRecord,
  ChangeRequestRevisionRecord,
  ChangeRequestRevisionView,
  ChangeRequestSourceCommit,
  ChangeRequestStatus,
  ChangeRequestUpdateInput,
  ChangeRequestView,
} from './change-request-types';

export { ChangeRequestError } from './change-request-error';

export type ChangeRequestServiceDependencies = ChangeRequestSnapshotDependencies &
  ChangeRequestDirectMergerDependencies & {
    repository: ChangeRequestRepository;
    runHostCommand: RunHostCommand;
    now: () => string;
    operationLock?: ChangeRequestOperationLock;
    lifecycle?: ChangeRequestLifecycle;
    githubMirrorLifecycle?: {
      syncAfterNativeUpdate: (record: ChangeRequestRecord) => Promise<void>;
      closeAfterNativeCompletion: (record: ChangeRequestRecord) => Promise<void>;
      refreshAfterNativeAssessment: (record: ChangeRequestRecord) => Promise<void>;
    };
  } & Pick<ChangeRequestReviewWorkspaceDependencies, 'copyToContainer' | 'runCommandInDrone'>;

const MAX_TITLE_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MERGE_TIMEOUT_MS = 120_000;
const ASSESSMENT_CONCURRENCY = 4;

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new ChangeRequestError(`${label} is required`);
  if (text.length > maxLength) throw new ChangeRequestError(`${label} is too long`);
  return text;
}

function optionalText(value: unknown, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw new ChangeRequestError('description is too long');
  return text;
}

function statusType(statusCharRaw: string): ChangeRequestFileChange['statusType'] {
  const statusChar = statusCharRaw.slice(0, 1).toUpperCase();
  if (statusChar === 'A') return 'added';
  if (statusChar === 'M') return 'modified';
  if (statusChar === 'D') return 'deleted';
  if (statusChar === 'R') return 'renamed';
  if (statusChar === 'C') return 'copied';
  if (statusChar === 'T') return 'type-changed';
  return 'unknown';
}

export class ChangeRequestService {
  private readonly operationLock: ChangeRequestOperationLock;
  private readonly lifecycle: ChangeRequestLifecycle;
  private readonly snapshotService: ChangeRequestSnapshotService;
  private readonly directMerger: ChangeRequestDirectMerger;
  private readonly checkoutApplier: ChangeRequestCheckoutApplier;
  private readonly objectStore: ChangeRequestObjectStore;
  private readonly reviewWorkspaceService: ChangeRequestReviewWorkspaceService;

  constructor(private readonly deps: ChangeRequestServiceDependencies) {
    this.operationLock = deps.operationLock ?? new ChangeRequestOperationLock();
    this.snapshotService = new ChangeRequestSnapshotService(deps);
    this.objectStore = new ChangeRequestObjectStore(deps);
    this.directMerger = new ChangeRequestDirectMerger(deps);
    this.checkoutApplier = new ChangeRequestCheckoutApplier(deps);
    this.reviewWorkspaceService = new ChangeRequestReviewWorkspaceService(deps);
    this.lifecycle =
      deps.lifecycle ??
      new ChangeRequestLifecycle({
        repository: deps.repository,
        deleteHostRefBestEffort: deps.deleteHostRefBestEffort,
        now: deps.now,
      });
  }

  async create(input: ChangeRequestCreateInput): Promise<ChangeRequestView> {
    const id = crypto.randomUUID();
    const title = requiredText(input.title, 'title', MAX_TITLE_LENGTH);
    const description = optionalText(input.description, MAX_DESCRIPTION_LENGTH);
    const source = await this.snapshotService.captureSource(input.droneRef, input.chatName);
    const destinationBranch = await this.validBranch(
      source.repoRoot,
      input.destinationBranch || source.baseBranch,
    );
    const snapshot = await this.snapshotService.capture(id, 1, source);
    const now = this.deps.now();
    const actor = normalizeChangeRequestActor(input.actor);
    let created: ChangeRequestRecord;
    try {
      created = await this.deps.repository.insert(
        {
          id,
          status: 'open',
          droneId: snapshot.droneId,
          droneName: snapshot.droneName,
          chatId: input.chatId ?? snapshot.chatId,
          chatName: snapshot.chatName,
          repoRoot: snapshot.repoRoot,
          baseBranch: snapshot.baseBranch,
          baseSha: snapshot.baseSha,
          destinationBranch,
          snapshotRef: snapshot.snapshotRef,
          snapshotSha: snapshot.snapshotSha,
          sourceHeadSha: snapshot.sourceHeadSha,
          revision: 1,
          title,
          description,
          createdBy: actor,
          mergedBy: null,
          mergeCommitSha: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          mergedAt: null,
          closedAt: null,
          githubMirror: null,
        },
        {
          number: 1,
          baseBranch: snapshot.baseBranch,
          baseSha: snapshot.baseSha,
          snapshotRef: snapshot.snapshotRef,
          snapshotSha: snapshot.snapshotSha,
          sourceRef: snapshot.sourceRef,
          sourceHeadSha: snapshot.sourceHeadSha,
          objectStorePath: snapshot.objectStorePath,
          createdBy: actor,
          createdAt: now,
        },
      );
    } catch (error) {
      await this.snapshotService.discard(id, snapshot);
      throw error;
    }
    return await this.view(created);
  }

  async get(requestNumberRaw: unknown): Promise<ChangeRequestView> {
    return await this.view(this.requiredRecord(requestNumberRaw));
  }

  async prepareReviewWorkspace(input: {
    requestNumber: unknown;
    revision?: unknown;
    reviewerDroneRef: string;
  }): Promise<ChangeRequestReviewWorkspace> {
    const id = this.requiredRecord(input.requestNumber).id;
    return await this.withLock(id, () => this.reviewWorkspaceService.prepare(input));
  }

  async updateFromReviewWorkspace(input: {
    requestNumber: unknown;
    workspaceId: string;
    reviewerDroneRef: string;
    actor: ChangeRequestActor;
  }): Promise<ChangeRequestView> {
    const id = this.requiredRecord(input.requestNumber).id;
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      let promotion: ChangeRequestReviewPromotion | null = null;
      let updated: ChangeRequestRecord;
      try {
        promotion = await this.reviewWorkspaceService.capturePromotion({
          record: current,
          workspaceId: input.workspaceId,
          reviewerDroneRef: input.reviewerDroneRef,
        });
        const updatedAt = this.deps.now();
        updated = await this.deps.repository.updateWithRevision(
          id,
          {
            baseSha: promotion.baseSha,
            snapshotRef: promotion.snapshotRef,
            snapshotSha: promotion.snapshotSha,
            sourceHeadSha: promotion.sourceHeadSha,
            revision: current.revision + 1,
            lastError: null,
            updatedAt,
          },
          {
            number: current.revision + 1,
            baseBranch: current.baseBranch,
            baseSha: promotion.baseSha,
            snapshotRef: promotion.snapshotRef,
            snapshotSha: promotion.snapshotSha,
            sourceRef: promotion.sourceRef,
            sourceHeadSha: promotion.sourceHeadSha,
            objectStorePath: promotion.objectStorePath,
            createdBy: normalizeChangeRequestActor(input.actor),
            createdAt: updatedAt,
          },
        );
      } catch (error) {
        if (promotion) await this.reviewWorkspaceService.discardPromotion(current, promotion);
        throw error;
      }
      await this.deps.githubMirrorLifecycle?.syncAfterNativeUpdate(updated);
      return await this.view(this.requiredRecord(id));
    });
  }

  async revisions(requestNumberRaw: unknown): Promise<ChangeRequestRevisionView[]> {
    const record = this.requiredRecord(requestNumberRaw);
    return await Promise.all(
      this.deps.repository
        .listRevisions(record.id)
        .map((revision) => this.revisionView(record, revision)),
    );
  }

  async getByNumber(numberRaw: unknown, droneIdRaw: unknown): Promise<ChangeRequestView> {
    const number = Number(numberRaw);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new ChangeRequestError('change request number must be a positive integer');
    }
    const repoRoot = await this.repositoryRootForDrone(droneIdRaw);
    const record = this.deps.repository.getByNumber(number);
    if (!record || path.resolve(record.repoRoot) !== repoRoot) {
      throw new ChangeRequestError(`unknown change request: #${number}`, 404, 'not_found');
    }
    return await this.view(record);
  }

  async repositoryRootForDrone(droneIdRaw: unknown): Promise<string> {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) throw new ChangeRequestError('droneId is required');
    const resolved = await this.deps.resolveDrone(droneId);
    if (!resolved) {
      throw new ChangeRequestError(`unknown drone: ${droneId}`, 404, 'drone_not_found');
    }
    if (resolved.kind !== 'real') {
      throw new ChangeRequestError(`drone is still starting: ${droneId}`, 409, 'drone_starting');
    }
    const repoPath = String(resolved.drone?.repoPath ?? '').trim();
    if (!repoPath) throw new ChangeRequestError('drone has no attached repository');
    return path.resolve(await this.deps.gitTopLevel(repoPath));
  }

  async list(
    filters: {
      droneId?: string;
      chatName?: string;
      status?: ChangeRequestStatus;
    } = {},
  ): Promise<ChangeRequestView[]> {
    const repoRoot = filters.droneId ? await this.repositoryRootForDrone(filters.droneId) : null;
    const records = this.deps.repository.list({
      ...(repoRoot ? {} : { droneId: filters.droneId }),
      chatName: filters.chatName,
      status: filters.status,
    });
    return await mapWithConcurrency(
      repoRoot ? records.filter((record) => path.resolve(record.repoRoot) === repoRoot) : records,
      ASSESSMENT_CONCURRENCY,
      (record) => this.view(record),
    );
  }

  async refreshAssessment(requestNumberRaw: unknown): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredRecord(id);
      if (current.status === 'open') {
        const revision = this.currentRevision(current);
        if (revision.objectStorePath) {
          await this.objectStore.refreshTargets(revision.objectStorePath, current.repoRoot);
        } else {
          await this.git(current.repoRoot, ['fetch', 'origin', '--prune'], MERGE_TIMEOUT_MS);
        }
      }
      await this.deps.githubMirrorLifecycle?.refreshAfterNativeAssessment(this.requiredRecord(id));
      const updated = await this.deps.repository.emitEvent(
        id,
        'change_request.updated',
        this.deps.now(),
      );
      return await this.view(updated);
    });
  }

  async update(
    requestNumberRaw: unknown,
    input: ChangeRequestUpdateInput,
  ): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const destinationBranch = input.destinationBranch
        ? await this.validBranch(current.repoRoot, input.destinationBranch)
        : current.destinationBranch;
      let snapshotPatch: Partial<ChangeRequestRecord> = {};
      let snapshot: ChangeRequestSnapshot | null = null;
      if (input.refreshSnapshot !== false) {
        const source = await this.snapshotService.captureSource(
          current.droneId,
          current.chatName,
          current,
        );
        snapshot = await this.snapshotService.capture(id, current.revision + 1, source);
        snapshotPatch = {
          baseSha: snapshot.baseSha,
          snapshotRef: snapshot.snapshotRef,
          snapshotSha: snapshot.snapshotSha,
          sourceHeadSha: snapshot.sourceHeadSha,
          revision: current.revision + 1,
        };
      }
      let updated: ChangeRequestRecord;
      try {
        const patch = {
          ...snapshotPatch,
          destinationBranch,
          ...(input.title === undefined
            ? {}
            : { title: requiredText(input.title, 'title', MAX_TITLE_LENGTH) }),
          ...(input.description === undefined
            ? {}
            : { description: optionalText(input.description, MAX_DESCRIPTION_LENGTH) }),
          lastError: null,
          updatedAt: this.deps.now(),
        };
        updated = snapshotPatch.snapshotRef
          ? await this.deps.repository.updateWithRevision(id, patch, {
              number: current.revision + 1,
              baseBranch: current.baseBranch,
              baseSha: snapshotPatch.baseSha!,
              snapshotRef: snapshotPatch.snapshotRef,
              snapshotSha: snapshotPatch.snapshotSha!,
              sourceRef: snapshot!.sourceRef,
              sourceHeadSha: snapshotPatch.sourceHeadSha!,
              objectStorePath: snapshot!.objectStorePath,
              createdBy: normalizeChangeRequestActor(input.actor ?? current.createdBy),
              createdAt: patch.updatedAt,
            })
          : await this.deps.repository.update(id, patch);
      } catch (error) {
        if (snapshot) await this.snapshotService.discard(id, snapshot);
        throw error;
      }
      await this.deps.githubMirrorLifecycle?.syncAfterNativeUpdate(updated);
      updated = this.requiredRecord(id);
      return await this.view(updated);
    });
  }

  async close(requestNumberRaw: unknown): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const closed = await this.lifecycle.completeClose(current);
      await this.deps.githubMirrorLifecycle?.closeAfterNativeCompletion(closed);
      return await this.view(this.requiredRecord(id));
    });
  }

  async applyToHostCheckout(
    requestNumberRaw: unknown,
    input: { droneId: unknown; expectedRevision?: number },
  ): Promise<ChangeRequestCheckoutApplication> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const revision = this.currentRevision(current);
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision.number) {
        throw new ChangeRequestError(
          'The change request revision changed before it could be applied. Review the latest revision and try again.',
          409,
          'review_candidate_outdated',
          { expectedRevision: input.expectedRevision, revision: revision.number },
        );
      }
      const checkoutRoot = await this.repositoryRootForDrone(input.droneId);
      if (path.resolve(current.repoRoot) !== checkoutRoot) {
        throw new ChangeRequestError(
          'The selected host checkout belongs to a different repository.',
          409,
          'checkout_repository_mismatch',
        );
      }
      return await this.operationLock.withLock(`checkout:${checkoutRoot}`, async () => {
        const receipt = await this.checkoutApplier.apply(current, revision, checkoutRoot);
        return { ...receipt, request: await this.view(this.requiredRecord(id)) };
      });
    });
  }

  async merge(
    requestNumberRaw: unknown,
    input: {
      actor: ChangeRequestActor;
      commitMessage?: string;
      expectedRevision?: number;
      expectedDestinationBranch?: string;
      expectedDestinationSha?: string;
      expectedCandidateTreeSha?: string;
    },
  ): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const revision = this.currentRevision(current);
      const expectedDestinationBranch = input.expectedDestinationBranch
        ? normalizeChangeRequestBranch(input.expectedDestinationBranch)
        : '';
      const expectedDestinationSha = String(input.expectedDestinationSha ?? '')
        .trim()
        .toLowerCase();
      const expectedCandidateTreeSha = String(input.expectedCandidateTreeSha ?? '')
        .trim()
        .toLowerCase();
      const reviewPins = [
        input.expectedRevision !== undefined,
        Boolean(expectedDestinationBranch),
        Boolean(expectedDestinationSha),
        Boolean(expectedCandidateTreeSha),
      ];
      if (reviewPins.some(Boolean) && !reviewPins.every(Boolean)) {
        throw new ChangeRequestError(
          'Reviewed merges require expectedRevision, expectedDestinationBranch, expectedDestinationSha, and expectedCandidateTreeSha together.',
          400,
          'review_pins_incomplete',
        );
      }
      if (
        (expectedDestinationSha && !/^[0-9a-f]{40}$/.test(expectedDestinationSha)) ||
        (expectedCandidateTreeSha && !/^[0-9a-f]{40}$/.test(expectedCandidateTreeSha))
      ) {
        throw new ChangeRequestError('Reviewed merge SHAs must be 40 hexadecimal characters.');
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision.number) {
        throw new ChangeRequestError(
          'The change request revision changed after the reviewed candidate was prepared. Prepare and review it again before merging.',
          409,
          'review_candidate_outdated',
          { expectedRevision: input.expectedRevision, revision: revision.number },
        );
      }
      if (expectedDestinationBranch && expectedDestinationBranch !== current.destinationBranch) {
        throw new ChangeRequestError(
          'The destination branch changed after the reviewed candidate was prepared. Prepare and review it again before merging.',
          409,
          'review_candidate_outdated',
          {
            expectedDestinationBranch,
            destinationBranch: current.destinationBranch,
          },
        );
      }
      const destinationLock = `destination:${path.resolve(current.repoRoot)}:${current.destinationBranch}`;
      return await this.operationLock.withLock(destinationLock, async () => {
        let attemptId: string | null = null;
        let pushed = false;
        try {
          const mergeCommitSha = await this.directMerger.merge(
            current,
            String(input.commitMessage ?? '').trim() || current.title,
            revision,
            async ({ expectedTargetSha, mergeCommitSha }) => {
              const now = this.deps.now();
              attemptId = crypto.randomUUID();
              await this.deps.repository.insertMergeAttempt({
                id: attemptId,
                requestId: current.id,
                revision: revision.number,
                destinationBranch: current.destinationBranch,
                expectedTargetSha,
                mergeCommitSha,
                actor: normalizeChangeRequestActor(input.actor),
                status: 'prepared',
                error: null,
                createdAt: now,
                updatedAt: now,
              });
            },
            expectedDestinationSha || undefined,
            expectedCandidateTreeSha || undefined,
          );
          pushed = true;
          const merged = await this.lifecycle.completeMerge(current, {
            actor: input.actor,
            mergeCommitSha,
          });
          if (attemptId) {
            await this.deps.repository.completeMergeAttempt(
              attemptId,
              'completed',
              null,
              this.deps.now(),
            );
          }
          await this.deps.githubMirrorLifecycle?.closeAfterNativeCompletion(merged);
          return await this.view(this.requiredRecord(id));
        } catch (error: any) {
          if (attemptId && !pushed) {
            await this.deps.repository.completeMergeAttempt(
              attemptId,
              'failed',
              error?.message ?? String(error),
              this.deps.now(),
            );
          }
          await this.deps.repository.update(id, {
            lastError: error?.message ?? String(error),
            updatedAt: this.deps.now(),
          });
          throw error;
        }
      });
    });
  }

  async recoverPendingMerges(): Promise<void> {
    for (const attempt of this.deps.repository.listPreparedMergeAttempts()) {
      await this.withLock(attempt.requestId, async () => {
        const current = this.deps.repository.get(attempt.requestId);
        if (!current) {
          await this.deps.repository.completeMergeAttempt(
            attempt.id,
            'failed',
            'Change request no longer exists.',
            this.deps.now(),
          );
          return;
        }
        if (current.status === 'merged' && current.mergeCommitSha === attempt.mergeCommitSha) {
          await this.deps.repository.completeMergeAttempt(
            attempt.id,
            'completed',
            null,
            this.deps.now(),
          );
          return;
        }
        if (current.status !== 'open' || current.revision !== attempt.revision) {
          await this.deps.repository.completeMergeAttempt(
            attempt.id,
            'failed',
            'Change request changed before merge recovery.',
            this.deps.now(),
          );
          return;
        }
        const revision = this.currentRevision(current);
        const gitRoot = this.revisionGitRoot(current, revision);
        if (revision.objectStorePath) {
          await this.objectStore.refreshTargets(revision.objectStorePath, current.repoRoot);
        } else {
          await this.git(gitRoot, ['fetch', 'origin', '--prune'], MERGE_TIMEOUT_MS);
        }
        const destinationRef = await resolveChangeRequestBranch(
          this.deps.runHostCommand,
          gitRoot,
          attempt.destinationBranch,
        );
        const destinationSha = destinationRef
          ? await resolveChangeRequestCommit(this.deps.runHostCommand, gitRoot, destinationRef)
          : null;
        if (destinationSha !== attempt.mergeCommitSha) {
          await this.deps.repository.completeMergeAttempt(
            attempt.id,
            'failed',
            destinationSha === attempt.expectedTargetSha
              ? 'Prepared merge was not pushed.'
              : 'Destination changed before merge recovery.',
            this.deps.now(),
          );
          return;
        }
        const merged = await this.lifecycle.completeMerge(current, {
          actor: attempt.actor,
          mergeCommitSha: attempt.mergeCommitSha,
        });
        await this.deps.repository.completeMergeAttempt(
          attempt.id,
          'completed',
          null,
          this.deps.now(),
        );
        await this.deps.githubMirrorLifecycle?.closeAfterNativeCompletion(merged);
      }).catch(async (error) => {
        const current = this.deps.repository.get(attempt.requestId);
        if (current?.status === 'open') {
          await this.deps.repository.update(current.id, {
            lastError: `Merge recovery is pending: ${error instanceof Error ? error.message : String(error)}`,
            updatedAt: this.deps.now(),
          });
        }
        // An inability to inspect the remote is inconclusive. Keep the attempt
        // prepared so a later startup can reconcile it safely.
      });
    }
  }

  async changes(
    requestNumberRaw: unknown,
    revisionNumberRaw?: unknown,
  ): Promise<ChangeRequestChanges> {
    const record = this.requiredRecord(requestNumberRaw);
    const request = await this.view(record);
    const revision = this.requiredRevision(record, revisionNumberRaw);
    const revisionView = await this.revisionView(record, revision);
    const gitRoot = this.revisionGitRoot(record, revision);
    const range = `${revision.baseSha}..${revision.snapshotRef}`;
    const [names, stats] = await Promise.all([
      this.git(gitRoot, ['diff', '--name-status', '-M', range]),
      this.git(gitRoot, ['diff', '--numstat', range]),
    ]);
    const statsByPath = new Map<string, { additions: number; deletions: number }>();
    for (const line of stats.stdout.split(/\r?\n/)) {
      if (!line) continue;
      const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
      const filePath = pathParts.at(-1)?.trim() ?? '';
      if (!filePath) continue;
      const additions = /^\d+$/.test(addedRaw ?? '') ? Number(addedRaw) : 0;
      const deletions = /^\d+$/.test(deletedRaw ?? '') ? Number(deletedRaw) : 0;
      statsByPath.set(filePath, { additions, deletions });
    }
    const entries: ChangeRequestFileChange[] = [];
    for (const line of names.stdout.split(/\r?\n/)) {
      if (!line) continue;
      const [statusRaw, firstPathRaw, secondPathRaw] = line.split('\t');
      const statusChar = String(statusRaw ?? '')
        .slice(0, 1)
        .toUpperCase();
      const renamed = statusChar === 'R' || statusChar === 'C';
      const filePath = String(renamed ? secondPathRaw : firstPathRaw).trim();
      if (!filePath) continue;
      const fileStats = statsByPath.get(filePath) ?? { additions: 0, deletions: 0 };
      entries.push({
        path: filePath,
        originalPath: renamed ? String(firstPathRaw ?? '').trim() || null : null,
        statusChar,
        statusType: statusType(statusChar),
        additions: fileStats.additions,
        deletions: fileStats.deletions,
        changes: fileStats.additions + fileStats.deletions,
      });
    }
    entries.sort((left, right) => left.path.localeCompare(right.path));
    const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
    const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
    return {
      request,
      revision: revisionView,
      counts: {
        changed: entries.length,
        additions,
        deletions,
        modified: entries.reduce(
          (sum, entry) => sum + Math.min(entry.additions, entry.deletions),
          0,
        ),
      },
      entries,
    };
  }

  async diff(
    requestNumberRaw: unknown,
    filePathRaw: string,
    contextLinesRaw = 3,
    revisionNumberRaw?: unknown,
  ): Promise<{
    request: ChangeRequestView;
    revision: ChangeRequestRevisionView;
    path: string;
    diff: string;
    truncated: boolean;
  }> {
    const record = this.requiredRecord(requestNumberRaw);
    const request = await this.view(record);
    const revision = this.requiredRevision(record, revisionNumberRaw);
    const revisionView = await this.revisionView(record, revision);
    const gitRoot = this.revisionGitRoot(record, revision);
    const filePath = String(filePathRaw ?? '').trim();
    if (!filePath || path.isAbsolute(filePath) || filePath.split(/[\\/]+/).includes('..')) {
      throw new ChangeRequestError('A valid repository-relative path is required.');
    }
    const contextLines = Math.min(200, Math.max(0, Math.floor(Number(contextLinesRaw) || 3)));
    const result = await this.git(gitRoot, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `-U${contextLines}`,
      `${revision.baseSha}..${revision.snapshotRef}`,
      '--',
      filePath,
    ]);
    const maxBytes = 2 * 1024 * 1024;
    const bytes = Buffer.from(result.stdout, 'utf8');
    return {
      request,
      revision: revisionView,
      path: filePath,
      diff: bytes.length > maxBytes ? bytes.subarray(0, maxBytes).toString('utf8') : result.stdout,
      truncated: bytes.length > maxBytes,
    };
  }

  private requiredRecord(requestNumberRaw: unknown): ChangeRequestRecord {
    const reference = String(requestNumberRaw ?? '').trim();
    const number = Number(requestNumberRaw);
    if (Number.isSafeInteger(number) && number > 0) {
      const record = this.deps.repository.getByNumber(number);
      if (record) return record;
      throw new ChangeRequestError(`unknown change request: #${number}`, 404, 'not_found');
    }
    // Internal services may still use the opaque storage key. Public API and MCP
    // callers only receive and submit the integer request number.
    const internalRecord = reference ? this.deps.repository.get(reference) : null;
    if (internalRecord) return internalRecord;
    throw new ChangeRequestError('change request number must be a positive integer');
  }

  private requiredOpenRecord(requestNumberRaw: unknown): ChangeRequestRecord {
    const record = this.requiredRecord(requestNumberRaw);
    if (record.status !== 'open') {
      throw new ChangeRequestError(`Change request is ${record.status}.`, 409, 'not_open');
    }
    return record;
  }

  private async validBranch(repoRoot: string, value: unknown): Promise<string> {
    const branch = normalizeChangeRequestBranch(value);
    if (!branch) throw new ChangeRequestError('destination branch is required');
    const result = await this.deps.runHostCommand('git', [
      '-C',
      repoRoot,
      'check-ref-format',
      '--branch',
      branch,
    ]);
    if (result.code !== 0) throw new ChangeRequestError(`Invalid destination branch: ${branch}`);
    return branch;
  }

  private async view(record: ChangeRequestRecord): Promise<ChangeRequestView> {
    const { id: _internalId, ...publicRecord } = record;
    const githubMirror = this.githubMirrorView(record);
    const revision = this.currentRevisionOrNull(record);
    const lineStats = revision ? await this.lineStats(record, revision) : null;
    if (record.status !== 'open') {
      return {
        ...publicRecord,
        githubMirror,
        lineStats,
        stale: false,
        conflicted: false,
        destinationExists: record.status === 'merged',
        destinationSha: record.mergeCommitSha,
        conflictFiles: [],
      };
    }
    if (!revision) {
      return {
        ...publicRecord,
        githubMirror,
        lineStats,
        stale: false,
        conflicted: false,
        destinationExists: false,
        destinationSha: null,
        conflictFiles: [],
        lastError: 'Change request revision is unavailable.',
      };
    }
    const gitRoot = this.revisionGitRoot(record, revision);
    const snapshot = await resolveChangeRequestCommit(
      this.deps.runHostCommand,
      gitRoot,
      revision.snapshotRef,
    );
    if (!snapshot || snapshot !== revision.snapshotSha) {
      return {
        ...publicRecord,
        githubMirror,
        lineStats,
        stale: false,
        conflicted: false,
        destinationExists: false,
        destinationSha: null,
        conflictFiles: [],
        lastError: 'Change request snapshot is unavailable.',
      };
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
    const destinationSha = targetRef
      ? await resolveChangeRequestCommit(this.deps.runHostCommand, gitRoot, targetRef)
      : null;
    if (!destinationSha) {
      return {
        ...publicRecord,
        githubMirror,
        lineStats,
        stale: false,
        conflicted: false,
        destinationExists: Boolean(destinationRef),
        destinationSha: null,
        conflictFiles: [],
        lastError: `Base branch is unavailable: ${record.baseBranch}`,
      };
    }
    const mergeTree = await this.deps.runHostCommand(
      'git',
      [
        '-C',
        gitRoot,
        'merge-tree',
        '--write-tree',
        '--messages',
        destinationSha,
        revision.snapshotRef,
      ],
      { timeoutMs: 30_000 },
    );
    const combined = `${mergeTree.stdout}\n${mergeTree.stderr}`.trim();
    return {
      ...publicRecord,
      githubMirror,
      lineStats,
      stale: destinationSha !== revision.baseSha,
      conflicted: mergeTree.code !== 0,
      destinationExists: Boolean(destinationRef),
      destinationSha,
      conflictFiles: mergeTree.code === 0 ? [] : changeRequestConflictFiles(combined),
    };
  }

  private async lineStats(
    record: ChangeRequestRecord,
    revision: ChangeRequestRevisionRecord,
  ): Promise<ChangeRequestLineStats | null> {
    try {
      const result = await this.git(this.revisionGitRoot(record, revision), [
        'diff',
        '--numstat',
        `${revision.baseSha}..${revision.snapshotSha}`,
      ]);
      if (result.code !== 0) return null;
      let files = 0;
      let additions = 0;
      let modifications = 0;
      let deletions = 0;
      for (const line of result.stdout.split(/\r?\n/)) {
        if (!line) continue;
        const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
        if (!pathParts.some((part) => part.trim())) continue;
        files += 1;
        // Git reports binary files as "-\t-". They still count as changed
        // files even though a meaningful line total is unavailable.
        if (!/^\d+$/.test(addedRaw ?? '') || !/^\d+$/.test(deletedRaw ?? '')) continue;
        const added = Number(addedRaw);
        const deleted = Number(deletedRaw);
        const modified = Math.min(added, deleted);
        additions += added - modified;
        modifications += modified;
        deletions += deleted - modified;
      }
      return {
        files,
        additions,
        modifications,
        deletions,
        total: additions + modifications + deletions,
      };
    } catch {
      return null;
    }
  }

  private currentRevisionOrNull(record: ChangeRequestRecord): ChangeRequestRevisionRecord | null {
    return this.deps.repository.getRevision(record.id, record.revision);
  }

  private currentRevision(record: ChangeRequestRecord): ChangeRequestRevisionRecord {
    const revision = this.currentRevisionOrNull(record);
    if (!revision) {
      throw new ChangeRequestError(
        'Change request revision is unavailable.',
        409,
        'revision_missing',
      );
    }
    return revision;
  }

  private requiredRevision(
    record: ChangeRequestRecord,
    revisionNumberRaw?: unknown,
  ): ChangeRequestRevisionRecord {
    const requested = Number(revisionNumberRaw);
    const revisionNumber =
      revisionNumberRaw === undefined || revisionNumberRaw === null || revisionNumberRaw === ''
        ? record.revision
        : requested;
    if (!Number.isSafeInteger(revisionNumber) || revisionNumber <= 0) {
      throw new ChangeRequestError('revision must be a positive integer');
    }
    const revision = this.deps.repository.getRevision(record.id, revisionNumber);
    if (!revision) {
      throw new ChangeRequestError(
        `unknown change request revision: ${revisionNumber}`,
        404,
        'revision_not_found',
      );
    }
    return revision;
  }

  private revisionGitRoot(
    record: ChangeRequestRecord,
    revision: ChangeRequestRevisionRecord,
  ): string {
    return revision.objectStorePath || record.repoRoot;
  }

  private async revisionView(
    record: ChangeRequestRecord,
    revision: ChangeRequestRevisionRecord,
  ): Promise<ChangeRequestRevisionView> {
    const {
      requestId: _requestId,
      snapshotRef: _snapshotRef,
      sourceRef: _sourceRef,
      objectStorePath: _objectStorePath,
      ...publicRevision
    } = revision;
    return {
      ...publicRevision,
      commits: await this.sourceCommits(record, revision),
    };
  }

  private async sourceCommits(
    record: ChangeRequestRecord,
    revision: ChangeRequestRevisionRecord,
  ): Promise<ChangeRequestSourceCommit[]> {
    if (revision.sourceRef === revision.snapshotRef) return [];
    try {
      const result = await this.git(this.revisionGitRoot(record, revision), [
        'log',
        '--reverse',
        '--max-count=500',
        '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e',
        `${revision.baseSha}..${revision.sourceRef}`,
      ]);
      return result.stdout
        .split('\x1e')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .flatMap((entry) => {
          const [sha, parents, authorName, authorEmail, authoredAt, subject] = entry.split('\x1f');
          if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return [];
          return [
            {
              sha: sha!,
              parentShas: String(parents ?? '')
                .split(/\s+/)
                .filter(Boolean),
              authorName: String(authorName ?? ''),
              authorEmail: String(authorEmail ?? ''),
              authoredAt: String(authoredAt ?? ''),
              subject: String(subject ?? ''),
            },
          ];
        });
    } catch {
      return [];
    }
  }

  private githubMirrorView(record: ChangeRequestRecord): ChangeRequestView['githubMirror'] {
    return record.githubMirror
      ? {
          ...record.githubMirror,
          outOfDate:
            record.githubMirror.syncedRevision !== record.revision ||
            record.githubMirror.syncedNativeUpdatedAt !== record.updatedAt,
        }
      : null;
  }

  private async git(repoRoot: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
    return await runChangeRequestGit(this.deps.runHostCommand, repoRoot, args, timeoutMs);
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return await this.operationLock.withLock(id, operation);
  }
}

async function mapWithConcurrency<T, Result>(
  items: T[],
  limit: number,
  operation: (item: T) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
