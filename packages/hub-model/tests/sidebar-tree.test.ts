import { describe, expect, test } from 'bun:test';
import {
  buildSidebarRepoScopedGroupIndex,
  buildRepoSidebarModel,
  buildSidebarNodeTree,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
  type SidebarTreeDrone,
  type SidebarTreeFolderNode,
} from '../src/sidebar';

function buildRepoTree(
  drones: SidebarTreeDrone[],
  sidebarNodeOrderByParent: Record<string, string[]> = {},
) {
  const sidebarGroupOrder = ['repo:repo:/repo'];
  return buildRepoSidebarModel({
    drones,
    registeredRepoPaths: ['/repo'],
    sidebarDroneOrderByGroup: {},
    sidebarGroupOrder,
    sidebarNodeOrderByParent,
  }).nodeTree;
}

describe('canonical sidebar tree', () => {
  test('derives repository folder ownership from canonical groups', () => {
    expect(
      buildSidebarRepoScopedGroupIndex([
        {
          id: 'group-parent',
          repoPath: '/repo',
          name: 'Bug Finding',
          createdAt: '2026-08-20T09:04:42Z',
        },
        {
          id: 'group-child',
          repoPath: '/repo',
          name: 'Bug Finding/Experiments',
          createdAt: '2026-08-20T09:04:49Z',
        },
        { id: 'group-local', repoPath: '', name: 'Local', createdAt: null },
      ]),
    ).toEqual({
      pathsByRepoGroup: {
        'repo:/repo': ['Bug Finding', 'Bug Finding/Experiments'],
        'repo:ungrouped': ['Local'],
      },
      idsByPathByRepoGroup: {
        'repo:/repo': {
          'Bug Finding': 'group-parent',
          'Bug Finding/Experiments': 'group-child',
        },
        'repo:ungrouped': { Local: 'group-local' },
      },
      createdAtByPathByRepoGroup: {
        'repo:/repo': {
          'Bug Finding': '2026-08-20T09:04:42Z',
          'Bug Finding/Experiments': '2026-08-20T09:04:49Z',
        },
        'repo:ungrouped': { Local: null },
      },
    });
  });

  test('keeps new direct drones ahead of saved repo anchors on every client', () => {
    const repoRootId = sidebarFolderNodeId('repo:/repo');
    const modelFolderId = sidebarFolderNodeId('repo-scope:repo:/repo:model-work');
    const tree = buildRepoTree(
      [
        { id: 'video', name: 'Video', repoPath: '/repo', createdAt: '2026-07-07T20:55:53Z' },
        { id: 'luna', name: 'Luna', repoPath: '/repo', createdAt: '2026-07-16T21:44:29Z' },
        { id: 'slowest', name: 'Slowest', repoPath: '/repo', createdAt: '2026-07-16T23:38:41Z' },
        { id: 'agentic', name: 'Agentic', repoPath: '/repo', createdAt: '2026-07-17T10:51:02Z' },
        { id: 'model', name: 'Model', repoPath: '/repo', group: 'model-work' },
      ],
      {
        [repoRootId]: [sidebarDroneNodeId('video'), modelFolderId],
      },
    );

    expect(tree.childIdsByParent[repoRootId]).toEqual([
      sidebarDroneNodeId('agentic'),
      sidebarDroneNodeId('slowest'),
      sidebarDroneNodeId('luna'),
      sidebarDroneNodeId('video'),
      modelFolderId,
    ]);
  });

  test('builds nested group folders and ordered fleet children', () => {
    const tree = buildRepoTree(
      [
        { id: 'parent', name: 'Parent', repoPath: '/repo', group: 'Delivery/Review' },
        { id: 'new-child', name: 'New child', repoPath: '/repo', group: 'Delivery/Review', fleetParentId: 'parent', createdAt: '2026-04-01T00:00:00Z' },
        { id: 'old-child', name: 'Old child', repoPath: '/repo', group: 'Delivery/Review', fleetParentId: 'parent', createdAt: '2026-03-01T00:00:00Z' },
      ],
      {
        [sidebarDroneNodeId('parent')]: [
          sidebarDroneNodeId('old-child'),
          sidebarDroneNodeId('new-child'),
        ],
      },
    );
    const reviewFolderId = sidebarFolderNodeId('repo-scope:repo:/repo:Delivery/Review');

    expect(tree.childIdsByParent[reviewFolderId]).toEqual([sidebarDroneNodeId('parent')]);
    expect(tree.childIdsByParent[sidebarDroneNodeId('parent')]).toEqual([
      sidebarDroneNodeId('old-child'),
      sidebarDroneNodeId('new-child'),
    ]);
  });

  test('orders implicit repo folder ancestors by their saved group order', () => {
    const sidebarGroupOrder = [
      'repo:repo:/repo',
      'group:Beta',
      'group:Alpha',
    ];
    const { nodeTree: tree } = buildRepoSidebarModel({
      drones: [
        { id: 'alpha', name: 'Alpha task', repoPath: '/repo', group: 'Alpha/Review' },
        { id: 'beta', name: 'Beta task', repoPath: '/repo', group: 'Beta/Review' },
      ],
      registeredRepoPaths: ['/repo'],
      sidebarDroneOrderByGroup: {},
      sidebarGroupOrder,
      sidebarNodeOrderByParent: {},
    });

    expect(tree.childIdsByParent[sidebarFolderNodeId('repo:/repo')]).toEqual([
      sidebarFolderNodeId('repo-scope:repo:/repo:Beta'),
      sidebarFolderNodeId('repo-scope:repo:/repo:Alpha'),
    ]);
  });

  test('orders repositories with the same label deterministically by full path', () => {
    const { groups } = buildRepoSidebarModel({
      drones: [],
      registeredRepoPaths: ['/z/shared', '/a/shared'],
      sidebarGroupOrder: [],
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
    });

    expect(groups.map((group) => group.group)).toEqual([
      'repo:/a/shared',
      'repo:/z/shared',
    ]);
  });

  test('keeps same-named repo group folders on their independent canonical ids', () => {
    const { nodeTree } = buildRepoSidebarModel({
      drones: [
        { id: 'repo-a-drone', name: 'A', repoPath: '/repo/a', group: 'review', groupId: 'grp_repo_a' },
        { id: 'repo-b-drone', name: 'B', repoPath: '/repo/b', group: 'review', groupId: 'grp_repo_b' },
      ],
      registeredRepoPaths: ['/repo/a', '/repo/b'],
      sidebarDroneOrderByGroup: {},
      sidebarGroupOrder: ['group-id:grp_repo_b', 'group-id:grp_repo_a'],
      sidebarNodeOrderByParent: {},
    });

    const repoAFolder = nodeTree.nodesById[sidebarFolderNodeId('repo-scope:repo:/repo/a:review')];
    const repoBFolder = nodeTree.nodesById[sidebarFolderNodeId('repo-scope:repo:/repo/b:review')];

    expect(repoAFolder?.kind).toBe('folder');
    expect(repoBFolder?.kind).toBe('folder');
    expect(repoAFolder?.kind === 'folder' ? repoAFolder.groupId : null).toBe('grp_repo_a');
    expect(repoBFolder?.kind === 'folder' ? repoBFolder.groupId : null).toBe('grp_repo_b');
  });

  test('normalizes repeated and Windows-style group separators before placing drones', () => {
    const tree = buildRepoTree([
      { id: 'repeated', name: 'Repeated', repoPath: '/repo', group: 'Delivery//Review' },
      { id: 'windows', name: 'Windows', repoPath: '/repo', group: 'Delivery\\Plan' },
    ]);

    expect(
      tree.childIdsByParent[
        sidebarFolderNodeId('repo-scope:repo:/repo:Delivery/Review')
      ],
    ).toEqual([sidebarDroneNodeId('repeated')]);
    expect(
      tree.childIdsByParent[
        sidebarFolderNodeId('repo-scope:repo:/repo:Delivery/Plan')
      ],
    ).toEqual([sidebarDroneNodeId('windows')]);
  });

  test('uses normalized paths when building non-repo group trees', () => {
    const tree = buildSidebarNodeTree({
      sidebarGroups: [
        {
          group: 'Delivery//Review',
          label: 'Review',
          kind: 'group',
          items: [{ id: 'review', name: 'Review' }],
        },
        {
          group: 'Delivery\\Plan',
          label: 'Plan',
          kind: 'group',
          items: [{ id: 'plan', name: 'Plan' }],
        },
      ],
      sidebarGroupOrder: [],
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
    });

    expect(tree.childIdsByParent[sidebarFolderNodeId('Delivery/Review')]).toEqual([
      sidebarDroneNodeId('review'),
    ]);
    expect(tree.childIdsByParent[sidebarFolderNodeId('Delivery/Plan')]).toEqual([
      sidebarDroneNodeId('plan'),
    ]);
  });

  test('ignores blank drone ids and trims fleet relationship ids', () => {
    const tree = buildRepoTree([
      { id: '', name: 'Invalid', repoPath: '/repo' },
      { id: ' parent ', name: 'Parent', repoPath: '/repo' },
      { id: 'child', name: 'Child', repoPath: '/repo', fleetParentId: ' parent ' },
    ]);

    expect(tree.childIdsByParent[sidebarFolderNodeId('repo:/repo')]).toEqual([
      sidebarDroneNodeId('parent'),
    ]);
    expect(tree.childIdsByParent[sidebarDroneNodeId('parent')]).toEqual([
      sidebarDroneNodeId('child'),
    ]);
    expect(tree.nodesById[sidebarDroneNodeId('')]).toBeUndefined();
  });

  test('excludes invalid and duplicate drone ids from repo items and counts', () => {
    const { groups, nodeTree } = buildRepoSidebarModel({
      drones: [
        { id: '', name: 'Invalid', repoPath: '/repo' },
        { id: 'same', name: 'First', repoPath: '/repo' },
        { id: ' same ', name: 'Duplicate', repoPath: '/repo' },
      ],
      registeredRepoPaths: ['/repo'],
      sidebarGroupOrder: [],
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
    });
    const repoRoot = nodeTree.nodesById[sidebarFolderNodeId('repo:/repo')];

    expect(groups[0]?.items.map((drone) => drone.name)).toEqual(['First']);
    expect(repoRoot?.totalDroneCount).toBe(1);
    expect(nodeTree.childIdsByParent[repoRoot!.id]).toEqual([sidebarDroneNodeId('same')]);
  });

  test('keeps orphaned and cyclic fleet nodes reachable', () => {
    const tree = buildRepoTree([
      { id: 'orphan', name: 'Orphan', repoPath: '/repo', fleetParentId: 'missing' },
      { id: 'a', name: 'A', repoPath: '/repo', fleetParentId: 'b' },
      { id: 'b', name: 'B', repoPath: '/repo', fleetParentId: 'a' },
    ]);

    expect(tree.childIdsByParent[sidebarFolderNodeId('repo:/repo')]).toEqual([
      sidebarDroneNodeId('a'),
      sidebarDroneNodeId('b'),
      sidebarDroneNodeId('orphan'),
    ]);
  });

  test('produces one deterministic, fully connected node for every valid drone', () => {
    const drones: SidebarTreeDrone[] = [
      { id: 'direct', name: 'Direct', repoPath: '/repo', createdAt: '2026-04-04T00:00:00Z' },
      { id: 'parent', name: 'Parent', repoPath: '/repo', group: 'Delivery/Review' },
      {
        id: 'child',
        name: 'Child',
        repoPath: '/repo',
        group: 'Delivery/Review',
        fleetParentId: 'parent',
      },
      { id: 'orphan', name: 'Orphan', repoPath: '/repo', fleetParentId: 'missing' },
      { id: 'cycle-a', name: 'Cycle A', repoPath: '/repo', fleetParentId: 'cycle-b' },
      { id: 'cycle-b', name: 'Cycle B', repoPath: '/repo', fleetParentId: 'cycle-a' },
      { id: 'nested', name: 'Nested', repoPath: '/repo', group: 'Delivery/Plan/Current' },
    ];
    const tree = buildRepoTree(drones);
    const repeatedTree = buildRepoTree(drones);
    const visitedNodeIds = new Set<string>();
    const visitedDroneIds: string[] = [];

    const visit = (nodeId: string, expectedParentId: string): number => {
      expect(visitedNodeIds.has(nodeId)).toBe(false);
      visitedNodeIds.add(nodeId);
      const node = tree.nodesById[nodeId];
      expect(node).toBeDefined();
      expect(node!.parentId).toBe(expectedParentId);
      if (node!.kind === 'drone') visitedDroneIds.push(node!.droneId);
      const descendantDroneCount = (tree.childIdsByParent[nodeId] ?? [])
        .map((childId) => visit(childId, nodeId))
        .reduce((sum, count) => sum + count, 0);
      if (node!.kind === 'folder') {
        expect((node as SidebarTreeFolderNode).totalDroneCount).toBe(descendantDroneCount);
      }
      return descendantDroneCount + (node!.kind === 'drone' ? 1 : 0);
    };

    for (const rootId of tree.rootChildIds) visit(rootId, 'root');

    expect([...visitedNodeIds].sort()).toEqual(Object.keys(tree.nodesById).sort());
    expect(visitedDroneIds.sort()).toEqual(drones.map((drone) => drone.id).sort());
    expect(repeatedTree).toEqual(tree);
  });
});
