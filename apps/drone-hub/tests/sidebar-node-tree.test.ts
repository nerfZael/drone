import { describe, expect, test } from 'bun:test';
import { buildSidebarFolderTree } from '../src/droneHub/app/sidebar-folder-tree';
import { SIDEBAR_ROOT_PARENT_ID, sidebarDroneNodeId, sidebarFolderNodeId } from '../src/droneHub/app/sidebar-node-order';
import { buildSidebarNodeTree, type SidebarTreeFolderNode } from '../src/droneHub/app/sidebar-node-tree';
import type { SidebarGroup } from '../src/droneHub/app/use-sidebar-view-model';
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

function folderNode(node: unknown): SidebarTreeFolderNode {
  expect(node && typeof node === 'object' && (node as any).kind === 'folder').toBe(true);
  return node as SidebarTreeFolderNode;
}

describe('buildSidebarNodeTree', () => {
  test('keeps newly inserted drones ahead of persisted sibling node order', () => {
    const sidebarGroups: SidebarGroup[] = [
      {
        group: 'Ungrouped',
        label: 'Ungrouped',
        kind: 'group',
        items: [
          drone({ id: 'new-drone', name: 'new-drone', createdAt: '2026-03-31T12:00:00.000Z' }),
          drone({ id: 'older-a', name: 'older-a', createdAt: '2026-03-30T12:00:00.000Z' }),
          drone({ id: 'older-b', name: 'older-b', createdAt: '2026-03-29T12:00:00.000Z' }),
        ],
      },
    ];

    const tree = buildSidebarNodeTree({
      sidebarFolderTree: [],
      sidebarGroups,
      sidebarGroupOrder: [],
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {
        [SIDEBAR_ROOT_PARENT_ID]: [sidebarDroneNodeId('older-b'), sidebarDroneNodeId('older-a')],
      },
    });

    expect(tree.rootChildIds).toEqual([
      sidebarDroneNodeId('new-drone'),
      sidebarDroneNodeId('older-b'),
      sidebarDroneNodeId('older-a'),
    ]);
  });

  test('renders repo-scoped empty folders under the owning repo root', () => {
    const repoPath = '/work/repo-a';
    const sidebarGroups: SidebarGroup[] = [
      {
        group: `repo:${repoPath}`,
        label: 'repo-a',
        kind: 'repo',
        items: [drone({ id: 'drone-a', name: 'drone-a', repoPath, repoAttached: true })],
      },
    ];
    const sidebarFolderTree = buildSidebarFolderTree(sidebarGroups, []);

    const tree = buildSidebarNodeTree({
      sidebarFolderTree,
      sidebarGroups,
      sidebarGroupOrder: [],
      repoScopedGroupPathsByRepoGroup: {
        [`repo:${repoPath}`]: ['showreels/alpha'],
      },
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
    });

    const repoRootId = sidebarFolderNodeId(`repo:${repoPath}`);
    const repoChildren = (tree.childIdsByParent[repoRootId] ?? []).map((id) => tree.nodesById[id]);
    const showreelsNode = folderNode(repoChildren.find((node) => (node as any)?.kind === 'folder' && (node as any)?.groupPath === 'showreels'));
    const alphaNode = folderNode(
      (tree.childIdsByParent[showreelsNode.id] ?? []).map((id) => tree.nodesById[id]).find((node) => (node as any)?.groupPath === 'showreels/alpha'),
    );

    expect(showreelsNode.repoGroupPath).toBe(`repo:${repoPath}`);
    expect(showreelsNode.totalDroneCount).toBe(0);
    expect(alphaNode.repoGroupPath).toBe(`repo:${repoPath}`);
    expect(alphaNode.totalDroneCount).toBe(0);
  });

  test('keeps newly inserted repo-root drones ahead of saved repo node order', () => {
    const repoPath = '/work/repo-a';
    const repoGroup = `repo:${repoPath}`;
    const alphaFolderPath = `repo-scope:${repoGroup}:alpha`;
    const sidebarGroups: SidebarGroup[] = [
      {
        group: repoGroup,
        label: 'repo-a',
        kind: 'repo',
        items: [
          drone({
            id: 'new-drone',
            name: 'new-drone',
            repoPath,
            repoAttached: true,
            createdAt: '2026-03-31T12:00:00.000Z',
          }),
          drone({
            id: 'older-drone',
            name: 'older-drone',
            repoPath,
            repoAttached: true,
            createdAt: '2026-03-30T12:00:00.000Z',
          }),
          drone({
            id: 'alpha-drone',
            name: 'alpha-drone',
            repoPath,
            repoAttached: true,
            group: 'alpha',
            createdAt: '2026-03-29T12:00:00.000Z',
          }),
        ],
      },
    ];
    const sidebarFolderTree = buildSidebarFolderTree(sidebarGroups, []);

    const tree = buildSidebarNodeTree({
      sidebarFolderTree,
      sidebarGroups,
      sidebarGroupOrder: [],
      repoScopedGroupPathsByRepoGroup: {
        [repoGroup]: ['alpha'],
      },
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {
        [sidebarFolderNodeId(repoGroup)]: [
          sidebarDroneNodeId('older-drone'),
          sidebarFolderNodeId(alphaFolderPath),
        ],
      },
    });

    expect(tree.childIdsByParent[sidebarFolderNodeId(repoGroup)]).toEqual([
      sidebarDroneNodeId('new-drone'),
      sidebarDroneNodeId('older-drone'),
      sidebarFolderNodeId(alphaFolderPath),
    ]);
  });
});
