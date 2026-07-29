import { describe, expect, test } from 'bun:test';
import {
  groupSidebarRepoScopedGroupsByRepoGroup,
  normalizeSidebarRepoScopedGroupMap,
  removeSidebarRepoScopedGroupMapKeysByPrefix,
  rewriteSidebarRepoScopedGroupMapKeysByPrefix,
} from '../src/droneHub/app/sidebar-repo-scoped-groups';

describe('sidebar-repo-scoped-groups', () => {
  test('normalizes persisted repo-scoped folder ownership', () => {
    expect(
      normalizeSidebarRepoScopedGroupMap({
        Alpha: 'repo:/work/a',
        ' ': 'repo:/work/skip',
        Beta: '',
      }),
    ).toEqual({
      Alpha: 'repo:/work/a',
    });
  });

  test('rewrites descendant keys on rename', () => {
    expect(
      rewriteSidebarRepoScopedGroupMapKeysByPrefix(
        {
          Alpha: 'repo:/work/a',
          'Alpha/Beta': 'repo:/work/a',
          Gamma: 'repo:/work/b',
        },
        'Alpha',
        'Delta',
      ),
    ).toEqual({
      Delta: 'repo:/work/a',
      'Delta/Beta': 'repo:/work/a',
      Gamma: 'repo:/work/b',
    });
  });

  test('removes a deleted subtree', () => {
    expect(
      removeSidebarRepoScopedGroupMapKeysByPrefix(
        {
          Alpha: 'repo:/work/a',
          'Alpha/Beta': 'repo:/work/a',
          Gamma: 'repo:/work/b',
        },
        'Alpha',
      ),
    ).toEqual({
      Gamma: 'repo:/work/b',
    });
  });

  test('removes a deleted subtree only from the requested repository', () => {
    expect(
      removeSidebarRepoScopedGroupMapKeysByPrefix(
        {
          Alpha: 'repo:/work/a',
          'Alpha/Beta': 'repo:/work/a',
          Gamma: 'repo:/work/b',
        },
        'Alpha',
        'repo:/work/b',
      ),
    ).toEqual({
      Alpha: 'repo:/work/a',
      'Alpha/Beta': 'repo:/work/a',
      Gamma: 'repo:/work/b',
    });
  });

  test('groups folder paths by repo owner', () => {
    expect(
      groupSidebarRepoScopedGroupsByRepoGroup({
        Alpha: 'repo:/work/a',
        Beta: 'repo:/work/a',
        Gamma: 'repo:/work/b',
      }),
    ).toEqual({
      'repo:/work/a': ['Alpha', 'Beta'],
      'repo:/work/b': ['Gamma'],
    });
  });
});
