import { describe, expect, test } from 'bun:test';
import {
  migrateDroneHubUiPersistedState,
  normalizeSpawnContextByRepoKey,
  resolveSpawnContextPreferencesForRepo,
} from '../src/droneHub/app/use-drone-hub-ui-store';
import { restoreUiPreferencesFromPersistedStorage } from '../src/droneHub/app/use-ui-preferences-settings';

describe('drone hub ui store migration', () => {
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
      autoDelete: true,
      showCanvasLastMessagePreviews: true,
      seenModelIds: ['gpt-5.4', 'o3'],
    });
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

  test('normalizes invalid persisted sidebar dock sides to left', () => {
    expect(migrateDroneHubUiPersistedState({ sidebarDockSide: 'floating', assistantThreadSidebarDockSide: 'floating' }, 13)).toMatchObject({
      sidebarDockSide: 'left',
    });
  });

  test('normalizes the persisted pinned sidebar placement', () => {
    expect(migrateDroneHubUiPersistedState({ pinnedSidebarPlacement: 'bottom' }, 15)).toMatchObject({
      pinnedSidebarPlacement: 'bottom',
    });
    expect(migrateDroneHubUiPersistedState({ pinnedSidebarPlacement: 'floating' }, 15)).toMatchObject({
      pinnedSidebarPlacement: 'bottom',
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
        repoBranchSource: 'remote',
        repoCreateRemoteBranch: 'origin/feature-a',
      },
    });

    expect(resolveSpawnContextPreferencesForRepo(byRepo, '/tmp/repo-a')).toMatchObject({
      spawnAgentKey: 'builtin:codex',
      spawnModel: 'gpt-5.4',
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

  test('restores UI preferences from the raw localStorage envelope when backend settings are still empty', () => {
    const restored = restoreUiPreferencesFromPersistedStorage(
      {
        sidebarGroupingMode: 'groups',
        sidebarGroupOrder: [],
        sidebarDroneOrderByGroup: {},
        sidebarChatOrderByDrone: {},
        pinnedDroneIds: [],
        hiddenSidebarGroups: [],
        autoDelete: false,
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
    expect(restored.snapshot.autoDelete).toBe(true);
    expect(restored.snapshot.spawnAgentKey).toBe('builtin:codex');
    expect(restored.snapshot.spawnModel).toBe('gpt-5.5');
    expect(restored.snapshot.repoBranchSource).toBe('remote');
    expect(restored.snapshot.repoCreateRemoteBranch).toBe('origin/voice');
    expect(restored.snapshot.pinnedDroneIds).toEqual(['drone-b', 'drone-a']);
  });

  test('migrates former creation defaults to 1/2/3', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        shortcutBindings: {
          createDraftDrone: { key: 'tab', mod: false, ctrl: false, meta: false, alt: false, shift: false },
          createDroneChat: { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false },
          markSelectedDronesUnread: { key: 'z', mod: false, ctrl: false, meta: false, alt: false, shift: false },
        },
      },
      12,
    );

    expect(migrated.shortcutBindings).toMatchObject({
      createDraftDrone: { key: '1', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      createChildDraftDrone: { key: '3', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      createDroneChat: { key: '2', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      markSelectedDronesUnread: { key: 'z', mod: false, ctrl: false, meta: false, alt: false, shift: false },
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
