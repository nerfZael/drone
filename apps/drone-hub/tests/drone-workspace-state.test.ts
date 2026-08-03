import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { openFileTab, updateFileTabContent } from '../src/droneHub/app/opened-file-tabs';
import {
  openedFileTabsStateForDrone,
  updateOpenedFileTabsStateForDrone,
} from '../src/droneHub/app/drone-file-editor-state';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();
const testWindow = new EventTarget() as EventTarget & { localStorage: MemoryStorage };
testWindow.localStorage = storage;
(globalThis as any).window = testWindow;
(globalThis as any).localStorage = storage;

const {
  readActiveWhiteboardId,
  WHITEBOARD_ACTIVE_STORAGE_KEY,
  writeActiveWhiteboardId,
} = await import('../src/droneHub/whiteboard/whiteboard-events');
const { restoreRequiredWorkspacePanels } = await import('../src/droneHub/app/DockableDroneWorkspace');

function readAppSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, '../src/droneHub', relativePath), 'utf8');
}

describe('per-drone workspace state', () => {
  beforeEach(() => storage.clear());

  test('stores the active whiteboard independently for each drone', () => {
    writeActiveWhiteboardId('drone-a', 'board-a');
    writeActiveWhiteboardId('drone-b', 'board-b');

    expect(readActiveWhiteboardId('drone-a')).toBe('board-a');
    expect(readActiveWhiteboardId('drone-b')).toBe('board-b');
    expect(JSON.parse(storage.getItem(WHITEBOARD_ACTIVE_STORAGE_KEY) ?? '{}')).toEqual({
      'drone-a': 'board-a',
      'drone-b': 'board-b',
    });
  });

  test('migrates a legacy single active whiteboard value', () => {
    storage.setItem(WHITEBOARD_ACTIVE_STORAGE_KEY, 'legacy-board');

    expect(readActiveWhiteboardId('drone-a')).toBe('legacy-board');
    writeActiveWhiteboardId('drone-a', 'board-a');
    expect(readActiveWhiteboardId('drone-a')).toBe('board-a');
  });

  test('keys Dockview mounts and persisted layouts by drone', () => {
    const workspace = readAppSource('app/DockableDroneWorkspace.tsx');
    const selectedWorkspace = readAppSource('app/SelectedDroneWorkspace.tsx');

    expect(workspace).toContain('workspaceLayoutStorageKey(droneId)');
    expect(workspace).toContain('writeStoredLayout(currentDrone.id, layout)');
    expect(selectedWorkspace).toContain('key={currentDrone.id}');
  });

  test('keeps one globally positioned File Explorer inside the Editor', () => {
    const editorWorkspace = readAppSource('app/DroneEditorWorkspace.tsx');
    const appConfig = readAppSource('app/app-config.ts');

    expect(editorWorkspace).toContain("profileStorageKey('droneHub.editorExplorerLayout')");
    expect(editorWorkspace).toContain('DEFAULT_EXPLORER_WIDTH = 240');
    expect(editorWorkspace).toContain('draggable');
    expect(editorWorkspace).toContain('File Explorer');
    expect(appConfig).toContain("if (raw === 'files') return 'editor'");
  });

  test('repairs an empty saved chat group and restores chat beside the editor', () => {
    const emptyGroup = { panels: [] };
    const editorPanel = {
      api: {
        id: 'tool:editor',
        group: { api: { location: { type: 'grid' } } },
      },
    };
    const editorGroup = { panels: [editorPanel] };
    const removedGroups: unknown[] = [];
    const addedPanels: Array<{
      id?: string;
      component?: string;
      position?: { direction?: string; referencePanel?: string };
    }> = [];
    const api = {
      groups: [emptyGroup, editorGroup],
      panels: [editorPanel],
      getPanel: () => undefined,
      removeGroup: (group: unknown) => removedGroups.push(group),
      addPanel: (panel: (typeof addedPanels)[number]) => addedPanels.push(panel),
    };

    restoreRequiredWorkspacePanels(api as unknown as Parameters<typeof restoreRequiredWorkspacePanels>[0]);

    expect(removedGroups).toEqual([emptyGroup]);
    expect(addedPanels).toHaveLength(1);
    expect(addedPanels[0]).toMatchObject({
      id: 'agent-chat',
      component: 'chat',
      position: { direction: 'left', referencePanel: 'tool:editor' },
    });
  });

  test('does not persist a teardown layout after the required chat panel is gone', () => {
    const workspace = readAppSource('app/DockableDroneWorkspace.tsx');

    expect(workspace).toContain('if (!layout.panels[CHAT_PANEL_ID]) return;');
    expect(workspace).toContain('unmountingRef.current = false;');
    expect(workspace).toContain('unmountingRef.current = true;');
  });

  test('keeps editor tabs in drone-keyed buckets instead of clearing them on navigation', () => {
    const editorState = readAppSource('app/use-file-editor-state.ts');

    expect(editorState).toContain('openedFileTabsStateForDrone(tabStateByDroneId, currentDroneId)');
    expect(editorState).toContain('setTabStateForDrone(droneId');
    expect(editorState).not.toContain('if (tabs.every((tab) => String(tab.droneId) === droneId)) return;');
  });

  test('restores each drone editor bucket, including dirty content', () => {
    let state = {};
    state = updateOpenedFileTabsStateForDrone(state, 'drone-a', (current) =>
      openFileTab(current, {
        droneId: 'drone-a',
        path: '/work/repo/a.ts',
        name: 'a.ts',
        targetLine: null,
        targetColumn: null,
        navigationSeq: 1,
      }),
    );
    const droneATabId = openedFileTabsStateForDrone(state, 'drone-a').activeTabId;
    state = updateOpenedFileTabsStateForDrone(state, 'drone-a', (current) => ({
      ...current,
      tabs: updateFileTabContent(current.tabs, droneATabId, 'unsaved change'),
    }));
    state = updateOpenedFileTabsStateForDrone(state, 'drone-b', (current) =>
      openFileTab(current, {
        droneId: 'drone-b',
        path: '/work/repo/b.ts',
        name: 'b.ts',
        targetLine: null,
        targetColumn: null,
        navigationSeq: 2,
      }),
    );

    expect(openedFileTabsStateForDrone(state, 'drone-a').tabs[0]?.content).toBe('unsaved change');
    expect(openedFileTabsStateForDrone(state, 'drone-b').tabs[0]?.path).toBe('/work/repo/b.ts');
  });
});
