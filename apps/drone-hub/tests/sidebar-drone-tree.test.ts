import { describe, expect, test } from 'bun:test';
import { buildSidebarDroneTree } from '../src/droneHub/app/sidebar-drone-tree';
import type { DroneSummary } from '../src/droneHub/types';

function drone(seed: Partial<DroneSummary> & Pick<DroneSummary, 'id' | 'name'>): DroneSummary {
  return {
    id: seed.id,
    name: seed.name,
    group: seed.group ?? null,
    createdAt: seed.createdAt ?? '2026-01-01T00:00:00.000Z',
    repoPath: seed.repoPath ?? '',
    containerPort: seed.containerPort ?? 0,
    hostPort: seed.hostPort ?? null,
    statusOk: seed.statusOk ?? true,
    statusError: seed.statusError ?? null,
    chats: seed.chats ?? ['default'],
    fleetParentId: seed.fleetParentId ?? null,
    repoAttached: seed.repoAttached ?? false,
    hubPhase: seed.hubPhase ?? null,
    hubMessage: seed.hubMessage ?? null,
    busy: seed.busy ?? false,
  };
}

describe('buildSidebarDroneTree', () => {
  test('nests child drones under visible parents and preserves input order', () => {
    const result = buildSidebarDroneTree([
      drone({ id: 'parent', name: 'parent' }),
      drone({ id: 'child-a', name: 'child-a', fleetParentId: 'parent' }),
      drone({ id: 'child-b', name: 'child-b', fleetParentId: 'parent' }),
      drone({ id: 'sibling', name: 'sibling' }),
    ]);

    expect(result).toEqual({
      rootDroneIds: ['parent', 'sibling'],
      childDroneIdsByParentId: {
        parent: ['child-a', 'child-b'],
      },
    });
  });

  test('keeps drones at the root when their parent is not visible in the rendered list', () => {
    const result = buildSidebarDroneTree([
      drone({ id: 'child', name: 'child', fleetParentId: 'missing-parent' }),
      drone({ id: 'root', name: 'root' }),
    ]);

    expect(result).toEqual({
      rootDroneIds: ['child', 'root'],
      childDroneIdsByParentId: {},
    });
  });

  test('breaks parent cycles so every drone remains reachable from the root', () => {
    const result = buildSidebarDroneTree([
      drone({ id: 'alpha', name: 'alpha', fleetParentId: 'beta' }),
      drone({ id: 'beta', name: 'beta', fleetParentId: 'alpha' }),
      drone({ id: 'gamma', name: 'gamma' }),
    ]);

    expect(result).toEqual({
      rootDroneIds: ['alpha', 'beta', 'gamma'],
      childDroneIdsByParentId: {},
    });
  });
});
