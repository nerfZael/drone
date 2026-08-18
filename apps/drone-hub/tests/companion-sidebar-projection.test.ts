import { describe, expect, test } from 'bun:test';

import type { DroneSummary } from '../src/droneHub/types';
import {
  buildCompanionSidebarProjection,
  companionSidebarChatProjectionKey,
  companionSidebarGroupProjectionKey,
  COMPANION_PROPOSAL_DRONE_ID_PREFIX,
} from '../src/droneHub/companion/companion-sidebar-projection';

const sourceDrone: DroneSummary = {
  id: 'source-drone',
  name: 'Source',
  group: 'Engineering/Core',
  createdAt: '2026-08-17T00:00:00.000Z',
  runtime: 'container',
  repoAttached: true,
  repoPath: '/workspace/repo',
  containerPort: 4000,
  hostPort: 4000,
  statusOk: true,
  statusError: null,
  chats: ['default', 'review'],
  busy: false,
};

function projection(
  proposal: Parameters<typeof buildCompanionSidebarProjection>[0]['proposal'],
  overrides: Partial<Parameters<typeof buildCompanionSidebarProjection>[0]> = {},
) {
  return buildCompanionSidebarProjection({
    proposal,
    execution: null,
    progress: null,
    defaultRepoPath: '/workspace/repo',
    sidebarDrones: [sourceDrone],
    allDrones: [sourceDrone],
    sidebarGroups: [
      {
        group: 'repo:/workspace/repo',
        label: 'repo',
        kind: 'repo',
        items: [sourceDrone],
      },
    ],
    repoScopedGroupPathsByRepoGroup: {
      'repo:/workspace/repo': ['Engineering/Core'],
    },
    sidebarGroupCreatedAtByName: {
      'Engineering/Core': '2026-08-01T00:00:00.000Z',
    },
    sidebarGroupingMode: 'repos',
    ...overrides,
  });
}

