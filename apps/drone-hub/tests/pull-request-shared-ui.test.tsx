import React from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PullRequestStatusBadgeStrip } from '../src/droneHub/pullRequests/pull-request-ui';
import {
  readPullRequestMergeMethod,
  writePullRequestMergeMethod,
} from '../src/droneHub/pullRequests/pull-request-preferences';
import type { RepoPullRequestSummary } from '../src/droneHub/types';

const previousLocalStorage = (globalThis as any).localStorage;
const values = new Map<string, string>();

const localStorageMock = {
  getItem(key: string) {
    return values.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    values.set(key, value);
  },
};

const pullRequest: RepoPullRequestSummary = {
  number: 596,
  title: 'Workspace transfers',
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
  checksState: 'success',
  reviewState: 'approved',
  hasMergeConflicts: false,
};

beforeEach(() => {
  values.clear();
  (globalThis as any).localStorage = localStorageMock;
});

afterEach(() => {
  if (previousLocalStorage === undefined) delete (globalThis as any).localStorage;
  else (globalThis as any).localStorage = previousLocalStorage;
});

describe('shared pull request UI behavior', () => {
  test('uses one merge-method preference reader and writer', () => {
    expect(readPullRequestMergeMethod()).toBe('merge');
    writePullRequestMergeMethod('squash');
    expect(readPullRequestMergeMethod()).toBe('squash');

    const storageKey = [...values.keys()][0];
    expect(storageKey).toContain('droneHub.prMergeMethod');
    values.set(storageKey, 'invalid');
    expect(readPullRequestMergeMethod()).toBe('merge');
  });

  test('shows successful checks consistently and respects compact limits', () => {
    const fullHtml = renderToStaticMarkup(<PullRequestStatusBadgeStrip pullRequest={pullRequest} />);
    expect(fullHtml).toContain('Checks passed');
    expect(fullHtml).toContain('Approved');

    const limitedHtml = renderToStaticMarkup(<PullRequestStatusBadgeStrip pullRequest={pullRequest} limit={1} />);
    expect(limitedHtml).toContain('Checks passed');
    expect(limitedHtml).not.toContain('Approved');
  });
});
