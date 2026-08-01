import crypto from 'node:crypto';

import { githubApiRequest, resolveGithubToken } from '../github-pull-requests';
import type { ResourceEvent } from './resource-subscription-types';

export type GithubRepositoryPollCursor = {
  initialized: boolean;
  lastPollAt: string;
  pulls: Record<string, { state: 'open' | 'closed' | 'merged'; updatedAt: string }>;
  seenCommentIds: string[];
};

export type GithubRepositoryPollResult = {
  cursor: GithubRepositoryPollCursor;
  events: ResourceEvent[];
};

type GithubPull = {
  number?: number;
  title?: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
  html_url?: string;
  user?: { login?: string };
};

type GithubComment = {
  id?: number;
  body?: string;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  issue_url?: string;
  pull_request_url?: string;
  user?: { login?: string };
};

export async function pollGithubRepository(
  resourceIdRaw: string,
  cursorRaw: Record<string, unknown> | null,
  now = new Date(),
  options?: { token: string | null },
): Promise<GithubRepositoryPollResult> {
  const resourceId = normalizeGithubRepositoryId(resourceIdRaw);
  const [owner, repo] = resourceId.split('/');
  const token = options ? options.token : await resolveGithubToken();
  const cursor = normalizeCursor(cursorRaw, now);
  const since = encodeURIComponent(cursor.lastPollAt);
  const [pullsRaw, issueCommentsRaw, reviewCommentsRaw] = await Promise.all([
    githubApiRequest<GithubPull[]>({
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
      token,
    }),
    githubApiRequest<GithubComment[]>({
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments?sort=updated&direction=asc&since=${since}&per_page=100`,
      token,
    }),
    githubApiRequest<GithubComment[]>({
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/comments?sort=updated&direction=asc&since=${since}&per_page=100`,
      token,
    }),
  ]);

  const pulls = Array.isArray(pullsRaw) ? pullsRaw : [];
  const pullNumbers = new Set(
    pulls
      .map((pull) => normalizePullNumber(pull.number))
      .filter((value): value is number => value != null),
  );
  const nextPulls: GithubRepositoryPollCursor['pulls'] = {};
  const events: ResourceEvent[] = [];
  for (const pull of pulls) {
    const number = normalizePullNumber(pull.number);
    if (number == null) continue;
    const nextState = pullState(pull);
    const previous = cursor.pulls[String(number)];
    nextPulls[String(number)] = {
      state: nextState,
      updatedAt: validIso(pull.updated_at, now.toISOString()),
    };
    if (!cursor.initialized) continue;
    if (!previous && Date.parse(validIso(pull.created_at, '')) > Date.parse(cursor.lastPollAt)) {
      events.push(
        pullEvent(
          resourceId,
          pull,
          number,
          'pull_request.opened',
          validIso(pull.created_at, now.toISOString()),
        ),
      );
    }
    if (previous?.state === 'closed' && nextState === 'open') {
      events.push(
        pullEvent(
          resourceId,
          pull,
          number,
          'pull_request.opened',
          validIso(pull.updated_at, now.toISOString()),
        ),
      );
    }
    if (previous?.state === nextState) continue;
    if (nextState === 'merged') {
      const occurredAt = validIso(pull.merged_at, now.toISOString());
      if (previous || Date.parse(occurredAt) > Date.parse(cursor.lastPollAt)) {
        events.push(pullEvent(resourceId, pull, number, 'pull_request.merged', occurredAt));
      }
    } else if (nextState === 'closed') {
      const occurredAt = validIso(pull.closed_at, now.toISOString());
      if (previous || Date.parse(occurredAt) > Date.parse(cursor.lastPollAt)) {
        events.push(pullEvent(resourceId, pull, number, 'pull_request.closed', occurredAt));
      }
    }
  }

  const seen = new Set(cursor.seenCommentIds);
  const nextCommentIds = [...cursor.seenCommentIds];
  if (cursor.initialized) {
    for (const [kind, rawComments] of [
      ['conversation', issueCommentsRaw],
      ['inline', reviewCommentsRaw],
    ] as const) {
      for (const comment of Array.isArray(rawComments) ? rawComments : []) {
        const id = normalizeCommentId(comment.id);
        const number = pullNumberFromComment(comment);
        if (!id || number == null || !pullNumbers.has(number)) continue;
        const dedupeId = `${kind}:${id}`;
        if (seen.has(dedupeId)) continue;
        seen.add(dedupeId);
        nextCommentIds.push(dedupeId);
        const createdAtMs = Date.parse(validIso(comment.created_at, ''));
        if (!Number.isFinite(createdAtMs) || createdAtMs <= Date.parse(cursor.lastPollAt)) {
          continue;
        }
        events.push(commentEvent(resourceId, comment, number, kind));
      }
    }
  } else {
    for (const [kind, rawComments] of [
      ['conversation', issueCommentsRaw],
      ['inline', reviewCommentsRaw],
    ] as const) {
      for (const comment of Array.isArray(rawComments) ? rawComments : []) {
        const id = normalizeCommentId(comment.id);
        if (id) nextCommentIds.push(`${kind}:${id}`);
      }
    }
  }

  return {
    events,
    cursor: {
      initialized: true,
      lastPollAt: now.toISOString(),
      pulls: nextPulls,
      seenCommentIds: [...new Set(nextCommentIds)].slice(-1_000),
    },
  };
}

