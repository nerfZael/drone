import { describe, expect, test } from 'bun:test';
import { planSidebarDrop, type SidebarDropTarget } from '../src/droneHub/app/sidebar-drop-plan';
import {
  SIDEBAR_ROOT_PARENT_ID,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
} from '../src/droneHub/app/sidebar-node-order';
import type { SidebarNodeTreeModel } from '../src/droneHub/app/sidebar-node-tree';
import type { DroneSummary } from '../src/droneHub/types';

const root = SIDEBAR_ROOT_PARENT_ID;
const sourceFolderId = sidebarFolderNodeId('Source');
const targetFolderId = sidebarFolderNodeId('Target');
const parentId = sidebarDroneNodeId('parent');
const childId = sidebarDroneNodeId('child');
const tree = nodeTree({
  [root]: [
    sidebarDroneNodeId('a'),
    sidebarDroneNodeId('b'),
    sourceFolderId,
    targetFolderId,
    parentId,
  ],
  [targetFolderId]: [sidebarDroneNodeId('inside')],
  [parentId]: [childId],
});

describe('sidebar drop planner', () => {
  test('plans previews and commands for each supported sidebar item', () => {
    const cases: Array<{
      active: Parameters<typeof planSidebarDrop>[0]['active'];
      target: SidebarDropTarget;
      expected: object;
    }> = [
      {
        active: droneDrag('b'),
        target: { kind: 'tree-node', nodeId: sidebarDroneNodeId('a'), placement: 'before' },
        expected: {
          treeTarget: { nodeId: sidebarDroneNodeId('a'), placement: 'before' },
          intent: { kind: 'tree-entry', activeNodeId: sidebarDroneNodeId('b') },
        },
      },
      {
        active: droneDrag('a', ['a', 'b']),
        target: { kind: 'folder-body', folderNodeId: targetFolderId, insertionTarget: null },
        expected: {
          treeTarget: null,
          folderBodyId: targetFolderId,
          intent: {
            kind: 'move-into-folder',
            itemKind: 'drone',
            droneIds: ['a', 'b'],
            targetGroup: 'Target',
            targetParentId: targetFolderId,
            placement: 'inside',
          },
        },
      },
      {
        active: {
          type: 'sidebar-folder',
          folderNodeId: sourceFolderId,
          folderPath: 'Source',
          groupKind: 'group',
          label: 'Source',
        },
        target: {
          kind: 'folder-body',
          folderNodeId: targetFolderId,
          insertionTarget: { nodeId: sidebarDroneNodeId('inside'), placement: 'before' },
        },
        expected: {
          intent: {
            kind: 'move-into-folder',
            itemKind: 'folder',
            sourceGroup: 'Source',
            targetGroup: 'Target',
            targetParentId: targetFolderId,
            targetOverNodeId: sidebarDroneNodeId('inside'),
            placement: 'before',
          },
        },
      },
      {
        active: {
          type: 'sidebar-chat',
          droneId: 'a',
          chatName: 'review',
          nodeId: 'chat:a:review',
          label: 'review',
        },
        target: { kind: 'chat', droneId: 'a', chatName: 'default', placement: 'before' },
        expected: {
          chatTarget: { key: 'a:default', placement: 'before' },
          intent: {
            kind: 'chat',
            chatNames: ['default', 'review'],
            activeChatName: 'review',
            overChatName: 'default',
            placement: 'before',
          },
        },
      },
    ];

    for (const item of cases) {
      expect(dropPlan(item.active, item.target)).toMatchObject(item.expected);
    }
  });

  test('rejects assigning a top-level drone beneath an existing fleet parent', () => {
    expect(
      dropPlan(droneDrag('a'), { kind: 'tree-node', nodeId: childId, placement: 'after' }),
    ).toBeNull();
  });

  test('rejects a stale preview when the final tree target is missing', () => {
    expect(
      planSidebarDrop({
        active: droneDrag('a'),
        target: { kind: 'drone-tail', nodeId: sidebarDroneNodeId('missing') },
        nodeTree: tree,
        droneById: drones('a'),
        sidebarChatOrderByDrone: {},
        preferredTreeTarget: { nodeId: sidebarDroneNodeId('b'), placement: 'before' },
      }),
    ).toBeNull();
  });

  test('falls back to the hovered folder when its DOM insertion anchor is stale', () => {
    const result = dropPlan(droneDrag('a'), {
      kind: 'folder-body',
      folderNodeId: targetFolderId,
      insertionTarget: { nodeId: childId, placement: 'before' },
    });

    expect(result).toMatchObject({
      treeTarget: null,
      folderBodyId: targetFolderId,
      intent: {
        kind: 'move-into-folder',
        targetParentId: targetFolderId,
        placement: 'inside',
      },
    });
  });

  test('keeps the stable group id and normalizes the repo-less root for empty folder moves', () => {
    const repoLessTree = nodeTree({
      [root]: [sourceFolderId, targetFolderId],
    });
    const source = repoLessTree.nodesById[sourceFolderId];
    const target = repoLessTree.nodesById[targetFolderId];
    if (source?.kind !== 'folder' || target?.kind !== 'folder') throw new Error('missing folders');
    source.groupId = 'source-group-id';
    source.repoGroupPath = 'repo:ungrouped';
    target.repoGroupPath = 'repo:ungrouped';

    expect(
      planSidebarDrop({
        active: {
          type: 'sidebar-folder',
          groupId: 'source-group-id',
          folderNodeId: sourceFolderId,
          folderPath: 'Source',
          groupKind: 'group',
          label: 'Source',
        },
        target: { kind: 'folder-body', folderNodeId: targetFolderId, insertionTarget: null },
        nodeTree: repoLessTree,
        droneById: {},
        sidebarChatOrderByDrone: {},
      })?.intent,
    ).toMatchObject({
      kind: 'move-into-folder',
      itemKind: 'folder',
      repoPath: '',
      sourceGroupId: 'source-group-id',
      sourceGroup: 'Source',
      targetGroup: 'Target',
    });
  });

  test('only reorders repository roots when the final hovered node is another root', () => {
    const repoSourceId = sidebarFolderNodeId('repo:first');
    const repoTargetId = sidebarFolderNodeId('repo:second');
    const repoTree = nodeTree({ [root]: [repoSourceId, repoTargetId, targetFolderId] });
    for (const id of [repoSourceId, repoTargetId]) {
      const node = repoTree.nodesById[id];
      if (node?.kind === 'folder') {
        node.groupKind = 'repo';
        node.groupPath = null;
      }
    }
    const active = {
      type: 'sidebar-folder' as const,
      folderNodeId: repoSourceId,
      folderPath: 'repo:first',
      groupKind: 'repo' as const,
      label: 'first',
    };
    const args = {
      active,
      nodeTree: repoTree,
      droneById: {},
      sidebarChatOrderByDrone: {},
    };

    expect(
      planSidebarDrop({
        ...args,
        target: { kind: 'tree-node', nodeId: repoTargetId, placement: 'before' },
      })?.intent,
    ).toMatchObject({ kind: 'tree-entry', activeNodeId: repoSourceId });
    expect(
      planSidebarDrop({
        ...args,
        target: { kind: 'tree-node', nodeId: targetFolderId, placement: 'before' },
        preferredTreeTarget: { nodeId: repoTargetId, placement: 'before' },
      }),
    ).toBeNull();
  });
});

