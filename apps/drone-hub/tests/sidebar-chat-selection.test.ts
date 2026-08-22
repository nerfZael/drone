import { describe, expect, test } from 'bun:test';
import { selectSidebarChatNodes } from '../src/droneHub/app/sidebar-chat-selection';

describe('sidebar chat multi-selection', () => {
  const ordered = ['chat:d:a', 'chat:d:b', 'chat:d:c', 'chat:d:d'];

  test('replaces selection on a plain click', () => {
    expect(selectSidebarChatNodes({ currentNodeIds: ordered.slice(0, 2), orderedNodeIds: ordered, nodeId: ordered[3]! })).toEqual([ordered[3]]);
  });

  test('ctrl/cmd toggles one chat', () => {
    expect(selectSidebarChatNodes({ currentNodeIds: [ordered[0]!], orderedNodeIds: ordered, nodeId: ordered[2]!, additive: true })).toEqual([ordered[0], ordered[2]]);
    expect(selectSidebarChatNodes({ currentNodeIds: [ordered[0]!, ordered[2]!], orderedNodeIds: ordered, nodeId: ordered[0]!, additive: true })).toEqual([ordered[2]]);
  });

  test('shift selects the inclusive ordered range', () => {
    expect(selectSidebarChatNodes({ currentNodeIds: [ordered[1]!], orderedNodeIds: ordered, nodeId: ordered[3]!, anchorNodeId: ordered[1], range: true })).toEqual(ordered.slice(1));
  });
});
