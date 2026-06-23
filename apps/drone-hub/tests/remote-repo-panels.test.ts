import { describe, expect, test } from 'bun:test';
import { REMOTE_REPO_PANEL_ENTRIES } from '../src/remote/remote-repo-panel-config';

describe('remote repo panels', () => {
  test('exposes changes and PRs panels', () => {
    expect(REMOTE_REPO_PANEL_ENTRIES).toEqual([
      { value: 'changes', label: 'Changes' },
      { value: 'prs', label: 'PRs' },
    ]);
  });
});
