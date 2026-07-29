import { describe, expect, test } from 'bun:test';
import {
  SIDEBAR_ROOT_PARENT_ID,
  mergeVisibleSidebarNodeOrderByParent,
  moveSidebarDroneToTopInNodeOrder,
  placeCreatedSidebarFolderAtTop,
  removeSidebarRepoScopedNodeOrderByGroupPrefix,
  renameSidebarNodeOrderByParentGroupPrefix,
  sidebarDroneIdFromNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
} from '../src/droneHub/app/sidebar-node-order';

describe('sidebar-node-order', () => {
  test('resolves only drone rows as inline rename targets', () => {
    expect(sidebarDroneIdFromNodeId(sidebarDroneNodeId('drone-1'))).toBe('drone-1');
    expect(sidebarDroneIdFromNodeId(sidebarFolderNodeId('Group'))).toBeNull();
    expect(sidebarDroneIdFromNodeId('chat:drone-1:default')).toBeNull();
  });

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

  test('places a committed root folder before every rendered sibling', () => {
    const firstDroneId = sidebarDroneNodeId('first');
    const existingFolderId = sidebarFolderNodeId('Existing');

    expect(
      placeCreatedSidebarFolderAtTop(
        {
          [SIDEBAR_ROOT_PARENT_ID]: [firstDroneId, existingFolderId],
        },
        {
          childIdsByParent: {
            [SIDEBAR_ROOT_PARENT_ID]: [firstDroneId, existingFolderId],
          },
        },
        'Untitled 1',
      ),
    ).toEqual({
      [SIDEBAR_ROOT_PARENT_ID]: [
        sidebarFolderNodeId('Untitled 1'),
        firstDroneId,
        existingFolderId,
      ],
    });
  });

  test('places a committed repo-scoped folder at the top of its repository', () => {
    const repoGroupPath = 'repo:/work/drone';
    const repoRootId = sidebarFolderNodeId(repoGroupPath);
    const existingDroneId = sidebarDroneNodeId('existing');
    const existingFolderId = sidebarFolderNodeId(
      `repo-scope:${repoGroupPath}:Existing`,
    );

    expect(
      placeCreatedSidebarFolderAtTop(
        {
          [repoRootId]: [existingFolderId, existingDroneId],
        },
        {
          childIdsByParent: {
            [repoRootId]: [existingDroneId, existingFolderId],
          },
        },
        'Untitled 1',
        repoGroupPath,
      ),
    ).toEqual({
      [repoRootId]: [
        sidebarFolderNodeId(`repo-scope:${repoGroupPath}:Untitled 1`),
        existingDroneId,
        existingFolderId,
      ],
    });
  });

  test('removes stale ordering entries for a deleted repo-scoped group', () => {
    const repoGroupPath = 'repo:/work/drone';
    const repoRootId = sidebarFolderNodeId(repoGroupPath);
    const deletedId = sidebarFolderNodeId(
      `repo-scope:${repoGroupPath}:Deleted`,
    );
    const deletedChildId = sidebarFolderNodeId(
      `repo-scope:${repoGroupPath}:Deleted/Child`,
    );
    const keptId = sidebarFolderNodeId(
      `repo-scope:${repoGroupPath}:Kept`,
    );

    expect(
      removeSidebarRepoScopedNodeOrderByGroupPrefix(
        {
          [repoRootId]: [deletedId, keptId],
          [deletedId]: [deletedChildId],
        },
        repoGroupPath,
        'Deleted',
      ),
    ).toEqual({
      [repoRootId]: [keptId],
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
