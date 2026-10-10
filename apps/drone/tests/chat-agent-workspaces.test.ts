import { describe, expect, test } from 'bun:test';
import type { ChatWorkspaceAccess } from '@drone/assistant-chat';
import { AgentChatWorkspaces, type AgentChat } from '../src/hub/assistant/chat-agent-workspaces';
import { buildHostWorkspaces, hostWorkspaceId } from '../src/hub/assistant/host-workspaces';
import { parseCompanionWorkspaceAccess } from '../src/hub/companion/companion-workspaces';

function fixture() {
  const drones: any[] = [
    { id: 'box', name: 'box', runtime: 'container', repoPath: '/repo', status: 'running', group: null, chats: ['default'] },
    { id: 'other', name: 'other', runtime: 'container', repoPath: '/repo', status: 'running', group: null, chats: ['default'] },
    { id: 'local', name: 'local', runtime: 'host', repoPath: '/tmp/local-repo', cwd: '/tmp/local-repo', status: 'running', group: null, chats: ['default'] },
  ];
  const stored = new Map<string, ChatWorkspaceAccess>();
  const key = (chat: AgentChat) => `${chat.droneId}/${chat.chatName}`;
  const calls: Array<{ id: string; tool: string; args: Record<string, unknown> }> = [];
  const workspaces = new AgentChatWorkspaces(
    {
      workspaceInventory: async () => ({ drones, hostWorkspaces: buildHostWorkspaces(drones, []) }),
      executeAuthorizedWorkspaceTool: async (id, call, authorize) => {
        await authorize();
        calls.push({ id, tool: call.tool, args: call.args });
        return { content: [{ type: 'text', text: `${call.tool} in ${id}` }], details: {} };
      },
    },
    {
      workspaceAccessDevices: async () => ({ self: { id: 'home', name: 'Home' }, devices: [] }),
      listWorkspaceAccessTargets: async () => [],
      legacyWorkspaceAccessTargets: async () => [],
      remoteWorkspaceTargets: async () => [],
    },
    {
      read: async (chat) => stored.get(key(chat)),
      write: async (chat, access) => {
        stored.set(key(chat), structuredClone(access));
      },
    },
  );
  return { workspaces, stored, calls };
}

describe('agent chat workspaces', () => {
  test('a container drone chat starts with its own container, saved on first use', async () => {
    const { workspaces, stored } = fixture();
    const chat = { droneId: 'box', chatName: 'default' };
    const catalog = await workspaces.catalog(chat);
    expect(catalog.access.defaultTargetId).toBe('drone:box');
    expect(catalog.access.targets).toEqual([
      expect.objectContaining({ id: 'drone:box', kind: 'drone', droneId: 'box', read: true, write: true, execute: true }),
    ]);
    expect(stored.get('box/default')).toEqual(catalog.access);
    const listed = await workspaces.list(chat);
    expect(listed.workspaces).toEqual([
      expect.objectContaining({ id: 'drone:box', default: true, ownWorkspace: true }),
    ]);
  });

  test('a host drone chat starts with the folder it works in', async () => {
    const { workspaces } = fixture();
    const catalog = await workspaces.catalog({ droneId: 'local', chatName: 'default' });
    const id = hostWorkspaceId('/tmp/local-repo');
    expect(catalog.access).toEqual({
      targets: [expect.objectContaining({ id, kind: 'host', read: true, write: true, execute: true })],
      defaultTargetId: id,
    });
  });

  test('runs tools against the saved selection and refuses what it does not grant', async () => {
    const { workspaces, calls } = fixture();
    const chat = { droneId: 'box', chatName: 'default' };
    const catalog = await workspaces.catalog(chat);
    const other = catalog.workspaces.find((option) => option.id === 'drone:other')!;
    await workspaces.save(
      chat,
      {
        targets: [
          ...catalog.access.targets,
          { ...other, read: true, write: false, execute: false },
        ],
        defaultTargetId: 'drone:box',
      },
      catalog.revision,
    );

    const read = await workspaces.run(chat, 'read_file', { path: 'a.txt', target: 'drone:other' });
    expect(read.content[0]).toEqual({ type: 'text', text: 'read_file in other' });
    await workspaces.run(chat, 'read_file', { path: 'a.txt' });
    expect(calls.map((call) => call.id)).toEqual(['other', 'box']);

    await expect(
      workspaces.run(chat, 'write_file', { path: 'a.txt', content: 'x', target: 'drone:other' }),
    ).rejects.toThrow('lacks capability files.write');
    expect(
      (await workspaces.list(chat)).workspaces.map(({ id, write }) => ({ id, write })),
    ).toEqual([
      { id: 'drone:box', write: true },
      { id: 'drone:other', write: false },
    ]);
  });

  test('a selection changed between calls applies to the next call', async () => {
    const { workspaces, stored, calls } = fixture();
    const chat = { droneId: 'box', chatName: 'default' };
    const catalog = await workspaces.catalog(chat);
    await workspaces.run(chat, 'read_file', { path: 'a.txt' });
    const other = catalog.workspaces.find((option) => option.id === 'drone:other')!;
    // Saved elsewhere (another Hub window): the cached tools are stale and must not keep the old selection.
    stored.set(
      'box/default',
      parseCompanionWorkspaceAccess({
        targets: [{ ...other, read: true, write: false, execute: false }],
        defaultTargetId: 'drone:other',
      }),
    );
    await workspaces.run(chat, 'read_file', { path: 'a.txt' });
    expect(calls.map((call) => call.id)).toEqual(['box', 'other']);
    await expect(workspaces.run(chat, 'read_file', { path: 'a.txt', target: 'drone:box' })).rejects.toThrow();
  });

  test('an emptied selection stays empty and offers no tools', async () => {
    const { workspaces } = fixture();
    const chat = { droneId: 'box', chatName: 'default' };
    const catalog = await workspaces.catalog(chat);
    await workspaces.save(chat, { targets: [], defaultTargetId: null }, catalog.revision);
    expect((await workspaces.catalog(chat)).access.targets).toEqual([]);
    await expect(workspaces.run(chat, 'read_file', { path: 'a.txt' })).rejects.toThrow(
      'read_file is not available',
    );
    await expect(
      workspaces.run(chat, 'transfer_files', {
        sourceTarget: 'a',
        sourcePath: 'x',
        destinationTarget: 'b',
        destinationPath: 'y',
      }),
    ).rejects.toThrow('at least two workspaces');
  });
});
