import { describe, expect, test } from 'bun:test';
import { githubPullRequestGraphqlStatesForList } from '../src/hub/github-pull-requests';

describe('GitHub pull request GraphQL states', () => {
  test('includes merged pull requests in closed and all-state queries', () => {
    expect(githubPullRequestGraphqlStatesForList('open')).toEqual(['OPEN']);
    expect(githubPullRequestGraphqlStatesForList('closed')).toEqual(['CLOSED', 'MERGED']);
    expect(githubPullRequestGraphqlStatesForList('all')).toEqual(['OPEN', 'CLOSED', 'MERGED']);
  });
});
