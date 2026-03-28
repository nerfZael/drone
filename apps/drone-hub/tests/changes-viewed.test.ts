import { describe, expect, test } from 'bun:test';
import { readViewedChangesStore, setEntryViewed, viewedStateForEntry } from '../src/droneHub/changes/viewed';

describe('changes viewed store', () => {
  test('marks files viewed within a review scope and detects stale tokens', () => {
    const scopeId = 'scope-a';
    const entry = {
      path: 'src/app.ts',
      originalPath: null,
      reviewKey: '\u0000src/app.ts',
      reviewToken: 'token-a',
    };

    const initial = readViewedChangesStore();
    const marked = setEntryViewed(initial, scopeId, entry, true);
    expect(viewedStateForEntry(marked, scopeId, entry)).toBe('viewed');

    const changed = {
      ...entry,
      reviewToken: 'token-b',
    };
    expect(viewedStateForEntry(marked, scopeId, changed)).toBe('stale');

    const cleared = setEntryViewed(marked, scopeId, changed, false);
    expect(viewedStateForEntry(cleared, scopeId, changed)).toBe('unviewed');
  });
});
