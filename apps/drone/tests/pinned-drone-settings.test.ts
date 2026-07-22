import { describe, expect, test } from 'bun:test';

import { resolvePinnedDronePreferenceIds } from '../src/hub/hub-settings';

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
});
