import { describe, expect, test } from 'bun:test';
import type { DroneSummary, RepoSummary } from '../src/droneHub/types';
import { buildSidebarRepositoryNavigationItems } from '../src/droneHub/app/sidebar-repository-navigation';

function drone(id: string, repoPath: string): DroneSummary {
  return {
    id,
    name: id,
    group: null,
    createdAt: '2026-07-20T10:00:00.000Z',
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
});
