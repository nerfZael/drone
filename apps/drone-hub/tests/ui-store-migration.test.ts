import { describe, expect, test } from 'bun:test';
import {
  migrateDroneHubUiPersistedState,
  normalizeChatInputEditorModes,
  normalizeLastChatSelectionByRepoPath,
  normalizeSpawnContextByRepoKey,
  resolveRepoChatSelectionTransition,
  resolveSpawnContextPreferencesForRepo,
  useDroneHubUiStore,
} from '../src/droneHub/app/use-drone-hub-ui-store';
import {
  mergeUiPreferencesChanges,
  recoverInitialSpawnContextByRepoKey,
  reconcileUiPreferencesReload,
  restoreUiPreferencesFromPersistedStorage,
} from '../src/droneHub/app/use-ui-preferences-settings';

describe('drone hub ui store migration', () => {
  test('does not publish store updates for equivalent normalized sidebar orders', () => {
    const previous = useDroneHubUiStore.getState();
    const previousWarn = console.warn;
    let unsubscribe = () => undefined;
    console.warn = () => undefined;
    try {
      useDroneHubUiStore.setState({
        sidebarGroupOrder: ['group-id:review'],
        sidebarDroneOrderByGroup: { 'group-id:review': ['drone:a', 'drone:b'] },
        hiddenSidebarGroups: ['group-id:done'],
      });
      let updates = 0;
      unsubscribe = useDroneHubUiStore.subscribe(() => {
        updates += 1;
      });

      const state = useDroneHubUiStore.getState();
      state.setSidebarGroupOrder([' group-id:review ', 'group-id:review']);
      state.setSidebarDroneOrderByGroup({
        'group-id:review': ['drone:a', 'drone:b', 'drone:b'],
      });
      state.setHiddenSidebarGroups(['group-id:done']);

      expect(updates).toBe(0);
    } finally {
      unsubscribe();
      useDroneHubUiStore.setState({
        sidebarGroupOrder: previous.sidebarGroupOrder,
        sidebarDroneOrderByGroup: previous.sidebarDroneOrderByGroup,
        hiddenSidebarGroups: previous.hiddenSidebarGroups,
      });
      console.warn = previousWarn;
    }
  });

  test('preserves persisted browser-backed settings across version upgrades', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        sidebarGroupingMode: 'repos',
        sidebarDockSide: 'right',
        viewMode: 'flat',
        assistantThreadSidebarDockSide: 'right',
        autoDelete: true,
        transcriptInlineImages: false,
        showCanvasLastMessagePreviews: true,
        seenModelIds: ['gpt-5.4', 'o3'],
        automations: [{ id: 'retired-automation' }],
        playbookRunsSelectionInitialized: true,
        playbookRunsSelectedPlaybookId: 'retired-playbook',
        playbookRunsSelectedRepoPath: '/tmp/retired-playbook',
      },
      5,
    );

    expect(migrated).toMatchObject({
      sidebarGroupingMode: 'repos',
      sidebarDockSide: 'right',
      showCanvasLastMessagePreviews: true,
      seenModelIds: ['gpt-5.4', 'o3'],
    });
    expect((migrated as any).autoDelete).toBeUndefined();
    expect((migrated as any).viewMode).toBeUndefined();
    expect((migrated as any).assistantThreadSidebarDockSide).toBeUndefined();
    expect((migrated as any).transcriptInlineImages).toBeUndefined();
    expect((migrated as any).automations).toBeUndefined();
    expect((migrated as any).playbookRunsSelectionInitialized).toBeUndefined();
    expect((migrated as any).playbookRunsSelectedPlaybookId).toBeUndefined();
    expect((migrated as any).playbookRunsSelectedRepoPath).toBeUndefined();
  });

  test('returns an empty object for invalid persisted payloads', () => {
    expect(migrateDroneHubUiPersistedState(null, 5)).toEqual({});
    expect(migrateDroneHubUiPersistedState('invalid', 5)).toEqual({});
  });

  test('restores editor-mode choices only for valid per-chat keys', () => {
    expect(
      normalizeChatInputEditorModes({
        ' drone:a:chat:default ': true,
        'drone:a:chat:review': false,
        'drone:b:chat:default': 'true',
        '': true,
      }),
    ).toEqual({
      'drone:a:chat:default': true,
    });
    expect(
      migrateDroneHubUiPersistedState({
        chatInputEditorModes: { 'drone:a:chat:default': true },
      }).chatInputEditorModes,
    ).toEqual({ 'drone:a:chat:default': true });

    const oversized = Object.fromEntries([
      ...Array.from({ length: 82 }, (_, index) => [`drone:${index}:chat:default`, true]),
      ['invalid:false', false],
      ['invalid:string', 'true'],
    ]);
    const normalized = normalizeChatInputEditorModes(oversized);
    expect(Object.keys(normalized)).toHaveLength(80);
    expect(normalized['drone:0:chat:default']).toBeUndefined();
    expect(normalized['drone:2:chat:default']).toBe(true);
    expect(normalized['drone:81:chat:default']).toBe(true);
  });

  test('migrates the existing active chat into repo-scoped selection history', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        activeRepoPath: '/work/repo-a',
        selectedDrone: 'drone-a',
        selectedChat: 'implementation',
      },
      15,
    );

    expect(migrated.lastChatSelectionByRepoPath).toEqual({
      '/work/repo-a': { droneId: 'drone-a', chatName: 'implementation' },
    });
  });

  test('normalizes persisted repo chat selections and drops malformed entries', () => {
    expect(
      normalizeLastChatSelectionByRepoPath({
        ' /work/repo-a ': { droneId: ' drone-a ', chatName: ' planning ' },
        '/work/repo-b': { droneId: 'drone-b', chatName: '' },
        '/work/missing-drone': { chatName: 'default' },
        '': { droneId: 'ignored', chatName: 'default' },
      }),
    ).toEqual({
      '/work/repo-a': { droneId: 'drone-a', chatName: 'planning' },
      '/work/repo-b': { droneId: 'drone-b', chatName: 'default' },
    });
  });

  test('restores the incoming repo chat without rewriting another repo history', () => {
    expect(
      resolveRepoChatSelectionTransition(
        {
          activeRepoPath: '/work/repo-a',
          selectedDrone: 'drone-a',
          selectedDroneIds: ['drone-a'],
          selectedChat: 'implementation',
          lastChatSelectionByRepoPath: {
            '/work/repo-a': { droneId: 'drone-a', chatName: 'planning' },
            '/work/repo-b': { droneId: 'drone-b', chatName: 'review' },
          },
        },
        '/work/repo-b',
      ),
    ).toEqual({
      activeRepoPath: '/work/repo-b',
      selectedDrone: 'drone-b',
      selectedDroneIds: ['drone-b'],
      selectedChat: 'review',
      lastChatSelectionByRepoPath: {
        '/work/repo-a': { droneId: 'drone-a', chatName: 'planning' },
        '/work/repo-b': { droneId: 'drone-b', chatName: 'review' },
      },
    });
  });

  test('starts with an empty selection for a repo without chat history', () => {
    expect(
      resolveRepoChatSelectionTransition(
        {
          activeRepoPath: '/work/repo-a',
          selectedDrone: 'drone-a',
          selectedDroneIds: ['drone-a'],
          selectedChat: 'default',
          lastChatSelectionByRepoPath: {},
        },
        '/work/repo-b',
      ),
    ).toMatchObject({
      activeRepoPath: '/work/repo-b',
      selectedDrone: null,
      selectedDroneIds: [],
      selectedChat: 'default',
    });
  });

  test('keeps the current chat selected when opening the repository overview', () => {
    expect(
      resolveRepoChatSelectionTransition(
        {
          activeRepoPath: '/work/repo-a',
          selectedDrone: 'drone-a',
          selectedDroneIds: ['drone-a', 'drone-b'],
          selectedChat: 'implementation',
          lastChatSelectionByRepoPath: {
            '/work/repo-a': { droneId: 'drone-a', chatName: 'implementation' },
          },
        },
        '',
      ),
    ).toMatchObject({
      activeRepoPath: '',
      selectedDrone: 'drone-a',
      selectedDroneIds: ['drone-a', 'drone-b'],
      selectedChat: 'implementation',
    });
  });

  test('normalizes invalid persisted sidebar dock sides to left', () => {
    expect(
      migrateDroneHubUiPersistedState(
        { sidebarDockSide: 'floating', assistantThreadSidebarDockSide: 'floating' },
        13,
      ),
    ).toMatchObject({
      sidebarDockSide: 'left',
    });
  });

  test('normalizes the persisted pinned sidebar placement', () => {
    expect(migrateDroneHubUiPersistedState({ pinnedSidebarPlacement: 'bottom' }, 15)).toMatchObject(
      {
        pinnedSidebarPlacement: 'bottom',
      },
    );
    expect(
      migrateDroneHubUiPersistedState({ pinnedSidebarPlacement: 'floating' }, 15),
    ).toMatchObject({
      pinnedSidebarPlacement: 'bottom',
    });
  });

  test('normalizes the persisted pinned sidebar collapsed state', () => {
    expect(migrateDroneHubUiPersistedState({ pinnedSidebarCollapsed: true }, 16)).toMatchObject({
      pinnedSidebarCollapsed: true,
    });
    expect(migrateDroneHubUiPersistedState({ pinnedSidebarCollapsed: 'true' }, 16)).toMatchObject({
      pinnedSidebarCollapsed: false,
    });
  });

  test('normalizes persisted desktop themes', () => {
    expect(migrateDroneHubUiPersistedState({ themeId: 'catppuccin-mocha' }, 14)).toMatchObject({
      themeId: 'catppuccin-mocha',
    });
    expect(migrateDroneHubUiPersistedState({ themeId: 'monolith' }, 14)).toMatchObject({
      themeId: 'monolith',
    });
    expect(migrateDroneHubUiPersistedState({ themeId: 'unknown' }, 14)).toMatchObject({
      themeId: 'catppuccin-mocha',
    });
  });

  test('migrates legacy global spawn defaults into the non-repo bucket', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        spawnAgentKey: 'builtin:codex',
        spawnModel: 'gpt-5.4',
        repoBranchSource: 'remote',
        repoCreateRemoteBranch: 'origin/feature-x',
      },
      11,
    );

    expect(migrated.spawnContextByRepoKey).toEqual({
      __no_repo__: {
        spawnAgentKey: 'builtin:codex',
        spawnModel: 'gpt-5.4',
        spawnReasoning: '',
        spawnAgentPermissionMode: 'full-access',
        spawnApprovalPolicy: 'ask',
        repoBranchSource: 'remote',
        repoCreateRemoteBranch: 'origin/feature-x',
      },
    });
  });

  test('resolves repo-scoped spawn defaults before falling back to non-repo defaults', () => {
    const byRepo = normalizeSpawnContextByRepoKey({
      __no_repo__: {
        spawnAgentKey: 'builtin:cursor',
        spawnModel: '',
        repoBranchSource: 'host',
        repoCreateRemoteBranch: '',
      },
      '/tmp/repo-a': {
        spawnAgentKey: 'builtin:codex',
        spawnModel: 'gpt-5.4',
        spawnAgentPermissionMode: 'workspace-write',
        spawnApprovalPolicy: 'never',
        repoBranchSource: 'remote',
        repoCreateRemoteBranch: 'origin/feature-a',
      },
    });

    expect(resolveSpawnContextPreferencesForRepo(byRepo, '/tmp/repo-a')).toMatchObject({
      spawnAgentKey: 'builtin:codex',
      spawnModel: 'gpt-5.4',
      spawnAgentPermissionMode: 'workspace-write',
      spawnApprovalPolicy: 'never',
      repoBranchSource: 'remote',
      repoCreateRemoteBranch: 'origin/feature-a',
    });
    expect(resolveSpawnContextPreferencesForRepo(byRepo, '/tmp/repo-b')).toMatchObject({
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      repoBranchSource: 'host',
      repoCreateRemoteBranch: '',
    });
    expect(resolveSpawnContextPreferencesForRepo(byRepo, '')).toMatchObject({
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      repoBranchSource: 'host',
      repoCreateRemoteBranch: '',
    });
  });

  test('updates access defaults for an explicit repo without changing the active repo', () => {
    const previous = useDroneHubUiStore.getState();
    const previousWarn = console.warn;
    console.warn = () => undefined;
    try {
      const byRepo = normalizeSpawnContextByRepoKey({
        '/tmp/repo-a': {
          spawnAgentKey: 'builtin:codex',
          spawnAgentPermissionMode: 'full-access',
          spawnApprovalPolicy: 'agent-decides',
        },
        '/tmp/repo-b': {
          spawnAgentKey: 'builtin:codex',
          spawnAgentPermissionMode: 'full-access',
          spawnApprovalPolicy: 'agent-decides',
        },
      });
      useDroneHubUiStore.setState({
        spawnContextRepoPath: '/tmp/repo-a',
        spawnContextByRepoKey: byRepo,
        ...byRepo['/tmp/repo-a'],
      });

      useDroneHubUiStore.getState().updateSpawnContextForRepo('/tmp/repo-b', {
        spawnAgentPermissionMode: 'workspace-write',
        spawnApprovalPolicy: 'ask',
      });

      const state = useDroneHubUiStore.getState();
      expect(state.spawnContextRepoPath).toBe('/tmp/repo-a');
      expect(state.spawnAgentPermissionMode).toBe('full-access');
      expect(state.spawnApprovalPolicy).toBe('agent-decides');
      expect(state.spawnContextByRepoKey['/tmp/repo-b']).toMatchObject({
        spawnAgentPermissionMode: 'workspace-write',
        spawnApprovalPolicy: 'ask',
      });
    } finally {
      useDroneHubUiStore.setState({
        spawnContextRepoPath: previous.spawnContextRepoPath,
        spawnContextByRepoKey: previous.spawnContextByRepoKey,
        spawnAgentKey: previous.spawnAgentKey,
        spawnModel: previous.spawnModel,
        spawnReasoning: previous.spawnReasoning,
        spawnAgentPermissionMode: previous.spawnAgentPermissionMode,
        spawnApprovalPolicy: previous.spawnApprovalPolicy,
        repoBranchSource: previous.repoBranchSource,
        repoCreateRemoteBranch: previous.repoCreateRemoteBranch,
      });
      console.warn = previousWarn;
    }
  });

  test('bounds shared spawn context values to the server limits', () => {
    const normalized = normalizeSpawnContextByRepoKey({
      '/tmp/repo': {
        spawnAgentKey: `builtin:${'a'.repeat(300)}`,
        spawnModel: 'm'.repeat(300),
        spawnReasoning: 'r'.repeat(300),
        repoCreateRemoteBranch: 'b'.repeat(500),
      },
    });
    const preferences = normalized['/tmp/repo'];
    expect(preferences?.spawnAgentKey).toHaveLength(200);
    expect(preferences?.spawnModel).toHaveLength(200);
    expect(preferences?.spawnReasoning).toHaveLength(200);
    expect(preferences?.repoCreateRemoteBranch).toHaveLength(400);
  });

  test('migrates repo defaults without replacing existing server-wide defaults', () => {
    const recovered = recoverInitialSpawnContextByRepoKey({
      backend: {
        spawnAgentKey: 'builtin:codex',
        spawnModel: 'gpt-5.5',
        spawnReasoning: 'high',
        spawnAgentPermissionMode: 'full-access',
        spawnApprovalPolicy: 'agent-decides',
      },
      current: {
        spawnContextByRepoKey: normalizeSpawnContextByRepoKey({
          __no_repo__: {
            spawnAgentKey: 'builtin:cursor',
          },
          '/tmp/repo-a': {
            spawnAgentKey: 'builtin:codex',
            spawnAgentPermissionMode: 'full-access',
            spawnApprovalPolicy: 'agent-decides',
          },
        }),
      },
      remembered: {
        '/tmp/repo-a': {
          spawnAgentKey: 'builtin:codex',
          spawnAgentPermissionMode: 'workspace-write',
          spawnApprovalPolicy: 'ask',
        },
      },
      backendUpdated: true,
    });

    expect(recovered.__no_repo__).toMatchObject({
      spawnAgentKey: 'builtin:codex',
      spawnModel: 'gpt-5.5',
      spawnReasoning: 'high',
      spawnApprovalPolicy: 'agent-decides',
    });
    expect(recovered['/tmp/repo-a']).toMatchObject({
      spawnAgentPermissionMode: 'workspace-write',
      spawnApprovalPolicy: 'ask',
    });
  });

  test('restores UI preferences from the raw localStorage envelope when backend settings are still empty', () => {
    const restored = restoreUiPreferencesFromPersistedStorage(
      {
        sidebarGroupingMode: 'groups',
        sidebarGroupOrder: [],
        sidebarDroneOrderByGroup: {},
        sidebarChatOrderByDrone: {},
        pinnedDroneIds: [],
        hiddenSidebarGroups: [],
        spawnAgentKey: 'builtin:cursor',
        spawnModel: '',
        repoBranchSource: 'host',
        repoCreateRemoteBranch: '',
      },
      JSON.stringify({
        state: {
          autoDelete: true,
          spawnAgentKey: 'builtin:codex',
          spawnModel: 'gpt-5.5',
          repoBranchSource: 'remote',
          repoCreateRemoteBranch: 'origin/voice',
          pinnedDroneIds: ['drone-b', 'drone-a'],
        },
        version: 5,
      }),
    );

    expect(restored.restored).toBe(true);
    expect((restored.snapshot as any).autoDelete).toBeUndefined();
    expect(restored.snapshot.spawnAgentKey).toBe('builtin:codex');
    expect(restored.snapshot.spawnModel).toBe('gpt-5.5');
    expect(restored.snapshot.repoBranchSource).toBe('remote');
    expect(restored.snapshot.repoCreateRemoteBranch).toBe('origin/voice');
    expect(restored.snapshot.pinnedDroneIds).toEqual(['drone-b', 'drone-a']);
  });

  test('rebases a local reorder without replacing unrelated newer server preferences', () => {
    const base = {
      sidebarDensityMode: 'default' as const,
      sidebarNodeOrderByParent: {
        'folder:a': ['drone:a', 'drone:b'],
        'folder:b': ['drone:c', 'drone:d'],
      },
    };
    const local = {
      ...base,
      sidebarNodeOrderByParent: {
        ...base.sidebarNodeOrderByParent,
        'folder:a': ['drone:b', 'drone:a'],
      },
    };
    const remote = {
      ...base,
      sidebarDensityMode: 'compact' as const,
      sidebarNodeOrderByParent: {
        ...base.sidebarNodeOrderByParent,
        'folder:b': ['drone:d', 'drone:c'],
      },
    };

    const merged = mergeUiPreferencesChanges(base, local, remote);

    expect(merged.sidebarDensityMode).toBe('compact');
    expect(merged.sidebarNodeOrderByParent).toEqual({
      'folder:a': ['drone:b', 'drone:a'],
      'folder:b': ['drone:d', 'drone:c'],
    });
  });

  test('preserves an intentional local order-key deletion while rebasing', () => {
    const base = {
      sidebarNodeOrderByParent: {
        'folder:a': ['drone:a'],
        'folder:b': ['drone:b'],
      },
    };
    const local = {
      sidebarNodeOrderByParent: {
        'folder:b': ['drone:b'],
      },
    };
    const remote = {
      sidebarNodeOrderByParent: {
        'folder:a': ['drone:a'],
        'folder:b': ['drone:b', 'drone:c'],
      },
    };

    expect(mergeUiPreferencesChanges(base, local, remote).sidebarNodeOrderByParent).toEqual({
      'folder:b': ['drone:b', 'drone:c'],
    });
  });

  test('does not resurrect cleared server preferences from stale browser storage', () => {
    const snapshot = reconcileUiPreferencesReload({
      backend: {
        sidebarGroupingMode: 'repos',
        sidebarNodeOrderByParent: {},
        pinnedDroneIds: [],
      },
      backendUpdatedAt: '2026-08-06T10:00:00.000Z',
      current: {},
      previousBackend: null,
      wasReady: false,
      storageRaw: JSON.stringify({
        state: {
          sidebarGroupingMode: 'groups',
          sidebarNodeOrderByParent: { root: ['drone:stale'] },
          pinnedDroneIds: ['drone:stale'],
        },
      }),
    });

    expect(snapshot.sidebarGroupingMode).toBe('repos');
    expect(snapshot.sidebarNodeOrderByParent).toEqual({});
    expect(snapshot.pinnedDroneIds).toEqual([]);
  });

  test('keeps unsaved local changes during a cross-client refresh', () => {
    const snapshot = reconcileUiPreferencesReload({
      backend: {
        sidebarDensityMode: 'compact',
        sidebarNodeOrderByParent: { root: ['drone:b', 'drone:a'] },
      },
      backendUpdatedAt: '2026-08-06T10:00:00.000Z',
      previousBackend: {
        sidebarDensityMode: 'default',
        sidebarNodeOrderByParent: { root: ['drone:a', 'drone:b'] },
      },
      current: {
        sidebarDensityMode: 'comfortable',
        sidebarNodeOrderByParent: { root: ['drone:a', 'drone:b'] },
      },
      wasReady: true,
      storageRaw: null,
    });

    expect(snapshot.sidebarDensityMode).toBe('comfortable');
    expect(snapshot.sidebarNodeOrderByParent.root).toEqual(['drone:b', 'drone:a']);
  });

  test('migrates former creation defaults to 1/2/3', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        shortcutBindings: {
          createDraftDrone: {
            key: 'tab',
            mod: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
          },
          createDroneChat: {
            key: 'q',
            mod: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
          },
          markSelectedDronesUnread: {
            key: 'z',
            mod: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
          },
        },
      },
      12,
    );

    expect(migrated.shortcutBindings).toMatchObject({
      createDraftDrone: {
        key: '1',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
      createChildDraftDrone: {
        key: '3',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
      createDroneChat: { key: '2', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      markSelectedDronesUnread: {
        key: 'z',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
    });
  });

  test('moves the former default E shortcut from to-do tagging to group creation', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        shortcutBindings: {
          toggleSelectedDronesToDo: {
            key: 'e',
            mod: false,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
          },
        },
      },
      12,
    );

    expect(migrated.shortcutBindings).toMatchObject({
      createDraftGroup: {
        key: 'e',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
      toggleSelectedDronesToDo: null,
    });
  });
});
