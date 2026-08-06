import { describe, expect, test } from 'bun:test';
import { applySidebarMove, normalizeSidebarLayout, reorderSidebarEntries } from '../src/sidebar';

describe('canonical sidebar mutations', () => {
  test('moves an item between parents without duplicating it', () => {
    const next = applySidebarMove(
      normalizeSidebarLayout({
        sidebarNodeOrderByParent: {
          root: ['drone:host', 'folder:Review'],
          'folder:Review': ['drone:first', 'drone:second'],
        },
      }),
      {
        kind: 'move-into-folder',
        itemKind: 'drone',
        repoPath: '/repo',
        droneId: 'host',
        sourceParentId: 'root',
        sourceSiblingNodeIds: ['drone:host', 'folder:Review'],
        targetGroup: 'Review',
        targetParentId: 'folder:Review',
        targetSiblingNodeIds: ['drone:first', 'drone:second'],
        targetOverNodeId: 'drone:second',
        placement: 'before',
      },
    );
    expect(next.sidebarNodeOrderByParent).toEqual({
      root: ['folder:Review'],
      'folder:Review': ['drone:first', 'drone:host', 'drone:second'],
    });
    expect(
      Object.values(next.sidebarNodeOrderByParent)
        .flat()
        .filter((id) => id === 'drone:host'),
    ).toHaveLength(1);
  });

  test('preserves unrelated preference maps across a sequence of moves', () => {
    const original = normalizeSidebarLayout({
      sidebarNodeOrderByParent: { root: ['drone:a', 'drone:b'] },
      sidebarChatOrderByDrone: { a: ['default', 'review'] },
      pinnedDroneIds: ['a', 'b'],
    });
    const reordered = applySidebarMove(original, {
      kind: 'tree-entry',
      parentId: 'root',
      siblingNodeIds: ['drone:a', 'drone:b'],
      activeNodeId: 'drone:b',
      overNodeId: 'drone:a',
      placement: 'before',
    });
    const chats = applySidebarMove(reordered, {
      kind: 'chat',
      droneId: 'a',
      chatNames: ['default', 'review'],
      activeChatName: 'review',
      overChatName: 'default',
      placement: 'before',
    });
    expect(chats).toEqual({
      sidebarNodeOrderByParent: { root: ['drone:b', 'drone:a'] },
      sidebarChatOrderByDrone: { a: ['review', 'default'] },
      pinnedDroneIds: ['a', 'b'],
    });
  });

  test('rebases one dragged item without replaying stale sibling order', () => {
    const reordered = applySidebarMove(
      normalizeSidebarLayout({
        sidebarNodeOrderByParent: { root: ['drone:b', 'drone:a', 'drone:c'] },
      }),
      {
        kind: 'tree-entry',
        parentId: 'root',
        siblingNodeIds: ['drone:a', 'drone:b', 'drone:c'],
        activeNodeId: 'drone:c',
        overNodeId: 'drone:a',
        placement: 'before',
      },
    );
    expect(reordered.sidebarNodeOrderByParent.root).toEqual(['drone:b', 'drone:c', 'drone:a']);

    const moved = applySidebarMove(
      normalizeSidebarLayout({
        sidebarNodeOrderByParent: {
          root: ['drone:b', 'drone:a', 'drone:host'],
          'folder:Review': ['drone:y', 'drone:x'],
        },
      }),
      {
        kind: 'move-into-folder',
        itemKind: 'drone',
        repoPath: '/repo',
        droneId: 'host',
        sourceParentId: 'root',
        sourceSiblingNodeIds: ['drone:a', 'drone:b', 'drone:host'],
        targetGroup: 'Review',
        targetParentId: 'folder:Review',
        targetSiblingNodeIds: ['drone:x', 'drone:y'],
        targetOverNodeId: 'drone:y',
        placement: 'before',
      },
    );
    expect(moved.sidebarNodeOrderByParent).toEqual({
      root: ['drone:b', 'drone:a'],
      'folder:Review': ['drone:host', 'drone:y', 'drone:x'],
    });
  });

  test('retains the visible gaps of entries that have not been persisted yet', () => {
    expect(
      reorderSidebarEntries(
        ['drone:a', 'drone:b'],
        ['drone:new-first', 'drone:a', 'drone:b', 'drone:new-last'],
        'drone:b',
        'drone:new-first',
        'before',
      ),
    ).toEqual(['drone:b', 'drone:new-first', 'drone:a', 'drone:new-last']);
  });
});
