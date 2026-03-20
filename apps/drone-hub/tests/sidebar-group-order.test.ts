import { describe, expect, test } from 'bun:test';
import {
  orderSidebarEntries,
  orderSidebarGroups,
  renameSidebarEntryOrderMapKey,
  renameSidebarGroupOrderToken,
  reorderSidebarEntryOrder,
  reorderSidebarGroupOrder,
  sidebarGroupOrderToken,
} from '../src/droneHub/app/sidebar-group-order';

describe('sidebar-group-order', () => {
  test('applies persisted order before fallback input order', () => {
    const groups = [
      { group: 'Ungrouped', kind: 'group' as const },
      { group: 'Alpha', kind: 'group' as const },
      { group: 'Beta', kind: 'group' as const },
    ];

    expect(
      orderSidebarGroups(groups, [
        sidebarGroupOrderToken({ group: 'Beta', kind: 'group' }),
        sidebarGroupOrderToken({ group: 'Ungrouped', kind: 'group' }),
      ]),
    ).toEqual([
      { group: 'Beta', kind: 'group' },
      { group: 'Ungrouped', kind: 'group' },
      { group: 'Alpha', kind: 'group' },
    ]);
  });

  test('reorders virtual repo groups including the ungrouped bucket', () => {
    const groups = [
      { group: 'repo:ungrouped', kind: 'repo' as const },
      { group: 'repo:/work/a', kind: 'repo' as const },
      { group: 'repo:/work/b', kind: 'repo' as const },
    ];

    expect(
      reorderSidebarGroupOrder(
        [],
        groups,
        { group: 'repo:ungrouped', kind: 'repo' },
        { group: 'repo:/work/b', kind: 'repo' },
        'after',
      ),
    ).toEqual([
      'repo:repo:/work/a',
      'repo:repo:/work/b',
      'repo:repo:ungrouped',
    ]);
  });

  test('renames persisted group tokens without changing other entries', () => {
    expect(
      renameSidebarGroupOrderToken(
        ['group:Alpha', 'repo:repo:/work/a', 'group:Beta'],
        { group: 'Alpha', kind: 'group' },
        { group: 'Gamma', kind: 'group' },
      ),
    ).toEqual(['group:Gamma', 'repo:repo:/work/a', 'group:Beta']);
  });

  test('renames persisted grouped-entry map keys without losing entry order', () => {
    expect(
      renameSidebarEntryOrderMapKey(
        {
          'group:Alpha': ['drone-b', 'drone-a'],
          'group:Beta': ['drone-c'],
        },
        { group: 'Alpha', kind: 'group' },
        { group: 'Gamma', kind: 'group' },
      ),
    ).toEqual({
      'group:Gamma': ['drone-b', 'drone-a'],
      'group:Beta': ['drone-c'],
    });
  });

  test('orders arbitrary entries by a persisted list', () => {
    expect(orderSidebarEntries(['drone-b', 'drone-a', 'drone-c'], ['drone-c'], (entry) => entry)).toEqual([
      'drone-c',
      'drone-b',
      'drone-a',
    ]);
  });

  test('reorders arbitrary entries while preserving hidden entries at the end', () => {
    expect(
      reorderSidebarEntryOrder(['chat-z'], ['chat-a', 'chat-b', 'chat-c'], 'chat-a', 'chat-c', 'after'),
    ).toEqual(['chat-b', 'chat-c', 'chat-a', 'chat-z']);
  });
});
