import { describe, expect, test } from 'bun:test';
import {
  applyMobileSidebarMoveIntoFolder,
  applyMobileSidebarReorder,
  applyOptimisticMobileSidebarMove,
  firstMobileSidebarInsertionTarget,
  mobileSidebarMoveDestination,
  reorderMobileSidebarEntries,
} from '../src/drones/mobile-sidebar-reorder';
import {
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  type MobileDroneSidebarOrder,
} from '../src/drones/drone-sidebar-model';

function order(overrides: Partial<MobileDroneSidebarOrder> = {}): MobileDroneSidebarOrder {
  return { ...EMPTY_MOBILE_DRONE_SIDEBAR_ORDER, ...overrides };
}

describe('mobile sidebar reorder', () => {
  test('uses the first child other than the active node for top insertion', () => {
    expect(
      firstMobileSidebarInsertionTarget(['drone:host', 'drone:first'], 'drone:host'),
    ).toBe('drone:first');
    expect(firstMobileSidebarInsertionTarget(['drone:host'], 'drone:host')).toBeUndefined();
  });

  test('moves a visible entry before or after the drop target', () => {
    expect(reorderMobileSidebarEntries([], ['a', 'b', 'c'], 'c', 'a', 'before')).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(reorderMobileSidebarEntries([], ['a', 'b', 'c'], 'a', 'b', 'after')).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('preserves hidden entry slots while reordering the visible scope', () => {
    expect(
      reorderMobileSidebarEntries(['a', 'hidden', 'b', 'stale'], ['a', 'b'], 'b', 'a', 'before'),
    ).toEqual(['b', 'hidden', 'a', 'stale']);
  });

  test('writes drone order with canonical node ids under its parent', () => {
    const next = applyMobileSidebarReorder(
      order({ sidebarNodeOrderByParent: { root: ['folder:Review', 'drone:a', 'drone:b'] } }),
      {
        kind: 'drone',
        parentId: 'root',
        siblingDroneIds: ['a', 'b'],
        activeDroneId: 'b',
        overDroneId: 'a',
        placement: 'before',
      },
    );
    expect(next.sidebarNodeOrderByParent.root).toEqual(['folder:Review', 'drone:b', 'drone:a']);
  });

  test('reorders folders and drones together within one parent', () => {
    const next = applyMobileSidebarReorder(
      order({ sidebarNodeOrderByParent: { root: ['folder:Review', 'drone:a', 'folder:Done'] } }),
      {
        kind: 'tree-entry',
        parentId: 'root',
        siblingNodeIds: ['folder:Review', 'drone:a', 'folder:Done'],
        activeNodeId: 'folder:Done',
        overNodeId: 'folder:Review',
        placement: 'before',
      },
    );
    expect(next.sidebarNodeOrderByParent.root).toEqual(['folder:Done', 'folder:Review', 'drone:a']);
  });

  test('moves a drone into a folder and appends it to the visible children', () => {
    const request = {
      kind: 'move-into-folder' as const,
      itemKind: 'drone' as const,
      repoPath: '/repo',
      droneId: 'loose',
      sourceParentId: 'folder:repo:/repo',
      sourceSiblingNodeIds: ['folder:Review', 'drone:loose', 'folder:Done'],
      targetGroup: 'Review',
      targetParentId: 'folder:Review',
      targetSiblingNodeIds: ['drone:existing'],
    };
    const next = applyMobileSidebarMoveIntoFolder(
      order({
        sidebarNodeOrderByParent: {
          'folder:repo:/repo': ['folder:Review', 'drone:loose', 'folder:Done'],
          'folder:Review': ['drone:existing'],
        },
      }),
      request,
    );
    expect(next.sidebarNodeOrderByParent).toEqual({
      'folder:repo:/repo': ['folder:Review', 'folder:Done'],
      'folder:Review': ['drone:existing', 'drone:loose'],
    });
    expect(
      applyOptimisticMobileSidebarMove(
        [
          {
            id: 'loose',
            name: 'Loose',
            runtime: 'host',
            phase: 'ready',
            status: 'ready',
            group: null,
            repoPath: '/repo',
            fleetParentId: null,
            chats: ['default'],
            busyChats: [],
          },
        ],
        request,
      )[0]?.group,
    ).toBe('Review');
  });

  test('moves a drone onto the top of a folder before its first child', () => {
    const next = applyMobileSidebarMoveIntoFolder(
      order({
        sidebarNodeOrderByParent: {
          root: ['drone:host', 'folder:PR tracking tests'],
          'folder:PR tracking tests': ['drone:first', 'drone:second'],
        },
      }),
      {
        kind: 'move-into-folder',
        itemKind: 'drone',
        repoPath: '/repo',
        droneId: 'host',
        sourceParentId: 'root',
        sourceSiblingNodeIds: ['drone:host', 'folder:PR tracking tests'],
        targetGroup: 'PR tracking tests',
        targetParentId: 'folder:PR tracking tests',
        targetSiblingNodeIds: ['drone:first', 'drone:second'],
        targetOverNodeId: 'drone:first',
        placement: 'before',
      },
    );

    expect(next.sidebarNodeOrderByParent).toEqual({
      root: ['folder:PR tracking tests'],
      'folder:PR tracking tests': ['drone:host', 'drone:first', 'drone:second'],
    });
  });

  test('moves a drone out of a group and positions it at the repository root', () => {
    const request = {
      kind: 'move-into-folder' as const,
      itemKind: 'drone' as const,
      repoPath: '/repo',
      droneId: 'review',
      sourceParentId: 'folder:repo-scope:repo:/repo:Review',
      sourceSiblingNodeIds: ['drone:review'],
      targetGroup: null,
      targetParentId: 'folder:repo:/repo',
      targetSiblingNodeIds: ['folder:repo-scope:repo:/repo:Review', 'drone:loose'],
      targetOverNodeId: 'drone:loose',
      placement: 'after' as const,
    };
    const next = applyMobileSidebarMoveIntoFolder(
      order({
        sidebarNodeOrderByParent: {
          'folder:repo-scope:repo:/repo:Review': ['drone:review'],
          'folder:repo:/repo': ['folder:repo-scope:repo:/repo:Review', 'drone:loose'],
        },
      }),
      request,
    );
    expect(next.sidebarNodeOrderByParent).toEqual({
      'folder:repo:/repo': ['folder:repo-scope:repo:/repo:Review', 'drone:loose', 'drone:review'],
    });
    expect(
      applyOptimisticMobileSidebarMove(
        [
          {
            id: 'review',
            name: 'Review drone',
            runtime: 'host',
            phase: 'ready',
            status: 'ready',
            group: 'Review',
            repoPath: '/repo',
            fleetParentId: null,
            chats: ['default'],
            busyChats: [],
          },
        ],
        request,
      )[0]?.group,
    ).toBeNull();
  });

  test('moves a group into another group and rewrites descendant order keys', () => {
    const request = {
      kind: 'move-into-folder' as const,
      itemKind: 'folder' as const,
      repoPath: '/repo',
      sourceGroup: 'Review',
      sourceNodeId: 'folder:repo-scope:repo:/repo:Review',
      sourceParentId: 'folder:repo:/repo',
      sourceSiblingNodeIds: [
        'folder:repo-scope:repo:/repo:Review',
        'folder:repo-scope:repo:/repo:Done',
      ],
      targetGroup: 'Done',
      targetParentId: 'folder:repo-scope:repo:/repo:Done',
      targetSiblingNodeIds: ['drone:done'],
    };
    expect(mobileSidebarMoveDestination(request)).toEqual({
      targetGroup: 'Done',
      nextGroup: 'Done/Review',
    });
    const next = applyMobileSidebarMoveIntoFolder(
      order({
        sidebarNodeOrderByParent: {
          'folder:repo:/repo': [
            'folder:repo-scope:repo:/repo:Review',
            'folder:repo-scope:repo:/repo:Done',
          ],
          'folder:repo-scope:repo:/repo:Review': [
            'folder:repo-scope:repo:/repo:Review/Nested',
            'drone:review',
          ],
          'folder:repo-scope:repo:/repo:Review/Nested': ['drone:nested'],
          'folder:repo-scope:repo:/repo:Done': ['drone:done'],
        },
      }),
      request,
    );
    expect(next.sidebarNodeOrderByParent).toEqual({
      'folder:repo:/repo': ['folder:repo-scope:repo:/repo:Done'],
      'folder:repo-scope:repo:/repo:Done/Review': [
        'folder:repo-scope:repo:/repo:Done/Review/Nested',
        'drone:review',
      ],
      'folder:repo-scope:repo:/repo:Done/Review/Nested': ['drone:nested'],
      'folder:repo-scope:repo:/repo:Done': [
        'drone:done',
        'folder:repo-scope:repo:/repo:Done/Review',
      ],
    });
    expect(
      applyOptimisticMobileSidebarMove(
        [
          {
            id: 'review',
            name: 'Review',
            runtime: 'host',
            phase: 'ready',
            status: 'ready',
            group: 'Review',
            repoPath: '/repo',
            fleetParentId: null,
            chats: ['default'],
            busyChats: [],
          },
          {
            id: 'nested',
            name: 'Nested',
            runtime: 'host',
            phase: 'ready',
            status: 'ready',
            group: 'Review/Nested',
            repoPath: '/repo',
            fleetParentId: null,
            chats: ['default'],
            busyChats: [],
          },
        ],
        request,
      ).map((drone) => drone.group),
    ).toEqual(['Done/Review', 'Done/Review/Nested']);
  });

  test('rejects moving a group into its own subtree', () => {
    expect(
      mobileSidebarMoveDestination({
        kind: 'move-into-folder',
        itemKind: 'folder',
        repoPath: '/repo',
        sourceGroup: 'Review',
        sourceNodeId: 'folder:Review',
        sourceParentId: 'root',
        sourceSiblingNodeIds: ['folder:Review'],
        targetGroup: 'Review/Nested',
        targetParentId: 'folder:Review/Nested',
        targetSiblingNodeIds: [],
      }),
    ).toBeNull();
  });

  test('moves a nested group back to the repository root before a visible row', () => {
    const request = {
      kind: 'move-into-folder' as const,
      itemKind: 'folder' as const,
      repoPath: '/repo',
      sourceGroup: 'Review/Nested',
      sourceNodeId: 'folder:repo-scope:repo:/repo:Review/Nested',
      sourceParentId: 'folder:repo-scope:repo:/repo:Review',
      sourceSiblingNodeIds: ['drone:review', 'folder:repo-scope:repo:/repo:Review/Nested'],
      targetGroup: null,
      targetParentId: 'folder:repo:/repo',
      targetSiblingNodeIds: ['folder:repo-scope:repo:/repo:Review', 'drone:loose'],
      targetOverNodeId: 'drone:loose',
      placement: 'before' as const,
    };
    expect(mobileSidebarMoveDestination(request)).toEqual({
      targetGroup: null,
      nextGroup: 'Nested',
    });
    const next = applyMobileSidebarMoveIntoFolder(
      order({
        sidebarNodeOrderByParent: {
          'folder:repo:/repo': ['folder:repo-scope:repo:/repo:Review', 'drone:loose'],
          'folder:repo-scope:repo:/repo:Review': [
            'drone:review',
            'folder:repo-scope:repo:/repo:Review/Nested',
          ],
          'folder:repo-scope:repo:/repo:Review/Nested': ['drone:nested'],
        },
      }),
      request,
    );
    expect(next.sidebarNodeOrderByParent).toEqual({
      'folder:repo:/repo': [
        'folder:repo-scope:repo:/repo:Review',
        'folder:repo-scope:repo:/repo:Nested',
        'drone:loose',
      ],
      'folder:repo-scope:repo:/repo:Review': ['drone:review'],
      'folder:repo-scope:repo:/repo:Nested': ['drone:nested'],
    });
    expect(
      applyOptimisticMobileSidebarMove(
        [
          {
            id: 'nested',
            name: 'Nested drone',
            runtime: 'host',
            phase: 'ready',
            status: 'ready',
            group: 'Review/Nested',
            repoPath: '/repo',
            fleetParentId: null,
            chats: ['default'],
            busyChats: [],
          },
        ],
        request,
      )[0]?.group,
    ).toBe('Nested');
  });

  test('reorders chats only inside their drone', () => {
    const next = applyMobileSidebarReorder(
      order({
        sidebarChatOrderByDrone: {
          alpha: ['default', 'review', 'plan'],
          beta: ['default', 'debug'],
        },
      }),
      {
        kind: 'chat',
        droneId: 'alpha',
        chatNames: ['default', 'review', 'plan'],
        activeChatName: 'plan',
        overChatName: 'default',
        placement: 'before',
      },
    );
    expect(next.sidebarChatOrderByDrone).toEqual({
      alpha: ['plan', 'default', 'review'],
      beta: ['default', 'debug'],
    });
  });

  test('reorders the visible pinned set without losing hidden pinned drones', () => {
    const next = applyMobileSidebarReorder(order({ pinnedDroneIds: ['a', 'hidden', 'b'] }), {
      kind: 'pinned-drone',
      visibleDroneIds: ['a', 'b'],
      activeDroneId: 'b',
      overDroneId: 'a',
      placement: 'before',
    });
    expect(next.pinnedDroneIds).toEqual(['b', 'hidden', 'a']);
  });
});
