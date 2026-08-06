import { describe, expect, test } from 'bun:test';
import {
  resolveMobileSidebarDropTarget,
  type MobileSidebarMeasuredDropTarget,
} from '../src/drones/mobile-sidebar-drop-target';

function target(
  itemId: string,
  scope: string,
  top: number,
  options: {
    treeScope?: string;
    acceptsInside?: boolean;
    folderPath?: string;
    parentId?: string;
    parentGroupPath?: string | null;
    siblingItemIds?: string[];
    childItemIds?: string[];
  } = {},
): MobileSidebarMeasuredDropTarget {
  return {
    key: `${scope}\u0000${itemId}`,
    scope,
    treeScope: options.treeScope,
    itemId,
    data:
      options.folderPath || options.parentId
        ? {
            folderPath: options.folderPath,
            parentId: options.parentId,
            parentGroupPath: options.parentGroupPath,
            siblingItemIds: options.siblingItemIds,
            childItemIds: options.childItemIds,
          }
        : undefined,
    acceptsInside: () => options.acceptsInside === true,
    rect: { top, bottom: top + 40 },
  };
}

describe('mobile sidebar drop targeting', () => {
  test('reorders around siblings and nests at the indicated end of a sibling group', () => {
    const targets = [
      target('drone:a', 'tree:root', 0, { treeScope: 'repo:a' }),
      target('folder:b', 'tree:root', 40, {
        treeScope: 'repo:a',
        acceptsInside: true,
        folderPath: 'B',
        childItemIds: ['drone:existing'],
      }),
    ];
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 42),
    ).toMatchObject({
      overItemId: 'folder:b',
      placement: 'before',
    });
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 52),
    ).toMatchObject({
      overItemId: 'folder:b',
      placement: 'inside',
      overData: {
        folderPath: 'B',
        childItemIds: ['drone:existing'],
        insidePosition: 'start',
      },
    });
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 68),
    ).toMatchObject({
      overItemId: 'folder:b',
      placement: 'inside',
      overData: { folderPath: 'B', insidePosition: 'end' },
    });
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 78),
    ).toMatchObject({
      overItemId: 'folder:b',
      placement: 'after',
    });
  });

  test('allows a cross-level drop only directly over an eligible group', () => {
    const targets = [
      target('drone:a', 'tree:root', 0, { treeScope: 'repo:a' }),
      target('folder:b', 'tree:folder:c', 80, {
        treeScope: 'repo:a',
        acceptsInside: true,
        folderPath: 'C/B',
        parentId: 'folder:c',
      }),
    ];
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 100),
    ).toMatchObject({
      overItemId: 'folder:b',
      placement: 'inside',
    });
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 60),
    ).toBeNull();
  });

  test('returns no destination over an invalid row instead of choosing a nearby sibling', () => {
    const targets = [
      target('folder:a', 'tree:root', 0, { treeScope: 'repo:a' }),
      target('folder:sibling', 'tree:root', 40, { treeScope: 'repo:a', acceptsInside: true }),
      target('folder:a/child', 'tree:folder:a', 80, {
        treeScope: 'repo:a',
        acceptsInside: false,
        parentId: 'folder:a',
      }),
    ];
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'folder:a', 100),
    ).toBeNull();
  });

  test('targets visible children across levels with before or after placement', () => {
    const targets = [
      target('drone:a', 'tree:root', 0, { treeScope: 'repo:a', parentId: 'root' }),
      target('drone:b', 'tree:folder:b', 80, {
        treeScope: 'repo:a',
        parentId: 'folder:b',
        parentGroupPath: 'B',
        siblingItemIds: ['drone:b'],
      }),
    ];
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 82),
    ).toMatchObject({
      overItemId: 'drone:b',
      placement: 'before',
      overData: { parentGroupPath: 'B' },
    });
    expect(
      resolveMobileSidebarDropTarget(targets, 'tree:root', 'repo:a', 'drone:a', 118),
    ).toMatchObject({
      overItemId: 'drone:b',
      placement: 'after',
    });
  });

  test('does not imply unsupported fleet reparenting from cross-level row drops', () => {
    const targets = [
      target('drone:child-a', 'tree:drone:parent-a', 0, {
        treeScope: 'repo:a',
        parentId: 'drone:parent-a',
        parentGroupPath: 'Review',
      }),
      target('drone:child-b', 'tree:drone:parent-b', 80, {
        treeScope: 'repo:a',
        parentId: 'drone:parent-b',
        parentGroupPath: 'Done',
      }),
      target('drone:direct', 'tree:folder:review', 120, {
        treeScope: 'repo:a',
        parentId: 'folder:review',
        parentGroupPath: 'Review',
      }),
    ];
    expect(
      resolveMobileSidebarDropTarget(
        targets,
        'tree:drone:parent-a',
        'repo:a',
        'drone:child-a',
        100,
      ),
    ).toBeNull();
    expect(
      resolveMobileSidebarDropTarget(
        targets,
        'tree:drone:parent-a',
        'repo:a',
        'drone:child-a',
        140,
      ),
    ).toBeNull();
  });
});
