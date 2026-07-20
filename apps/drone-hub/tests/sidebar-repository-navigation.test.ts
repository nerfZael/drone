import { describe, expect, test } from 'bun:test';
import { sidebarDroneNodeId, sidebarFolderNodeId } from '@drone/hub-model/sidebar';
import type { DroneSummary, RepoSummary } from '../src/droneHub/types';
import {
  buildSidebarRepositoryNavigationItems,
  buildSidebarRepositoryNavigationModel,
} from '../src/droneHub/app/sidebar-repository-navigation';

function drone(id: string, repoPath: string, createdAt = '2026-07-20T10:00:00.000Z'): DroneSummary {
  return {
    id,
    name: id,
    group: null,
    createdAt,
    repoPath,
    containerPort: 3000,
    hostPort: null,
    statusOk: true,
    statusError: null,
    chats: ['default'],
  };
}

describe('desktop sidebar repository navigation', () => {
  test('builds repository drill-in rows instead of repository group nodes', () => {
    const repos: RepoSummary[] = [
      { path: '/work/zeta', addedAt: null, remoteUrl: null, github: null },
      { path: '/work/alpha', addedAt: null, remoteUrl: null, github: null },
    ];
    const items = buildSidebarRepositoryNavigationItems({
      repos,
      drones: [drone('a', '/work/alpha'), drone('b', '/work/alpha'), drone('loose', '')],
      summarize: (drones) => ({ count: drones.length }),
    });

    expect(items.map(({ id, label, droneCount }) => ({ id, label, droneCount }))).toEqual([
      { id: 'repo:ungrouped', label: 'Ungrouped', droneCount: 1 },
      { id: 'repo:/work/alpha', label: 'alpha', droneCount: 2 },
      { id: 'repo:/work/zeta', label: 'zeta', droneCount: 0 },
    ]);
    expect(items[1]?.stateSummary).toEqual({ count: 2 });
  });

  test('includes repositories discovered from drones even when not registered', () => {
    const items = buildSidebarRepositoryNavigationItems({
      repos: [],
      drones: [drone('a', '/work/discovered')],
      summarize: (drones) => drones.length,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'repo:/work/discovered',
      label: 'discovered',
      repoPath: '/work/discovered',
      droneCount: 1,
      stateSummary: 1,
    });
  });

  test('uses the shared repository tree order for registered and ungrouped drones', () => {
    const repoPath = '/work/alpha';
    const model = buildSidebarRepositoryNavigationModel({
      repos: [{ path: repoPath, addedAt: null, remoteUrl: null, github: null }],
      drones: [
        drone('repo-old', repoPath, '2026-07-19T10:00:00.000Z'),
        drone('repo-new', repoPath, '2026-07-20T10:00:00.000Z'),
        drone('loose-old', '', '2026-07-18T10:00:00.000Z'),
        drone('loose-new', '', '2026-07-21T10:00:00.000Z'),
      ],
      summarize: (drones) => drones.length,
      sidebarNodeOrderByParent: {
        [sidebarFolderNodeId(`repo:${repoPath}`)]: [sidebarDroneNodeId('repo-old')],
        [sidebarFolderNodeId('repo:ungrouped')]: [sidebarDroneNodeId('loose-old')],
      },
    });

    expect(model.nodeTree.childIdsByParent[sidebarFolderNodeId(`repo:${repoPath}`)]).toEqual([
      sidebarDroneNodeId('repo-new'),
      sidebarDroneNodeId('repo-old'),
    ]);
    expect(model.nodeTree.childIdsByParent[sidebarFolderNodeId('repo:ungrouped')]).toEqual([
      sidebarDroneNodeId('loose-new'),
      sidebarDroneNodeId('loose-old'),
    ]);
  });

  test('uses the shared saved repository order for drill-in navigation', () => {
    const items = buildSidebarRepositoryNavigationItems({
      repos: [
        { path: '/work/alpha', addedAt: null, remoteUrl: null, github: null },
        { path: '/work/zeta', addedAt: null, remoteUrl: null, github: null },
      ],
      drones: [],
      summarize: (drones) => drones.length,
      sidebarGroupOrder: ['repo:repo:/work/zeta', 'repo:repo:/work/alpha'],
    });

    expect(items.map((item) => item.id)).toEqual([
      'repo:/work/zeta',
      'repo:/work/alpha',
    ]);
  });
});