describe('Companion sidebar projection', () => {
  test('places proposed empty groups in their real repository tree paths', () => {
    const result = projection({
      version: 1,
      title: 'Add groups',
      operations: [
        { id: 'security', type: 'create_group', name: 'Security' },
        { id: 'research', type: 'create_group', name: 'Research/Experiments' },
      ],
    });

    expect(result.repoScopedGroupPathsByRepoGroup['repo:/workspace/repo']).toEqual([
      'Engineering/Core',
      'Security',
      'Research',
      'Research/Experiments',
    ]);
    expect(
      result.marks.groups[companionSidebarGroupProjectionKey('Security', 'repo:/workspace/repo')],
    ).toMatchObject({ action: 'create', label: 'Security' });
    expect(
      result.marks.groups[
        companionSidebarGroupProjectionKey('Research/Experiments', 'repo:/workspace/repo')
      ],
    ).toMatchObject({ action: 'create', label: 'Experiments' });
  });

  test('does not mark an existing parent path as new when it is represented by a drone', () => {
    const nestedDrone = {
      ...sourceDrone,
      group: 'Automated/Daily Retrospective',
    };
    const result = projection(
      {
        version: 1,
        title: 'Add sibling groups',
        operations: [
          {
            id: 'security',
            type: 'create_group',
            name: 'Automated/Daily Retrospective/Security',
          },
        ],
      },
      {
        sidebarDrones: [nestedDrone],
        allDrones: [nestedDrone],
        sidebarGroups: [
          {
            group: 'repo:/workspace/repo',
            label: 'repo',
            kind: 'repo',
            items: [nestedDrone],
          },
        ],
        repoScopedGroupPathsByRepoGroup: {
          'repo:/workspace/repo': ['Automated'],
        },
      },
    );

    expect(
      result.marks.groups[
        companionSidebarGroupProjectionKey('Automated/Daily Retrospective', 'repo:/workspace/repo')
      ],
    ).toBeUndefined();
    expect(
      result.marks.groups[
        companionSidebarGroupProjectionKey(
          'Automated/Daily Retrospective/Security',
          'repo:/workspace/repo',
        )
      ],
    ).toMatchObject({ action: 'create', label: 'Security' });
  });

  test('places cloned drones under the destination group with cloned chats', () => {
    const result = projection({
      version: 1,
      title: 'Clone reviewer',
      operations: [
        {
          id: 'clone',
          type: 'clone_drone',
          sourceDroneId: 'source-drone',
          name: 'Reviewer',
          group: 'Engineering/Review',
        },
      ],
    });
    const projectedId = `${COMPANION_PROPOSAL_DRONE_ID_PREFIX}clone`;
    const clone = result.sidebarDrones.find((drone) => drone.id === projectedId);

    expect(clone).toMatchObject({
      name: 'Reviewer',
      group: 'Engineering/Review',
      repoPath: '/workspace/repo',
      chats: ['default', 'review'],
    });
    expect(result.sidebarGroups[0]?.items.some((drone) => drone.id === projectedId)).toBe(true);
    expect(result.marks.drones[projectedId]).toMatchObject({ action: 'clone' });
  });

  test('adds proposed chats beneath real and newly proposed drones', () => {
    const result = projection({
      version: 1,
      title: 'Add chats',
      operations: [
        {
          id: 'create-drone',
          type: 'create_drone',
          name: 'Builder',
          prompt: 'Build it.',
          group: 'Engineering/Core',
        },
        {
          id: 'existing-chat',
          type: 'clone_chat',
          droneId: 'source-drone',
          sourceChat: 'review',
          chatName: 'release-review',
        },
        {
          id: 'new-chat',
          type: 'create_chat',
          droneId: '$create-drone',
          chatName: 'implementation',
        },
      ],
    });
    const projectedId = `${COMPANION_PROPOSAL_DRONE_ID_PREFIX}create-drone`;

    expect(result.sidebarDrones.find((drone) => drone.id === 'source-drone')?.chats).toContain(
      'release-review',
    );
    expect(result.sidebarDrones.find((drone) => drone.id === projectedId)?.chats).toEqual([
      'default',
      'implementation',
    ]);
    expect(
      result.marks.chats[companionSidebarChatProjectionKey('source-drone', 'release-review')],
    ).toMatchObject({ action: 'clone' });
    expect(
      result.marks.chats[companionSidebarChatProjectionKey(projectedId, 'implementation')],
    ).toMatchObject({ action: 'create' });
  });

  test('attaches rename and delete treatments to existing rows', () => {
    const result = projection({
      version: 1,
      title: 'Rename structure',
      operations: [
        {
          id: 'rename-group',
          type: 'rename_group',
          name: 'Engineering/Core',
          newName: 'Engineering/Platform',
        },
        {
          id: 'rename-drone',
          type: 'rename_drone',
          droneId: 'source-drone',
          newName: 'Platform source',
        },
        {
          id: 'delete-chat',
          type: 'delete_chat',
          droneId: 'source-drone',
          chatName: 'review',
        },
      ],
    });

    expect(
      result.marks.groups[
        companionSidebarGroupProjectionKey('Engineering/Core', 'repo:/workspace/repo')
      ],
    ).toMatchObject({
      action: 'rename',
      previousLabel: 'Core',
      label: 'Platform',
    });
    expect(result.marks.drones['source-drone']).toMatchObject({
      action: 'rename',
      previousLabel: 'Source',
      label: 'Platform source',
    });
    expect(
      result.marks.chats[companionSidebarChatProjectionKey('source-drone', 'review')],
    ).toMatchObject({ action: 'delete' });
  });

  test('drops completed projections as real state takes their place', () => {
    const result = projection(
      {
        version: 1,
        title: 'Apply groups',
        operations: [
          { id: 'done', type: 'create_group', name: 'Done' },
          { id: 'next', type: 'create_group', name: 'Next' },
        ],
      },
      {
        progress: {
          activeOperationId: 'next',
          operations: [{ id: 'done', type: 'create_group', status: 'completed' }],
        },
      },
    );

    expect(result.repoScopedGroupPathsByRepoGroup['repo:/workspace/repo']).not.toContain('Done');
    expect(
      result.marks.groups[companionSidebarGroupProjectionKey('Next', 'repo:/workspace/repo')],
    ).toMatchObject({ active: true });
  });

  test('integrates ghost treatments into the real group, drone, and chat rows', async () => {
    const sidebarSource = await Bun.file(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
    ).text();
    const groupedTreeSource = await Bun.file(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
    ).text();

    expect(sidebarSource).not.toContain('Proposal preview');
    expect(sidebarSource).toContain('companionProposalPreview={companionSidebarProjection.marks}');
    expect(sidebarSource).toContain("sidebarCapabilities.headerActions\n          ? 'repos'");
    expect(groupedTreeSource).toContain('data-companion-proposal-preview="chat"');
    expect(groupedTreeSource).toContain(
      "data-companion-proposal-preview={isCompanionPreview ? 'drone'",
    );
    expect(groupedTreeSource).toContain(
      "data-companion-proposal-preview={companionPreviewMark ? 'group'",
    );
    expect(groupedTreeSource).toContain('outline-dashed outline-[var(--accent-muted)]');
    expect(groupedTreeSource).not.toContain(
      'pointer-events-none bg-[var(--accent-subtle)] opacity-70 ring-1',
    );
  });
});
