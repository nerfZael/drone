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
        assistantThreadSidebarDockSide: 'right',
        autoDelete: true,
        showCanvasLastMessagePreviews: true,
        seenModelIds: ['gpt-5.4', 'o3'],
        automations: [
          {
            id: 'automation-a',
            label: 'Nightly',
            prompt: 'Ship it',
            sleepBetweenRunsSeconds: 3600,
          },
        ],
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
    expect((migrated as any).assistantThreadSidebarDockSide).toBeUndefined();
    expect(Array.isArray(migrated.automations)).toBe(true);
    expect((migrated.automations ?? [])[0]).toMatchObject({
      id: 'automation-a',
      label: 'Nightly',
      prompt: 'Ship it',
      sleepBetweenRunsSeconds: 3600,
    });
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

  test('migrates legacy global spawn defaults into the non-repo bucket', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        spawnAgentKey: 'builtin:codex',
        spawnModel: 'gpt-5.4',
        repoBranchSource: 'remote',
        repoCreateRemoteBranch: 'origin/feature-x',
        pullHostBranchBeforeCreate: false,
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
        pullHostBranchBeforeCreate: false,
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
        pullHostBranchBeforeCreate: true,
      },
      '/tmp/repo-a': {
        spawnAgentKey: 'builtin:codex',
        spawnModel: 'gpt-5.4',
        repoBranchSource: 'remote',
        repoCreateRemoteBranch: 'origin/feature-a',
        pullHostBranchBeforeCreate: false,
      },
    });

    expect(resolveSpawnContextPreferencesForRepo(byRepo, '/tmp/repo-a')).toMatchObject({
      spawnAgentKey: 'builtin:codex',
      spawnModel: 'gpt-5.4',
      repoBranchSource: 'remote',
      repoCreateRemoteBranch: 'origin/feature-a',
      pullHostBranchBeforeCreate: false,
    });
    expect(resolveSpawnContextPreferencesForRepo(byRepo, '/tmp/repo-b')).toMatchObject({
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      repoBranchSource: 'host',
      repoCreateRemoteBranch: '',
      pullHostBranchBeforeCreate: true,
    });
    expect(resolveSpawnContextPreferencesForRepo(byRepo, '')).toMatchObject({
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      repoBranchSource: 'host',
      repoCreateRemoteBranch: '',
      pullHostBranchBeforeCreate: true,
    });
  });

  test('keeps pull-before-create enabled when old spawn defaults omit it', () => {
    const byRepo = normalizeSpawnContextByRepoKey({
      __no_repo__: {
        spawnAgentKey: 'builtin:cursor',
        spawnModel: '',
        repoBranchSource: 'host',
        repoCreateRemoteBranch: '',
      },
    });

    expect(resolveSpawnContextPreferencesForRepo(byRepo, '')).toMatchObject({
      pullHostBranchBeforeCreate: true,
    });
  });

  test('restores automations from the raw localStorage envelope when backend settings are still empty', () => {
    const restored = restoreUiPreferencesFromPersistedStorage(
      {
        sidebarGroupingMode: 'groups',
        sidebarGroupOrder: [],
        sidebarDroneOrderByGroup: {},
        sidebarChatOrderByDrone: {},
        hiddenSidebarGroups: [],
        autoDelete: false,
        automations: [],
        spawnAgentKey: 'builtin:cursor',
        spawnModel: '',
        repoBranchSource: 'host',
        repoCreateRemoteBranch: '',
        pullHostBranchBeforeCreate: true,
      },
      JSON.stringify({
        state: {
          autoDelete: true,
          spawnAgentKey: 'builtin:codex',
          spawnModel: 'gpt-5.5',
          repoBranchSource: 'remote',
          repoCreateRemoteBranch: 'origin/voice',
          pullHostBranchBeforeCreate: false,
          automations: [
            {
              id: 'automation-a',
              label: 'Nightly',
              prompt: 'Ship it',
              sleepBetweenRunsSeconds: 3600,
            },
          ],
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
    expect(restored.snapshot.pullHostBranchBeforeCreate).toBe(false);
    expect(restored.snapshot.automations).toHaveLength(1);
    expect(restored.snapshot.automations[0]).toMatchObject({
      id: 'automation-a',
      label: 'Nightly',
      prompt: 'Ship it',
      sleepAmount: 1,
      sleepUnit: 'hours',
    });
  });

  test('migrates the former create-chat default onto child-drone and moves create-chat to W', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        shortcutBindings: {
          createDraftDrone: { key: 'tab', mod: false, ctrl: false, meta: false, alt: false, shift: false },
          createDroneChat: { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false },
          markSelectedDronesUnread: { key: 'z', mod: false, ctrl: false, meta: false, alt: false, shift: false },
          toggleTldr: null,
        },
      },
      12,
    );

    expect(migrated.shortcutBindings).toMatchObject({
      createChildDraftDrone: { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      createDroneChat: { key: 'w', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      markSelectedDronesUnread: { key: 'z', mod: false, ctrl: false, meta: false, alt: false, shift: false },
    });
  });
});
