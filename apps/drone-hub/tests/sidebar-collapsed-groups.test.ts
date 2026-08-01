import { describe, expect, test } from 'bun:test';
import { isSidebarGroupCollapsed } from '../src/droneHub/app/is-sidebar-group-collapsed';

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
});
