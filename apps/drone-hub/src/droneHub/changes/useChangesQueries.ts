import { useQuery, type QueryKey } from '@tanstack/react-query';
import { requestJson } from '../http';
import type {
  RepoChangesPayload,
  RepoCommitChangesPayload,
  RepoCommitListPayload,
  RepoPullChangesPayload,
  RepoPullRequestChangesPayload,
  RepoPullRequestCommitChangesPayload,
  RepoPullRequestCommitListPayload,
} from '../types';
import type { ChangesDataMode } from './helpers';

const CHANGES_STALE_TIME_MS = 12_000;
const WORKING_TREE_POLL_INTERVAL_MS = 5_000;
const PULL_PREVIEW_POLL_INTERVAL_MS = 10_000;

type ChangesContextMode = 'branch' | 'pull-request';
type ChangesPrimaryView = 'changes' | 'commits';
type Successful<T> = Extract<T, { ok: true }>;

type ChangesQueryOptions = {
  droneId: string;
  repoPath: string;
  repoAttached: boolean;
  disabled: boolean;
  dataMode: ChangesDataMode;
  contextMode: ChangesContextMode;
  primaryView: ChangesPrimaryView;
  pullRequestNumber: number | null;
  selectedCommitSha: string | null;
};

export const changesQueryKeys = {
  drone: (droneId: string) => ['drone-changes', droneId] as const,
  workingTree: (droneId: string, repoPath: string) =>
    [...changesQueryKeys.drone(droneId), 'working-tree', repoPath] as const,
  pullPreview: (droneId: string, repoPath: string) =>
    [...changesQueryKeys.drone(droneId), 'pull-preview', repoPath] as const,
  pullRequest: (droneId: string, repoPath: string, pullNumber: number | null) =>
    [...changesQueryKeys.drone(droneId), 'pull-request', repoPath, pullNumber] as const,
  branchCommits: (droneId: string, repoPath: string) =>
    [...changesQueryKeys.drone(droneId), 'branch-commits', repoPath] as const,
  pullRequestCommits: (droneId: string, repoPath: string, pullNumber: number | null) =>
    [...changesQueryKeys.drone(droneId), 'pull-request-commits', repoPath, pullNumber] as const,
  branchCommit: (droneId: string, repoPath: string, sha: string | null) =>
    [...changesQueryKeys.drone(droneId), 'branch-commit', repoPath, sha] as const,
  pullRequestCommit: (droneId: string, repoPath: string, pullNumber: number | null, sha: string | null) =>
    [...changesQueryKeys.drone(droneId), 'pull-request-commit', repoPath, pullNumber, sha] as const,
};

