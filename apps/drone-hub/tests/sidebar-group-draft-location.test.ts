import { describe, expect, test } from 'bun:test';

import {
  resolveSidebarDroneDraftLocation,
  resolveSidebarGroupDraftLocation,
} from '../src/droneHub/app/sidebar-group-draft-location';
import {
  SIDEBAR_ROOT_PARENT_ID,
  sidebarChatSidebarNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
} from '../src/droneHub/app/sidebar-node-order';
import type { SidebarNodeTreeModel } from '../src/droneHub/app/sidebar-node-tree';

describe('sidebar group draft location', () => {
  const visibleFolderPaths = new Set([
    'Alpha',
    'Alpha/Untitled 1',
    'Alpha/Nested',
    'Alpha/Nested/Untitled 1',
    'Beta',
    'Untitled 1',
  ]);
  const alphaId = sidebarFolderNodeId('Alpha');
  const nestedId = sidebarFolderNodeId('Alpha/Nested');
  const betaId = sidebarFolderNodeId('Beta');
  const droneId = sidebarDroneNodeId('drone-1');
  const childDroneId = sidebarDroneNodeId('child-1');
  const nodeTree: SidebarNodeTreeModel = {
    nodesById: {
      [alphaId]: {
        id: alphaId,
        kind: 'folder',
        path: 'Alpha',
        groupPath: 'Alpha',
        repoGroupPath: null,
        label: 'Alpha',
        groupKind: 'group',
        parentId: SIDEBAR_ROOT_PARENT_ID,
        depth: 0,
        totalDroneCount: 2,
        directDroneCount: 2,
      },
      [nestedId]: {
        id: nestedId,
        kind: 'folder',
        path: 'Alpha/Nested',
        groupPath: 'Alpha/Nested',
        repoGroupPath: null,
        label: 'Nested',
        groupKind: 'group',
        parentId: alphaId,
        depth: 1,
        totalDroneCount: 0,
        directDroneCount: 0,
      },
      [betaId]: {
        id: betaId,
        kind: 'folder',
        path: 'Beta',
        groupPath: 'Beta',
        repoGroupPath: null,
        label: 'Beta',
        groupKind: 'group',
        parentId: SIDEBAR_ROOT_PARENT_ID,
        depth: 0,
        totalDroneCount: 0,
        directDroneCount: 0,
      },
      [droneId]: {
        id: droneId,
        kind: 'drone',
        droneId: 'drone-1',
        parentId: alphaId,
        groupPath: 'Alpha',
        repoGroupPath: null,
        depth: 1,
      },
      [childDroneId]: {
        id: childDroneId,
        kind: 'drone',
        droneId: 'child-1',
        parentId: droneId,
        groupPath: 'Alpha',
        repoGroupPath: null,
        depth: 2,
      },
    },
    childIdsByParent: {
      [SIDEBAR_ROOT_PARENT_ID]: [alphaId, betaId],
      [alphaId]: [nestedId, droneId],
      [nestedId]: [],
      [betaId]: [],
      [droneId]: [childDroneId],
      [childDroneId]: [],
    },
    rootChildIds: [alphaId, betaId],
    folderNodeByPath: {},
  };

  test('creates immediately above a selected root group', () => {
    expect(
      resolveSidebarGroupDraftLocation({
        selectedSidebarNodeId: alphaId,
        nodeTree,
        visibleFolderPaths,
      }),
    ).toEqual({
      parentPath: null,
      beforeNodeId: alphaId,
      siblingNames: ['Alpha', 'Beta', 'Untitled 1'],
    });
  });

  test('creates a sibling immediately above a selected nested group', () => {
    expect(
      resolveSidebarGroupDraftLocation({
        selectedSidebarNodeId: nestedId,
        nodeTree,
        visibleFolderPaths,
      }),
    ).toEqual({
      parentPath: 'Alpha',
      beforeNodeId: nestedId,
      siblingNames: ['Untitled 1', 'Nested'],
    });
  });

  test('creates immediately above a selected drone without moving it', () => {
    expect(
      resolveSidebarGroupDraftLocation({
        selectedSidebarNodeId: droneId,
        nodeTree,
        visibleFolderPaths,
      }),
    ).toEqual({
      parentPath: 'Alpha',
      beforeNodeId: droneId,
      siblingNames: ['Untitled 1', 'Nested'],
    });
  });

  test('anchors a selected chat and child drone above the top-level drone unit', () => {
    expect(
      resolveSidebarGroupDraftLocation({
        selectedSidebarNodeId: sidebarChatSidebarNodeId('drone-1', 'review'),
        selectedDroneId: 'drone-1',
        nodeTree,
        visibleFolderPaths,
      }),
    ).toEqual({
      parentPath: 'Alpha',
      beforeNodeId: droneId,
      siblingNames: ['Untitled 1', 'Nested'],
    });
    expect(
      resolveSidebarGroupDraftLocation({
        selectedSidebarNodeId: childDroneId,
        nodeTree,
        visibleFolderPaths,
      }),
    ).toEqual({
      parentPath: 'Alpha',
      beforeNodeId: droneId,
      siblingNames: ['Untitled 1', 'Nested'],
    });
  });

  test('falls back to the top of the root when there is no selection', () => {
    expect(
      resolveSidebarGroupDraftLocation({
        selectedSidebarNodeId: null,
        nodeTree,
        visibleFolderPaths,
      }),
    ).toEqual({
      parentPath: null,
      beforeNodeId: null,
      siblingNames: ['Alpha', 'Beta', 'Untitled 1'],
    });
  });
});

