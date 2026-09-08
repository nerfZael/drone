import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChatWorkspaceAccess, ChatWorkspaceOption } from '@drone/assistant-chat';
import {
  CompanionWorkspaceService,
  parseCompanionWorkspaceAccess,
} from '../src/hub/companion/companion-workspaces';
import { HubAssistantService } from '../src/hub/assistant';
import { buildHostWorkspaces } from '../src/hub/assistant/host-workspaces';
import { withTempDroneDataDir } from './test-helpers';

function fixture() {
  let saved: ChatWorkspaceAccess = { targets: [], defaultTargetId: null };
  const calls: Array<{ id: string; tool: string }> = [];
  const drones = ['a', 'b'].map((id) => ({
    id,
    name: id,
    runtime: 'container',
    repoPath: '/repo',
    status: 'running',
    group: null,
    chats: ['default'],
  }));
  const shared: ChatWorkspaceOption = {
    id: 'remote:server:folder',
    kind: 'remote',
    deviceId: 'server',
    deviceName: 'Server',
    workspaceId: 'folder',
    name: 'Shared',
    read: true,
    write: false,
    execute: false,
  };
  const service = new CompanionWorkspaceService(
    {
      workspaceInventory: async () => ({ drones, hostWorkspaces: [] }),
      executeAuthorizedWorkspaceTool: async (id, call, authorize) => {
        await authorize();
        calls.push({ id, tool: call.tool });
        return { content: [{ type: 'text', text: 'ok' }], details: { id } };
      },
    },
    {
      workspaceAccessDevices: async () => ({
        self: { id: 'home', name: 'Home' },
        devices: [{ id: 'server', name: 'Server' }],
      }),
      listWorkspaceAccessTargets: async () => [shared],
      legacyWorkspaceAccessTargets: async () => [],
      remoteWorkspaceTargets: async () => [],
    },
    {
      read: async () => structuredClone(saved),
      write: async (value) => {
        saved = structuredClone(value);
      },
    },
  );
  return {
    service,
    drones,
    calls,
    shared,
    setAccess: (value: ChatWorkspaceAccess) => {
      saved = value;
    },
  };
}
const call = async (
  tools: Awaited<ReturnType<CompanionWorkspaceService['tools']>>,
  name: string,
  args: any,
) => {
  const tool = tools.find((tool) => tool.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.execute('call', args, new AbortController().signal);
};

describe('Companion workspace access', () => {
  test('starts empty, requires Read, and rejects invented targets and remote permission escalation', async () => {
    const { service, shared } = fixture();
    const catalog = await service.catalog();
    expect(catalog.access.targets).toEqual([]);
    expect(await service.tools('test', () => {})).toEqual([]);
    const target = catalog.workspaces[0]!;
    expect(() =>
      parseCompanionWorkspaceAccess({
        targets: [{ ...target, read: false }],
        defaultTargetId: target.id,
      }),
    ).toThrow('must allow Read');
    await expect(
      service.save(
        {
          targets: [{ ...target, id: 'drone:invented', droneId: 'invented' }],
          defaultTargetId: 'drone:invented',
        },
        catalog.revision,
      ),
    ).rejects.toThrow('unavailable');
    await expect(
      service.save(
        { targets: [{ ...shared, execute: true }], defaultTargetId: shared.id },
        catalog.revision,
      ),
    ).rejects.toThrow('unavailable');
    const remote = await service.catalog('server');
    expect(remote.workspaces).toContainEqual(shared);
  });

  test('exposes only supported tools and checks Write/Execute on the actual target', async () => {
    const { service, calls } = fixture();
    const catalog = await service.catalog();
    const [a, b] = catalog.workspaces;
    await service.save(
      {
        targets: [
          { ...a, write: false, execute: true },
          { ...b, write: true, execute: false },
        ],
        defaultTargetId: a!.id,
      },
      catalog.revision,
    );
    const tools = await service.tools('test', () => {});
    await call(tools, 'read_file', { target: b!.id, path: 'x' });
    await call(tools, 'bash', { target: a!.id, command: 'true' });
    await call(tools, 'write_file', { target: b!.id, path: 'x', content: 'hello' });
    await expect(call(tools, 'bash', { target: b!.id, command: 'true' })).rejects.toThrow(
      'lacks capability',
    );
    await expect(
      call(tools, 'write_file', { target: a!.id, path: 'x', content: 'hello' }),
    ).rejects.toThrow('lacks capability');
    expect(calls).toEqual([
      { id: 'b', tool: 'read_file' },
      { id: 'a', tool: 'bash' },
      { id: 'b', tool: 'write_file' },
    ]);
    const transfer = tools.find((tool) => tool.name === 'transfer_files')!;
    const properties = (transfer.parameters as any).properties;
    expect(properties.sourceTarget.enum).toEqual([a!.id, b!.id]);
    expect(properties.destinationTarget.enum).toEqual([b!.id]);
    await expect(
      call(tools, 'transfer_files', {
        sourceTarget: b!.id,
        sourcePath: 'x',
        destinationTarget: a!.id,
        destinationPath: 'x',
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(3);
  });

  test('revocation blocks cached tools; new turns get a refreshed catalog', async () => {
    const { service, calls } = fixture();
    const initial = await service.catalog();
    const target = initial.workspaces[0]!;
    const saved = await service.save(
      { targets: [target], defaultTargetId: target.id },
      initial.revision,
    );
    const tools = await service.tools('test', () => {});
    await service.save(
      { targets: [{ ...target, execute: false, write: false }], defaultTargetId: target.id },
      saved.revision,
    );
    await expect(call(tools, 'bash', { target: target.id, command: 'true' })).rejects.toThrow(
      'access changed',
    );
    expect(calls).toEqual([]);
    const refreshed = await service.tools('test', () => {});
    expect(refreshed.some((tool) => tool.name === 'bash' || tool.name === 'write_file')).toBe(
      false,
    );
    expect(refreshed.some((tool) => tool.name === 'read_file')).toBe(true);
    await expect(service.save(initial.access, initial.revision)).rejects.toThrow(
      'changed elsewhere',
    );
  });

  test('checks destination permission during an in-flight transfer, before writing bytes', async () => {
    const source: ChatWorkspaceOption = {
      id: 'remote:server:source',
      kind: 'remote',
      deviceId: 'server',
      deviceName: 'Server',
      workspaceId: 'source',
      name: 'Source',
      read: true,
      write: false,
      execute: false,
    };
    const destination: ChatWorkspaceOption = {
      ...source,
      id: 'remote:server:destination',
      workspaceId: 'destination',
      name: 'Destination',
      write: true,
    };
    let access: ChatWorkspaceAccess = {
      targets: [source, destination],
      defaultTargetId: source.id,
    };
    let written = false;
    const service = new CompanionWorkspaceService(
      {
        workspaceInventory: async () => ({ drones: [], hostWorkspaces: [] }),
        executeAuthorizedWorkspaceTool: async () => {
          throw new Error('unexpected local operation');
        },
      },
      {
        workspaceAccessDevices: async () => ({
          self: { id: 'home', name: 'Home' },
          devices: [{ id: 'server', name: 'Server' }],
        }),
        listWorkspaceAccessTargets: async () => [source, destination],
        legacyWorkspaceAccessTargets: async () => [],
        remoteWorkspaceTargets: async () => [
          {
            descriptor: {
              id: source.id,
              kind: 'remote-device',
              label: 'Source',
              rootLabel: 'Source',
              capabilities: ['files.read'],
            },
            execute: async () => {
              throw new Error('unexpected execute');
            },
            transfer: {
              source: {
                stat: async () => ({ type: 'file', size: 1 }),
                list: async () => [],
                readChunk: async () => {
                  access = { ...access, targets: [source, { ...destination, write: false }] };
                  return { dataBase64: 'YQ==', bytes: 1 };
                },
              },
            },
          },
          {
            descriptor: {
              id: destination.id,
              kind: 'remote-device',
              label: 'Destination',
              rootLabel: 'Destination',
              capabilities: ['files.read', 'files.write'],
            },
            execute: async () => {
              throw new Error('unexpected execute');
            },
            transfer: {
              destination: {
                createDirectory: async () => {},
                prepareFile: async () => ({ offset: 0 }),
                writeChunk: async () => {
                  written = true;
                  return { offset: 1 };
                },
                commitFile: async () => {
                  written = true;
                },
              },
            },
          },
        ],
      },
      {
        read: async () => access,
        write: async (value) => {
          access = value;
        },
      },
    );
    const tools = await service.tools('test', () => {});
    try {
      const result = await call(tools, 'transfer_files', {
        sourceTarget: source.id,
        sourcePath: 'x',
        destinationTarget: destination.id,
        destinationPath: 'x',
      });
      expect(JSON.stringify(result)).toContain('write access');
    } catch (error) {
      expect(String(error)).toContain('write access');
    }
    expect(written).toBe(false);
  });

  test('saved revisions survive storage normalization and another service instance', async () => {
    await withTempDroneDataDir('companion-workspace-settings-', async () => {
      const assistant = new HubAssistantService({
        listDrones: async () => [],
        listHostWorkspaces: async () => buildHostWorkspaces([], ['/repo']),
      });
      const mesh = {
        workspaceAccessDevices: async () => ({ self: { id: 'home', name: 'Home' }, devices: [] }),
        listWorkspaceAccessTargets: async () => [],
        legacyWorkspaceAccessTargets: async () => [],
        remoteWorkspaceTargets: async () => [],
      };
      const service = new CompanionWorkspaceService(assistant, mesh);
      const initial = await service.catalog();
      const target = initial.workspaces[0]!;
      const saved = await service.save(
        { targets: [target], defaultTargetId: target.id },
        initial.revision,
      );
      const reloaded = new CompanionWorkspaceService(assistant, mesh);
      expect((await reloaded.catalog()).revision).toBe(saved.revision);
      await reloaded.save(
        { targets: [{ ...target, execute: false }], defaultTargetId: target.id },
        saved.revision,
      );
      expect((await service.catalog()).access.targets[0]!.execute).toBe(false);
    });
  });

  test('runtime configuration refreshes when selected workspaces disappear or return', async () => {
    const { service, drones } = fixture();
    const catalog = await service.catalog();
    const target = catalog.workspaces[0]!;
    await service.save({ targets: [target], defaultTargetId: target.id }, catalog.revision);
    const before = await service.revision();
    const removed = drones.splice(0, drones.length);
    expect(await service.revision()).not.toBe(before);
    const unavailable = await service.tools('test', () => {});
    expect(unavailable.some((tool) => tool.name === 'read_file')).toBe(false);
    drones.push(...removed);
    expect(await service.revision()).toBe(before);
    expect((await service.tools('test', () => {})).some((tool) => tool.name === 'read_file')).toBe(
      true,
    );
  });

  test('cancellation blocks tool execution', async () => {
    const { service, calls } = fixture();
    const initial = await service.catalog();
    await service.save(
      { targets: [initial.workspaces[0]], defaultTargetId: initial.workspaces[0]!.id },
      initial.revision,
    );
    const tools = await service.tools('test', () => {
      throw new Error('cancelled');
    });
    await expect(call(tools, 'read_file', { path: 'x' })).rejects.toThrow('cancelled');
    expect(calls).toEqual([]);
  });

  test('reuses the real patch executor and local command tool without a chat or approval', async () => {
    await withTempDroneDataDir('companion-workspaces-', async () => {
      const folder = await mkdtemp(path.join(os.tmpdir(), 'companion-command-'));
      try {
        const files = new Map([['hello.txt', 'before\n']]);
        const assistant = new HubAssistantService({
          listDrones: async () => [],
          listHostWorkspaces: async () => buildHostWorkspaces([], [folder]),
          readDroneFile: async ({ path }) => ({ path, content: files.get(path) ?? '' }) as any,
          statDronePath: async ({ path }) =>
            ({ path, exists: files.has(path), kind: 'file' }) as any,
          batchDroneFiles: async ({ operations }) => {
            for (const op of operations) if (op.type === 'write') files.set(op.path, op.content);
            return { ok: true } as any;
          },
        });
        let access: ChatWorkspaceAccess = { targets: [], defaultTargetId: null };
        const service = new CompanionWorkspaceService(
          assistant,
          {
            workspaceAccessDevices: async () => ({
              self: { id: 'home', name: 'Home' },
              devices: [],
            }),
            listWorkspaceAccessTargets: async () => [],
            legacyWorkspaceAccessTargets: async () => [],
            remoteWorkspaceTargets: async () => [],
          },
          {
            read: async () => access,
            write: async (value) => {
              access = value;
            },
          },
        );
        const initial = await service.catalog();
        const target = initial.workspaces[0]!;
        expect(target.execute).toBe(true);
        await service.save({ targets: [target], defaultTargetId: target.id }, initial.revision);
        const tools = await service.tools('test', () => {});
        await call(tools, 'apply_patch', {
          patch: '*** Begin Patch\n*** Update File: hello.txt\n@@\n-before\n+after\n*** End Patch',
        });
        expect(files.get('hello.txt')).toBe('after\n');
        const output = await call(tools, 'bash', { command: 'pwd' });
        expect(JSON.stringify(output)).toContain(folder);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  });
});
