import React from 'react';
import {
  UiPaneState,
  UiCenteredLoadingState,
  UiPanel,
  UiPanelStatusStrip,
  UiToolbarButton,
} from '../../ui/components';
import { requestJson } from '../http';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import type {
  RepoPullRequestClosePayload,
  RepoPullRequestMergeMethod,
  RepoPullRequestMergePayload,
  RepoPullRequestSummary,
  RepoPullRequestsPayload,
} from '../types';
import {
  CHANGES_OPEN_PULL_REQUEST_EVENT,
  clearSelectedPullRequestForDrone,
  requestChangesPullRequest,
  selectedPullRequestForDrone,
  type ChangesOpenPullRequestDetail,
} from '../changes/navigation';
import { PullRequestListView } from './PullRequestListView';
import { readPullRequestMergeMethod, writePullRequestMergeMethod } from './pull-request-preferences';
import { mergeBlockedReason } from './pull-request-ui';

const PR_LIST_CACHE_TTL_MS = 12_000;
const PR_LIST_POLL_INTERVAL_MS = 20_000;

const LazyDroneChangesDock = React.lazy(async () => ({
  default: (await import('../changes/DroneChangesDock')).DroneChangesDock,
}));

type PullRequestListDiagnostics = {
  repoRoot: string | null;
  origin: string | null;
  github: { owner: string; repo: string } | null;
};

type BulkActionState = {
  kind: 'merge' | 'close';
  total: number;
  done: number;
};

type PullRequestListCacheEntry = {
  atMs: number;
  payload: Extract<RepoPullRequestsPayload, { ok: true }>;
};

const pullRequestListCache = new Map<string, PullRequestListCacheEntry>();

function normalizePullRequestListCacheKey(repoPath: string, droneId: string): string {
  return String(repoPath ?? '').trim() || `drone:${String(droneId ?? '').trim()}`;
}

function freshPullRequestListCache(repoCacheKey: string): Extract<RepoPullRequestsPayload, { ok: true }> | null {
  const cached = pullRequestListCache.get(repoCacheKey);
  if (!cached || Date.now() - cached.atMs >= PR_LIST_CACHE_TTL_MS) return null;
  return cached.payload;
}

function writePullRequestListCache(repoCacheKey: string, payload: Extract<RepoPullRequestsPayload, { ok: true }>): void {
  if (!repoCacheKey) return;
  if (pullRequestListCache.size > 100) pullRequestListCache.clear();
  pullRequestListCache.set(repoCacheKey, { atMs: Date.now(), payload });
}

function normalizePullRequestListDiagnostics(raw: any): PullRequestListDiagnostics | null {
  if (!raw || typeof raw !== 'object') return null;
  const repoRoot = String(raw?.repoRoot ?? '').trim() || null;
  const origin = String(raw?.origin ?? '').trim() || null;
  const owner = String(raw?.github?.owner ?? '').trim();
  const repo = String(raw?.github?.repo ?? '').trim();
  const github = owner && repo ? { owner, repo } : null;
  if (!repoRoot && !origin && !github) return null;
  return { repoRoot, origin, github };
}

