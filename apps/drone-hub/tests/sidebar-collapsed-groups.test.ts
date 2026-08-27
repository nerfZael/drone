import { describe, expect, test } from 'bun:test';
import { isSidebarGroupCollapsed } from '../src/droneHub/app/is-sidebar-group-collapsed';
import { renameCollapsedGroupKeysByPrefix } from '../src/droneHub/app/sidebar-collapsed-groups';
import {
  reparentSidebarGroupPath,
  replaceSidebarGroupPathSuffix,
} from '../src/droneHub/app/sidebar-group-paths';

describe('sidebar collapsed groups', () => {
  test('collapses groups without saved viewer state by default', () => {
    expect(isSidebarGroupCollapsed({}, 'My group')).toBe(true);
  });

  test('honors the viewer state saved for an open or closed group', () => {
    expect(isSidebarGroupCollapsed({ 'My group': false }, 'My group')).toBe(false);
    expect(isSidebarGroupCollapsed({ 'My group': true }, 'My group')).toBe(true);
  });

  test('does not treat the sidebar root as a collapsible group', () => {
    expect(isSidebarGroupCollapsed({}, '')).toBe(false);
    expect(isSidebarGroupCollapsed({}, '   ')).toBe(false);
  });

  test('renames collapsed state only inside the targeted repository', () => {
    const target = 'repo-scope:repo:/work/a:Review';
    const other = 'repo-scope:repo:/work/b:Review';

    expect(
      renameCollapsedGroupKeysByPrefix(
        { [target]: true, [`${target}/Ready`]: false, [other]: true },
        target,
        'repo-scope:repo:/work/a:Approved',
      ),
    ).toEqual({
      'repo-scope:repo:/work/a:Approved': true,
      'repo-scope:repo:/work/a:Approved/Ready': false,
      [other]: true,
    });
  });

  test('keeps the expansion key when a nested group moves to another parent', () => {
    const nextGroupPath = reparentSidebarGroupPath('Review/Ready', 'Archive');
    const currentScopedPath = 'repo-scope:repo:/work/a:Review/Ready';
    const nextScopedPath = replaceSidebarGroupPathSuffix(
      currentScopedPath,
      'Review/Ready',
      nextGroupPath,
    );

    expect(nextGroupPath).toBe('Archive/Ready');
    expect(nextScopedPath).toBe('repo-scope:repo:/work/a:Archive/Ready');
    expect(renameCollapsedGroupKeysByPrefix(
      { [currentScopedPath]: false, [`${currentScopedPath}/Later`]: true },
      currentScopedPath,
      nextScopedPath,
    )).toEqual({
      'repo-scope:repo:/work/a:Archive/Ready': false,
      'repo-scope:repo:/work/a:Archive/Ready/Later': true,
    });
  });

  test('keeps in-drone chat-group expansion scoped to its drone when moved', () => {
    const current = 'chat-group:drone-a:Review';
    const otherDrone = 'chat-group:drone-b:Review';

    expect(renameCollapsedGroupKeysByPrefix(
      { [current]: false, [`${current}/Ready`]: true, [otherDrone]: true },
      current,
      'chat-group:drone-a:Archive/Review',
    )).toEqual({
      'chat-group:drone-a:Archive/Review': false,
      'chat-group:drone-a:Archive/Review/Ready': true,
      [otherDrone]: true,
    });
  });
});
