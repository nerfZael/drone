import { ChangeRequestError } from './change-request-error';
import {
  resolveChangeRequestBranch,
  resolveChangeRequestCommit,
  runChangeRequestGit,
  type RunHostCommand,
} from './change-request-git';
import { prepareChangeRequestCandidate } from './prepare-change-request-candidate';
import type { ChangeRequestRecord, ChangeRequestRevisionRecord } from './change-request-types';

export type ChangeRequestDirectMergerDependencies = {
  runHostCommand: RunHostCommand;
};

const MERGE_TIMEOUT_MS = 120_000;

export class ChangeRequestDirectMerger {
  constructor(private readonly deps: ChangeRequestDirectMergerDependencies) {}

  async merge(
    record: ChangeRequestRecord,
    commitMessage: string,
    revision?: ChangeRequestRevisionRecord,
    onPrepared?: (prepared: { expectedTargetSha: string; mergeCommitSha: string }) => Promise<void>,
    expectedDestinationSha?: string,
    expectedCandidateTreeSha?: string,
  ): Promise<string> {
    const gitRoot = revision?.objectStorePath || record.repoRoot;
    const snapshotRef = revision?.snapshotRef || record.snapshotRef;
    await this.git(gitRoot, ['fetch', 'origin', '--prune'], MERGE_TIMEOUT_MS);
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
    const targetSha = await resolveChangeRequestCommit(
      this.deps.runHostCommand,
      gitRoot,
      targetRef,
    );
    if (!targetSha) {
      throw new ChangeRequestError(
        'Unable to resolve merge destination.',
        409,
        'destination_missing',
      );
    }
    const expectedTarget = String(expectedDestinationSha ?? '')
      .trim()
      .toLowerCase();
    if (expectedTarget && targetSha !== expectedTarget) {
      throw new ChangeRequestError(
        'The destination changed after the reviewed candidate was prepared. Prepare and review it again before merging.',
        409,
        'review_candidate_outdated',
        { expectedDestinationSha: expectedTarget, destinationSha: targetSha },
      );
    }
    const candidate = await prepareChangeRequestCandidate(this.deps.runHostCommand, {
      gitRoot,
      baseSha: targetSha,
      snapshotRef: snapshotRef!,
      timeoutMs: MERGE_TIMEOUT_MS,
    });
    if (candidate.status === 'conflicted') {
      throw new ChangeRequestError(
        'The change request conflicts with its destination.',
        409,
        'merge_conflict',
        { conflictFiles: candidate.conflictFiles },
      );
    }
    const expectedTree = String(expectedCandidateTreeSha ?? '')
      .trim()
      .toLowerCase();
    if (expectedTree && candidate.candidateTreeSha !== expectedTree) {
      throw new ChangeRequestError(
        'The prepared merge tree differs from the reviewed candidate. Prepare and review it again before merging.',
        409,
        'review_candidate_outdated',
        {
          expectedCandidateTreeSha: expectedTree,
          candidateTreeSha: candidate.candidateTreeSha,
        },
      );
    }
    const mergeCommitSha = candidate.changed
      ? (
          await this.git(
            gitRoot,
            [
              'commit-tree',
              candidate.candidateTreeSha,
              '-p',
              targetSha,
              '-m',
              requiredCommitMessage(commitMessage),
            ],
            MERGE_TIMEOUT_MS,
          )
        ).stdout
          .trim()
          .toLowerCase()
      : targetSha;
    const committedTreeSha = (
      await this.git(gitRoot, ['rev-parse', `${mergeCommitSha}^{tree}`])
    ).stdout
      .trim()
      .toLowerCase();
    if (committedTreeSha !== candidate.candidateTreeSha) {
      throw new ChangeRequestError(
        'The merge tree changed while its commit was being created.',
        409,
        'merge_tree_changed',
      );
    }
    await onPrepared?.({ expectedTargetSha: targetSha, mergeCommitSha });
    await this.git(
      gitRoot,
      [
        'push',
        destinationRef
          ? `--force-with-lease=refs/heads/${record.destinationBranch}:${targetSha}`
          : `--force-with-lease=refs/heads/${record.destinationBranch}:`,
        'origin',
        `${mergeCommitSha}:refs/heads/${record.destinationBranch}`,
      ],
      MERGE_TIMEOUT_MS,
    );
    return mergeCommitSha;
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
