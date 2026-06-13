import React from 'react';
import { requestJson } from '../http';
import type {
  RepoPullRequestClosePayload,
  RepoPullRequestMergeMethod,
  RepoPullRequestMergePayload,
  RepoPullRequestSummary,
  RepoPullRequestsPayload,
} from '../types';
import { profileStorageKey } from '../../profile-storage';

const PR_MERGE_METHOD_STORAGE_KEY = profileStorageKey('droneHub.prMergeMethod');
const HEADER_REPO_PR_CACHE_TTL_MS = 12_000;
const HEADER_REPO_PR_POLL_INTERVAL_MS = 20_000;

type RepoPullRequestSummarySnapshot = {
  pullRequestsData: Extract<RepoPullRequestsPayload, { ok: true }> | null;
  loading: boolean;
  error: string | null;
};

type RepoPullRequestSummaryResource = {
  droneId: string;
  repoCacheKey: string;
  snapshot: RepoPullRequestSummarySnapshot;
  subscribers: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  generation: number;
  loadingPromise: Promise<void> | null;
  queuedForceRefresh: boolean;
  subscribe: (callback: () => void, droneId: string) => () => void;
  load: (silent: boolean, force?: boolean) => Promise<void>;
  refresh: () => void;
  stop: () => void;
};

type RepoPullRequestSummaryOptions = {
  droneId: string;
  repoPath: string;
  repoAttached: boolean;
  disabled: boolean;
};

const EMPTY_PULL_REQUEST_SUMMARY_SNAPSHOT: RepoPullRequestSummarySnapshot = {
  pullRequestsData: null,
  loading: false,
  error: null,
};

const headerRepoPullRequestSummaryCache = new Map<
  string,
  {
    atMs: number;
    payload: Extract<RepoPullRequestsPayload, { ok: true }>;
  }
>();
const repoPullRequestSummaryResources = new Map<string, RepoPullRequestSummaryResource>();

function normalizeRepoPullRequestSummaryCacheKey(repoPath: string): string {
  return String(repoPath ?? '').trim();
}

function freshHeaderRepoPullRequestSummaryCache(
  repoCacheKey: string,
): Extract<RepoPullRequestsPayload, { ok: true }> | null {
  const cached = headerRepoPullRequestSummaryCache.get(repoCacheKey);
  if (!cached || Date.now() - cached.atMs >= HEADER_REPO_PR_CACHE_TTL_MS) return null;
  return cached.payload;
}

function emitRepoPullRequestSummaryResource(resource: RepoPullRequestSummaryResource): void {
  for (const callback of resource.subscribers) callback();
}

