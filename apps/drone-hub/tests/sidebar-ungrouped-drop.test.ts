import { describe, expect, test } from 'bun:test';
import { resolveSidebarUngroupedDropDroneIds } from '../src/droneHub/app/sidebar-ungrouped-drop';

const droneIds = ['a', 'b'];

describe('sidebar ungrouped drop', () => {
  test('returns the dragged drones for the enabled Ungrouped target', () => {
    expect(
      resolveSidebarUngroupedDropDroneIds({
        droneIds,
        overType: 'sidebar-ungrouped-drop',
        enabled: true,
      }),
    ).toEqual(['a', 'b']);
  });

  test('rejects disabled, unrelated, and empty drops', () => {
    expect(
      resolveSidebarUngroupedDropDroneIds({
        droneIds,
        overType: 'sidebar-ungrouped-drop',
        enabled: false,
      }),
    ).toEqual([]);
    expect(
      resolveSidebarUngroupedDropDroneIds({
        droneIds,
        overType: 'sidebar-tree-node',
        enabled: true,
      }),
    ).toEqual([]);
    expect(
      resolveSidebarUngroupedDropDroneIds({
        droneIds: [],
        overType: 'sidebar-ungrouped-drop',
        enabled: true,
      }),
    ).toEqual([]);
  });
});
