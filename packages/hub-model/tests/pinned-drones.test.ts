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

  test('returns pins across repositories in one global order', () => {
    const drones = [
      { id: 'alpha', name: 'Alpha', repoPath: '/work/alpha' },
      { id: 'beta', name: 'Beta', repoPath: '/work/beta' },
      { id: 'detached', name: 'Detached', repoPath: '' },
    ];
    const pinnedIds = ['beta', 'detached', 'alpha'];

    expect(
      resolvePinnedSidebarDrones(drones, pinnedIds).map((drone) => drone.id),
    ).toEqual(['beta', 'detached', 'alpha']);
  });

  test('retains the repo-scoped resolver for callers that need a filtered projection', () => {
    const drones = [
      { id: 'alpha', name: 'Alpha', repoPath: '/work/alpha' },
      { id: 'beta', name: 'Beta', repoPath: '/work/beta' },
    ];

    expect(
      resolvePinnedSidebarDronesForRepo(drones, ['beta', 'alpha'], '/work/alpha').map(
        (drone) => drone.id,
      ),
    ).toEqual(['alpha']);
  });
});
