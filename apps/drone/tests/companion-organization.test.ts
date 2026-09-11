import { expect, test } from 'bun:test';
import { executeCompanionOrganization } from '../src/hub/companion/executeCompanionOrganization';
import { SidebarCommandService, type SidebarCommandOperations } from '../src/hub/sidebar-command-service';
import type { HubServices } from '../src/hub/application/hub-services';
import { sidebarChatNodeId, sidebarChatGroupNodeId } from '@drone/hub-model';

function fixture() {
  let preferences: Record<string, unknown> = { sidebarChatOrderByDrone: { drone: ['tests', 'api', 'default'] }, untouched: 'preserved' };
  let version = 1;
  const groupCalls: unknown[] = [];
  const operations: SidebarCommandOperations = {
    setDroneParent: async () => ({}),
    setDroneGroup: async (droneIds, group) => {
      groupCalls.push({ droneIds, group });
      return { ok: true, moved: [{ id: droneIds[0], group, repoPath: '/repo' }], rejected: [] };
    },
    renameGroup: async () => ({}),
    readUiPreferences: async () => ({ uiPreferences: preferences, version }),
    writeUiPreferences: async ({ uiPreferences, expectedVersion }) => {
      expect(expectedVersion).toBe(version);
      preferences = uiPreferences;
      return { uiPreferences: preferences, version: ++version };
    },
  };
  const services = {
    groups: { setDroneGroup: async ({ droneIds, group }: any) => await operations.setDroneGroup(droneIds, group) },
    settings: { uiPreferences: { read: operations.readUiPreferences } },
  } as unknown as HubServices;
  const deps = { services, sidebar: new SidebarCommandService(operations), readChats: async () => ['default', 'api', 'tests'] };
  return { deps, groupCalls, preferences: () => preferences, run: (operation: unknown) => executeCompanionOrganization(operation, deps) };
}

test('proposal Apply uses canonical sidebar writes, keeps existing preferences and honors legacy chat order', async () => {
  const h = fixture();
  await h.run({ id: 'group', type: 'create_chat_group', droneId: 'drone', group: 'Work' });
  await h.run({ id: 'move', type: 'move_chats', droneId: 'drone', chats: ['api', 'tests'], targetGroup: 'Work' });
  const order = h.preferences().sidebarChatNodeOrderByParent as Record<string, string[]>;
  expect(order[sidebarChatGroupNodeId('drone', 'Work')]).toEqual(['tests', 'api'].map((name) => sidebarChatNodeId('drone', name)));
  await h.run({ id: 'rename', type: 'rename_chat_group', droneId: 'drone', group: 'Work', newName: 'Tasks' });
  await expect(h.run({ id: 'delete', type: 'delete_chat_group', droneId: 'drone', group: 'Tasks' })).resolves.toMatchObject({ ok: true, chatsDeleted: false });
  expect(h.preferences().untouched).toBe('preserved');
  expect((h.preferences().sidebarChatGroupByChat as Record<string, string>)[sidebarChatNodeId('drone', 'api')] ?? '').toBe('');
});

test('assigns and clears a drone group without changing its repository', async () => {
  const h = fixture();
  await h.run({ id: 'assign', type: 'set_drone_group', droneId: 'drone', group: 'Review' });
  await h.run({ id: 'clear', type: 'set_drone_group', droneId: 'drone', group: '' });
  expect(h.groupCalls).toEqual([{ droneIds: ['drone'], group: 'Review' }, { droneIds: ['drone'], group: null }]);
});

test('rejects unrelated operations and reports a group assignment rejection as failure', async () => {
  const h = fixture();
  await expect(h.run({ id: 'delete', type: 'delete_drone', droneId: 'drone' })).rejects.toThrow('Unsupported organization operation');
  await expect(h.run({ id: 'group', type: 'create_chat_group', droneId: '$unresolved', group: 'Work' })).rejects.toThrow('references an earlier');
  h.deps.services.groups.setDroneGroup = async () => ({ ok: true, group: null, moved: [], rejected: [{ id: 'drone', error: 'unknown drone' }], total: 1 });
  await expect(h.run({ id: 'move', type: 'set_drone_group', droneId: 'drone', group: 'Review' })).rejects.toThrow('unknown drone');
});
