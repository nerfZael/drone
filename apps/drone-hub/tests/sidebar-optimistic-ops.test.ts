import { describe, expect, test } from 'bun:test';
import {
  applySidebarOptimisticOpsToDrones,
  applySidebarOptimisticOpsToGroups,
  pruneSatisfiedSidebarOptimisticOps,
  sidebarOptimisticOpForMoveIntent,
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
  test('maps unified folder drops to optimistic membership changes', () => {
    expect(
      sidebarOptimisticOpForMoveIntent(
        {
          kind: 'move-into-folder',
          itemKind: 'drone',
          repoPath: '/repo',
          droneId: 'child',
          droneIds: ['child'],
          targetParentDroneId: null,
          sourceParentId: 'folder:beta',
          sourceSiblingNodeIds: ['drone:child'],
          targetGroup: 'alpha',
          targetParentId: 'folder:alpha',
          targetSiblingNodeIds: [],
          placement: 'inside',
        },
        'op-1',
      ),
    ).toEqual({
      id: 'op-1',
      kind: 'reparent_drones',
      droneIds: ['child'],
      targetParentDroneId: null,
      targetGroup: 'alpha',
    });

    expect(
      sidebarOptimisticOpForMoveIntent(
        {
          kind: 'move-into-folder',
          itemKind: 'folder',
          repoPath: '/repo',
          sourceGroup: 'beta',
          sourceNodeId: 'folder:beta',
          sourceParentId: 'root',
          sourceSiblingNodeIds: ['folder:beta'],
          targetGroup: 'alpha',
          targetParentId: 'folder:alpha',
          targetSiblingNodeIds: [],
          placement: 'inside',
        },
        'op-2',
      ),
    ).toEqual({
      id: 'op-2',
      kind: 'rename_group',
      sourceGroup: 'beta',
      targetGroup: 'alpha/beta',
    });
  });

  test('does not create membership overlays for same-parent reorders', () => {
    expect(
      sidebarOptimisticOpForMoveIntent(
        {
          kind: 'tree-entry',
          parentId: 'folder:alpha',
          siblingNodeIds: ['drone:a', 'drone:b'],
          activeNodeId: 'drone:b',
          overNodeId: 'drone:a',
          placement: 'before',
        },
        'op-1',
      ),
    ).toBeNull();
  });

  test('keeps a group move over stale registry data until the server confirms it', () => {
    const op: SidebarOptimisticOp = {
      id: 'op-1',
      kind: 'move_drones',
      droneIds: ['moving'],
      targetGroup: 'alpha',
    };
    const staleDrones = [drone({ id: 'moving', name: 'moving', group: 'beta' })];

    expect(applySidebarOptimisticOpsToDrones(staleDrones, [op])).toEqual([
      drone({ id: 'moving', name: 'moving', group: 'alpha' }),
    ]);
    expect(
      pruneSatisfiedSidebarOptimisticOps(
        [op],
        [{ group: 'alpha', label: 'alpha', kind: 'group', items: [] }],
        staleDrones,
      ),
    ).toEqual([op]);
    expect(
      pruneSatisfiedSidebarOptimisticOps(
        [op],
        [{ group: 'alpha', label: 'alpha', kind: 'group', items: [] }],
        [drone({ id: 'moving', name: 'moving', group: 'alpha' })],
      ),
    ).toEqual([]);
  });

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

  test('composes rapid moves using the newest pending destination', () => {
    const base = [drone({ id: 'moving', name: 'moving', group: 'alpha' })];
    const ops: SidebarOptimisticOp[] = [
      { id: 'to-bravo', kind: 'move_drones', droneIds: ['moving'], targetGroup: 'bravo' },
      { id: 'to-charlie', kind: 'move_drones', droneIds: ['moving'], targetGroup: 'charlie' },
      { id: 'ungroup', kind: 'move_drones', droneIds: ['moving'], targetGroup: null },
    ];
    expect(applySidebarOptimisticOpsToDrones(base, ops)[0]?.group).toBeNull();
    expect(applySidebarOptimisticOpsToDrones(base, ops.slice(1))[0]?.group).toBeNull();
  });

  test('can create, rename, and populate a group before registry confirmation', () => {
    const baseDrones = [drone({ id: 'moving', name: 'moving', group: null })];
    const baseGroups = [{ group: 'Ungrouped', label: 'Ungrouped', kind: 'group' as const, items: baseDrones }];
    const ops: SidebarOptimisticOp[] = [
      { id: 'create', kind: 'create_group', group: 'alpha' },
      { id: 'rename', kind: 'rename_group', sourceGroup: 'alpha', targetGroup: 'bravo' },
      { id: 'move', kind: 'move_drones', droneIds: ['moving'], targetGroup: 'bravo' },
    ];
    const optimisticDrones = applySidebarOptimisticOpsToDrones(baseDrones, ops);
    const optimisticGroups = applySidebarOptimisticOpsToGroups(baseGroups, optimisticDrones, ops);
    expect(optimisticDrones[0]?.group).toBe('bravo');
    expect(optimisticGroups.map((group) => group.group).sort()).toEqual(['Ungrouped', 'bravo']);
    expect(optimisticGroups.find((group) => group.group === 'bravo')?.items.map((item) => item.id)).toEqual(['moving']);
  });

  test('preserves canonical group identity while optimistically renaming an empty folder', () => {
    const baseGroups = [
      {
        groupId: 'group-stable',
        group: 'alpha',
        label: 'alpha',
        kind: 'group' as const,
        items: [],
      },
    ];
    const ops: SidebarOptimisticOp[] = [
      {
        id: 'nest',
        kind: 'rename_group',
        sourceGroup: 'alpha',
        targetGroup: 'parent/alpha',
      },
    ];

    expect(applySidebarOptimisticOpsToGroups(baseGroups, [], ops)).toEqual([
      {
        groupId: 'group-stable',
        group: 'parent/alpha',
        label: 'parent/alpha',
        kind: 'group',
        items: [],
      },
    ]);
  });
});
