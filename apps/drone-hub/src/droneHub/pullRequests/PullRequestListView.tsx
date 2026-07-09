import React from 'react';
import type { RepoPullRequestMergeMethod, RepoPullRequestSummary } from '../types';
import { forceMergeReason, formatTimestamp, mergeBlockedReason, MetaChip, PullRequestStatusBadgeStrip, shortBranchName } from './pull-request-ui';

export function PullRequestListView({
  pullRequests,
  busyByPullNumber,
  anyBusy,
  mergeMethod,
  onOpenPullRequest,
  onMergePullRequest,
  onClosePullRequest,
}: {
  pullRequests: RepoPullRequestSummary[];
  busyByPullNumber: Record<number, 'merge' | 'close'>;
  anyBusy: boolean;
  mergeMethod: RepoPullRequestMergeMethod;
  onOpenPullRequest: (pullRequest: RepoPullRequestSummary) => void;
  onMergePullRequest: (pullRequest: RepoPullRequestSummary) => void;
  onClosePullRequest: (pullRequest: RepoPullRequestSummary) => void;
}) {
  return (
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
                  onClick={() => onOpenPullRequest(pr)}
                  className="block w-full text-left text-[12px] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:underline truncate"
                  title={`Inspect PR #${pr.number}: ${pr.title}`}
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
                    onClick={() => onMergePullRequest(pr)}
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
                    onClick={() => onClosePullRequest(pr)}
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
  );
}