export function normalizeGithubRepositoryId(raw: string): string {
  const value = String(raw ?? '')
    .trim()
    .replace(/^github:/i, '');
  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error('GitHub repository resource ID must use owner/repository');
  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
}

export function normalizeGithubPullRequestId(raw: string): string {
  const value = String(raw ?? '')
    .trim()
    .replace(/^github:/i, '');
  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/);
  if (!match) throw new Error('GitHub pull request resource ID must use owner/repository#number');
  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}#${Number(match[3])}`;
}

export function githubRepositoryIdFromPullRequest(resourceId: string): string {
  return normalizeGithubPullRequestId(resourceId).split('#')[0];
}

export async function validateGithubSubscriptionResource(
  resourceType: 'repository' | 'pull_request',
  resourceIdRaw: string,
): Promise<void> {
  const token = await resolveGithubToken();
  if (resourceType === 'repository') {
    const [owner, repo] = normalizeGithubRepositoryId(resourceIdRaw).split('/');
    await githubApiRequest<unknown>({
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      token,
    });
    return;
  }
  const resourceId = normalizeGithubPullRequestId(resourceIdRaw);
  const [repositoryId, number] = resourceId.split('#');
  const [owner, repo] = repositoryId.split('/');
  const pull = await githubApiRequest<GithubPull>({
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(number)}`,
    token,
  });
  const state = pullState(pull);
  if (state !== 'open') {
    throw new Error(`GitHub pull request ${resourceId} is already ${state}`);
  }
}

export function initialGithubRepositoryPollCursor(now = new Date()): GithubRepositoryPollCursor {
  return {
    initialized: true,
    lastPollAt: now.toISOString(),
    pulls: {},
    seenCommentIds: [],
  };
}

function normalizeCursor(
  raw: Record<string, unknown> | null,
  now: Date,
): GithubRepositoryPollCursor {
  const pullsRaw =
    raw?.pulls && typeof raw.pulls === 'object' && !Array.isArray(raw.pulls)
      ? (raw.pulls as Record<string, any>)
      : {};
  const pulls: GithubRepositoryPollCursor['pulls'] = {};
  for (const [number, value] of Object.entries(pullsRaw)) {
    const state =
      value?.state === 'merged' ? 'merged' : value?.state === 'closed' ? 'closed' : 'open';
    pulls[number] = { state, updatedAt: validIso(value?.updatedAt, now.toISOString()) };
  }
  return {
    initialized: raw?.initialized === true,
    lastPollAt: validIso(raw?.lastPollAt, new Date(now.getTime() - 5 * 60_000).toISOString()),
    pulls,
    seenCommentIds: Array.isArray(raw?.seenCommentIds)
      ? raw.seenCommentIds.map(String).filter(Boolean).slice(-1_000)
      : [],
  };
}

function pullState(pull: GithubPull): 'open' | 'closed' | 'merged' {
  if (validIso(pull.merged_at, '')) return 'merged';
  return String(pull.state ?? '').toLowerCase() === 'closed' ? 'closed' : 'open';
}

function pullEvent(
  repositoryId: string,
  pull: GithubPull,
  number: number,
  eventType: 'pull_request.opened' | 'pull_request.merged' | 'pull_request.closed',
  occurredAt: string,
): ResourceEvent {
  const resourceId = `${repositoryId}#${number}`;
  const action = eventType.split('.')[1];
  const title = String(pull.title ?? '').trim() || `Pull request #${number}`;
  return {
    id: crypto.randomUUID(),
    providerEventId: `github:${resourceId}:${action}:${occurredAt}`,
    provider: 'github',
    resourceType: 'pull_request',
    resourceId,
    parentResourceId: repositoryId,
    eventType,
    occurredAt,
    summary: `${repositoryId} pull request #${number} ${action}.`,
    providerContent: {
      title,
      author: String(pull.user?.login ?? '').trim() || null,
      url: String(pull.html_url ?? '').trim() || null,
    },
  };
}

function commentEvent(
  repositoryId: string,
  comment: GithubComment,
  number: number,
  kind: 'conversation' | 'inline',
): ResourceEvent {
  const id = normalizeCommentId(comment.id)!;
  const author = String(comment.user?.login ?? '').trim() || 'unknown user';
  const occurredAt = validIso(comment.created_at, new Date().toISOString());
  return {
    id: crypto.randomUUID(),
    providerEventId: `github:comment:${kind}:${id}`,
    provider: 'github',
    resourceType: 'pull_request',
    resourceId: `${repositoryId}#${number}`,
    parentResourceId: repositoryId,
    eventType: 'pull_request.comment.created',
    occurredAt,
    summary: `${repositoryId} pull request #${number} received a new ${kind} comment.`,
    providerContent: {
      kind,
      author,
      body: String(comment.body ?? '').slice(0, 8_000),
      url: String(comment.html_url ?? '').trim() || null,
    },
  };
}

function pullNumberFromComment(comment: GithubComment): number | null {
  const url = String(comment.pull_request_url ?? comment.issue_url ?? '');
  const match = url.match(/\/(?:pulls|issues)\/([1-9][0-9]*)(?:$|[/?#])/);
  return match ? normalizePullNumber(match[1]) : null;
}

function normalizePullNumber(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeCommentId(raw: unknown): string | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

function validIso(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim();
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}
