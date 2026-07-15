import React from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LinkedPullRequestCards } from '../src/droneHub/chat/LinkedPullRequestCards';
import { extractGithubPullRequestLinks, parseGithubPullRequestHref } from '../src/droneHub/chat/github-pull-request-links';
import {
  linkedPullRequestResourceCountForTests,
  resetLinkedPullRequestResourcesForTests,
  subscribeLinkedPullRequests,
} from '../src/droneHub/chat/linked-pull-request-resource';
import type { RepoPullRequestsPayload } from '../src/droneHub/types';

const originalFetch = globalThis.fetch;

const payload: Extract<RepoPullRequestsPayload, { ok: true }> = {
  ok: true,
  id: 'drone-a',
  name: 'Drone A',
  repoRoot: '/work/repo',
  state: 'all',
  github: { owner: 'nerfzael', repo: 'drone' },
  count: 0,
  pullRequests: [],
};

const openPayload: Extract<RepoPullRequestsPayload, { ok: true }> = {
  ...payload,
  state: 'open',
  count: 1,
  pullRequests: [
    {
      number: 596,
      title: 'Add resilient workspace file and folder transfers',
      state: 'open',
      draft: false,
      htmlUrl: 'https://github.com/nerfZael/drone/pull/596',
      createdAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-15T10:05:00.000Z',
      authorLogin: 'nerfZael',
      authorAvatarUrl: null,
      headRefName: 'feature/workspace-transfers',
      headLabel: 'nerfZael:feature/workspace-transfers',
      baseRefName: 'main',
      isCrossRepository: false,
      checksState: 'pending',
      reviewState: 'review_required',
      hasMergeConflicts: false,
    },
  ],
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => resetLinkedPullRequestResourcesForTests());

afterEach(() => {
  resetLinkedPullRequestResourcesForTests();
  globalThis.fetch = originalFetch;
});

describe('linked pull request messages', () => {
  test('extracts and deduplicates GitHub pull request links from markdown', () => {
    const text = [
      '[#596](https://github.com/nerfZael/drone/pull/596)',
      'Duplicate: https://github.com/nerfZael/drone/pull/596/files.',
      'Another: https://github.com/acme/widgets/pull/12',
    ].join('\n');

    expect(extractGithubPullRequestLinks(text)).toEqual([
      { owner: 'nerfzael', repo: 'drone', pullNumber: 596, href: 'https://github.com/nerfzael/drone/pull/596' },
      { owner: 'acme', repo: 'widgets', pullNumber: 12, href: 'https://github.com/acme/widgets/pull/12' },
    ]);
    expect(parseGithubPullRequestHref('http://github.com/acme/widgets/pull/12')).toBeNull();
    expect(parseGithubPullRequestHref('https://example.com/acme/widgets/pull/12')).toBeNull();
  });

  test('renders a compact linked-request fallback without fetching when management is disabled', () => {
    const html = renderToStaticMarkup(
      <LinkedPullRequestCards
        text="PR created: [#596](https://github.com/nerfZael/drone/pull/596)"
        context={{
          droneId: 'drone-a',
          repoPath: '/work/repo',
          repoAttached: true,
          disabled: true,
          openPullRequestsData: null,
          openPullRequestsLoading: false,
          openPullRequestsError: null,
        }}
      />,
    );

    expect(html).toContain('Linked request');
    expect(html).toContain('#596');
    expect(html).toContain('Status unavailable');
    expect(html).toContain('https://github.com/nerfzael/drone/pull/596');
    expect(html).not.toContain('mb-8');
  });

  test('shows status-loading failures directly in the card', () => {
    const html = renderToStaticMarkup(
      <LinkedPullRequestCards
        text="PR created: https://github.com/nerfZael/drone/pull/596"
        context={{
          droneId: 'drone-a',
          repoPath: '/work/repo',
          repoAttached: true,
          disabled: false,
          openPullRequestsData: null,
          openPullRequestsLoading: false,
          openPullRequestsError: 'GitHub authentication is unavailable.',
        }}
      />,
    );

    expect(html).toContain('Status unavailable: GitHub authentication is unavailable.');
    expect(html).toContain('role="alert"');
  });

  test('renders live title, checks, branches, and actions from the existing open-PR summary', () => {
    const html = renderToStaticMarkup(
      <LinkedPullRequestCards
        text="PR created: https://github.com/nerfZael/drone/pull/596"
        context={{
          droneId: 'drone-a',
          repoPath: '/work/repo',
          repoAttached: true,
          disabled: false,
          openPullRequestsData: openPayload,
          openPullRequestsLoading: false,
          openPullRequestsError: null,
        }}
      />,
    );

    expect(html).toContain('Add resilient workspace file and folder transfers');
    expect(html).toContain('Checks pending');
    expect(html).toContain('Review required');
    expect(html).toContain('feature/workspace-transfers');
    expect(html).toContain('feature/workspace-transfers → main');
    expect(html).not.toContain('feature/workspace-tra...');
    expect(html).not.toContain('>View<');
    expect(html).not.toContain('Merge requires confirmation');
    expect(html).toContain('border-l-2');
    expect(html).not.toContain('shadow-[inset_3px_0_0');
    expect(html).toContain('Force merge');
    expect(html).toContain('Close');
  });

  test('shares one all-state status request across linked cards', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(payload),
      } as Response;
    }) as typeof fetch;
    const counts: number[] = [];
    const options = { droneId: 'drone-a', repoPath: '/work/repo', repoAttached: true, disabled: false };
    const unsubscribeFirst = subscribeLinkedPullRequests(options, (snapshot) => counts.push(snapshot.data?.count ?? -1));
    const unsubscribeSecond = subscribeLinkedPullRequests(options, () => {});

    await flushAsync();

    expect(calls).toEqual(['/api/drones/drone-a/repo/pull-requests?state=all']);
    expect(counts.at(-1)).toBe(0);
    expect(linkedPullRequestResourceCountForTests()).toBe(1);

    unsubscribeFirst();
    unsubscribeSecond();
    expect(linkedPullRequestResourceCountForTests()).toBe(0);
  });
});
