import { describe, expect, test } from 'bun:test';

import { loadMobileDroneList } from '../src/drones/load-mobile-drone-list';

describe('mobile performance presentation', () => {
  test('loads startup drones and creation repositories in one request', async () => {
    const requests: Array<{ destinationId: string; operation: string; payload: unknown }> = [];
    const result = await loadMobileDroneList(
      async (destinationId, operation, payload) => {
        requests.push({ destinationId, operation, payload });
        return {
          drones: [],
          createOptions: { repos: [{ path: '/work/widgets', hostBranch: 'main' }] },
        };
      },
      'hub-1',
      false,
    );

    expect(requests).toEqual([
      {
        destinationId: 'hub-1',
        operation: 'drones.list',
        payload: { includeCreateOptions: true },
      },
    ]);
    expect(result.createRepos).toEqual([
      {
        path: '/work/widgets',
        hostBranch: 'main',
        remoteBranches: [],
        branchesError: null,
        branchesLoaded: false,
      },
    ]);
  });
});
