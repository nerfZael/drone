import { describe, expect, test } from 'bun:test';
import {
  applySidebarOptimisticOpsToDrones,
  pruneSatisfiedSidebarOptimisticOps,
  type SidebarOptimisticOp,
} from '../src/droneHub/app/sidebar-optimistic-ops';
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

describe('sidebar optimistic ops', () => {
  test('applies optimistic reparenting to drone hierarchy and inherited group', () => {
    const ops: SidebarOptimisticOp[] = [
      {
        id: 'op-1',
        kind: 'reparent_drones',
        droneIds: ['child'],
        targetParentDroneId: 'parent',
        targetGroup: 'alpha',
      },
    ];

    expect(
      applySidebarOptimisticOpsToDrones(
        [
          drone({ id: 'parent', name: 'parent', group: 'alpha' }),
          drone({ id: 'child', name: 'child', group: 'beta', fleetParentId: null }),
        ],
        ops,
      ),
    ).toEqual([
      drone({ id: 'parent', name: 'parent', group: 'alpha' }),
      drone({ id: 'child', name: 'child', group: 'alpha', fleetParentId: 'parent' }),
    ]);
  });

  test('prunes optimistic reparent ops once parent and group match server state', () => {
    const ops: SidebarOptimisticOp[] = [
      {
        id: 'op-1',
        kind: 'reparent_drones',
        droneIds: ['child'],
        targetParentDroneId: 'parent',
        targetGroup: 'alpha',
      },
    ];

    expect(
      pruneSatisfiedSidebarOptimisticOps(
        ops,
        [{ group: 'alpha', label: 'alpha', kind: 'group', items: [] }],
        [
          drone({ id: 'parent', name: 'parent', group: 'alpha' }),
          drone({ id: 'child', name: 'child', group: 'alpha', fleetParentId: 'parent' }),
        ],
      ),
    ).toEqual([]);
  });

  test('preserves the current group when optimistic reparent only changes parentage', () => {
    const ops: SidebarOptimisticOp[] = [
      {
        id: 'op-1',
        kind: 'reparent_drones',
        droneIds: ['child'],
        targetParentDroneId: null,
      },
    ];

    expect(
      applySidebarOptimisticOpsToDrones(
        [drone({ id: 'child', name: 'child', group: 'alpha', fleetParentId: 'parent' })],
        ops,
      ),
    ).toEqual([
      drone({ id: 'child', name: 'child', group: 'alpha', fleetParentId: null }),
    ]);
  });
});
