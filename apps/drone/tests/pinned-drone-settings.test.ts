import { describe, expect, test } from 'bun:test';

import {
  resolvePinnedDronePreferenceIds,
  resolveUiPreferencesSettingsResponse,
  upsertStoredUiPreferencesSettings,
} from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

describe('pinned drone settings batch', () => {
  test('preserves existing order and appends newly pinned drones in request order', () => {
    expect(
      resolvePinnedDronePreferenceIds(
        ['existing', 'already-selected'],
        ['already-selected', 'new-two', 'new-one', 'new-two'],
        true,
      ),
    ).toEqual(['existing', 'already-selected', 'new-two', 'new-one']);
  });

  test('unpins every requested drone in one update', () => {
    expect(
      resolvePinnedDronePreferenceIds(
        ['one', 'two', 'three'],
        [' three ', 'one'],
        false,
      ),
    ).toEqual(['two']);
  });

  test('persists sidebar collapse state in UI preferences', async () => {
    await withTempDroneDataDir('drone-ui-collapse-settings-', async () => {
      await upsertStoredUiPreferencesSettings({
        collapsedGroups: { 'repo:/work/repo': true, open: false },
        collapsedDroneSections: { 'chats:drone-a': true, 'children:drone-b': false },
      });

      const response = await resolveUiPreferencesSettingsResponse();
      expect(response.uiPreferences.collapsedGroups).toEqual({
        'repo:/work/repo': true,
        open: false,
      });
      expect(response.uiPreferences.collapsedDroneSections).toEqual({
        'chats:drone-a': true,
        'children:drone-b': false,
      });
    });
  });
});