export function DronePullRequestsDock({
  droneId,
  repoAttached,
  repoPath,
  repoUnavailableReason,
  disabled,
  hubPhase,
  hubMessage,
  onOpenPullRequest,
  onRevealFileInFiles,
  onOpenFileInEditor,
}: {
  droneId: string;
  droneName: string;
  repoAttached: boolean;
  repoPath: string;
  repoUnavailableReason?: string | null;
  disabled: boolean;
  hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
  onOpenPullRequest?: (pullRequest: RepoPullRequestSummary) => void;
  onRevealFileInFiles: (repoRelativePath: string) => void;
  onOpenFileInEditor: (repoRelativePath: string) => void;
}) {
  const confirm = useAppConfirmDialog();
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [activePullRequestNumber, setActivePullRequestNumber] = React.useState<number | null>(() => selectedPullRequestForDrone(droneId));
  const [listData, setListData] = React.useState<Extract<RepoPullRequestsPayload, { ok: true }> | null>(null);
  const [listLoading, setListLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listErrorCode, setListErrorCode] = React.useState<string | null>(null);
  const [listErrorDiagnostics, setListErrorDiagnostics] = React.useState<PullRequestListDiagnostics | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  const [busyByPullNumber, setBusyByPullNumber] = React.useState<Record<number, 'merge' | 'close'>>({});
  const [bulkAction, setBulkAction] = React.useState<BulkActionState | null>(null);
  const [selectedPullNumbers, setSelectedPullNumbers] = React.useState<Set<number>>(
    () => new Set(),
  );
  const [query, setQuery] = React.useState('');
  const lastRefreshNonceRef = React.useRef(refreshNonce);
  const repoCacheKey = React.useMemo(() => normalizePullRequestListCacheKey(repoPath, droneId), [droneId, repoPath]);
  const lastRepoCacheKeyRef = React.useRef(repoCacheKey);
  const [mergeMethod, setMergeMethod] = React.useState<RepoPullRequestMergeMethod>(readPullRequestMergeMethod);

  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000pull-requests`,
    timeoutMs: 18_000,
  });

  React.useEffect(() => {
    writePullRequestMergeMethod(mergeMethod);
  }, [mergeMethod]);

  React.useEffect(() => {
    setActivePullRequestNumber(selectedPullRequestForDrone(droneId));
  }, [droneId]);

  React.useEffect(() => {
    const onOpenPullRequestEvent = (event: Event) => {
      const detail = (event as CustomEvent<ChangesOpenPullRequestDetail>).detail;
      if (!detail || String(detail.droneId ?? '').trim() !== String(droneId ?? '').trim()) return;
      const pullNumber = Number(detail.pullNumber);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      setActivePullRequestNumber(Math.floor(pullNumber));
    };
    window.addEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequestEvent as EventListener);
    return () => window.removeEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequestEvent as EventListener);
  }, [droneId]);

  React.useEffect(() => {
    if (!actionNotice) return;
    const timer = setTimeout(() => setActionNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [actionNotice]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      setListData(null);
      setListError(null);
      setListErrorCode(null);
      setListErrorDiagnostics(null);
      setListLoading(false);
      return;
    }

    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const forceInitialLoad = refreshNonce !== lastRefreshNonceRef.current;
    lastRefreshNonceRef.current = refreshNonce;
    const repoChanged = repoCacheKey !== lastRepoCacheKeyRef.current;
    lastRepoCacheKeyRef.current = repoCacheKey;
    const cached = forceInitialLoad ? null : freshPullRequestListCache(repoCacheKey);
    if (cached) {
      setListData(cached);
      setListError(null);
      setListErrorCode(null);
      setListErrorDiagnostics(null);
      setListLoading(false);
      startup.markReady();
    } else if (repoChanged) {
      setListData(null);
      setListError(null);
      setListErrorCode(null);
      setListErrorDiagnostics(null);
    }

    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = freshPullRequestListCache(repoCacheKey);
        if (fresh) {
          setListData(fresh);
          setListError(null);
          setListErrorCode(null);
          setListErrorDiagnostics(null);
          setListLoading(false);
          startup.markReady();
          return;
        }
      }
      if (!silent) setListLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestsPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests?state=open`,
        );
        if (!mounted) return;
        writePullRequestListCache(repoCacheKey, data);
        setListData(data);
        setListError(null);
        setListErrorCode(null);
        setListErrorDiagnostics(null);
        startup.markReady();
      } catch (e: any) {
        if (!mounted) return;
        if (startup.suppressErrors) {
          setListError(null);
          setListErrorCode(null);
          setListErrorDiagnostics(null);
        } else {
          setListError(e?.message ?? String(e));
          const code = String(e?.data?.code ?? '').trim();
          setListErrorCode(code || null);
          setListErrorDiagnostics(normalizePullRequestListDiagnostics(e?.data?.diagnostics));
        }
      } finally {
        if (mounted && !silent) setListLoading(false);
      }
    };

    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);
    timer = setInterval(() => {
      void load(true);
    }, PR_LIST_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [disabled, droneId, refreshNonce, repoAttached, repoCacheKey, startup.markReady, startup.suppressErrors]);

  const pullRequests = React.useMemo(() => listData?.pullRequests ?? [], [listData]);
  const anyBusy = bulkAction != null || Object.keys(busyByPullNumber).length > 0;
  const selectedPullRequests = React.useMemo(
    () => pullRequests.filter((pullRequest) => selectedPullNumbers.has(pullRequest.number)),
    [pullRequests, selectedPullNumbers],
  );
  const mergeablePullRequests = React.useMemo(
    () => selectedPullRequests.filter((pr) => !mergeBlockedReason(pr)),
    [selectedPullRequests],
  );
  const blockedMergeCount = Math.max(
    0,
    selectedPullRequests.length - mergeablePullRequests.length,
  );
  const blockedConflictCount = React.useMemo(
    () => selectedPullRequests.filter((pr) => pr.hasMergeConflicts).length,
    [selectedPullRequests],
  );
  const blockedPolicyCount = Math.max(0, blockedMergeCount - blockedConflictCount);
  const filteredPullRequests = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return pullRequests;
    return pullRequests.filter((pullRequest) =>
      [
        pullRequest.title,
        pullRequest.authorLogin,
        pullRequest.headRefName,
        pullRequest.baseRefName,
        `#${pullRequest.number}`,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [pullRequests, query]);
  const unavailableReason = String(repoUnavailableReason ?? '').trim();

  React.useEffect(() => {
    const available = new Set(pullRequests.map((pullRequest) => pullRequest.number));
    setSelectedPullNumbers((current) => {
      const next = new Set([...current].filter((number) => available.has(number)));
      return next.size === current.size ? current : next;
    });
  }, [pullRequests]);

  const requestMergePullRequest = React.useCallback(
    async (pullNumber: number) =>
      requestJson<Extract<RepoPullRequestMergePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${pullNumber}/merge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: mergeMethod }),
        },
      ),
    [droneId, mergeMethod],
  );

  const requestClosePullRequest = React.useCallback(
    async (pullNumber: number) =>
      requestJson<Extract<RepoPullRequestClosePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${pullNumber}/close`,
        { method: 'POST' },
      ),
    [droneId],
  );

  const mergeSelectedPullRequests = React.useCallback(async () => {
    if (anyBusy) return;
    const queue = mergeablePullRequests
      .map((pr) => Number(pr?.number))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.floor(n));
    if (queue.length === 0) {
      setActionError(
        'No selected pull requests can be merged because they are blocked by conflicts, draft state, or requested changes.',
      );
      return;
    }
    const skipLabel =
      blockedMergeCount > 0
        ? ` (${blockedMergeCount} blocked will be skipped${blockedConflictCount > 0 || blockedPolicyCount > 0 ? `: ${blockedConflictCount} conflicts, ${blockedPolicyCount} policy` : ''})`
        : '';
    if (
      !(await confirm({
        title: `Merge ${queue.length} pull request${queue.length === 1 ? '' : 's'}?`,
        message: `Merge ${queue.length} selected pull request${queue.length === 1 ? '' : 's'} using ${mergeMethod === 'merge' ? 'merge commits' : mergeMethod === 'squash' ? 'squash merging' : 'rebasing'}${skipLabel}.`,
        confirmLabel: `Merge ${queue.length}`,
      }))
    )
      return;

    setActionError(null);
    setActionNotice(null);
    setBulkAction({ kind: 'merge', total: queue.length, done: 0 });

    let successCount = 0;
    const failures: string[] = [];

    for (let i = 0; i < queue.length; i += 1) {
      const pullNumber = queue[i];
      setBusyByPullNumber((prev) => ({ ...prev, [pullNumber]: 'merge' }));
      try {
        await requestMergePullRequest(pullNumber);
        successCount += 1;
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? 'merge failed').trim() || 'merge failed';
        failures.push(`#${pullNumber}: ${msg}`);
      } finally {
        setBusyByPullNumber((prev) => {
          const next = { ...prev };
          delete next[pullNumber];
          return next;
        });
        setBulkAction((prev) => (prev ? { ...prev, done: i + 1 } : prev));
      }
    }

    setBulkAction(null);
    setSelectedPullNumbers(new Set());
    setRefreshNonce((n) => n + 1);

    if (failures.length === 0) {
      const skipped =
        blockedMergeCount > 0
          ? ` Skipped ${blockedMergeCount} blocked (${blockedConflictCount} conflicts, ${blockedPolicyCount} policy).`
          : '';
      setActionNotice(`Merged ${successCount} pull requests.${skipped}`);
      return;
    }
    const skipped =
      blockedMergeCount > 0
        ? ` Skipped ${blockedMergeCount} blocked (${blockedConflictCount} conflicts, ${blockedPolicyCount} policy).`
        : '';
    setActionNotice(`Merged ${successCount} of ${queue.length} pull requests.${skipped}`);
    setActionError(`Bulk merge finished with ${failures.length} failure(s): ${failures.slice(0, 3).join(' | ')}`);
  }, [anyBusy, blockedConflictCount, blockedMergeCount, blockedPolicyCount, confirm, mergeMethod, mergeablePullRequests, requestMergePullRequest]);

  const closeSelectedPullRequests = React.useCallback(async () => {
    if (anyBusy) return;
    const queue = selectedPullRequests
      .map((pr) => Number(pr?.number))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.floor(n));
    if (queue.length === 0) return;
    if (
      !(await confirm({
        title: `Close ${queue.length} pull request${queue.length === 1 ? '' : 's'}?`,
        message: `This closes ${queue.length === 1 ? 'the selected pull request' : `all ${queue.length} selected pull requests`} without merging ${queue.length === 1 ? 'it' : 'them'}.`,
        confirmLabel: `Close ${queue.length}`,
        destructive: true,
      }))
    )
      return;

    setActionError(null);
    setActionNotice(null);
    setBulkAction({ kind: 'close', total: queue.length, done: 0 });

    let successCount = 0;
    const failures: string[] = [];

    for (let i = 0; i < queue.length; i += 1) {
      const pullNumber = queue[i];
      setBusyByPullNumber((prev) => ({ ...prev, [pullNumber]: 'close' }));
      try {
        await requestClosePullRequest(pullNumber);
        successCount += 1;
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? 'close failed').trim() || 'close failed';
        failures.push(`#${pullNumber}: ${msg}`);
      } finally {
        setBusyByPullNumber((prev) => {
          const next = { ...prev };
          delete next[pullNumber];
          return next;
        });
        setBulkAction((prev) => (prev ? { ...prev, done: i + 1 } : prev));
      }
    }

    setBulkAction(null);
    setSelectedPullNumbers(new Set());
    setRefreshNonce((n) => n + 1);

    if (failures.length === 0) {
      setActionNotice(`Closed ${successCount} pull requests.`);
      return;
    }
    setActionNotice(`Closed ${successCount} of ${queue.length} pull requests.`);
    setActionError(`Bulk close finished with ${failures.length} failure(s): ${failures.slice(0, 3).join(' | ')}`);
  }, [anyBusy, confirm, requestClosePullRequest, selectedPullRequests]);

  const bulkActionLabel = React.useMemo(() => {
    if (!bulkAction) return null;
    const verb = bulkAction.kind === 'merge' ? 'Merging' : 'Closing';
    return `${verb} ${bulkAction.done}/${bulkAction.total}...`;
  }, [bulkAction]);

  const openPullRequest = React.useCallback(
    (pr: RepoPullRequestSummary) => {
      const pullNumber = Number(pr?.number);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      const normalizedPullNumber = Math.floor(pullNumber);
      setActivePullRequestNumber(normalizedPullNumber);
      requestChangesPullRequest({ droneId, pullNumber: normalizedPullNumber });
      onOpenPullRequest?.(pr);
    },
    [droneId, onOpenPullRequest],
  );

  const closeDetailView = React.useCallback(() => {
    clearSelectedPullRequestForDrone(droneId);
    setActivePullRequestNumber(null);
    setRefreshNonce((n) => n + 1);
  }, [droneId]);

  return (
    <UiPanel flush surface="alternate" className="relative h-full w-full">
      {activePullRequestNumber ? (
        <React.Suspense
          fallback={
            <UiCenteredLoadingState message="Loading pull request…" />
          }
        >
          <LazyDroneChangesDock
            droneId={droneId}
            repoAttached={repoAttached}
            repoPath={repoPath}
            repoUnavailableReason={repoUnavailableReason}
            fixedContextMode="pull-request"
            onReviewBack={closeDetailView}
            disabled={disabled}
            hubPhase={hubPhase}
            hubMessage={hubMessage}
            onRevealFileInFiles={onRevealFileInFiles}
            onOpenFileInEditor={onOpenFileInEditor}
          />
        </React.Suspense>
      ) : (
        <>
          {actionNotice ? (
            <UiPanelStatusStrip tone="success">{actionNotice}</UiPanelStatusStrip>
          ) : null}
          {actionError ? (
            <UiPanelStatusStrip tone="danger">{actionError}</UiPanelStatusStrip>
          ) : null}
          {bulkActionLabel ? (
            <UiPanelStatusStrip tone="info">{bulkActionLabel}</UiPanelStatusStrip>
          ) : null}

          {!repoAttached ? (
            <UiPaneState
              kind="unavailable"
              title="Repository unavailable"
              description={unavailableReason || 'Attach a repo to manage pull requests.'}
            />
          ) : disabled ? (
            <UiPaneState
              kind={startup.timedOut ? 'warning' : 'loading'}
              title={provisioningLabel(hubPhase)}
              description={[
                startup.timedOut
                  ? 'Still waiting for the repository to become available.'
                  : 'Waiting for repository…',
                String(hubMessage ?? '').trim(),
              ].filter(Boolean).join(' ')}
            />
          ) : listError ? (
            <UiPaneState
              kind="error"
              title="Could not load pull requests"
              description={
                <span>
                  {listError}
                  {listErrorCode ? ` Code: ${listErrorCode}.` : ''}
                  {listErrorDiagnostics?.repoRoot ? ` Repo: ${listErrorDiagnostics.repoRoot}.` : ''}
                  {listErrorDiagnostics?.origin ? ` Origin: ${listErrorDiagnostics.origin}.` : ''}
                  {listErrorDiagnostics?.github
                    ? ` GitHub: ${listErrorDiagnostics.github.owner}/${listErrorDiagnostics.github.repo}.`
                    : ''}
                </span>
              }
              action={
                <UiToolbarButton onClick={() => setRefreshNonce((n) => n + 1)}>
                  Try again
                </UiToolbarButton>
              }
            />
          ) : listLoading && !listData ? (
            <UiCenteredLoadingState message="Loading pull requests…" />
          ) : (
            <PullRequestListView
              pullRequests={filteredPullRequests}
              openCount={pullRequests.length}
              selectedNumbers={selectedPullNumbers}
              onSelectedNumbersChange={setSelectedPullNumbers}
              query={query}
              onQueryChange={setQuery}
              mergeMethod={mergeMethod}
              onMergeMethodChange={setMergeMethod}
              onOpenPullRequest={openPullRequest}
              onMergeSelected={() => {
                void mergeSelectedPullRequests();
              }}
              onCloseSelected={() => {
                void closeSelectedPullRequests();
              }}
              onRefresh={() => setRefreshNonce((n) => n + 1)}
              refreshLoading={listLoading}
              mergeDisabled={
                !repoAttached ||
                disabled ||
                mergeablePullRequests.length === 0 ||
                anyBusy ||
                Boolean(listError)
              }
              closeDisabled={
                !repoAttached ||
                disabled ||
                selectedPullRequests.length === 0 ||
                anyBusy ||
                Boolean(listError)
              }
              mergeLoading={bulkAction?.kind === 'merge'}
              closeLoading={bulkAction?.kind === 'close'}
            />
          )}
        </>
      )}
    </UiPanel>
  );
}
