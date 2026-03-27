import { describe, expect, test } from 'bun:test';
import { shouldApplySuggestedKanbanTitle } from '../src/droneHub/app/kanban-generated-title-state';

describe('kanban generated title state', () => {
  test('allows a suggestion only while the provisional title is still pending', () => {
    expect(
      shouldApplySuggestedKanbanTitle({
        pendingProvisionalTitle: 'Refactor board header',
        provisionalTitle: 'Refactor board header',
        currentTitle: 'Refactor board header',
      }),
    ).toBe(true);
  });

  test('blocks a suggestion after manual title editing clears the pending provisional title', () => {
    expect(
      shouldApplySuggestedKanbanTitle({
        pendingProvisionalTitle: '',
        provisionalTitle: 'Refactor board header',
        currentTitle: 'Refactor board header',
      }),
    ).toBe(false);
  });

  test('blocks a suggestion once the current title no longer matches the provisional title', () => {
    expect(
      shouldApplySuggestedKanbanTitle({
        pendingProvisionalTitle: 'Refactor board header',
        provisionalTitle: 'Refactor board header',
        currentTitle: 'My custom title',
      }),
    ).toBe(false);
  });
});
