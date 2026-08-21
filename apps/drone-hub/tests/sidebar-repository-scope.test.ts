import { describe, expect, test } from 'bun:test';
import {
  hasSidebarRepoPathScope,
  sidebarGroupMutationKey,
  sidebarRepoGroupPathFromRepoPath,
  sidebarRepoPathFromGroupPath,
  sidebarRepoScopedGroupPath,
} from '../src/droneHub/app/sidebar-repository-scope';

describe('sidebar repository scope', () => {
  test('round-trips an attached repository path', () => {
    const repoPath = '/work/repo';
    expect(sidebarRepoPathFromGroupPath(sidebarRepoGroupPathFromRepoPath(repoPath)))
      .toBe(repoPath);
  });

  test('uses an explicit scope for drones without a repository', () => {
    expect(sidebarRepoGroupPathFromRepoPath('')).toBe('repo:ungrouped');
    expect(sidebarRepoPathFromGroupPath('repo:ungrouped')).toBe('');
  });

  test('does not interpret an ordinary group path as a repository', () => {
    expect(sidebarRepoPathFromGroupPath('Review/Ready')).toBeNull();
  });

  test('preserves an explicit empty repository scope', () => {
    expect(hasSidebarRepoPathScope(undefined)).toBe(false);
    expect(hasSidebarRepoPathScope({})).toBe(false);
    expect(hasSidebarRepoPathScope({ repoPath: '' })).toBe(true);
  });

  test('isolates mutation keys for same-named repository groups', () => {
    const target = sidebarRepoScopedGroupPath('repo:/work/a', 'Review');
    expect(target).toBe('repo-scope:repo:/work/a:Review');
    expect(sidebarGroupMutationKey('Review', 'repo:/work/a')).toBe(target);
    expect(sidebarGroupMutationKey('Review', 'repo:/work/b')).not.toBe(target);
    expect(sidebarGroupMutationKey('Review')).toBe('Review');
  });
});
