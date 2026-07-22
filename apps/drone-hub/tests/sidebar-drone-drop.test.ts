import { describe, expect, test } from 'bun:test';
import { canReorderSidebarDroneSelectionAtParent } from '../src/droneHub/app/sidebar-drone-drop';
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

describe('sidebar drone drop helpers', () => {
  test('allows sibling reordering and clearing a parent without assigning a new parent', () => {
    const droneById = Object.fromEntries(
      [
        drone({ id: 'parent', name: 'parent' }),
        drone({ id: 'child-a', name: 'child-a', fleetParentId: 'parent' }),
        drone({ id: 'child-b', name: 'child-b', fleetParentId: 'parent' }),
        drone({ id: 'top-level', name: 'top-level' }),
      ].map((item) => [item.id, item]),
    );

    expect(canReorderSidebarDroneSelectionAtParent(droneById, ['child-a'], 'parent')).toBe(true);
    expect(canReorderSidebarDroneSelectionAtParent(droneById, ['child-a'], null)).toBe(true);
    expect(canReorderSidebarDroneSelectionAtParent(droneById, ['top-level'], 'parent')).toBe(false);
  });
});
