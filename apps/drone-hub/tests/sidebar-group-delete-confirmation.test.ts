import { describe, expect, test } from 'bun:test';
import { buildSidebarGroupDeleteConfirmation } from '../src/droneHub/app/sidebar-group-delete-confirmation';

describe('sidebar group delete confirmation', () => {
  test('describes deleting an empty repository-scoped group without implying other repos are affected', () => {
    expect(buildSidebarGroupDeleteConfirmation({
      kind: 'group',
      label: 'todo',
      countHint: 0,
      repoPath: '/work/alpha',
    })).toEqual({
      title: 'Delete group “todo”?',
      message: 'This permanently deletes this empty group. Only this group in /work/alpha is affected; groups with the same name in other repositories are not affected.',
      confirmLabel: 'Delete group',
      destructive: true,
    });
  });

  test('warns that a populated group includes its contents', () => {
    const confirmation = buildSidebarGroupDeleteConfirmation({
      kind: 'group',
      label: 'review',
      countHint: 2,
      repoPath: '/work/alpha',
    });

    expect(confirmation.message).toContain('this group and its contents (2 drones)');
    expect(confirmation.message).toContain('containers and registry entries');
    expect(confirmation.confirmLabel).toBe('Delete group and contents');
  });

  test('makes repository grouping deletion about drones, not deleting the repository', () => {
    const confirmation = buildSidebarGroupDeleteConfirmation({
      kind: 'repo',
      label: 'alpha',
      countHint: 1,
      repoPath: '/work/alpha',
    });

    expect(confirmation.title).toBe('Delete drones in “alpha”?');
    expect(confirmation.message).toContain('all 1 drone attached to /work/alpha');
    expect(confirmation.message).toContain('The repository itself is not deleted.');
    expect(confirmation.confirmLabel).toBe('Delete drones');
  });
});
