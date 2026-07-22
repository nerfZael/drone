import { describe, expect, test } from 'bun:test';
import {
  excludePinnedSidebarGroupItems,
  resolveSelectedDronePinMutation,
} from '../src/droneHub/app/pinned-drone-selection';

const availableDroneIds = new Set(['one', 'two', 'three']);

describe('selected drone pin mutation', () => {
  test('pins every selected drone when at least one is not pinned', () => {
    expect(
      resolveSelectedDronePinMutation({
        selectedDroneIds: ['one', 'two'],
        activeDroneId: 'one',
        availableDroneIds,
        pinnedDroneIds: ['one'],
      }),
    ).toEqual({ droneIds: ['one', 'two'], pinned: true });
  });

  test('unpins every selected drone when all are pinned', () => {
    expect(
      resolveSelectedDronePinMutation({
        selectedDroneIds: ['one', 'two'],
        activeDroneId: 'one',
        availableDroneIds,
        pinnedDroneIds: ['two', 'one'],
      }),
    ).toEqual({ droneIds: ['one', 'two'], pinned: false });
  });

  test('falls back to the active drone and ignores unavailable selections', () => {
    expect(
      resolveSelectedDronePinMutation({
        selectedDroneIds: ['missing'],
        activeDroneId: 'three',
        availableDroneIds,
        pinnedDroneIds: [],
      }),
    ).toEqual({ droneIds: ['three'], pinned: true });
  });

  test('normalizes duplicate selection ids before creating the batch', () => {
    expect(
      resolveSelectedDronePinMutation({
        selectedDroneIds: [' one ', 'one', 'two'],
        activeDroneId: 'three',
        availableDroneIds,
        pinnedDroneIds: [],
      }),
    ).toEqual({ droneIds: ['one', 'two'], pinned: true });
  });

  test('returns no mutation when neither the selection nor active drone is available', () => {
    expect(
      resolveSelectedDronePinMutation({
        selectedDroneIds: ['missing'],
        activeDroneId: 'also-missing',
        availableDroneIds,
        pinnedDroneIds: [],
      }),
    ).toBeNull();
  });
});

describe('pinned drone tree membership', () => {
  test('removes pinned drones from ordinary groups without losing the groups', () => {
    const groups = [
      { group: 'One', items: [{ id: 'one' }, { id: 'two' }] },
      { group: 'Two', items: [{ id: 'three' }] },
    ];

    expect(excludePinnedSidebarGroupItems(groups, new Set(['two', 'three']))).toEqual([
      { group: 'One', items: [{ id: 'one' }] },
      { group: 'Two', items: [] },
    ]);
    expect(groups[0]?.items).toEqual([{ id: 'one' }, { id: 'two' }]);
  });
});
