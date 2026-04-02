import { describe, expect, test } from 'bun:test';
import {
  SIDEBAR_ROOT_PARENT_ID,
  mergeVisibleSidebarNodeOrderByParent,
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
});
