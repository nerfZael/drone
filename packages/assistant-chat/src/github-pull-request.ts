import { messageText } from './assistant-message-model.js';
import type { AssistantMessage } from './assistant-message-types.js';

export type GithubPullRequestLink = {
  owner: string;
  repo: string;
  pullNumber: number;
  href: string;
};

export type GithubPullRequestSummary = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  diffStats?: {
    changed: number;
    additions: number;
    deletions: number;
  } | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  headRefName: string;
  headLabel: string;
  baseRefName: string;
  isCrossRepository: boolean;
  checksState: 'success' | 'failing' | 'pending' | 'unknown';
  reviewState: 'approved' | 'changes_requested' | 'review_required' | 'unknown';
  hasMergeConflicts: boolean;
};

export type GithubPullRequestsResult = {
  github: { owner: string; repo: string };
  pullRequests: GithubPullRequestSummary[];
};

export type GithubPullRequestStatusBadge = {
  key: string;
  label: string;
  tone: 'danger' | 'success' | 'warning';
};

export function githubPullRequestDiffStatsPresentation(
  stats: NonNullable<GithubPullRequestSummary['diffStats']>,
) {
  const changed = Math.max(0, Math.floor(Number(stats.changed) || 0));
  const additions = Math.max(0, Math.floor(Number(stats.additions) || 0));
  const deletions = Math.max(0, Math.floor(Number(stats.deletions) || 0));
  const net = additions - deletions;
  const netLabel = net === 0 ? '±0' : `${net > 0 ? '+' : ''}${net}`;
  return {
    changed,
    additions,
    deletions,
    netLabel,
    accessibilityLabel: `${changed} files changed, ${additions} additions, ${deletions} deletions, ${netLabel} net lines`,
  };
}

export function parseGithubPullRequestHref(hrefRaw: string): GithubPullRequestLink | null {
  const href = String(hrefRaw ?? '').trim();
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || String(url.hostname || '').toLowerCase() !== 'github.com')
    return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i.exec(
    String(url.pathname ?? '').trim(),
  );
  if (!match) return null;
  const owner = String(match[1] ?? '').trim().toLowerCase();
  const repo = String(match[2] ?? '').trim().toLowerCase();
  const pullNumber = Number(match[3]);
  if (!owner || !repo || !Number.isFinite(pullNumber) || pullNumber <= 0) return null;
  const normalizedPullNumber = Math.floor(pullNumber);
  return {
    owner,
    repo,
    pullNumber: normalizedPullNumber,
    href: `https://github.com/${owner}/${repo}/pull/${normalizedPullNumber}`,
  };
}

export function extractGithubPullRequestLinks(
  textRaw: string,
  limit = 3,
): GithubPullRequestLink[] {
  const text = String(textRaw ?? '');
  if (!text) return [];
  const maxLinks = Math.max(1, Math.floor(limit));
  const links: GithubPullRequestLink[] = [];
  const seen = new Set<string>();
  const candidates = text.match(/https:\/\/github\.com\/[^\s<>"']+/gi) ?? [];

  for (const candidateRaw of candidates) {
    const candidate = candidateRaw.replace(/[),.;:!?\]}]+$/g, '');
    const parsed = parseGithubPullRequestHref(candidate);
    if (!parsed) continue;
    const key = `${parsed.owner}/${parsed.repo}#${parsed.pullNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(parsed);
    if (links.length >= maxLinks) break;
  }

  return links;
}

export function extractGithubPullRequestLinksFromMessages(
  messages: AssistantMessage[],
  limit = 12,
): GithubPullRequestLink[] {
  const maxLinks = Math.max(1, Math.floor(limit));
  const links: GithubPullRequestLink[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const link of extractGithubPullRequestLinks(messageText(message))) {
      const key = `${link.owner}/${link.repo}#${link.pullNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(link);
      if (links.length >= maxLinks) return links;
    }
  }
  return links;
}

export function githubPullRequestMatchesRepo(
  link: GithubPullRequestLink,
  github: { owner: string; repo: string } | null | undefined,
): boolean | null {
  if (!github) return null;
  return (
    String(github.owner ?? '').trim().toLowerCase() === link.owner &&
    String(github.repo ?? '').trim().toLowerCase() === link.repo
  );
}

export function githubPullRequestStatusBadges(
  pullRequest: GithubPullRequestSummary,
): GithubPullRequestStatusBadge[] {
  const badges: GithubPullRequestStatusBadge[] = [];
  if (pullRequest.draft) badges.push({ key: 'draft', label: 'Draft', tone: 'warning' });
  if (pullRequest.checksState === 'failing')
    badges.push({ key: 'checks_failing', label: 'Checks failing', tone: 'danger' });
  else if (pullRequest.checksState === 'pending')
    badges.push({ key: 'checks_pending', label: 'Checks pending', tone: 'warning' });
  else if (pullRequest.checksState === 'success')
    badges.push({ key: 'checks_success', label: 'Checks passed', tone: 'success' });
  if (pullRequest.reviewState === 'approved')
    badges.push({ key: 'approved', label: 'Approved', tone: 'success' });
  else if (pullRequest.reviewState === 'changes_requested')
    badges.push({ key: 'changes_requested', label: 'Changes requested', tone: 'danger' });
  else if (pullRequest.reviewState === 'review_required')
    badges.push({ key: 'review_required', label: 'Review required', tone: 'warning' });
  if (pullRequest.hasMergeConflicts)
    badges.push({ key: 'merge_conflict', label: 'Merge conflict', tone: 'danger' });
  return badges;
}

export function githubPullRequestMergeBlockedReason(
  pullRequest: GithubPullRequestSummary,
): string | null {
  if (pullRequest.hasMergeConflicts) return 'merge conflicts detected';
  if (pullRequest.draft) return 'pull request is in draft state';
  if (pullRequest.reviewState === 'changes_requested') return 'review has changes requested';
  return null;
}

export function githubPullRequestForceMergeReason(
  pullRequest: GithubPullRequestSummary,
): string | null {
  if (pullRequest.checksState === 'failing') return 'checks are failing';
  if (pullRequest.checksState === 'pending') return 'checks are still pending';
  return null;
}