export function useChangesQueries(options: ChangesQueryOptions) {
  const {
    droneId,
    repoPath,
    repoAttached,
    disabled,
    dataMode,
    contextMode,
    primaryView,
    pullRequestNumber,
    selectedCommitSha,
  } = options;
  const available = repoAttached && !disabled;
  const encodedDroneId = encodeURIComponent(droneId);

  const workingTree = useChangesResourceQuery<Successful<RepoChangesPayload>>({
    queryKey: changesQueryKeys.workingTree(droneId, repoPath),
    url: `/api/drones/${encodedDroneId}/repo/changes`,
    enabled: available && primaryView === 'changes' && dataMode === 'working-tree',
    refetchInterval: WORKING_TREE_POLL_INTERVAL_MS,
  });
  const pullPreview = useChangesResourceQuery<Successful<RepoPullChangesPayload>>({
    queryKey: changesQueryKeys.pullPreview(droneId, repoPath),
    url: `/api/drones/${encodedDroneId}/repo/pull/changes`,
    enabled: available && primaryView === 'changes' && dataMode === 'pull-preview',
    refetchInterval: PULL_PREVIEW_POLL_INTERVAL_MS,
  });
  const pullRequest = useChangesResourceQuery<Successful<RepoPullRequestChangesPayload>>({
    queryKey: changesQueryKeys.pullRequest(droneId, repoPath, pullRequestNumber),
    url: `/api/drones/${encodedDroneId}/repo/pull-requests/${pullRequestNumber}/changes`,
    enabled: available && dataMode === 'pull-request' && Boolean(pullRequestNumber),
  });
  const branchCommits = useChangesResourceQuery<Successful<RepoCommitListPayload>>({
    queryKey: changesQueryKeys.branchCommits(droneId, repoPath),
    url: `/api/drones/${encodedDroneId}/repo/commits?limit=100`,
    enabled: available && primaryView === 'commits' && contextMode === 'branch',
  });
  const pullRequestCommits = useChangesResourceQuery<Successful<RepoPullRequestCommitListPayload>>({
    queryKey: changesQueryKeys.pullRequestCommits(droneId, repoPath, pullRequestNumber),
    url: `/api/drones/${encodedDroneId}/repo/pull-requests/${pullRequestNumber}/commits`,
    enabled: available && primaryView === 'commits' && contextMode === 'pull-request' && Boolean(pullRequestNumber),
  });
  const branchCommit = useChangesResourceQuery<Successful<RepoCommitChangesPayload>>({
    queryKey: changesQueryKeys.branchCommit(droneId, repoPath, selectedCommitSha),
    url: `/api/drones/${encodedDroneId}/repo/commits/${encodeURIComponent(selectedCommitSha ?? '')}/changes`,
    enabled: available && primaryView === 'commits' && contextMode === 'branch' && Boolean(selectedCommitSha),
  });
  const pullRequestCommit = useChangesResourceQuery<Successful<RepoPullRequestCommitChangesPayload>>({
    queryKey: changesQueryKeys.pullRequestCommit(droneId, repoPath, pullRequestNumber, selectedCommitSha),
    url: `/api/drones/${encodedDroneId}/repo/pull-requests/${pullRequestNumber}/commits/${encodeURIComponent(selectedCommitSha ?? '')}/changes`,
    enabled:
      available &&
      primaryView === 'commits' &&
      contextMode === 'pull-request' &&
      Boolean(pullRequestNumber) &&
      Boolean(selectedCommitSha),
  });

  return {
    changes: available ? workingTree.data ?? null : null,
    changesLoading: workingTree.isLoading,
    changesError: available ? errorMessage(workingTree.error) : null,
    pullChanges: available ? pullPreview.data ?? null : null,
    pullLoading: pullPreview.isLoading,
    pullError: available ? errorMessage(pullPreview.error) : null,
    pullRequestChanges: available ? pullRequest.data ?? null : null,
    pullRequestLoading: pullRequest.isLoading,
    pullRequestError: available ? pullRequestErrorMessage(pullRequest.error, pullRequestNumber) : null,
    branchCommitList: available ? branchCommits.data ?? null : null,
    branchCommitListLoading: branchCommits.isLoading,
    branchCommitListError: available ? errorMessage(branchCommits.error) : null,
    pullRequestCommitList: available ? pullRequestCommits.data ?? null : null,
    pullRequestCommitListLoading: pullRequestCommits.isLoading,
    pullRequestCommitListError: available ? errorMessage(pullRequestCommits.error) : null,
    branchCommitDetails: available ? branchCommit.data ?? null : null,
    branchCommitDetailsLoading: branchCommit.isLoading,
    branchCommitDetailsError: available ? errorMessage(branchCommit.error) : null,
    pullRequestCommitDetails: available ? pullRequestCommit.data ?? null : null,
    pullRequestCommitDetailsLoading: pullRequestCommit.isLoading,
    pullRequestCommitDetailsError: available ? errorMessage(pullRequestCommit.error) : null,
  };
}

function useChangesResourceQuery<T>(options: {
  queryKey: QueryKey;
  url: string;
  enabled: boolean;
  refetchInterval?: number;
}) {
  return useQuery<T, Error>({
    queryKey: options.queryKey,
    queryFn: ({ signal }) => requestJson<T>(options.url, { signal }),
    enabled: options.enabled,
    refetchInterval: options.refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: CHANGES_STALE_TIME_MS,
  });
}

function errorMessage(error: Error | null): string | null {
  return error?.message ?? null;
}

function pullRequestErrorMessage(error: Error | null, pullNumber: number | null): string | null {
  if (!error) return null;
  if (Number((error as Error & { status?: number }).status) === 404) {
    return `PR #${pullNumber} was not found on GitHub (it may have been deleted or is inaccessible).`;
  }
  return error.message;
}
