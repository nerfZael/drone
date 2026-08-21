import { describe, expect, test } from 'bun:test';
import {
  renameSelectedGroupMultiChatGroup,
  resolveSelectedGroupMultiChatData,
  selectedGroupMultiChatTargetsGroup,
} from '../src/droneHub/app/sidebar-group-multi-chat';
import type { DroneSummary } from '../src/droneHub/types';

function drone(id: string, repoPath: string, group: string): DroneSummary {
  return {
    id,
    name: id,
    group,
    createdAt: '2026-08-21T00:00:00.000Z',
    repoPath,
    containerPort: 3000,
    hostPort: null,
    statusOk: true,
    statusError: null,
    chats: ['default'],
  };
}

describe('sidebar group multi-chat', () => {
  test('targets a nested group only inside its repository', () => {
    const repoA = '/work/a';
    const repoB = '/work/b';
    const aReview = drone('a-review', repoA, 'Review');
    const aChild = drone('a-child', repoA, 'Review/Ready');
    const bReview = drone('b-review', repoB, 'Review');
    const groups = [
      { group: `repo:${repoA}`, label: 'a', kind: 'repo' as const, items: [aReview, aChild] },
      { group: `repo:${repoB}`, label: 'b', kind: 'repo' as const, items: [bReview] },
    ];

    const result = resolveSelectedGroupMultiChatData(
      `repo-scope:repo:${repoA}:Review`,
      groups,
      [aReview, aChild, bReview],
    );

    expect(result?.label).toBe('a / Review');
    expect(result?.items.map((item) => item.id)).toEqual(['a-review', 'a-child']);
  });

  test('targets every drone when the repository root is selected', () => {
    const repoPath = '/work/a';
    const first = drone('first', repoPath, '');
    const second = drone('second', repoPath, 'Review');
    const repository = {
      group: `repo:${repoPath}`,
      label: 'a',
      kind: 'repo' as const,
      items: [first, second],
    };

    expect(
      resolveSelectedGroupMultiChatData(repository.group, [repository], [first, second]),
    ).toBe(repository);
  });

  test('renames and closes multi-chat only in the targeted repository', () => {
    const targetRepo = 'repo:/work/a';
    const otherRepoSelection = 'repo-scope:repo:/work/b:Review';

    expect(
      renameSelectedGroupMultiChatGroup(
        'repo-scope:repo:/work/a:Review/Ready',
        'Review',
        'Approved',
        targetRepo,
      ),
    ).toBe('repo-scope:repo:/work/a:Approved/Ready');
    expect(
      renameSelectedGroupMultiChatGroup(
        otherRepoSelection,
        'Review',
        'Approved',
        targetRepo,
      ),
    ).toBe(otherRepoSelection);
    expect(
      selectedGroupMultiChatTargetsGroup(
        'repo-scope:repo:/work/a:Review/Ready',
        'Review',
        targetRepo,
      ),
    ).toBe(true);
    expect(
      selectedGroupMultiChatTargetsGroup(
        otherRepoSelection,
        'Review',
        targetRepo,
      ),
    ).toBe(false);
  });
});
