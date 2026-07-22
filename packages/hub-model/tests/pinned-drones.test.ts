import { describe, expect, test } from 'bun:test';
import {
  resolvePinnedSidebarDrones,
  resolvePinnedSidebarDronesForRepo,
} from '../src/sidebar';

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

  test('returns only pins belonging to the open repository', () => {
    const drones = [
      { id: 'alpha', name: 'Alpha', repoPath: '/work/alpha' },
      { id: 'beta', name: 'Beta', repoPath: '/work/beta' },
      { id: 'detached', name: 'Detached', repoPath: '' },
    ];
    const pinnedIds = ['beta', 'detached', 'alpha'];

    expect(
      resolvePinnedSidebarDronesForRepo(drones, pinnedIds, '/work/alpha').map(
        (drone) => drone.id,
      ),
    ).toEqual(['alpha']);
    expect(
      resolvePinnedSidebarDronesForRepo(drones, pinnedIds, '').map((drone) => drone.id),
    ).toEqual(['detached']);
  });
});
