import { expect, test } from 'bun:test';
import { applySidebarMove, normalizeSidebarLayout, sidebarChatNodeId } from '@drone/hub-model/sidebar';
import { resolveLocalChatOrganization } from '../src/drones/resolveLocalChatOrganization';

const drones = [{ id: 'phone', name: 'Phone drone', group: null, createdAt: '', chats: { default: 'thread-1', api: 'thread-2' } }];

test('queued phone operations resolve names against preceding writes, preserving conversations', async () => {
  let layout = normalizeSidebarLayout({});
  let writes = Promise.resolve();
  const enqueue = (operation: Parameters<typeof resolveLocalChatOrganization>[0]) => {
    const pending = writes.then(() => {
      const intent = resolveLocalChatOrganization(operation, drones, layout);
      if (intent) layout = applySidebarMove(layout, intent);
    });
    writes = pending.catch(() => undefined);
    return pending;
  };
  await Promise.all([
    enqueue({ id: 'create', type: 'create_chat_group', droneId: 'phone', group: 'Work' }),
    enqueue({ id: 'move', type: 'move_chats', droneId: 'phone', chats: ['api'], targetGroup: 'Work' }),
    enqueue({ id: 'rename', type: 'rename_chat_group', droneId: 'phone', group: 'Work', newName: 'Tasks' }),
  ]);
  expect(layout.sidebarChatGroupByChat[sidebarChatNodeId('phone', 'api')]).toBe('Tasks');
  await enqueue({ id: 'delete', type: 'delete_chat_group', droneId: 'phone', group: 'Tasks' });
  expect(layout.sidebarChatGroupByChat[sidebarChatNodeId('phone', 'api')] ?? '').toBe('');
  expect(drones[0]!.chats).toEqual({ default: 'thread-1', api: 'thread-2' });
});

test('phone organization fails for deleted drones, deleted chats and renamed destinations', () => {
  const layout = normalizeSidebarLayout({ sidebarChatGroupPathsByDrone: { phone: ['Renamed'] } });
  expect(() => resolveLocalChatOrganization({ id: 'move', type: 'move_chats', droneId: 'phone', chats: ['api'], targetGroup: 'Work' }, drones, layout)).toThrow('Unknown chat group');
  expect(() => resolveLocalChatOrganization({ id: 'move', type: 'move_chats', droneId: 'phone', chats: ['missing'], targetGroup: '' }, drones, layout)).toThrow('Unknown sidebar chat');
  expect(() => resolveLocalChatOrganization({ id: 'create', type: 'create_chat_group', droneId: 'deleted', group: 'Work' }, drones, layout)).toThrow('Phone drone was not found');
});
