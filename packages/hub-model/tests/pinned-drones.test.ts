import { describe, expect, test } from 'bun:test';
import { resolvePinnedSidebarDrones } from '../src/sidebar';

describe('pinned sidebar drones', () => {
  test('keeps saved pin order while ignoring duplicates and missing drones', () => {
    const drones = [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
      { id: 'three', name: 'Three' },
    ];

    expect(
      resolvePinnedSidebarDrones(drones, ['two', 'missing', 'one', 'two']).map(
        (drone) => drone.id,
      ),
    ).toEqual(['two', 'one']);
  });
});
