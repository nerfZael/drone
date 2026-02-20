import React from 'react';
import { requestJson } from '../http';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import type {
  RepoPullRequestClosePayload,
  RepoPullRequestMergeMethod,
  RepoPullRequestMergePayload,
  RepoPullRequestSummary,
  RepoPullRequestsPayload,
} from '../types';
import { requestChangesPullRequest } from '../changes/navigation';

const PR_MERGE_METHOD_STORAGE_KEY = 'droneHub.prMergeMethod';

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

function formatTimestamp(iso: string): string {
  const text = String(iso ?? '').trim();
  if (!text) return '-';
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return text;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return text;
  }
}

function shortBranchName(raw: string, maxLen: number = 36): string {
  const text = String(raw ?? '').trim();
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function MetaChip({
  label,
  value,
  title,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1.5 py-[1px] text-[10px] ${
        mono ? 'font-mono' : ''
      }`}
      title={title}
    >
      <span className="uppercase tracking-[0.08em] text-[var(--muted-dim)]">{label}</span>
      <span className="text-[var(--fg-secondary)]">{value}</span>
    </span>
  );
}

function pullRequestStatusBadges(pr: RepoPullRequestSummary): Array<{ key: string; label: string; className: string }> {
  const out: Array<{ key: string; label: string; className: string }> = [];
  if (pr.draft) {
    out.push({
      key: 'draft',
      label: 'Draft',
      className: 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
    });
  }
  if (pr.checksState === 'failing') {
    out.push({
      key: 'checks_failing',
      label: 'Checks failing',
      className: 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]',
    });
  } else if (pr.checksState === 'pending') {
    out.push({
      key: 'checks_pending',
      label: 'Checks pending',
      className: 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
    });
  }
  if (pr.reviewState === 'approved') {
    out.push({
      key: 'approved',
      label: 'Approved',
      className: 'border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)]',
    });
  } else if (pr.reviewState === 'changes_requested') {
    out.push({
      key: 'changes_requested',
      label: 'Changes requested',
      className: 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]',
    });
  } else if (pr.reviewState === 'review_required') {
    out.push({
      key: 'review_required',
      label: 'Review required',
      className: 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
    });
  }
  if (pr.hasMergeConflicts) {
    out.push({
      key: 'merge_conflict',
      label: 'Merge conflict',
      className: 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]',
    });
  }
  return out;
}

function mergeBlockedReason(pr: RepoPullRequestSummary): string | null {
  if (pr.hasMergeConflicts) return 'merge conflicts detected';
  if (pr.draft) return 'pull request is in draft state';
  if (pr.reviewState === 'changes_requested') return 'review has changes requested';
  return null;
}

function forceMergeReason(pr: RepoPullRequestSummary): string | null {
  if (pr.checksState === 'failing') return 'checks are failing';
  if (pr.checksState === 'pending') return 'checks are still pending';
  return null;
}

function PullRequestStatusBadgeStrip({ pullRequest }: { pullRequest: RepoPullRequestSummary }) {
  const badges = pullRequestStatusBadges(pullRequest);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((badge) => (
        <span
          key={`pr-badge-${pullRequest.number}-${badge.key}`}
          className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] ${badge.className}`}
          title={badge.label}
        >
          {badge.label}
        </span>
      ))}
    </>
  );
}

