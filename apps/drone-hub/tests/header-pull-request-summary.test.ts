import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  headerRepoPullRequestSummaryResourceCountForTests,
  resetHeaderRepoPullRequestSummaryForTests,
  subscribeHeaderRepoPullRequestSummary,
} from '../src/droneHub/app/HeaderPullRequestShortcuts';
import type { RepoPullRequestsPayload } from '../src/droneHub/types';

const originalFetch = globalThis.fetch;

const payload: Extract<RepoPullRequestsPayload, { ok: true }> = {
  ok: true,
  id: 'drone-a',
  name: 'Drone A',
  repoRoot: '/work/repo',
  state: 'open',
  github: { owner: 'acme', repo: 'widgets' },
  count: 2,
  pullRequests: [],
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installFetchMock(calls: string[]): void {
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: () => 'application/json',
      },
      text: async () => JSON.stringify(payload),
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  resetHeaderRepoPullRequestSummaryForTests();
});

afterEach(() => {
  resetHeaderRepoPullRequestSummaryForTests();
  globalThis.fetch = originalFetch;
});

describe('header PR summary source', () => {
  test('shares one request and resource across selected workspace and shortcut subscribers', async () => {
    const fetchCalls: string[] = [];
    installFetchMock(fetchCalls);
    const firstCounts: number[] = [];
    const secondCounts: number[] = [];

    const unsubscribeFirst = subscribeHeaderRepoPullRequestSummary(
      { droneId: 'drone-a', repoPath: '/work/repo', repoAttached: true, disabled: false },
      (snapshot) => firstCounts.push(Number(snapshot.pullRequestsData?.count ?? 0)),
    );
    const unsubscribeSecond = subscribeHeaderRepoPullRequestSummary(
      { droneId: 'drone-a', repoPath: '/work/repo', repoAttached: true, disabled: false },
      (snapshot) => secondCounts.push(Number(snapshot.pullRequestsData?.count ?? 0)),
    );

    await flushAsync();

    expect(fetchCalls).toEqual(['/api/drones/drone-a/repo/pull-requests?state=open']);
    expect(headerRepoPullRequestSummaryResourceCountForTests()).toBe(1);
    expect(firstCounts.at(-1)).toBe(2);
    expect(secondCounts.at(-1)).toBe(2);

    unsubscribeFirst();
    expect(headerRepoPullRequestSummaryResourceCountForTests()).toBe(1);
    unsubscribeSecond();
    expect(headerRepoPullRequestSummaryResourceCountForTests()).toBe(0);
  });

  test('does not create a polling resource when repo polling is disabled', async () => {
    const fetchCalls: string[] = [];
    installFetchMock(fetchCalls);
    const counts: number[] = [];

    const unsubscribe = subscribeHeaderRepoPullRequestSummary(
      { droneId: 'drone-a', repoPath: '/work/repo', repoAttached: true, disabled: true },
      (snapshot) => counts.push(Number(snapshot.pullRequestsData?.count ?? 0)),
    );

    await flushAsync();

    expect(fetchCalls).toEqual([]);
    expect(counts).toEqual([0]);
    expect(headerRepoPullRequestSummaryResourceCountForTests()).toBe(0);
    unsubscribe();
  });

  test('does not create a polling resource without an attached repo path', async () => {
    const fetchCalls: string[] = [];
    installFetchMock(fetchCalls);

    subscribeHeaderRepoPullRequestSummary(
      { droneId: 'drone-a', repoPath: '', repoAttached: true, disabled: false },
      () => {},
    );
    subscribeHeaderRepoPullRequestSummary(
      { droneId: 'drone-a', repoPath: '/work/repo', repoAttached: false, disabled: false },
      () => {},
    );

    await flushAsync();

    expect(fetchCalls).toEqual([]);
    expect(headerRepoPullRequestSummaryResourceCountForTests()).toBe(0);
  });
});
