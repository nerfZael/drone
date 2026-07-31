import { describe, expect, test } from 'bun:test';
import {
  buildRepoSidebarModel,
  resolvePinnedSidebarDrones,
  sidebarFolderNodeId,
  type SidebarNodeTreeModel,
} from '@drone/hub-model/sidebar';
import {
  buildMobileDroneRepoGroups,
  normalizeMobileDroneListPayload,
  type MobileDroneGroupFolder,
  type MobileDroneSidebarEntry,
  type MobileDroneTreeNode,
} from '../src/drones/drone-sidebar-model';

type TreeShape =
  | { kind: 'drone'; id: string; children: TreeShape[] }
  | { kind: 'folder'; path: string; children: TreeShape[] };

function canonicalShape(tree: SidebarNodeTreeModel, nodeId: string): TreeShape {
  const node = tree.nodesById[nodeId]!;
  const children = (tree.childIdsByParent[nodeId] ?? []).map((childId) =>
    canonicalShape(tree, childId),
  );
  return node.kind === 'drone'
    ? { kind: 'drone', id: node.droneId, children }
    : { kind: 'folder', path: node.groupPath ?? node.path, children };
}

function mobileDroneShape(node: MobileDroneTreeNode): TreeShape {
  return {
    kind: 'drone',
    id: node.drone.id,
    children: node.children.map(mobileDroneShape),
  };
}

function mobileFolderShape(folder: MobileDroneGroupFolder): TreeShape {
  return {
    kind: 'folder',
    path: folder.path,
    children: folder.entries.map(mobileEntryShape),
  };
}

function mobileEntryShape(entry: MobileDroneSidebarEntry): TreeShape {
  return entry.kind === 'drone'
    ? mobileDroneShape(entry.node)
    : mobileFolderShape(entry.folder);
}

describe('mobile sidebar tree parity', () => {
  test('exposes registered repositories in the create selector without expanded options', () => {
    const result = normalizeMobileDroneListPayload({
      schemaVersion: 6,
      drones: [],
      sidebar: { registeredRepoPaths: ['/work/alpha', '/work/beta'] },
    });

    expect(result.createRepos).toEqual([
      {
        path: '/work/alpha',
        hostBranch: null,
        remoteBranches: [],
        branchesError: null,
        branchesLoaded: false,
      },
      {
        path: '/work/beta',
        hostBranch: null,
        remoteBranches: [],
        branchesError: null,
        branchesLoaded: false,
      },
    ]);
  });

  test('projects the canonical desktop hierarchy and ordering without drift', () => {
    const payload = normalizeMobileDroneListPayload({
      schemaVersion: 7,
      drones: [
        {
          id: 'direct-new',
          name: 'Direct new',
          repoPath: '/repo',
          createdAt: '2026-04-04T00:00:00Z',
        },
        {
          id: 'direct-old',
          name: 'Direct old',
          repoPath: '/repo',
          createdAt: '2026-04-01T00:00:00Z',
        },
        { id: 'parent', name: 'Parent', repoPath: '/repo', group: 'Delivery/Review' },
        {
          id: 'child',
          name: 'Child',
          repoPath: '/repo',
          group: 'Delivery/Review',
          fleetParentId: 'parent',
        },
        { id: 'plan', name: 'Plan', repoPath: '/repo', group: 'Delivery/Plan' },
        { id: 'other', name: 'Other', repoPath: '/other' },
      ],
      sidebar: {
        snapshotComplete: true,
        preferenceVersion: 18,
        registeredRepoPaths: ['/empty', '/other', '/repo'],
        groupCreatedAtByName: {
          'Delivery/Plan': '2026-04-03T00:00:00Z',
          'Delivery/Review': '2026-04-02T00:00:00Z',
        },
        sidebarGroupOrder: [
          'repo:repo:/repo',
          'repo:repo:/other',
          'repo:repo:/empty',
          'group:Delivery/Review',
          'group:Delivery/Plan',
        ],
        sidebarDroneOrderByGroup: {
          'group:Ungrouped': ['direct-old'],
        },
        sidebarNodeOrderByParent: {
          'folder:repo:/repo': ['drone:direct-old', 'folder:repo-scope:repo:/repo:Delivery'],
          'folder:repo-scope:repo:/repo:Delivery': [
            'folder:repo-scope:repo:/repo:Delivery/Plan',
            'folder:repo-scope:repo:/repo:Delivery/Review',
          ],
          'drone:parent': ['drone:child'],
        },
        pinnedDroneIds: ['plan', 'direct-old', 'other'],
      },
    });
    const drones = payload.drones;
    const order = payload.sidebar;

    const { groups: canonicalGroups, nodeTree: canonicalTree } = buildRepoSidebarModel({
      drones,
      registeredRepoPaths: order.registeredRepoPaths,
      sidebarDroneOrderByGroup: order.sidebarDroneOrderByGroup,
      sidebarGroupOrder: order.sidebarGroupOrder,
      sidebarNodeOrderByParent: order.sidebarNodeOrderByParent,
      sidebarGroupCreatedAtByName: order.groupCreatedAtByName,
    });
    const canonicalShapeByRepo = canonicalGroups.map((group) => ({
      id: group.group,
      children: (canonicalTree.childIdsByParent[sidebarFolderNodeId(group.group)] ?? []).map(
        (nodeId) => canonicalShape(canonicalTree, nodeId),
      ),
    }));
    const mobileShapeByRepo = buildMobileDroneRepoGroups(drones, order).map((group) => ({
      id: group.id,
      children: group.entries.map(mobileEntryShape),
    }));

    expect(mobileShapeByRepo).toEqual(canonicalShapeByRepo);
    expect(canonicalGroups.map((group) => group.group)).toEqual([
      'repo:/repo',
      'repo:/other',
      'repo:/empty',
    ]);
    expect(
      resolvePinnedSidebarDrones(drones, order.pinnedDroneIds).map((drone) => drone.id),
    ).toEqual(['plan', 'direct-old', 'other']);
  });

  test('uses the same deterministic fallback when no repositories are registered', () => {
    const payload = normalizeMobileDroneListPayload({
      schemaVersion: 7,
      drones: [
        { id: 'zeta', repoPath: '/zeta' },
        { id: 'alpha', repoPath: '/alpha' },
        { id: 'loose', repoPath: '' },
      ],
      sidebar: {
        snapshotComplete: true,
        registeredRepoPaths: [],
      },
    });
    const canonical = buildRepoSidebarModel({
      drones: payload.drones,
      registeredRepoPaths: payload.sidebar.registeredRepoPaths,
      sidebarGroupOrder: payload.sidebar.sidebarGroupOrder,
      sidebarDroneOrderByGroup: payload.sidebar.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: payload.sidebar.sidebarNodeOrderByParent,
      sidebarGroupCreatedAtByName: payload.sidebar.groupCreatedAtByName,
    });
    const mobile = buildMobileDroneRepoGroups(payload.drones, payload.sidebar);

    expect(mobile.map((group) => group.id)).toEqual(canonical.groups.map((group) => group.group));
    expect(mobile.map((group) => group.repoPath)).toEqual(['', '/alpha', '/zeta']);
  });
});