export function DronePullRequestsDock({
  droneId,
  droneName,
  repoAttached,
  repoPath,
  disabled,
  hubPhase,
  hubMessage,
  onOpenPullRequestInChanges,
}: {
  droneId: string;
  droneName: string;
  repoAttached: boolean;
  repoPath: string;
  disabled: boolean;
  hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
  onOpenPullRequestInChanges?: (pullRequest: RepoPullRequestSummary) => void;
}) {
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [listData, setListData] = React.useState<Extract<RepoPullRequestsPayload, { ok: true }> | null>(null);
  const [listLoading, setListLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listErrorCode, setListErrorCode] = React.useState<string | null>(null);
  const [listErrorDiagnostics, setListErrorDiagnostics] = React.useState<PullRequestListDiagnostics | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  const [busyByPullNumber, setBusyByPullNumber] = React.useState<Record<number, 'merge' | 'close'>>({});
  const [bulkAction, setBulkAction] = React.useState<BulkActionState | null>(null);
  const [mergeMethod, setMergeMethod] = React.useState<RepoPullRequestMergeMethod>(() => {
    try {
      const raw = localStorage.getItem(PR_MERGE_METHOD_STORAGE_KEY);
      return raw === 'squash' || raw === 'rebase' || raw === 'merge' ? raw : 'merge';
    } catch {
      return 'merge';
    }
  });

  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000pull-requests`,
    timeoutMs: 18_000,
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(PR_MERGE_METHOD_STORAGE_KEY, mergeMethod);
    } catch {
      // ignore
    }
  }, [mergeMethod]);

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
    let timer: any = null;

    const load = async (silent: boolean) => {
      if (!mounted) return;
      if (!silent) setListLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestsPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests?state=open`,
        );
        if (!mounted) return;
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

    void load(false);
    timer = setInterval(() => {
      void load(true);
    }, 20_000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [disabled, droneId, refreshNonce, repoAttached, startup.markReady, startup.suppressErrors]);

  const pullRequests = listData?.pullRequests ?? [];
  const anyBusy = bulkAction != null || Object.keys(busyByPullNumber).length > 0;
  const mergeablePullRequests = React.useMemo(() => pullRequests.filter((pr) => !mergeBlockedReason(pr)), [pullRequests]);
  const blockedMergeCount = Math.max(0, pullRequests.length - mergeablePullRequests.length);
  const blockedConflictCount = React.useMemo(() => pullRequests.filter((pr) => pr.hasMergeConflicts).length, [pullRequests]);
  const blockedPolicyCount = Math.max(0, blockedMergeCount - blockedConflictCount);

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

  const mergePullRequest = React.useCallback(
    async (pr: RepoPullRequestSummary) => {
      const pullNumber = Number(pr?.number);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      const blockedReason = mergeBlockedReason(pr);
      if (blockedReason) {
        setActionError(`Cannot merge PR #${pullNumber}: ${blockedReason}.`);
        return;
      }
      const forceReason = forceMergeReason(pr);
      if (bulkAction) return;
      if (busyByPullNumber[pullNumber]) return;
      const verb = forceReason ? 'Force merge' : 'Merge';
      const why = forceReason ? ` (${forceReason})` : '';
      if (!window.confirm(`${verb} PR #${pullNumber} into ${pr.baseRefName || 'base'} using "${mergeMethod}"?${why}`)) return;

      setActionError(null);
      setActionNotice(null);
      setBusyByPullNumber((prev) => ({ ...prev, [pullNumber]: 'merge' }));
      try {
        const merged = await requestMergePullRequest(pullNumber);
        setActionNotice(merged.message || `Merged PR #${pullNumber}.`);
        setRefreshNonce((n) => n + 1);
      } catch (e: any) {
        setActionError(e?.message ?? String(e));
      } finally {
        setBusyByPullNumber((prev) => {
          const next = { ...prev };
          delete next[pullNumber];
          return next;
        });
      }
    },
    [bulkAction, busyByPullNumber, mergeMethod, requestMergePullRequest],
  );

  const closePullRequest = React.useCallback(
    async (pr: RepoPullRequestSummary) => {
      const pullNumber = Number(pr?.number);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      if (bulkAction) return;
      if (busyByPullNumber[pullNumber]) return;
      if (!window.confirm(`Close PR #${pullNumber} without merging?`)) return;

      setActionError(null);
      setActionNotice(null);
      setBusyByPullNumber((prev) => ({ ...prev, [pullNumber]: 'close' }));
      try {
        const closed = await requestClosePullRequest(pullNumber);
        setActionNotice(`Closed PR #${closed.number}.`);
        setRefreshNonce((n) => n + 1);
      } catch (e: any) {
        setActionError(e?.message ?? String(e));
      } finally {
        setBusyByPullNumber((prev) => {
          const next = { ...prev };
          delete next[pullNumber];
          return next;
        });
      }
    },
    [bulkAction, busyByPullNumber, requestClosePullRequest],
  );

  const mergeAllPullRequests = React.useCallback(async () => {
    if (anyBusy) return;
    const queue = mergeablePullRequests
      .map((pr) => Number(pr?.number))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.floor(n));
    if (queue.length === 0) {
      setActionError('No mergeable PRs: all open PRs are blocked (conflicts, draft state, or changes requested).');
      return;
    }
    const skipLabel =
      blockedMergeCount > 0
        ? ` (${blockedMergeCount} blocked will be skipped${blockedConflictCount > 0 || blockedPolicyCount > 0 ? `: ${blockedConflictCount} conflicts, ${blockedPolicyCount} policy` : ''})`
        : '';
    if (!window.confirm(`Merge ${queue.length} mergeable open PRs using "${mergeMethod}"?${skipLabel}`)) return;

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
  }, [anyBusy, blockedConflictCount, blockedMergeCount, blockedPolicyCount, mergeMethod, mergeablePullRequests, requestMergePullRequest]);

  const closeAllPullRequests = React.useCallback(async () => {
    if (anyBusy) return;
    const queue = pullRequests
      .map((pr) => Number(pr?.number))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.floor(n));
    if (queue.length === 0) return;
    if (!window.confirm(`Close all ${queue.length} open PRs without merging?`)) return;

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
    setRefreshNonce((n) => n + 1);

    if (failures.length === 0) {
      setActionNotice(`Closed ${successCount} pull requests.`);
      return;
    }
    setActionNotice(`Closed ${successCount} of ${queue.length} pull requests.`);
    setActionError(`Bulk close finished with ${failures.length} failure(s): ${failures.slice(0, 3).join(' | ')}`);
  }, [anyBusy, pullRequests, requestClosePullRequest]);

  const bulkActionLabel = React.useMemo(() => {
    if (!bulkAction) return null;
    const verb = bulkAction.kind === 'merge' ? 'Merging' : 'Closing';
    return `${verb} ${bulkAction.done}/${bulkAction.total}…`;
  }, [bulkAction]);

  const openPullRequestInChanges = React.useCallback(
    (pr: RepoPullRequestSummary) => {
      const pullNumber = Number(pr?.number);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      requestChangesPullRequest({ droneId, pullNumber: Math.floor(pullNumber) });
      onOpenPullRequestInChanges?.(pr);
    },
    [droneId, onOpenPullRequestInChanges],
  );

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex flex-col relative">
      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div
          className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase"
          style={{ fontFamily: 'var(--display)' }}
          title={droneName}
        >
          Pull Requests
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-wide text-[var(--muted-dim)] mr-1" style={{ fontFamily: 'var(--display)' }}>
            Merge
          </span>
          <select
            value={mergeMethod}
            onChange={(event) => setMergeMethod(event.currentTarget.value as RepoPullRequestMergeMethod)}
            className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--fg-secondary)]"
            title="Default merge method"
          >
            <option value="merge">merge</option>
            <option value="squash">squash</option>
            <option value="rebase">rebase</option>
          </select>
          <button
            type="button"
            onClick={() => {
              void mergeAllPullRequests();
            }}
            disabled={!repoAttached || disabled || mergeablePullRequests.length === 0 || anyBusy || Boolean(listError)}
            className="h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--display)' }}
            title={
              mergeablePullRequests.length > 0
                ? `Merge all mergeable PRs with "${mergeMethod}"${
                    blockedMergeCount > 0 ? ` (${blockedMergeCount} blocked skipped: ${blockedConflictCount} conflicts, ${blockedPolicyCount} policy)` : ''
                  }`
                : 'No mergeable PRs (all blocked)'
            }
          >
            {bulkAction?.kind === 'merge' ? `Merging ${bulkAction.done}/${bulkAction.total}` : 'Merge All'}
          </button>
          <button
            type="button"
            onClick={() => {
              void closeAllPullRequests();
            }}
            disabled={!repoAttached || disabled || pullRequests.length === 0 || anyBusy || Boolean(listError)}
            className="h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--display)' }}
            title="Close all open PRs without merging"
          >
            {bulkAction?.kind === 'close' ? `Closing ${bulkAction.done}/${bulkAction.total}` : 'Close All'}
          </button>
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
            title="Refresh pull requests"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] text-[10px] text-[var(--muted)] flex items-center gap-1.5 min-h-[30px] overflow-x-auto whitespace-nowrap">
        {!repoAttached ? (
          <span>No repo attached.</span>
        ) : disabled ? (
          <span title={String(hubMessage ?? '').trim() || undefined}>
            {startup.timedOut ? 'Still provisioning… repo not ready yet.' : 'Provisioning… waiting for repo.'}
          </span>
        ) : listLoading && !listData ? (
          <span>Loading pull requests...</span>
        ) : listError ? (
          <span className="text-[var(--red)]">Error loading pull requests.</span>
        ) : (
          <>
            <span className="truncate max-w-[36ch]" title={listData?.repoRoot || repoPath || '-'}>
              {listData?.repoRoot || repoPath || '-'}
            </span>
            {listData?.github ? (
              <MetaChip label="github" value={`${listData.github.owner}/${listData.github.repo}`} title={`${listData.github.owner}/${listData.github.repo}`} mono />
            ) : null}
            <MetaChip label="open" value={pullRequests.length} />
          </>
        )}
      </div>

      {actionNotice ? (
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] text-[10px] text-[var(--green)] bg-[var(--green-subtle)]">{actionNotice}</div>
      ) : null}
      {actionError ? (
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] text-[10px] text-[var(--red)] bg-[var(--red-subtle)]">{actionError}</div>
      ) : null}
      {bulkActionLabel ? (
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] text-[10px] text-[var(--muted)] bg-[rgba(255,255,255,.02)]">
          {bulkActionLabel}
        </div>
      ) : null}

      {!repoAttached ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">Attach a repo to manage pull requests.</div>
      ) : disabled ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
            <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {provisioningLabel(hubPhase)}
            </div>
            <div className="mt-1">
              {startup.timedOut
                ? 'Still waiting for the repository to become available.'
                : 'Waiting for repository…'}
            </div>
            {String(hubMessage ?? '').trim() ? (
              <div className="mt-1 text-[10px] text-[var(--muted-dim)]">{String(hubMessage ?? '').trim()}</div>
            ) : null}
          </div>
        </div>
      ) : listError ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--red)]">
          <div>{listError}</div>
          {listErrorCode ? (
            <div className="mt-1 text-[10px] text-[var(--muted-dim)] font-mono">
              code: {listErrorCode}
            </div>
          ) : null}
          {listErrorDiagnostics?.repoRoot ? (
            <div className="mt-1 text-[10px] text-[var(--muted-dim)] font-mono break-all">
              repo: {listErrorDiagnostics.repoRoot}
            </div>
          ) : null}
          {listErrorDiagnostics?.origin ? (
            <div className="mt-1 text-[10px] text-[var(--muted-dim)] font-mono break-all">
              origin: {listErrorDiagnostics.origin}
            </div>
          ) : null}
          {listErrorDiagnostics?.github ? (
            <div className="mt-1 text-[10px] text-[var(--muted-dim)] font-mono">
              github: {listErrorDiagnostics.github.owner}/{listErrorDiagnostics.github.repo}
            </div>
          ) : null}
        </div>
      ) : pullRequests.length === 0 && !listLoading ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">No open pull requests.</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-2 py-2 flex flex-col gap-2">
          {pullRequests.map((pr) => {
            const busy = busyByPullNumber[pr.number] ?? null;
            const blockedReason = mergeBlockedReason(pr);
            const forceReason = blockedReason ? null : forceMergeReason(pr);
            return (
              <section key={`pr:${pr.number}`} className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden">
                <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/70 flex items-start gap-2">
                  <a
                    href={pr.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center min-w-[44px] h-6 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[10px] font-semibold text-[var(--accent)] hover:brightness-110"
                    title={pr.htmlUrl || `#${pr.number}`}
                  >
                    #{pr.number}
                  </a>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => openPullRequestInChanges(pr)}
                      className="block w-full text-left text-[12px] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:underline truncate"
                      title={`Open in Changes tab (PR mode): ${pr.title}`}
                    >
                      {pr.title}
                    </button>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <MetaChip label="author" value={pr.authorLogin || '-'} />
                      <MetaChip label="base" value={shortBranchName(pr.baseRefName)} title={pr.baseRefName} mono />
                      <MetaChip label="head" value={shortBranchName(pr.headRefName)} title={pr.headRefName} mono />
                      <MetaChip label="updated" value={formatTimestamp(pr.updatedAt)} title={pr.updatedAt} />
                      <PullRequestStatusBadgeStrip pullRequest={pr} />
                      {pr.isCrossRepository ? (
                        <span className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1.5 py-[1px] text-[10px] text-[var(--muted)]">
                          Cross-repo
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          void mergePullRequest(pr);
                        }}
                        disabled={Boolean(busy) || anyBusy || Boolean(blockedReason)}
                        className="h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
                        style={{ fontFamily: 'var(--display)' }}
                        title={
                          blockedReason
                            ? `Cannot merge: ${blockedReason}`
                            : forceReason
                              ? `Force merge: ${forceReason}`
                              : `Merge with "${mergeMethod}"`
                        }
                      >
                        {busy === 'merge' ? 'Merging...' : blockedReason ? 'Blocked' : forceReason ? 'Force Merge' : 'Merge'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void closePullRequest(pr);
                        }}
                        disabled={Boolean(busy) || anyBusy}
                        className="h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
                        style={{ fontFamily: 'var(--display)' }}
                        title="Close pull request without merging"
                      >
                        {busy === 'close' ? 'Closing...' : 'Close'}
                      </button>
                    </div>
                    {blockedReason ? (
                      <div className="text-[9px] text-[var(--red)] whitespace-nowrap" title={blockedReason}>
                        Merge blocked: {blockedReason}
                      </div>
                    ) : forceReason ? (
                      <div className="text-[9px] text-[var(--yellow)] whitespace-nowrap" title={forceReason}>
                        Force merge: {forceReason}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
