import { describe, expect, test } from 'bun:test';
import { isSidebarGroupCollapsed } from '../src/droneHub/app/is-sidebar-group-collapsed';
import { renameCollapsedGroupKeysByPrefix } from '../src/droneHub/app/sidebar-collapsed-groups';

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
});
