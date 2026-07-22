import { describe, expect, test } from 'bun:test';
import {
  SIDEBAR_ROOT_PARENT_ID,
  mergeVisibleSidebarNodeOrderByParent,
  moveSidebarDroneToTopInNodeOrder,
  renameSidebarNodeOrderByParentGroupPrefix,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
} from '../src/droneHub/app/sidebar-node-order';

describe('sidebar-node-order', () => {
  test('can persist the current visible folder order before a rename', () => {
    const stabilized = mergeVisibleSidebarNodeOrderByParent(
      {},
      {
        [SIDEBAR_ROOT_PARENT_ID]: [
          sidebarFolderNodeId('alpha'),
          sidebarFolderNodeId('beta'),
          sidebarFolderNodeId('gamma'),
        ],
      },
    );

    expect(
      renameSidebarNodeOrderByParentGroupPrefix(stabilized, 'beta', 'omega'),
    ).toEqual({
      [SIDEBAR_ROOT_PARENT_ID]: [
        sidebarFolderNodeId('alpha'),
        sidebarFolderNodeId('omega'),
        sidebarFolderNodeId('gamma'),
      ],
    });
  });

  test('keeps hidden sibling entries after the visible snapshot', () => {
    expect(
      mergeVisibleSidebarNodeOrderByParent(
        {
          [SIDEBAR_ROOT_PARENT_ID]: [
            sidebarFolderNodeId('hidden'),
            sidebarFolderNodeId('alpha'),
          ],
        },
        {
          [SIDEBAR_ROOT_PARENT_ID]: [
            sidebarFolderNodeId('alpha'),
            sidebarFolderNodeId('beta'),
          ],
        },
      ),
    ).toEqual({
      [SIDEBAR_ROOT_PARENT_ID]: [
        sidebarFolderNodeId('alpha'),
        sidebarFolderNodeId('beta'),
        sidebarFolderNodeId('hidden'),
      ],
    });
  });

  test('does not overwrite existing drone order when only folder positions are stabilized', () => {
    expect(
      mergeVisibleSidebarNodeOrderByParent(
        {
          [SIDEBAR_ROOT_PARENT_ID]: [
            sidebarDroneNodeId('new-drone'),
            sidebarFolderNodeId('alpha'),
            sidebarDroneNodeId('older-drone'),
          ],
        },
        {
          [SIDEBAR_ROOT_PARENT_ID]: [
            sidebarFolderNodeId('alpha'),
            sidebarFolderNodeId('beta'),
          ],
        },
      ),
    ).toEqual({
      [SIDEBAR_ROOT_PARENT_ID]: [
        sidebarFolderNodeId('alpha'),
        sidebarFolderNodeId('beta'),
        sidebarDroneNodeId('new-drone'),
        sidebarDroneNodeId('older-drone'),
      ],
    });
  });

  test('moves a drone to the top using its rendered repository-scoped parent', () => {
    const repoParentId = sidebarFolderNodeId('repo-scope:repo:/work/drone:Long Term');
    const firstDroneId = sidebarDroneNodeId('first');
    const selectedDroneId = sidebarDroneNodeId('selected');
    const nodeTree = {
      nodesById: {
        [firstDroneId]: {
          id: firstDroneId,
          kind: 'drone' as const,
          droneId: 'first',
          parentId: repoParentId,
          groupPath: 'Long Term',
          repoGroupPath: 'repo:/work/drone',
          depth: 2,
        },
        [selectedDroneId]: {
          id: selectedDroneId,
          kind: 'drone' as const,
          droneId: 'selected',
          parentId: repoParentId,
          groupPath: 'Long Term',
          repoGroupPath: 'repo:/work/drone',
          depth: 2,
        },
      },
      childIdsByParent: {
        [repoParentId]: [firstDroneId, selectedDroneId],
      },
    };

    expect(moveSidebarDroneToTopInNodeOrder({}, nodeTree, 'selected')).toEqual({
      [repoParentId]: [selectedDroneId, firstDroneId],
    });
  });

  test('does not claim a move when the drone is absent from the rendered tree', () => {
    expect(
      moveSidebarDroneToTopInNodeOrder(
        {},
        { nodesById: {}, childIdsByParent: {} },
        'not-visible',
      ),
    ).toBeNull();
  });
});
