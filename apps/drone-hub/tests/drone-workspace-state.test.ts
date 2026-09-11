import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { profileStorageKey } from '../src/profile-storage';
import { openFileTab, updateFileTabContent } from '../src/droneHub/app/opened-file-tabs';
import {
  EDITOR_LAST_FILE_STORAGE_KEY,
  openedFileTabsStateForDrone,
  readRememberedEditorFile,
  restoredOpenedFileTabsStateByDrone,
  updateOpenedFileTabsStateForDrone,
  writeRememberedEditorFile,
} from '../src/droneHub/app/drone-file-editor-state';

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
(globalThis as any).window = testWindow;
(globalThis as any).localStorage = storage;

const {
  readActiveWhiteboardId,
  WHITEBOARD_ACTIVE_STORAGE_KEY,
  writeActiveWhiteboardId,
} = await import('../src/droneHub/whiteboard/whiteboard-events');
const {
  resetWorkspaceToChat,
  rebalanceGridGroupWidths,
  sizeWorkspaceOpenedFromChat,
  ensureWorkspaceToolPanel,
  migrateEditorChangesPanels,
  refreshWorkspacePanelTitles,
  restoreRequiredWorkspacePanels,
} = await import('../src/droneHub/app/DockableDroneWorkspace');
const {
  readWorkspaceExplorerWidth,
  readWorkspaceExplorerZoom,
  WORKSPACE_EXPLORER_WIDTH_STORAGE_KEY,
  WORKSPACE_EXPLORER_ZOOM_STORAGE_KEY,
  writeWorkspaceExplorerWidth,
  writeWorkspaceExplorerZoom,
} = await import('../src/droneHub/app/workspace-explorer-preferences');
const { resolveExplorerDropSide } = await import('../src/droneHub/app/DroneEditorWorkspace');

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
    const workspaceTools = readAppSource('app/use-workspace-tools.ts');

    expect(workspace).toContain('workspaceLayoutStorageKey(droneId)');
    expect(workspace).toContain('writeStoredLayout(currentDrone.id, layout)');
    expect(selectedWorkspace).toContain('key={currentDrone.id}');
    expect(workspaceTools).toContain('visibleToolTabsByDrone');
    expect(workspaceTools).toContain('[droneId]: tabs');
    expect(selectedWorkspace).toContain('onVisibleToolTabsChange={onVisibleToolTabsChange}');
  });

  test('opens the Changes tool for an agent-run diff request', () => {
    const selectedWorkspace = readAppSource('app/SelectedDroneWorkspace.tsx');

    expect(selectedWorkspace).toContain(
      'window.addEventListener(CHANGES_OPEN_AGENT_RUN_EVENT, openAgentRunChanges)',
    );
    expect(selectedWorkspace).toContain("requestRightPanelTab('changes')");
    expect(selectedWorkspace).toContain(
      'window.removeEventListener(CHANGES_OPEN_AGENT_RUN_EVENT, openAgentRunChanges)',
    );
  });

  test('creates a fresh workspace with only the required chat panel', () => {
    const addedPanels: Array<{ id?: string; component?: string }> = [];
    let clearCount = 0;
    const api = {
      panels: [],
      getPanel: () => undefined,
      clear: () => {
        clearCount += 1;
      },
      addPanel: (panel: (typeof addedPanels)[number]) => addedPanels.push(panel),
    };

    resetWorkspaceToChat(
      api as unknown as Parameters<typeof resetWorkspaceToChat>[0],
    );

    expect(clearCount).toBe(1);
    expect(addedPanels).toEqual([
      expect.objectContaining({ id: 'agent-chat', component: 'chat' }),
    ]);
  });

  test('uses the same File Explorer chrome and preferences in Editor and Changes', () => {
    const editorWorkspace = readAppSource('app/DroneEditorWorkspace.tsx');
    const changesDock = readAppSource('changes/DroneChangesDock.tsx');
    const rightPanel = readAppSource('app/RightPanelTabContent.tsx');
    const appConfig = readAppSource('app/app-config.ts');

    expect(editorWorkspace).toContain("profileStorageKey('droneHub.editorExplorerLayout')");
    expect(editorWorkspace).toContain('<WorkspaceExplorerHeader');
    expect(editorWorkspace).toContain("dragHandle={pane === 'combined'");
    expect(editorWorkspace).toContain('onDragOver={handleDragOver}');
    expect(editorWorkspace).toContain('onDrop={handleDrop}');
    expect(editorWorkspace).toContain("dropSide === 'left' ? 'left-0' : 'right-0'");
    expect(changesDock).toContain('<WorkspaceExplorerHeader');
    expect(rightPanel).toContain('zoom={explorerZoom}');
    expect(editorWorkspace).toContain('aria-label="File Explorer"');
    expect(appConfig).toContain("if (raw === 'files') return 'editor'");
  });

  test('targets the explorer side from the workspace midpoint', () => {
    expect(resolveExplorerDropSide(100, 600, 100)).toBe('left');
    expect(resolveExplorerDropSide(100, 600, 399)).toBe('left');
    expect(resolveExplorerDropSide(100, 600, 400)).toBe('right');
    expect(resolveExplorerDropSide(100, 600, 700)).toBe('right');
  });

  test('shares explorer width and zoom through one preference pair', () => {
    writeWorkspaceExplorerWidth(376);
    writeWorkspaceExplorerZoom(1.2);

    expect(readWorkspaceExplorerWidth()).toBe(376);
    expect(readWorkspaceExplorerZoom()).toBe(1.2);
    expect(storage.getItem(WORKSPACE_EXPLORER_WIDTH_STORAGE_KEY)).toBe('376');
    expect(storage.getItem(WORKSPACE_EXPLORER_ZOOM_STORAGE_KEY)).toBe('1.2');
  });

  test('migrates the previous Changes explorer preferences into the shared model', () => {
    storage.setItem(profileStorageKey('droneHub.changesExplorerWidthPx'), '412');
    storage.setItem(profileStorageKey('droneHub.changesExplorerZoom'), '0.9');

    expect(readWorkspaceExplorerWidth()).toBe(412);
    expect(readWorkspaceExplorerZoom()).toBe(0.9);
  });

  test('opens the first tool with two thirds of the workspace width', () => {
    const added: any[] = [];
    const api = {
      width: 1800,
      panels: [{ id: 'agent-chat' }],
      groups: [],
      getPanel: () => undefined,
      addPanel: (panel: unknown) => added.push(panel),
    };
    ensureWorkspaceToolPanel(api as any, 'terminal', 'single');
    expect(added[0].initialWidth).toBe(1200);
  });

  function sizingWorkspace(panelIds: string[][], widths: number[]) {
    const calls: Array<{ ids: string[]; width: number }> = [];
    const groups = panelIds.map((ids, index) => ({
      panels: ids.map((id) => ({ id })),
      width: widths[index],
      height: 900,
      api: {
        location: { type: 'grid' },
        setSize: ({ width }: { width: number }) => {
          calls.push({ ids, width });
          // Model sibling redistribution: subsequent resizes must still use
          // the explorer width captured before the first setSize call.
          groups.forEach((group) => { group.width = 600; });
        },
      },
    }));
    const api = {
      width: 1800,
      groups,
      getPanel: (id: string) => {
        const group = groups.find((entry) => entry.panels.some((panel) => panel.id === id));
        return group ? { api: { group } } : undefined;
      },
    };
    return { api: api as any, calls, groups };
  }

  test('opening files from chat sizes the explorer after the chat column', () => {
    writeWorkspaceExplorerWidth(280);
    const { api, calls } = sizingWorkspace(
      [['agent-chat'], ['tool:editor'], ['file-explorer']], [600, 600, 600],
    );
    sizeWorkspaceOpenedFromChat(api);
    expect(calls).toEqual([
      { ids: ['agent-chat'], width: 600 },
      { ids: ['file-explorer'], width: 280 },
    ]);
  });

  test('adding or closing tools preserves the explorer width while balancing main panes', () => {
    const { api, calls } = sizingWorkspace(
      [['agent-chat'], ['tool:editor'], ['file-explorer']], [780, 780, 240],
    );
    rebalanceGridGroupWidths(api);
    expect(calls).toEqual([
      { ids: ['agent-chat'], width: 780 },
      { ids: ['tool:editor'], width: 780 },
      { ids: ['file-explorer'], width: 240 },
    ]);
  });

  test('preserves a manually resized explorer and ignores floating groups', () => {
    const { api, calls, groups } = sizingWorkspace(
      [['agent-chat'], ['tool:editor'], ['file-explorer'], ['tool:terminal']], [600, 600, 360, 500],
    );
    groups[3].api.location.type = 'floating';
    rebalanceGridGroupWidths(api);
    expect(calls).toEqual([
      { ids: ['agent-chat'], width: 720 },
      { ids: ['tool:editor'], width: 720 },
      { ids: ['file-explorer'], width: 360 },
    ]);
  });

  test('an explorer tab sharing a group with a tool does not narrow that tool', () => {
    const { api, calls } = sizingWorkspace(
      [['agent-chat'], ['tool:editor', 'file-explorer']], [900, 900],
    );
    rebalanceGridGroupWidths(api);
    expect(calls.map((call) => call.width)).toEqual([900, 900]);
  });

  test('opens editor and explorer as separate panels and reuses their positions', () => {
    const added: any[] = [];
    const panels: any[] = [{ id: 'agent-chat' }];
    const api = {
      width: 1800,
      panels,
      groups: [],
      getPanel: (id: string) => panels.find((panel) => panel.id === id),
      addPanel: (options: any) => {
        added.push(options);
        let params = options.params;
        panels.push({ id: options.id, api: {
          getParameters: () => params,
          updateParameters: (next: any) => { params = { ...params, ...next }; },
          setTitle: () => {}, setConstraints: () => {}, setActive: () => {},
        } });
      },
    };
    expect(ensureWorkspaceToolPanel(api as any, 'editor', 'single')).toBe(true);
    expect(added.map((panel) => panel.id)).toEqual(['tool:editor', 'file-explorer']);
    expect(added[1].position).toEqual({ direction: 'right', referencePanel: 'tool:editor' });
    expect(ensureWorkspaceToolPanel(api as any, 'editor', 'single')).toBe(false);
    expect(added).toHaveLength(2);
    panels.splice(panels.findIndex((panel) => panel.id === 'file-explorer'), 1);
    expect(ensureWorkspaceToolPanel(api as any, 'editor', 'single')).toBe(true);
    expect(added[2].id).toBe('file-explorer');
  });

  test('switches Editor and Changes inside the same Dockview panel', () => {
    let params = { tab: 'editor', paneKey: 'bottom' };
    let title = 'Editor';
    let minimumWidth = 0;
    let active = false;
    const panel = {
      id: 'tool:editor',
      api: {
        getParameters: () => params,
        updateParameters: (next: typeof params) => {
          params = next;
        },
        setTitle: (next: string) => {
          title = next;
        },
        setConstraints: (next: { minimumWidth?: number }) => {
          minimumWidth = next.minimumWidth ?? 0;
        },
        setActive: () => {
          active = true;
        },
      },
    };
    const addedPanels: unknown[] = [];
    const api = {
      panels: [panel],
      getPanel: () => undefined,
      addPanel: (next: unknown) => addedPanels.push(next),
    };

    const added = ensureWorkspaceToolPanel(
      api as unknown as Parameters<typeof ensureWorkspaceToolPanel>[0],
      'changes',
      'single',
    );

    expect(added).toBe(false);
    expect(addedPanels).toHaveLength(0);
    expect(params.tab).toBe('changes');
    expect(params.paneKey).toBe('bottom');
    expect(title).toBe('Changes');
    expect(minimumWidth).toBe(480);
    expect(active).toBe(true);
  });

  test('keeps a restored Editor or Changes pane independent of another drone active tab', () => {
    let editorParams = { tab: 'editor' };
    let editorTitle = 'Editor';
    const editorPanel = {
      id: 'tool:editor',
      api: {
        getParameters: () => editorParams,
        updateParameters: (next: typeof editorParams) => {
          editorParams = next;
        },
        setTitle: (next: string) => {
          editorTitle = next;
        },
        setConstraints: () => {},
        close: () => {},
      },
    };
    const terminalPanel = {
      id: 'tool:terminal',
      api: { getParameters: () => ({ tab: 'terminal' }) },
    };
    const api = {
      panels: [editorPanel],
      activePanel: terminalPanel,
    };

    migrateEditorChangesPanels(
      api as unknown as Parameters<typeof migrateEditorChangesPanels>[0],
    );

    expect(editorParams.tab).toBe('editor');
    expect(editorTitle).toBe('Editor');
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

  test('replaces stale titles restored from saved workspace layouts', () => {
    const titles = new Map<string, string>([
      ['agent-chat', 'Chat'],
      ['tool:prs', 'PRs'],
      ['tool:requests', 'Requests'],
    ]);
    const panels = Array.from(titles.keys(), (id) => ({
      id,
      api: {
        getParameters: () => ({}),
        setTitle: (title: string) => titles.set(id, title),
      },
    }));

    refreshWorkspacePanelTitles({ panels } as unknown as Parameters<typeof refreshWorkspacePanelTitles>[0]);

    expect(titles.get('agent-chat')).toBe('default');
    expect(titles.get('tool:prs')).toBe('Pull requests');
    expect(titles.get('tool:requests')).toBe('Change requests');
  });

  test('does not persist a teardown layout after the required chat panel is gone', () => {
    const workspace = readAppSource('app/DockableDroneWorkspace.tsx');

    expect(workspace).toContain('if (!layout.panels[CHAT_PANEL_ID]) return;');
    expect(workspace).toContain('unmountingRef.current = false;');
    expect(workspace).toContain('unmountingRef.current = true;');
    expect(workspace).toContain('schedulePersistCurrentLayout');
    expect(workspace).toContain('}, 200);');
    expect(workspace).toContain('lastVisibleToolTabsRef.current === nextVisibleTabsKey');
  });

  test('does not reconcile Dockview move removals as closed panels', () => {
    const workspace = readAppSource('app/DockableDroneWorkspace.tsx');
    const removalHandler = workspace.slice(
      workspace.indexOf('const removeDisposable = event.api.onDidRemovePanel'),
      workspace.indexOf('updateWorkspacePanelState();', workspace.indexOf('disposablesRef.current =')),
    );

    expect(removalHandler).toContain('const timer = window.setTimeout(() => {');
    expect(removalHandler).toContain('if (api.getPanel(panelId)) return;');
    expect(removalHandler.indexOf('if (api.getPanel(panelId)) return;')).toBeLessThan(
      removalHandler.indexOf('rebalanceWorkspaceGridGroups(onAfterToolPanelRemove);'),
    );
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

  test('restores the last active editor file for each drone from storage', () => {
    writeRememberedEditorFile('drone-a', {
      path: '/work/repo/src/a.ts',
      name: 'a.ts',
      targetLine: 12,
      targetColumn: 4,
    });
    writeRememberedEditorFile('drone-b', {
      path: '/work/repo/README.md',
      name: 'README.md',
      targetLine: null,
      targetColumn: null,
    });

    const restored = restoredOpenedFileTabsStateByDrone();
    const droneA = openedFileTabsStateForDrone(restored, 'drone-a');
    const droneB = openedFileTabsStateForDrone(restored, 'drone-b');

    expect(droneA.tabs[0]).toMatchObject({
      path: '/work/repo/src/a.ts',
      name: 'a.ts',
      targetLine: 12,
      targetColumn: 4,
      loaded: false,
    });
    expect(droneA.activeTabId).toBe(droneA.tabs[0]?.tabId);
    expect(droneB.tabs[0]?.path).toBe('/work/repo/README.md');
    expect(JSON.parse(storage.getItem(EDITOR_LAST_FILE_STORAGE_KEY) ?? '{}')).toEqual({
      'drone-a': {
        path: '/work/repo/src/a.ts',
        name: 'a.ts',
        targetLine: 12,
        targetColumn: 4,
      },
      'drone-b': {
        path: '/work/repo/README.md',
        name: 'README.md',
        targetLine: null,
        targetColumn: null,
      },
    });
  });

  test('forgets the remembered editor file when its last tab closes', () => {
    writeRememberedEditorFile('drone-a', {
      path: '/work/repo/a.ts',
      name: 'a.ts',
      targetLine: null,
      targetColumn: null,
    });

    writeRememberedEditorFile('drone-a', null);

    expect(readRememberedEditorFile('drone-a')).toBeNull();
    expect(storage.getItem(EDITOR_LAST_FILE_STORAGE_KEY)).toBeNull();
  });
});
