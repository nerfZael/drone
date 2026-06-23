import { describe, expect, test } from 'bun:test';
import {
  activateFileTab,
  closeFileTab,
  openedFileTabDirty,
  openedFileTabId,
  openFileTab,
  reorderFileTabs,
  updateFileTabContent,
  type OpenedFileTabsState,
} from '../src/droneHub/app/opened-file-tabs';

function openTab(
  state: OpenedFileTabsState,
  path: string,
  navigationSeq: number,
  overrides: Partial<Parameters<typeof openFileTab>[1]> = {},
): OpenedFileTabsState {
  const name = path.split('/').filter(Boolean).pop() || path;
  return openFileTab(state, {
    droneId: 'drone-1',
    path,
    name,
    targetLine: null,
    targetColumn: null,
    navigationSeq,
    ...overrides,
  });
}

describe('opened file tabs', () => {
  test('opens new files and reuses an existing tab for the same file', () => {
    let state: OpenedFileTabsState = { tabs: [], activeTabId: null };
    state = openTab(state, '/work/repo/a.ts', 1);
    state = openTab(state, '/work/repo/b.ts', 2);
    state = openTab(state, '/work/repo/a.ts', 3, { targetLine: 12, targetColumn: 4 });

    expect(state.tabs.map((tab) => tab.path)).toEqual(['/work/repo/a.ts', '/work/repo/b.ts']);
    expect(state.activeTabId).toBe(openedFileTabId('drone-1', '/work/repo/a.ts'));
    expect(state.tabs[0].navigationSeq).toBe(3);
    expect(state.tabs[0].targetLine).toBe(12);
    expect(state.tabs[0].targetColumn).toBe(4);
  });

  test('creates printable tab ids for drag and DOM usage', () => {
    const tabId = openedFileTabId('drone:1', '/work/repo/a b.ts');

    expect(tabId).toBe('file:drone%3A1:%2Fwork%2Frepo%2Fa%20b.ts');
    expect(tabId.includes('\u0000')).toBe(false);
  });

  test('switches the active tab without changing tab order', () => {
    let state: OpenedFileTabsState = { tabs: [], activeTabId: null };
    state = openTab(state, '/work/repo/a.ts', 1);
    state = openTab(state, '/work/repo/b.ts', 2);
    state = activateFileTab(state, openedFileTabId('drone-1', '/work/repo/a.ts'));

    expect(state.activeTabId).toBe(openedFileTabId('drone-1', '/work/repo/a.ts'));
    expect(state.tabs.map((tab) => tab.path)).toEqual(['/work/repo/a.ts', '/work/repo/b.ts']);
  });

  test('closes inactive and active tabs while preserving a useful active tab', () => {
    let state: OpenedFileTabsState = { tabs: [], activeTabId: null };
    state = openTab(state, '/work/repo/a.ts', 1);
    state = openTab(state, '/work/repo/b.ts', 2);
    state = openTab(state, '/work/repo/c.ts', 3);

    state = closeFileTab(state, openedFileTabId('drone-1', '/work/repo/a.ts'));
    expect(state.activeTabId).toBe(openedFileTabId('drone-1', '/work/repo/c.ts'));
    expect(state.tabs.map((tab) => tab.path)).toEqual(['/work/repo/b.ts', '/work/repo/c.ts']);

    state = closeFileTab(state, openedFileTabId('drone-1', '/work/repo/c.ts'));
    expect(state.activeTabId).toBe(openedFileTabId('drone-1', '/work/repo/b.ts'));
    expect(state.tabs.map((tab) => tab.path)).toEqual(['/work/repo/b.ts']);
  });

  test('tracks dirty state per text tab', () => {
    let state: OpenedFileTabsState = { tabs: [], activeTabId: null };
    state = openTab(state, '/work/repo/a.ts', 1);
    state = {
      ...state,
      tabs: state.tabs.map((tab) => ({ ...tab, loaded: true, content: 'saved', savedContent: 'saved' })),
    };
    state = { ...state, tabs: updateFileTabContent(state.tabs, state.activeTabId, 'changed') };

    expect(openedFileTabDirty(state.tabs[0])).toBe(true);
    expect(openedFileTabDirty({ ...state.tabs[0], kind: 'binary' })).toBe(false);
  });

  test('reorders tabs without changing the active tab', () => {
    let state: OpenedFileTabsState = { tabs: [], activeTabId: null };
    state = openTab(state, '/work/repo/a.ts', 1);
    state = openTab(state, '/work/repo/b.ts', 2);
    state = openTab(state, '/work/repo/c.ts', 3);
    const activeBefore = state.activeTabId;

    state = reorderFileTabs(
      state,
      openedFileTabId('drone-1', '/work/repo/c.ts'),
      openedFileTabId('drone-1', '/work/repo/a.ts'),
    );

    expect(state.tabs.map((tab) => tab.path)).toEqual(['/work/repo/c.ts', '/work/repo/a.ts', '/work/repo/b.ts']);
    expect(state.activeTabId).toBe(activeBefore);
  });
});
