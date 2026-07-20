import React from 'react';
import {
  githubPullRequestForceMergeReason,
  githubPullRequestMergeBlockedReason,
  githubPullRequestStatusBadges,
} from '@drone/assistant-chat';
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
      className={`inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-1.5 py-[1px] text-[10px] ${
        mono ? 'font-mono' : ''
      }`}
      title={title}
    >
      <span className="uppercase tracking-[0.08em] text-[var(--muted-dim)]">{label}</span>
      <span className="text-[var(--fg-secondary)]">{value}</span>
    </span>
  );
}

const pullRequestBadgeClassNames = {
  danger: 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]',
  success: 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]',
  warning: 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
} as const;

export function mergeBlockedReason(pr: RepoPullRequestSummary): string | null {
  return githubPullRequestMergeBlockedReason(pr);
}

export function forceMergeReason(pr: RepoPullRequestSummary): string | null {
  return githubPullRequestForceMergeReason(pr);
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
  const allBadges = githubPullRequestStatusBadges(pullRequest);
  const badges = typeof limit === 'number' ? allBadges.slice(0, Math.max(1, Math.floor(limit))) : allBadges;
  if (badges.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.map((badge) => (
        <span
          key={`pr-badge-${pullRequest.number}-${badge.key}`}
          className={`inline-flex items-center rounded border py-[1px] ${
            compact ? 'px-1 text-[9px] leading-none' : 'px-1.5 text-[10px]'
          } ${pullRequestBadgeClassNames[badge.tone]}`}
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
  if (state === 'open') return 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]';
  if (state === 'merged') return 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]';
  if (state === 'closed') return 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]';
  return 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)]';
}

export function changeStatusLabel(entry: RepoPullRequestChangeEntry): string {
  const status = String(entry.statusType ?? '').trim();
  if (status) return status;
  return String(entry.statusChar ?? '').trim() || 'unknown';
}

export function pullRequestEntryPathExistsInHead(entry: RepoPullRequestChangeEntry): boolean {
  return String(entry.path ?? '').trim().length > 0 && entry.statusType !== 'deleted';
}
