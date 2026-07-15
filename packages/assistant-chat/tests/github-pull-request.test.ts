import { describe, expect, test } from 'bun:test';
import {
  extractGithubPullRequestLinksFromMessages,
  githubPullRequestForceMergeReason,
  githubPullRequestMatchesRepo,
  githubPullRequestMergeBlockedReason,
  githubPullRequestStatusBadges,
  parseGithubPullRequestHref,
  type GithubPullRequestSummary,
} from '../src';

const pullRequest: GithubPullRequestSummary = {
  number: 596,
  title: 'Add workspace transfers',
  state: 'open',
  draft: false,
  htmlUrl: 'https://github.com/nerfZael/drone/pull/596',
  createdAt: '',
  updatedAt: '',
  authorLogin: 'nerfZael',
  authorAvatarUrl: null,
  headRefName: 'feature/workspace-transfers',
  headLabel: 'nerfZael:feature/workspace-transfers',
  baseRefName: 'main',
  isCrossRepository: false,
  checksState: 'pending',
  reviewState: 'review_required',
  hasMergeConflicts: false,
};

describe('shared GitHub pull request model', () => {
  test('extracts and deduplicates links from assistant messages only', () => {
    expect(
      extractGithubPullRequestLinksFromMessages([
        { role: 'user', content: 'https://github.com/acme/widgets/pull/1' },
        {
          role: 'assistant',
          content: 'PR: [#596](https://github.com/nerfZael/drone/pull/596)',
        },
        {
          role: 'assistant',
          content: 'Again https://github.com/nerfZael/drone/pull/596/files',
        },
      ]),
    ).toEqual([
      {
        owner: 'nerfzael',
        repo: 'drone',
        pullNumber: 596,
        href: 'https://github.com/nerfzael/drone/pull/596',
      },
    ]);
    expect(parseGithubPullRequestHref('http://github.com/acme/widgets/pull/1')).toBeNull();
  });

  test('shares repository and merge-safety decisions across clients', () => {
    const link = parseGithubPullRequestHref(pullRequest.htmlUrl)!;
    expect(githubPullRequestMatchesRepo(link, { owner: 'NERFZAEL', repo: 'Drone' })).toBe(true);
    expect(githubPullRequestForceMergeReason(pullRequest)).toBe('checks are still pending');
    expect(githubPullRequestMergeBlockedReason(pullRequest)).toBeNull();
    expect(githubPullRequestStatusBadges(pullRequest)).toEqual([
      { key: 'checks_pending', label: 'Checks pending', tone: 'warning' },
      { key: 'review_required', label: 'Review required', tone: 'warning' },
    ]);
    expect(
      githubPullRequestMergeBlockedReason({ ...pullRequest, hasMergeConflicts: true }),
    ).toBe('merge conflicts detected');
  });
});
