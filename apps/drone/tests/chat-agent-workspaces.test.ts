import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatWorkspaceAccess } from '@drone/assistant-chat';
import { AgentChatWorkspaces, type AgentChat } from '../src/hub/assistant/chat-agent-workspaces';
import { buildHostWorkspaces, hostWorkspaceId } from '../src/hub/assistant/host-workspaces';
import { ChatHomes, chatHomeTargetId } from '../src/hub/chat-homes';
import { parseCompanionWorkspaceAccess } from '../src/hub/companion/companion-workspaces';

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

/** Chats with ids get homes in a temporary folder: `box/default` is chat `c-box`, and so on. */
function fixture(options: { homes?: boolean; native?: string[] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-homes-'));
  temporary.push(directory);
  const ids: Record<string, string> = { 'box/default': 'c-box', 'other/default': 'c-other', 'local/default': 'c-local' };
  /** A chat's name now, by id, when it was renamed after its home was chosen. */
  const renamed: Record<string, string> = {};
  const homes = new ChatHomes(
    () => directory,
    () => ({
      available: true,
      chats: Object.entries(ids).map(([key, chatId]) => {
        const [droneId, chatName] = key.split('/');
        return { chatId, droneId: droneId!, chatName: renamed[chatId] ?? chatName!, archived: false };
      }),
    }),
  );
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
      workspaceInventory: async () => ({ drones, hostWorkspaces: buildHostWorkspaces(drones, [], [], await homes.list()) }),
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
      id: async (chat) => (options.homes ? ids[key(chat)] : undefined),
      native: async (chat) => Boolean(options.native?.includes(key(chat))),
    },
    homes,
  );
  return { workspaces, stored, calls, directory, renamed };
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

  test('lists a link for each workspace, and tools follow workspace links as paths', async () => {
    const { workspaces, calls } = fixture();
    const chat = { droneId: 'box', chatName: 'default' };
    const catalog = await workspaces.catalog(chat);
    const other = catalog.workspaces.find((option) => option.id === 'drone:other')!;
    await workspaces.save(
      chat,
      { targets: [...catalog.access.targets, { ...other, read: true, write: false, execute: false }], defaultTargetId: 'drone:box' },
      catalog.revision,
    );
    expect((await workspaces.list(chat)).workspaces.map(({ id, link }) => ({ id, link }))).toEqual([
      { id: 'drone:box', link: 'workspace://box/' },
      { id: 'drone:other', link: 'workspace://other/' },
    ]);

    await workspaces.run(chat, 'read_file', { path: 'workspace://other/docs/a%20b.txt#L3' });
    await workspaces.run(chat, 'read_file', { path: 'workspace://drone:other/docs/c.txt', target: 'drone:other' });
    await workspaces.run(chat, 'list_files', { path: 'workspace://other/' });
    expect(calls.map(({ id, tool, args }) => [id, tool, args.path ?? null])).toEqual([
      ['other', 'read_file', 'docs/a b.txt'],
      ['other', 'read_file', 'docs/c.txt'],
      ['other', 'list_files', null],
    ]);
    await expect(workspaces.run(chat, 'read_file', { path: 'workspace://Guides/a.md' })).rejects.toThrow(
      'This chat has no workspace "Guides"',
    );
    await expect(
      workspaces.run(chat, 'read_file', { path: 'workspace://other/a.md', target: 'drone:box' }),
    ).rejects.toThrow('is in workspace drone:other, not drone:box');
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

describe('chat homes', () => {
  test('a chat starts with its own workspace and a home of its own, which is not the default', async () => {
    const { workspaces, stored, directory } = fixture({ homes: true });
    const chat = { droneId: 'box', chatName: 'default' };
    const catalog = await workspaces.catalog(chat);
    expect(fs.statSync(path.join(directory, 'c-box')).isDirectory()).toBe(true);
    expect(catalog.access.defaultTargetId).toBe('drone:box');
    // A container drone's agent does not run commands on this device, so its home on this device does not either.
    expect(catalog.access.targets).toEqual([
      expect.objectContaining({ id: 'drone:box', read: true, write: true, execute: true }),
      expect.objectContaining({ id: chatHomeTargetId('c-box'), kind: 'host', name: 'default home (box)', read: true, write: true, execute: false }),
    ]);
    expect(stored.get('box/default')).toEqual(catalog.access);
    expect((catalog.access.targets[1] as any).path).toBeUndefined();
    // The first catalog already offers the home it selected.
    expect(catalog.workspaces.find((option) => option.id === chatHomeTargetId('c-box'))).toEqual(
      expect.objectContaining({ path: path.join(directory, 'c-box'), chatHome: expect.objectContaining({ chatId: 'c-box', droneName: 'box' }) }),
    );
    const listed = await workspaces.list(chat);
    expect(listed.workspaces.map(({ id, home, ownWorkspace, path: root }) => ({ id, home, ownWorkspace, root }))).toEqual([
      { id: 'drone:box', home: undefined, ownWorkspace: true, root: '/repo' },
      { id: chatHomeTargetId('c-box'), home: true, ownWorkspace: undefined, root: path.join(directory, 'c-box') },
    ]);
  });

  test('a host drone chat may run commands in its home', async () => {
    const { workspaces } = fixture({ homes: true });
    const catalog = await workspaces.catalog({ droneId: 'local', chatName: 'default' });
    expect(catalog.access.targets.find((target) => target.id === chatHomeTargetId('c-local'))).toEqual(
      expect.objectContaining({ read: true, write: true, execute: true }),
    );
  });

  test('a chat that already chose its workspaces gets its home once; removed, it stays removed', async () => {
    const { workspaces, stored, directory } = fixture({ homes: true });
    const chat = { droneId: 'box', chatName: 'default' };
    const before = await fixture().workspaces.catalog(chat);
    stored.set('box/default', before.access);
    const catalog = await workspaces.catalog(chat);
    expect(catalog.access.targets.map((target) => target.id)).toEqual(['drone:box', chatHomeTargetId('c-box')]);
    await workspaces.save(chat, { targets: [catalog.access.targets[0]], defaultTargetId: 'drone:box' }, catalog.revision);
    expect((await workspaces.catalog(chat)).access.targets.map((target) => target.id)).toEqual(['drone:box']);
    // The folder is still the chat's; the user can add it back from the picker.
    expect(fs.existsSync(path.join(directory, 'c-box'))).toBe(true);
    expect((await workspaces.catalog(chat)).workspaces.some((option) => option.id === chatHomeTargetId('c-box'))).toBe(true);
  });

  test("home() makes the home and says what the chat may do there, null once removed", async () => {
    const { workspaces, directory } = fixture({ homes: true });
    const chat = { droneId: 'box', chatName: 'default' };
    expect(await workspaces.home(chat)).toEqual({
      id: chatHomeTargetId('c-box'),
      path: path.join(directory, 'c-box'),
      access: { read: true, write: true, execute: false },
    });
    const catalog = await workspaces.catalog(chat);
    await workspaces.save(chat, { targets: [catalog.access.targets[0]], defaultTargetId: 'drone:box' }, catalog.revision);
    expect((await workspaces.home(chat))?.access).toBeNull();
    expect(await fixture().workspaces.home(chat)).toBeNull();
  });

  test('a native chat gets no home here: its workspaces are its assistant thread\'s', async () => {
    const { workspaces, directory } = fixture({ homes: true, native: ['box/default'] });
    expect(await workspaces.home({ droneId: 'box', chatName: 'default' })).toBeNull();
    expect(fs.existsSync(path.join(directory, 'c-box'))).toBe(false);
  });

  test("lists the home under its chat's name now, not the one it had when chosen", async () => {
    const { workspaces, renamed } = fixture({ homes: true });
    const chat = { droneId: 'box', chatName: 'default' };
    await workspaces.catalog(chat);
    renamed['c-box'] = 'Review Mech';
    const listed = await workspaces.list(chat);
    expect(listed.workspaces.find((item) => item.home)?.name).toBe('Review Mech home (box)');
  });

  test('tools reach the home folder by its workspace id', async () => {
    const { workspaces, calls } = fixture({ homes: true });
    const chat = { droneId: 'box', chatName: 'default' };
    await workspaces.run(chat, 'write_file', { path: 'notes.md', content: 'hi', target: chatHomeTargetId('c-box') });
    expect(calls.map(({ id, tool }) => [id, tool])).toEqual([[chatHomeTargetId('c-box'), 'write_file']]);
  });
});

describe('granting workspace access', () => {
  const one = { droneId: 'box', chatName: 'default' };
  const two = { droneId: 'other', chatName: 'default' };

  test('a chat gives another chat access it holds, added to what that chat has', async () => {
    const { workspaces } = fixture({ homes: true });
    const home = chatHomeTargetId('c-box');
    expect(await workspaces.grant(one, two, { workspace: home, read: true })).toEqual({
      workspace: home,
      name: 'default home (box)',
      changed: true,
      access: { read: true, write: false, execute: false },
    });
    expect((await workspaces.grant(one, two, { workspace: home, write: true })).access).toEqual({ read: true, write: true, execute: false });
    const access = (await workspaces.catalog(two)).access;
    // The other chat keeps its own default.
    expect(access.defaultTargetId).toBe('drone:other');
    expect(access.targets.find((target) => target.id === home)).toEqual(
      expect.objectContaining({ kind: 'host', read: true, write: true, execute: false }),
    );
    // Granting what it already has changes nothing, and never takes anything away.
    expect(await workspaces.grant(one, two, { workspace: home, read: true })).toEqual(
      expect.objectContaining({ changed: false, access: { read: true, write: true, execute: false } }),
    );
    await workspaces.run(two, 'write_file', { path: 'from-two.md', content: 'x', target: home });
  });

  test('a native chat cannot be granted access: only the user chooses its workspaces', async () => {
    const { workspaces } = fixture({ homes: true, native: ['other/default'] });
    await expect(workspaces.grant(one, two, { workspace: chatHomeTargetId('c-box'), read: true })).rejects.toThrow(
      'is a native chat',
    );
  });

  test('a chat cannot grant what it does not hold', async () => {
    const { workspaces } = fixture({ homes: true });
    // Its home is not executable for a container drone's chat.
    await expect(workspaces.grant(one, two, { workspace: chatHomeTargetId('c-box'), execute: true })).rejects.toThrow(
      'it has no execute access to default home (box)',
    );
    // Chat two's home is not chat one's.
    await workspaces.catalog(two);
    await expect(workspaces.grant(one, two, { workspace: chatHomeTargetId('c-other'), read: true })).rejects.toThrow(
      'This chat has no workspace',
    );
    const catalog = await workspaces.catalog(one);
    const local = catalog.workspaces.find((option) => option.id === hostWorkspaceId('/tmp/local-repo'))!;
    await workspaces.save(
      one,
      { targets: [...catalog.access.targets, { ...local, read: true, write: false, execute: false }], defaultTargetId: 'drone:box' },
      catalog.revision,
    );
    await expect(workspaces.grant(one, two, { workspace: local.id, write: true })).rejects.toThrow('no write access');
    await expect(workspaces.grant(one, two, { workspace: local.id })).rejects.toThrow('Choose at least one permission');
    await expect(workspaces.grant(one, one, { workspace: local.id, read: true })).rejects.toThrow('to itself');
  });

  test('access granted stays when the granting chat loses it', async () => {
    const { workspaces } = fixture({ homes: true });
    const home = chatHomeTargetId('c-box');
    await workspaces.grant(one, two, { workspace: 'default home (box)', write: true });
    const catalog = await workspaces.catalog(one);
    await workspaces.save(one, { targets: [catalog.access.targets[0]], defaultTargetId: 'drone:box' }, catalog.revision);
    expect((await workspaces.catalog(two)).access.targets.find((target) => target.id === home)?.write).toBe(true);
    await expect(workspaces.grant(one, two, { workspace: home, read: true })).rejects.toThrow('This chat has no workspace');
  });
});

describe('chat home sweeps', () => {
  function homes(chats: string[] | null) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-homes-'));
    temporary.push(directory);
    const sweeper = new ChatHomes(
      () => directory,
      () => ({
        available: chats !== null,
        chats: (chats ?? []).map((chatId, index) => ({ chatId, droneId: 'd', chatName: `c${index}`, archived: index > 0 })),
      }),
    );
    return { sweeper, directory };
  }

  test('deletes the homes of chats that are gone, files and all, and keeps archived chats', async () => {
    const { sweeper, directory } = homes(['live', 'archived']);
    for (const id of ['live', 'archived', 'gone']) await sweeper.ensure(id);
    fs.writeFileSync(path.join(directory, 'gone', 'work.md'), 'x');
    fs.mkdirSync(path.join(directory, 'not a chat id'));
    expect(await sweeper.sweep()).toEqual(['gone']);
    expect(fs.readdirSync(directory).sort()).toEqual(['archived', 'live', 'not a chat id']);
    expect((await sweeper.list()).map((home) => home.chatId).sort()).toEqual(['archived', 'live']);
  });

  test('deletes nothing without the chat list, or when it is empty', async () => {
    for (const chats of [null, []]) {
      const { sweeper, directory } = homes(chats);
      await sweeper.ensure('kept');
      expect(await sweeper.sweep()).toEqual([]);
      expect(fs.existsSync(path.join(directory, 'kept'))).toBe(true);
    }
  });

  test('ensure says whether it made the home', async () => {
    const { sweeper } = homes(['a']);
    expect((await sweeper.ensure('a')).created).toBe(true);
    expect((await sweeper.ensure('a')).created).toBe(false);
    await expect(sweeper.ensure('../escape')).rejects.toThrow('Invalid chat id');
  });
});
