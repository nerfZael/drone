import { expect, test } from 'bun:test';
import { applySidebarMove, buildChatOrganizationIntent, buildSidebarChatTree, normalizeSidebarLayout, sidebarChatNodeId, sidebarChatGroupNodeId } from '../src/sidebar';

function fixture() {
  let layout = normalizeSidebarLayout({});
  const chats = ['default', 'api', 'tests', 'review'];
  const tree = () => buildSidebarChatTree({ droneId: 'drone', chatNames: chats, groupPaths: layout.sidebarChatGroupPathsByDrone.drone ?? [], groupByChat: layout.sidebarChatGroupByChat, nodeOrderByParent: layout.sidebarChatNodeOrderByParent });
  const apply = (operation: Parameters<typeof buildChatOrganizationIntent>[0]) => {
    const intent = buildChatOrganizationIntent(operation, tree());
    if (intent) layout = applySidebarMove(layout, intent);
  };
  return { apply, tree, layout: () => layout };
}

test('create, move, rename, then delete nested groups without losing conversations', () => {
  const h = fixture();
  h.apply({ type: 'create_chat_group', droneId: 'drone', group: 'Work' });
  h.apply({ type: 'create_chat_group', droneId: 'drone', group: 'Backend', parentGroup: 'Work' });
  h.apply({ type: 'move_chats', droneId: 'drone', chats: ['tests', 'api'], targetGroup: 'Work/Backend' });
  expect(h.tree().childIdsByParent[sidebarChatGroupNodeId('drone', 'Work/Backend')]).toEqual(['api', 'tests'].map((name) => sidebarChatNodeId('drone', name)));
  h.apply({ type: 'rename_chat_group', droneId: 'drone', group: 'Work/Backend', newName: 'Server' });
  expect(h.layout().sidebarChatGroupByChat[sidebarChatNodeId('drone', 'api')]).toBe('Work/Server');
  h.apply({ type: 'delete_chat_group', droneId: 'drone', group: 'Work/Server' });
  expect(h.layout().sidebarChatGroupByChat[sidebarChatNodeId('drone', 'api')]).toBe('Work');
  h.apply({ type: 'move_chats', droneId: 'drone', chats: ['api', 'tests'], targetGroup: '' });
  expect(h.layout().sidebarChatGroupByChat[sidebarChatNodeId('drone', 'api')] ?? '').toBe('');
  expect(Object.values(h.tree().nodesById).filter((node) => node.kind === 'chat')).toHaveLength(4);
});

test('deleting a parent removes nested folders and promotes all their chats', () => {
  const h = fixture();
  h.apply({ type: 'create_chat_group', droneId: 'drone', group: 'Work/Backend' });
  h.apply({ type: 'move_chats', droneId: 'drone', chats: ['api'], targetGroup: 'Work/Backend' });
  h.apply({ type: 'delete_chat_group', droneId: 'drone', group: 'Work' });
  expect(h.layout().sidebarChatGroupPathsByDrone.drone).toEqual([]);
  expect(h.layout().sidebarChatGroupByChat[sidebarChatNodeId('drone', 'api')] ?? '').toBe('');
});

test('rejects missing groups/chats, duplicate groups and conflicting renames before changing layout', () => {
  const h = fixture();
  expect(() => h.apply({ type: 'create_chat_group', droneId: 'drone', group: 'Child', parentGroup: 'Missing' })).toThrow('Unknown chat group');
  h.apply({ type: 'create_chat_group', droneId: 'drone', group: 'Work' });
  h.apply({ type: 'create_chat_group', droneId: 'drone', group: 'Other' });
  expect(() => h.apply({ type: 'create_chat_group', droneId: 'drone', group: 'Work' })).toThrow('already exists');
  expect(() => h.apply({ type: 'rename_chat_group', droneId: 'drone', group: 'Work', newName: 'Other' })).toThrow('already exists');
  expect(() => h.apply({ type: 'move_chats', droneId: 'drone', chats: ['missing'], targetGroup: 'Work' })).toThrow('Unknown sidebar chat');
  expect(() => h.apply({ type: 'move_chats', droneId: 'drone', chats: ['api'], targetGroup: 'Missing' })).toThrow('Unknown chat group');
  expect(() => h.apply({ type: 'move_chats', droneId: 'other-drone', chats: ['api'], targetGroup: '' })).toThrow('another drone');
});
