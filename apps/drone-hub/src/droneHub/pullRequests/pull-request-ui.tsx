import React from 'react';
import type { RepoPullRequestChangeEntry, RepoPullRequestSummary } from '../types';

export function formatTimestamp(iso: string): string {
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

export function shortBranchName(raw: string, maxLen: number = 36): string {
  const text = String(raw ?? '').trim();
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  const suffix = '...';
  return `${text.slice(0, Math.max(1, maxLen - suffix.length))}${suffix}`;
}

export function shortSha(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) return '-';
  return text.length > 12 ? text.slice(0, 12) : text;
}

export function MetaChip({
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
  } else if (pr.checksState === 'success') {
    out.push({
      key: 'checks_success',
      label: 'Checks passed',
      className: 'border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)]',
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

export function mergeBlockedReason(pr: RepoPullRequestSummary): string | null {
  if (pr.hasMergeConflicts) return 'merge conflicts detected';
  if (pr.draft) return 'pull request is in draft state';
  if (pr.reviewState === 'changes_requested') return 'review has changes requested';
  return null;
}

export function forceMergeReason(pr: RepoPullRequestSummary): string | null {
  if (pr.checksState === 'failing') return 'checks are failing';
  if (pr.checksState === 'pending') return 'checks are still pending';
  return null;
}

export function PullRequestStatusBadgeStrip({
  pullRequest,
  limit,
  compact = false,
}: {
  pullRequest: RepoPullRequestSummary;
  limit?: number;
  compact?: boolean;
}) {
  const allBadges = pullRequestStatusBadges(pullRequest);
  const badges = typeof limit === 'number' ? allBadges.slice(0, Math.max(1, Math.floor(limit))) : allBadges;
  if (badges.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.map((badge) => (
        <span
          key={`pr-badge-${pullRequest.number}-${badge.key}`}
          className={`inline-flex items-center rounded border py-[1px] ${
            compact ? 'px-1 text-[9px] leading-none' : 'px-1.5 text-[10px]'
          } ${badge.className}`}
          title={badge.label}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

export function pullRequestStateClassName(stateRaw: string | null | undefined): string {
  const state = String(stateRaw ?? '').trim().toLowerCase();
  if (state === 'open') return 'border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)]';
  if (state === 'merged') return 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]';
  if (state === 'closed') return 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]';
  return 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)]';
}

export function changeStatusLabel(entry: RepoPullRequestChangeEntry): string {
  const status = String(entry.statusType ?? '').trim();
  if (status) return status;
  return String(entry.statusChar ?? '').trim() || 'unknown';
}

export function pullRequestEntryPathExistsInHead(entry: RepoPullRequestChangeEntry): boolean {
  return String(entry.path ?? '').trim().length > 0 && entry.statusType !== 'deleted';
}
