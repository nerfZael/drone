import { beforeEach, describe, expect, test } from 'bun:test';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();
const testWindow = new EventTarget() as EventTarget & { localStorage: MemoryStorage };
testWindow.localStorage = storage;
(globalThis as any).window ??= testWindow;
(globalThis as any).window.localStorage ??= storage;
(globalThis as any).localStorage ??= storage;
const localStorage = (globalThis as any).window.localStorage as MemoryStorage;

const {
  EDITOR_UNTITLED_FILES_STORAGE_KEY,
  isUntitledEditorPath,
  nextUntitledFileName,
  readStoredUntitledFiles,
  untitledFilesFromTabState,
  writeStoredUntitledFiles,
} = await import('../src/droneHub/app/untitled-editor-files');
const { createUntitledFileTab, openFileTab, openedFileTabDirty, updateFileTabContent } = await import(
  '../src/droneHub/app/opened-file-tabs'
);
const { restoredOpenedFileTabsStateByDrone, rememberedEditorFileFromTab, writeRememberedEditorFile } = await import(
  '../src/droneHub/app/drone-file-editor-state'
);
const { takeSourceModeHint, openNextInSourceMode, textViewModeKey } = await import(
  '../src/droneHub/files/text-view-mode-hints'
);

describe('untitled editor files', () => {
  beforeEach(() => localStorage.clear());

  test('names new files with the first free Untitled-N', () => {
    expect(nextUntitledFileName([])).toBe('Untitled-1');
    expect(nextUntitledFileName(['Untitled-1', 'Untitled-3'])).toBe('Untitled-2');
  });

  test('an untitled tab is loaded, never a disk path, and dirty once it has text', () => {
    const tab = createUntitledFileTab({ droneId: 'drone-a', name: 'Untitled-1', navigationSeq: 1 });
    expect(tab).toMatchObject({ loaded: true, untitled: true, content: '', kind: 'text' });
    expect(isUntitledEditorPath(tab.path)).toBe(true);
    expect(isUntitledEditorPath('/work/repo/untitled:x')).toBe(false);
    expect(openedFileTabDirty(tab)).toBe(false);
    const [edited] = updateFileTabContent([tab], tab.tabId, 'hello');
    expect(openedFileTabDirty(edited!)).toBe(true);
    expect(rememberedEditorFileFromTab(edited)).toBeNull();
  });

  test('stores untitled text per drone and restores it, dirty, next to the remembered file', () => {
    let state = openFileTab({ tabs: [], activeTabId: null }, {
      droneId: 'drone-a', path: '/work/repo/a.ts', name: 'a.ts', targetLine: null, targetColumn: null, navigationSeq: 1,
    });
    const untitled = createUntitledFileTab({ droneId: 'drone-a', name: 'Untitled-1', navigationSeq: 2 });
    state = { tabs: updateFileTabContent([...state.tabs, untitled], untitled.tabId, 'draft text'), activeTabId: untitled.tabId };

    writeRememberedEditorFile('drone-a', { path: '/work/repo/a.ts', name: 'a.ts', targetLine: null, targetColumn: null });
    writeStoredUntitledFiles(untitledFilesFromTabState({ 'drone-a': state }));
    expect(readStoredUntitledFiles()).toEqual({
      'drone-a': { files: [{ name: 'Untitled-1', content: 'draft text' }], activeName: 'Untitled-1' },
    });

    const restored = restoredOpenedFileTabsStateByDrone({ includeUntitled: true })['drone-a']!;
    expect(restored.tabs.map((tab) => tab.path)).toEqual(['/work/repo/a.ts', 'untitled:Untitled-1']);
    expect(restored.activeTabId).toBe(untitled.tabId);
    expect(openedFileTabDirty(restored.tabs[1]!)).toBe(true);

    // A second editor (a desktop window) does not take the untitled files.
    const withoutUntitled = restoredOpenedFileTabsStateByDrone()['drone-a']!;
    expect(withoutUntitled.tabs.map((tab) => tab.path)).toEqual(['/work/repo/a.ts']);
  });

  test('clears storage once no untitled files are left', () => {
    writeStoredUntitledFiles({ 'drone-a': { files: [{ name: 'Untitled-1', content: 'x' }], activeName: null } });
    expect(localStorage.getItem(EDITOR_UNTITLED_FILES_STORAGE_KEY)).not.toBeNull();
    writeStoredUntitledFiles({});
    expect(localStorage.getItem(EDITOR_UNTITLED_FILES_STORAGE_KEY)).toBeNull();
  });

  test('ignores malformed stored entries', () => {
    localStorage.setItem(EDITOR_UNTITLED_FILES_STORAGE_KEY, JSON.stringify({
      'drone-a': { files: [{ name: 'Untitled-1', content: 1 }, { name: '', content: '' }] },
      'drone-b': { files: [{ name: 'Untitled-2', content: 'ok' }, { name: 'Untitled-2', content: 'dupe' }], activeName: 'gone' },
    }));
    expect(readStoredUntitledFiles()).toEqual({
      'drone-b': { files: [{ name: 'Untitled-2', content: 'ok' }], activeName: null },
    });
  });

  test('a saved file opens in source mode once', () => {
    openNextInSourceMode('drone-a', '/work/repo/notes.md');
    const key = textViewModeKey('drone-a', '/work/repo/notes.md');
    expect(takeSourceModeHint(key)).toBe(true);
    expect(takeSourceModeHint(key)).toBe(false);
  });
});