function createRepoPullRequestSummaryResource(repoCacheKey: string, droneId: string): RepoPullRequestSummaryResource {
  const resource: RepoPullRequestSummaryResource = {
    droneId,
    repoCacheKey,
    snapshot: { ...EMPTY_PULL_REQUEST_SUMMARY_SNAPSHOT },
    subscribers: new Set(),
    timer: null,
    generation: 0,
    loadingPromise: null,
    queuedForceRefresh: false,
    subscribe(callback, nextDroneId) {
      resource.droneId = nextDroneId;
      resource.subscribers.add(callback);
      if (resource.subscribers.size === 1) {
        resource.generation += 1;
        void resource.load(false);
        resource.timer = setInterval(() => {
          void resource.load(true);
        }, HEADER_REPO_PR_POLL_INTERVAL_MS);
      }
      callback();
      return () => {
        resource.subscribers.delete(callback);
        if (resource.subscribers.size === 0) resource.stop();
      };
    },
    async load(silent, force = false) {
      if (resource.subscribers.size === 0) return;
      if (resource.loadingPromise) {
        if (force) resource.queuedForceRefresh = true;
        await resource.loadingPromise;
        return;
      }
      const cached = force ? null : freshHeaderRepoPullRequestSummaryCache(resource.repoCacheKey);
      if (cached) {
        resource.snapshot = {
          pullRequestsData: cached,
          loading: false,
          error: null,
        };
        emitRepoPullRequestSummaryResource(resource);
        return;
      }
      if (!silent) {
        resource.snapshot = {
          ...resource.snapshot,
          loading: true,
        };
        emitRepoPullRequestSummaryResource(resource);
      }

      const requestGeneration = resource.generation;
      const requestDroneId = resource.droneId;
      resource.loadingPromise = requestJson<Extract<RepoPullRequestsPayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(requestDroneId)}/repo/pull-requests?state=open`,
      )
        .then((data) => {
          if (
            resource.subscribers.size === 0 ||
            resource.generation !== requestGeneration ||
            repoPullRequestSummaryResources.get(resource.repoCacheKey) !== resource
          ) {
            return;
          }
          headerRepoPullRequestSummaryCache.set(resource.repoCacheKey, { atMs: Date.now(), payload: data });
          resource.snapshot = {
            pullRequestsData: data,
            loading: false,
            error: null,
          };
          emitRepoPullRequestSummaryResource(resource);
        })
        .catch((e: any) => {
          if (
            resource.subscribers.size === 0 ||
            resource.generation !== requestGeneration ||
            repoPullRequestSummaryResources.get(resource.repoCacheKey) !== resource
          ) {
            return;
          }
          resource.snapshot = {
            ...resource.snapshot,
            loading: false,
            error: e?.message ?? String(e),
          };
          emitRepoPullRequestSummaryResource(resource);
        })
        .finally(() => {
          if (resource.loadingPromise) resource.loadingPromise = null;
          if (resource.queuedForceRefresh && resource.subscribers.size > 0) {
            resource.queuedForceRefresh = false;
            void resource.load(false, true);
          }
        });
      await resource.loadingPromise;
    },
    refresh() {
      if (resource.subscribers.size === 0) return;
      void resource.load(false, true);
    },
    stop() {
      resource.generation += 1;
      if (resource.timer) clearInterval(resource.timer);
      resource.timer = null;
      resource.loadingPromise = null;
      resource.queuedForceRefresh = false;
      repoPullRequestSummaryResources.delete(resource.repoCacheKey);
    },
  };
  return resource;
}

function repoPullRequestSummaryResource(repoCacheKey: string, droneId: string): RepoPullRequestSummaryResource {
  const existing = repoPullRequestSummaryResources.get(repoCacheKey);
  if (existing) {
    existing.droneId = droneId;
    return existing;
  }
  const next = createRepoPullRequestSummaryResource(repoCacheKey, droneId);
  repoPullRequestSummaryResources.set(repoCacheKey, next);
  return next;
}

export function invalidateHeaderRepoPullRequestSummaryCache(repoPath: string): void {
  const repoCacheKey = normalizeRepoPullRequestSummaryCacheKey(repoPath);
  if (!repoCacheKey) return;
  headerRepoPullRequestSummaryCache.delete(repoCacheKey);
  repoPullRequestSummaryResources.get(repoCacheKey)?.refresh();
}

export function subscribeHeaderRepoPullRequestSummary(
  { droneId, repoPath, repoAttached, disabled }: RepoPullRequestSummaryOptions,
  callback: (snapshot: RepoPullRequestSummarySnapshot) => void,
): () => void {
  const repoCacheKey = normalizeRepoPullRequestSummaryCacheKey(repoPath);
  if (!repoAttached || disabled || !repoCacheKey) {
    callback(EMPTY_PULL_REQUEST_SUMMARY_SNAPSHOT);
    return () => {};
  }

  const resource = repoPullRequestSummaryResource(repoCacheKey, droneId);
  return resource.subscribe(() => callback(resource.snapshot), droneId);
}

export function refreshHeaderRepoPullRequestSummary({
  droneId,
  repoPath,
  repoAttached,
  disabled,
}: RepoPullRequestSummaryOptions): void {
  const repoCacheKey = normalizeRepoPullRequestSummaryCacheKey(repoPath);
  if (!repoAttached || disabled || !repoCacheKey) return;
  repoPullRequestSummaryResource(repoCacheKey, droneId).refresh();
}

export function resetHeaderRepoPullRequestSummaryForTests(): void {
  for (const resource of repoPullRequestSummaryResources.values()) {
    resource.stop();
  }
  repoPullRequestSummaryResources.clear();
  headerRepoPullRequestSummaryCache.clear();
}

export function headerRepoPullRequestSummaryResourceCountForTests(): number {
  return repoPullRequestSummaryResources.size;
}

export function useHeaderRepoPullRequestSummary({
  droneId,
  repoPath,
  repoAttached,
  disabled,
}: RepoPullRequestSummaryOptions): RepoPullRequestSummarySnapshot & { refresh: () => void } {
  const repoCacheKey = React.useMemo(() => normalizeRepoPullRequestSummaryCacheKey(repoPath), [repoPath]);
  const [snapshotState, setSnapshotState] = React.useState<{
    repoCacheKey: string;
    snapshot: RepoPullRequestSummarySnapshot;
  }>({ repoCacheKey: '', snapshot: EMPTY_PULL_REQUEST_SUMMARY_SNAPSHOT });

  React.useEffect(() => {
    return subscribeHeaderRepoPullRequestSummary(
      { droneId, repoPath: repoCacheKey, repoAttached, disabled },
      (snapshot) => setSnapshotState({ repoCacheKey, snapshot }),
    );
  }, [disabled, droneId, repoAttached, repoCacheKey]);

  const refresh = React.useCallback(() => {
    refreshHeaderRepoPullRequestSummary({ droneId, repoPath: repoCacheKey, repoAttached, disabled });
  }, [disabled, droneId, repoAttached, repoCacheKey]);

  const snapshot = snapshotState.repoCacheKey === repoCacheKey ? snapshotState.snapshot : EMPTY_PULL_REQUEST_SUMMARY_SNAPSHOT;
  return React.useMemo(() => ({ ...snapshot, refresh }), [refresh, snapshot]);
}

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
  const {
    pullRequestsData,
    loading,
    error: summaryError,
  } = useHeaderRepoPullRequestSummary({
    droneId,
    repoPath,
    repoAttached,
    disabled,
  });
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<{ kind: 'merge' | 'close'; prNumber: number } | null>(null);
  const repoCacheKey = normalizeRepoPullRequestSummaryCacheKey(repoPath);
  const error = actionError ?? summaryError;

  React.useEffect(() => {
    setActionError(null);
  }, [disabled, repoAttached, repoCacheKey]);

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
    setActionError(null);
    try {
      await requestJson<Extract<RepoPullRequestMergePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${prNumber}/merge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method }),
        },
      );
      invalidateHeaderRepoPullRequestSummaryCache(repoCacheKey);
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
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
    setActionError(null);
    try {
      await requestJson<Extract<RepoPullRequestClosePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${prNumber}/close`,
        { method: 'POST' },
      );
      invalidateHeaderRepoPullRequestSummaryCache(repoCacheKey);
    } catch (e: any) {
      setActionError(e?.message ?? String(e));
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