function dropPlan(
  active: Parameters<typeof planSidebarDrop>[0]['active'],
  target: SidebarDropTarget,
) {
  return planSidebarDrop({
    active,
    target,
    nodeTree: tree,
    droneById: drones('a', 'b', 'inside', 'parent', 'child'),
    sidebarChatOrderByDrone: {},
  });
}

function droneDrag(droneId: string, droneIds = [droneId]) {
  return { type: 'sidebar-drone' as const, droneId, droneIds, groupOrderKey: null, label: droneId };
}

function drones(...ids: string[]): Record<string, DroneSummary> {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id,
        group: null,
        repoPath: '/repo',
        chats: id === 'a' ? ['default', 'review'] : ['default'],
        fleetParentId: id === 'child' ? 'parent' : null,
      } as DroneSummary,
    ]),
  );
}

function nodeTree(children: Record<string, string[]>): SidebarNodeTreeModel {
  const nodesById = Object.fromEntries(
    Object.values(children).flat().map((id) => {
      const parentId = Object.entries(children).find(([, ids]) => ids.includes(id))?.[0] ?? root;
      const path = id.startsWith('folder:') ? id.slice('folder:'.length) : null;
      return [
        id,
        path
          ? {
              id,
              kind: 'folder',
              path,
              groupPath: path,
              repoGroupPath: null,
              groupKind: 'group',
              parentId,
            }
          : {
              id,
              kind: 'drone',
              droneId: id.slice('drone:'.length),
              parentId,
            },
      ];
    }),
  );
  return {
    nodesById,
    childIdsByParent: children,
    rootChildIds: children[root] ?? [],
    folderNodeByPath: {},
  } as SidebarNodeTreeModel;
}
