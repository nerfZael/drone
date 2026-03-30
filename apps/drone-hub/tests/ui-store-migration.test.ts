import { describe, expect, test } from 'bun:test';
import { migrateDroneHubUiPersistedState } from '../src/droneHub/app/use-drone-hub-ui-store';
import { restoreUiPreferencesFromPersistedStorage } from '../src/droneHub/app/use-ui-preferences-settings';

describe('drone hub ui store migration', () => {
  test('preserves persisted browser-backed settings across version upgrades', () => {
    const migrated = migrateDroneHubUiPersistedState(
      {
        sidebarGroupingMode: 'repos',
        autoDelete: true,
        showCanvasLastMessagePreviews: true,
        seenModelIds: ['gpt-5.4', 'o3'],
        kanbanBoardSelectionInitialized: true,
        kanbanBoardScopeType: 'group',
        kanbanBoardScopeValue: 'feature-x',
        kanbanBoardSelectedRepoPath: '/tmp/repo-a',
        kanbanBoardViewMode: 'table',
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
      autoDelete: true,
      showCanvasLastMessagePreviews: true,
      seenModelIds: ['gpt-5.4', 'o3'],
      kanbanBoardSelectionInitialized: true,
      kanbanBoardScopeType: 'group',
      kanbanBoardScopeValue: 'feature-x',
      kanbanBoardSelectedRepoPath: '/tmp/repo-a',
      kanbanBoardViewMode: 'table',
    });
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
      },
      JSON.stringify({
        state: {
          autoDelete: true,
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
    expect(restored.snapshot.automations).toHaveLength(1);
    expect(restored.snapshot.automations[0]).toMatchObject({
      id: 'automation-a',
      label: 'Nightly',
      prompt: 'Ship it',
      sleepAmount: 1,
      sleepUnit: 'hours',
    });
  });
});
