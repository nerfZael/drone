import { describe, expect, test } from 'bun:test';
import { buildRepoSidebarGroups } from '../src/droneHub/app/sidebar-repo-groups';
import { isSidebarGroupDeleting } from '../src/droneHub/app/sidebar-group-delete-visibility';
import { isDroneRecentForSidebar } from '../src/droneHub/app/sidebar-recent-filter';
import { shouldShowSidebarGroup } from '../src/droneHub/app/use-sidebar-view-model';
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
  test('sorts drones newest first before applying manual order', () => {
    const groups = buildRepoSidebarGroups({
      drones: [
        drone({ id: 'older', name: 'older', repoPath: '/work/repo-a', createdAt: '2026-07-09T12:00:00.000Z' }),
        drone({ id: 'newer', name: 'newer', repoPath: '/work/repo-a', createdAt: '2026-07-10T12:00:00.000Z' }),
      ],
      activeRepoPath: '',
      registeredRepoPaths: ['/work/repo-a'],
      sidebarDroneOrderByGroup: {},
      sidebarGroupOrder: [],
    });

    expect(groups[0]?.items.map((item) => item.id)).toEqual(['newer', 'older']);
  });

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

  test('can hide empty registered repo groups after drones are filtered out', () => {
    expect(
      buildRepoSidebarGroups({
        drones: [],
        activeRepoPath: '',
        registeredRepoPaths: ['/work/repo-a'],
        sidebarDroneOrderByGroup: {},
        sidebarGroupOrder: [],
        includeEmptyRegisteredRepoGroups: false,
      }),
    ).toEqual([]);

    expect(
      buildRepoSidebarGroups({
        drones: [drone({ id: 'drone-a', name: 'drone-a', repoPath: '/work/repo-a', repoAttached: true })],
        activeRepoPath: '',
        registeredRepoPaths: ['/work/repo-a', '/work/repo-b'],
        sidebarDroneOrderByGroup: {},
        sidebarGroupOrder: [],
        includeEmptyRegisteredRepoGroups: false,
      }),
    ).toEqual([
      {
        group: 'repo:/work/repo-a',
        label: 'repo-a',
        kind: 'repo',
        items: [drone({ id: 'drone-a', name: 'drone-a', repoPath: '/work/repo-a', repoAttached: true })],
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

describe('shouldShowSidebarGroup', () => {
  const group = {
    items: [drone({ id: 'selected-draft', name: 'Selected draft' })],
  };

  test('keeps a hidden group visible while it contains the selected drone', () => {
    expect(
      shouldShowSidebarGroup(group, {
        showHiddenSidebarGroups: false,
        hidden: true,
        retainedDroneIds: new Set(['selected-draft']),
      }),
    ).toBe(true);
  });

  test('continues hiding groups that do not contain a selected drone', () => {
    expect(
      shouldShowSidebarGroup(group, {
        showHiddenSidebarGroups: false,
        hidden: true,
        retainedDroneIds: new Set(),
      }),
    ).toBe(false);
  });
});

describe('isDroneRecentForSidebar', () => {
  const nowMs = Date.parse('2026-06-21T12:00:00.000Z');

  test('includes drones created in the last 24 hours', () => {
    expect(
      isDroneRecentForSidebar(
        { createdAt: '2026-06-20T12:30:00.000Z', lastMessageAt: null },
        nowMs,
      ),
    ).toBe(true);
  });

  test('includes older drones with a message in the last 24 hours', () => {
    expect(
      isDroneRecentForSidebar(
        {
          createdAt: '2026-06-01T12:00:00.000Z',
          lastMessageAt: '2026-06-21T08:00:00.000Z',
        },
        nowMs,
      ),
    ).toBe(true);
  });

  test('excludes older drones without a recent message', () => {
    expect(
      isDroneRecentForSidebar(
        {
          createdAt: '2026-06-01T12:00:00.000Z',
          lastMessageAt: '2026-06-20T11:59:59.999Z',
        },
        nowMs,
      ),
    ).toBe(false);
  });

  test('includes activity exactly at the 24-hour boundary', () => {
    expect(
      isDroneRecentForSidebar(
        { createdAt: '2026-06-20T12:00:00.000Z', lastMessageAt: null },
        nowMs,
      ),
    ).toBe(true);
  });

  test('does not treat non-message activity as recent chat activity', () => {
    const droneWithActivity = {
      createdAt: '2026-06-01T12:00:00.000Z',
      lastActivityAt: '2026-06-21T08:00:00.000Z',
      lastMessageAt: null,
    };

    expect(
      isDroneRecentForSidebar(droneWithActivity, nowMs),
    ).toBe(false);
  });
});
