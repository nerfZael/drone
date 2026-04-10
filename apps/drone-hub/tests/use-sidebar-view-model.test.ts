import { describe, expect, test } from 'bun:test';
import { buildRepoSidebarGroups } from '../src/droneHub/app/sidebar-repo-groups';
import { isSidebarGroupDeleting } from '../src/droneHub/app/sidebar-group-delete-visibility';
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

describe('buildRepoSidebarGroups', () => {
  test('includes registered repos even when they have no drones', () => {
    expect(
      buildRepoSidebarGroups({
        drones: [drone({ id: 'drone-a', name: 'drone-a', repoPath: '/work/repo-a', repoAttached: true })],
        activeRepoPath: '',
        registeredRepoPaths: ['/work/repo-a', '/work/repo-b'],
        sidebarDroneOrderByGroup: {},
        sidebarGroupOrder: [],
      }),
    ).toEqual([
      {
        group: 'repo:/work/repo-a',
        label: 'repo-a',
        kind: 'repo',
        items: [drone({ id: 'drone-a', name: 'drone-a', repoPath: '/work/repo-a', repoAttached: true })],
      },
      {
        group: 'repo:/work/repo-b',
        label: 'repo-b',
        kind: 'repo',
        items: [],
      },
    ]);
  });

  test('keeps repo filtering scoped to the active repo', () => {
    expect(
      buildRepoSidebarGroups({
        drones: [],
        activeRepoPath: '/work/repo-b',
        registeredRepoPaths: ['/work/repo-a', '/work/repo-b'],
        sidebarDroneOrderByGroup: {},
        sidebarGroupOrder: [],
      }),
    ).toEqual([
      {
        group: 'repo:/work/repo-b',
        label: 'repo-b',
        kind: 'repo',
        items: [],
      },
    ]);
  });
});

describe('isSidebarGroupDeleting', () => {
  test('matches descendant grouped folders while a parent delete is in progress', () => {
    expect(
      isSidebarGroupDeleting(
        { group: 'alpha/beta', kind: 'group' },
        { alpha: true },
      ),
    ).toBe(true);
  });

  test('matches repo groups by exact repo key only', () => {
    expect(
      isSidebarGroupDeleting(
        { group: 'repo:/work/repo-a', kind: 'repo' },
        { 'repo:/work/repo-a': true },
      ),
    ).toBe(true);
    expect(
      isSidebarGroupDeleting(
        { group: 'repo:/work/repo-b', kind: 'repo' },
        { 'repo:/work/repo-a': true },
      ),
    ).toBe(false);
  });
});
