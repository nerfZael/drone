import React from 'react';
import { requestJson } from '../http';
import type {
  RepoPullRequestClosePayload,
  RepoPullRequestMergeMethod,
  RepoPullRequestMergePayload,
  RepoPullRequestSummary,
  RepoPullRequestsPayload,
} from '../types';

const PR_MERGE_METHOD_STORAGE_KEY = 'droneHub.prMergeMethod';
const HEADER_REPO_PR_CACHE_TTL_MS = 12_000;
const headerRepoPullRequestSummaryCache = new Map<
  string,
  {
    atMs: number;
    payload: Extract<RepoPullRequestsPayload, { ok: true }>;
  }
>();

function headerPrMergeMethod(): RepoPullRequestMergeMethod {
  try {
    const raw = String(localStorage.getItem(PR_MERGE_METHOD_STORAGE_KEY) ?? '')
      .trim()
      .toLowerCase();
    if (raw === 'squash' || raw === 'rebase' || raw === 'merge') return raw;
  } catch {
    // ignore
  }
  return 'merge';
}

function shortPrTitle(raw: string, maxLen: number = 34): string {
  const text = String(raw ?? '').trim();
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}...`;
}

function repoPullRequestStatusBadges(pr: RepoPullRequestSummary): Array<{ key: string; label: string; className: string }> {
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

function PullRequestStatusBadgeStrip({ pullRequest, limit = 4 }: { pullRequest: RepoPullRequestSummary; limit?: number }) {
  const badges = repoPullRequestStatusBadges(pullRequest).slice(0, Math.max(1, Math.floor(limit)));
  if (badges.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {badges.map((badge) => (
        <span
          key={`pr-badge-${pullRequest.number}-${badge.key}`}
          className={`inline-flex items-center rounded border px-1 py-[1px] text-[9px] leading-none ${badge.className}`}
          title={badge.label}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

export function HeaderPullRequestShortcuts({
  droneId,
  repoPath,
  repoAttached,
  disabled,
  onOpenPullRequestsTab,
}: {
  droneId: string;
  repoPath: string;
  repoAttached: boolean;
  disabled: boolean;
  onOpenPullRequestsTab: () => void;
}) {
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [pullRequestsData, setPullRequestsData] = React.useState<Extract<RepoPullRequestsPayload, { ok: true }> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<{ kind: 'merge' | 'close'; prNumber: number } | null>(null);
  const repoCacheKey = String(repoPath ?? '').trim();

  React.useEffect(() => {
    if (!repoAttached || disabled || !repoCacheKey) {
      setPullRequestsData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let mounted = true;
    let timer: any = null;

    const load = async (silent: boolean) => {
      if (!mounted) return;
      const cached = headerRepoPullRequestSummaryCache.get(repoCacheKey);
      if (cached && Date.now() - cached.atMs < HEADER_REPO_PR_CACHE_TTL_MS) {
        setPullRequestsData(cached.payload);
        setError(null);
        if (!silent) setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestsPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests?state=open`,
        );
        if (!mounted) return;
        headerRepoPullRequestSummaryCache.set(repoCacheKey, { atMs: Date.now(), payload: data });
        setPullRequestsData(data);
        setError(null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setLoading(false);
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
  }, [disabled, droneId, refreshNonce, repoAttached, repoCacheKey]);

  const count = Number(pullRequestsData?.count ?? 0);
  const previewRows = (pullRequestsData?.pullRequests ?? []).slice(0, 2);
  const firstPr = previewRows.length === 1 ? previewRows[0] : null;

  const onQuickMerge = React.useCallback(async () => {
    if (!firstPr) return;
    const prNumber = Number(firstPr.number);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return;
    if (busyAction) return;
    const method = headerPrMergeMethod();
    if (!window.confirm(`Merge PR #${prNumber} using "${method}"?`)) return;
    setBusyAction({ kind: 'merge', prNumber });
    setError(null);
    try {
      await requestJson<Extract<RepoPullRequestMergePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${prNumber}/merge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method }),
        },
      );
      if (repoCacheKey) headerRepoPullRequestSummaryCache.delete(repoCacheKey);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, droneId, firstPr, repoCacheKey]);

  const onQuickClose = React.useCallback(async () => {
    if (!firstPr) return;
    const prNumber = Number(firstPr.number);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return;
    if (busyAction) return;
    if (!window.confirm(`Close PR #${prNumber} without merging?`)) return;
    setBusyAction({ kind: 'close', prNumber });
    setError(null);
    try {
      await requestJson<Extract<RepoPullRequestClosePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${prNumber}/close`,
        { method: 'POST' },
      );
      if (repoCacheKey) headerRepoPullRequestSummaryCache.delete(repoCacheKey);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, droneId, firstPr, repoCacheKey]);

  if (!repoAttached || disabled || !repoCacheKey) return null;

  return (
    <div className="hidden xl:flex items-center gap-1.5 pl-1 border-l border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={onOpenPullRequestsTab}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
          error
            ? 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]'
            : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
        title={error ?? 'Open pull requests tab'}
      >
        PRs {loading && !pullRequestsData ? '...' : String(count)}
      </button>
      {previewRows.map((pr) => (
        <button
          key={`header-pr-${pr.number}`}
          type="button"
          onClick={onOpenPullRequestsTab}
          className="inline-flex items-start gap-1.5 max-w-[280px] px-2 py-1 rounded text-[10px] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-110 transition-all"
          title={`#${pr.number} ${pr.title}`}
        >
          <span className="font-mono pt-[1px]">#{pr.number}</span>
          <span className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span className="truncate">{shortPrTitle(pr.title)}</span>
            <PullRequestStatusBadgeStrip pullRequest={pr} limit={3} />
          </span>
        </button>
      ))}
      {firstPr ? (
        <>
          <button
            type="button"
            onClick={() => {
              void onQuickMerge();
            }}
            disabled={Boolean(busyAction)}
            className="inline-flex items-center px-2 py-1 rounded text-[9px] font-semibold tracking-wide uppercase border border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed transition-all"
            style={{ fontFamily: 'var(--display)' }}
            title={`Quick merge #${firstPr.number}`}
          >
            {busyAction?.kind === 'merge' && busyAction.prNumber === firstPr.number ? 'Merging...' : 'Merge'}
          </button>
          <button
            type="button"
            onClick={() => {
              void onQuickClose();
            }}
            disabled={Boolean(busyAction)}
            className="inline-flex items-center px-2 py-1 rounded text-[9px] font-semibold tracking-wide uppercase border border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed transition-all"
            style={{ fontFamily: 'var(--display)' }}
            title={`Quick close #${firstPr.number}`}
          >
            {busyAction?.kind === 'close' && busyAction.prNumber === firstPr.number ? 'Closing...' : 'Close'}
          </button>
        </>
      ) : null}
    </div>
  );
}
