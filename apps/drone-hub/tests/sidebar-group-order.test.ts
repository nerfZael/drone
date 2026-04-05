import { describe, expect, test } from 'bun:test';
import {
  insertSidebarGroupOrderToken,
  mergeVisibleSidebarGroupOrder,
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

  test('can persist the current visible group order before a rename', () => {
    const stabilized = mergeVisibleSidebarGroupOrder([], [
      { group: 'Alpha', kind: 'group' as const },
      { group: 'Beta', kind: 'group' as const },
      { group: 'Gamma', kind: 'group' as const },
    ]);

    expect(
      renameSidebarGroupOrderToken(
        stabilized,
        { group: 'Beta', kind: 'group' },
        { group: 'Omega', kind: 'group' },
      ),
    ).toEqual(['group:Alpha', 'group:Omega', 'group:Gamma']);
  });

  test('can insert a new root folder at the top of the visible folder order', () => {
    expect(
      insertSidebarGroupOrderToken(
        ['group:Hidden', 'group:Alpha', 'group:Beta'],
        [
          { group: 'Alpha', kind: 'group' as const },
          { group: 'Beta', kind: 'group' as const },
        ],
        { group: 'Gamma', kind: 'group' },
        'start',
      ),
    ).toEqual(['group:Gamma', 'group:Alpha', 'group:Beta', 'group:Hidden']);
  });

  test('can insert a new child folder after its visible siblings', () => {
    expect(
      insertSidebarGroupOrderToken(
        ['group:alpha', 'group:alpha/a', 'group:alpha/b', 'group:beta'],
        [
          { group: 'alpha', kind: 'group' as const },
          { group: 'alpha/a', kind: 'group' as const },
          { group: 'alpha/b', kind: 'group' as const },
          { group: 'beta', kind: 'group' as const },
        ],
        { group: 'alpha/c', kind: 'group' },
        'end',
      ),
    ).toEqual(['group:alpha', 'group:alpha/a', 'group:alpha/b', 'group:alpha/c', 'group:beta']);
  });

  test('orders arbitrary entries by a persisted list', () => {
    expect(orderSidebarEntries(['drone-b', 'drone-a', 'drone-c'], ['drone-c'], (entry) => entry)).toEqual([
      'drone-c',
      'drone-b',
      'drone-a',
    ]);
  });

  test('can keep new unordered entries ahead of persisted ordered ones', () => {
    expect(
      orderSidebarEntries(['drone-c', 'drone-b', 'drone-a'], ['drone-b', 'drone-a'], (entry) => entry, {
        unorderedPlacement: 'start',
      }),
    ).toEqual(['drone-c', 'drone-b', 'drone-a']);
  });

  test('reorders arbitrary entries while preserving hidden entries at the end', () => {
    expect(
      reorderSidebarEntryOrder(['chat-z'], ['chat-a', 'chat-b', 'chat-c'], 'chat-a', 'chat-c', 'after'),
    ).toEqual(['chat-b', 'chat-c', 'chat-a', 'chat-z']);
  });

  test('reorders entries from the visible input order when new entries are not yet persisted', () => {
    expect(
      reorderSidebarEntryOrder(['drone-b', 'drone-a'], ['drone-c', 'drone-b', 'drone-a'], 'drone-c', 'drone-b', 'after'),
    ).toEqual(['drone-b', 'drone-c', 'drone-a']);
  });
});
