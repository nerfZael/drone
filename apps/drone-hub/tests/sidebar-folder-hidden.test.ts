import { describe, expect, test } from 'bun:test';
import { isSidebarFolderHidden } from '../src/droneHub/app/is-sidebar-folder-hidden';

describe('sidebar folder visibility', () => {
  test('keeps same-named groups in other repositories visible', () => {
    const hiddenTokens = new Set(['group-id:review-a']);

    expect(isSidebarFolderHidden(hiddenTokens, 'Review', 'group', { Review: 'review-a' }))
      .toBe(true);
    expect(isSidebarFolderHidden(hiddenTokens, 'Review', 'group', { Review: 'review-b' }))
      .toBe(false);
  });

  test('hides descendants of a hidden repository-scoped group', () => {
    expect(
      isSidebarFolderHidden(
        new Set(['group-id:review-a']),
        'Review/Ready',
        'group',
        { Review: 'review-a', 'Review/Ready': 'ready-a' },
      ),
    ).toBe(true);
  });
});