describe('sidebar drone draft location', () => {
  const visibleFolderPaths = new Set(['Alpha', 'Alpha/Nested', 'Beta']);

  test('uses the selected folder before the selected drone group', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: 'Alpha/Nested',
        visibleFolderPaths,
        selectedDrone: {
          group: 'Beta',
          repoPath: '/repos/example',
        },
      }),
    ).toEqual({
      group: 'Alpha/Nested',
      repoPath: '/repos/example',
    });
  });

  test("uses the selected drone's group for the New Drone button", () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths,
        selectedDrone: {
          group: 'Beta',
          repoPath: '/repos/example',
        },
      }),
    ).toEqual({
      group: 'Beta',
      repoPath: '/repos/example',
    });
  });

  test('does not create a drone inside a hidden selected group', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths,
        selectedDrone: {
          group: 'Hidden',
          repoAttached: true,
          repoPath: '/repos/example',
        },
      }),
    ).toEqual({
      group: '',
      repoPath: '/repos/example',
    });
  });

  test('does not reuse a stale repo path from a detached selected drone', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths,
        selectedDrone: {
          group: 'Beta',
          repoAttached: false,
          repoPath: '/repos/stale',
        },
        fallbackRepoPath: '/repos/fallback',
      }),
    ).toEqual({
      group: 'Beta',
    });
  });

  test('falls back to the active repository at the root', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths,
        fallbackRepoPath: '/repos/example',
      }),
    ).toEqual({
      group: '',
      repoPath: '/repos/example',
    });
  });

  test('keeps an ungrouped selected drone at the root', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths: new Set(['Ungrouped']),
        selectedDrone: {
          group: 'Ungrouped',
        },
      }),
    ).toEqual({
      group: '',
    });
  });

  test('uses the exact repository root selected in repository grouping mode', () => {
    const repoPath = '/repos/example';
    const repoGroupPath = `repo:${repoPath}`;
    const repoNodeId = sidebarFolderNodeId(repoGroupPath);
    const nodeTree: SidebarNodeTreeModel = {
      nodesById: {
        [repoNodeId]: {
          id: repoNodeId,
          kind: 'folder',
          path: repoGroupPath,
          groupPath: null,
          repoGroupPath,
          label: 'example',
          groupKind: 'repo',
          parentId: SIDEBAR_ROOT_PARENT_ID,
          depth: 0,
          totalDroneCount: 0,
          directDroneCount: 0,
        },
      },
      childIdsByParent: { [SIDEBAR_ROOT_PARENT_ID]: [repoNodeId], [repoNodeId]: [] },
      rootChildIds: [repoNodeId],
      folderNodeByPath: {},
    };

    expect(
      resolveSidebarDroneDraftLocation({
        selectedSidebarNodeId: repoNodeId,
        nodeTree,
        selectedFolderPath: repoGroupPath,
        visibleFolderPaths: new Set([repoGroupPath]),
        fallbackRepoPath: '',
      }),
    ).toEqual({ group: '', repoPath });
  });

  test('keeps same-named selected groups scoped to their exact repository', () => {
    const repoPath = '/repos/b';
    const repoGroupPath = `repo:${repoPath}`;
    const groupPath = 'Review';
    const scopedPath = `repo-scope:${repoGroupPath}:${groupPath}`;
    const groupNodeId = sidebarFolderNodeId(scopedPath);
    const nodeTree: SidebarNodeTreeModel = {
      nodesById: {
        [groupNodeId]: {
          id: groupNodeId,
          kind: 'folder',
          path: scopedPath,
          groupPath,
          repoGroupPath,
          label: groupPath,
          groupKind: 'group',
          parentId: sidebarFolderNodeId(repoGroupPath),
          depth: 1,
          totalDroneCount: 0,
          directDroneCount: 0,
        },
      },
      childIdsByParent: { [groupNodeId]: [] },
      rootChildIds: [],
      folderNodeByPath: {},
    };

    expect(
      resolveSidebarDroneDraftLocation({
        selectedSidebarNodeId: groupNodeId,
        nodeTree,
        selectedFolderPath: groupPath,
        visibleFolderPaths: new Set([groupPath]),
        selectedDrone: { group: groupPath, repoPath: '/repos/a' },
      }),
    ).toEqual({ group: groupPath, repoPath });
  });

  test('selecting the repository-less root explicitly clears repository context', () => {
    const repoGroupPath = 'repo:ungrouped';
    const repoNodeId = sidebarFolderNodeId(repoGroupPath);
    const nodeTree: SidebarNodeTreeModel = {
      nodesById: {
        [repoNodeId]: {
          id: repoNodeId,
          kind: 'folder',
          path: repoGroupPath,
          groupPath: null,
          repoGroupPath,
          label: 'Ungrouped',
          groupKind: 'repo',
          parentId: SIDEBAR_ROOT_PARENT_ID,
          depth: 0,
          totalDroneCount: 0,
          directDroneCount: 0,
        },
      },
      childIdsByParent: { [SIDEBAR_ROOT_PARENT_ID]: [repoNodeId], [repoNodeId]: [] },
      rootChildIds: [repoNodeId],
      folderNodeByPath: {},
    };

    expect(
      resolveSidebarDroneDraftLocation({
        selectedSidebarNodeId: repoNodeId,
        nodeTree,
        selectedFolderPath: repoGroupPath,
        visibleFolderPaths: new Set([repoGroupPath]),
        fallbackRepoPath: '/repos/stale',
      }),
    ).toEqual({ group: '', repoPath: '' });
  });
});
