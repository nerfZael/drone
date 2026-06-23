import { describe, expect, test } from 'bun:test';
import {
  emptyEditorLocationHistory,
  goBackInEditorHistory,
  goForwardInEditorHistory,
  pushEditorLocation,
} from '../src/droneHub/files/editor-location-history';

describe('editor location history', () => {
  test('goes back and forward between file and line targets', () => {
    let history = emptyEditorLocationHistory;
    history = pushEditorLocation(history, { droneId: 'd1', path: '/work/repo/a.ts', name: 'a.ts', line: null, column: null });
    history = pushEditorLocation(history, { droneId: 'd1', path: '/work/repo/b.ts', name: 'b.ts', line: 12, column: 3 });
    history = pushEditorLocation(history, { droneId: 'd1', path: '/work/repo/b.ts', name: 'b.ts', line: 20, column: 1 });

    const backOne = goBackInEditorHistory(history);
    expect(backOne.location).toMatchObject({ path: '/work/repo/b.ts', line: 12, column: 3 });

    const backTwo = goBackInEditorHistory(backOne.history);
    expect(backTwo.location).toMatchObject({ path: '/work/repo/a.ts', line: null, column: null });

    const forward = goForwardInEditorHistory(backTwo.history);
    expect(forward.location).toMatchObject({ path: '/work/repo/b.ts', line: 12, column: 3 });
  });

  test('new jumps after back replace forward history', () => {
    let history = emptyEditorLocationHistory;
    history = pushEditorLocation(history, { droneId: 'd1', path: '/work/repo/a.ts', name: 'a.ts', line: null, column: null });
    history = pushEditorLocation(history, { droneId: 'd1', path: '/work/repo/b.ts', name: 'b.ts', line: null, column: null });
    history = pushEditorLocation(history, { droneId: 'd1', path: '/work/repo/c.ts', name: 'c.ts', line: null, column: null });

    const back = goBackInEditorHistory(history);
    const branched = pushEditorLocation(back.history, { droneId: 'd1', path: '/work/repo/d.ts', name: 'd.ts', line: null, column: null });

    expect(branched.entries.map((entry) => entry.path)).toEqual(['/work/repo/a.ts', '/work/repo/b.ts', '/work/repo/d.ts']);
    expect(goForwardInEditorHistory(branched).location).toBeNull();
  });
});
