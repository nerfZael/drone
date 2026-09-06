import { describe, expect, test } from 'bun:test';
import { parseChatWorkspaceAccess, type ChatWorkspaceTarget } from '@drone/assistant-chat';
import { buildHostWorkspaces, hostWorkspaceId } from '../src/hub/assistant/host-workspaces';
import { HubAssistantService } from '../src/hub/assistant';
import {
  createChatWorkspaceAccessService,
  type WorkspaceAccessMesh,
} from '../src/hub/assistant/chat-workspace-access';
import { authorizeDroneHubMcpTool } from '../src/hub/mcp-server';
import { updateRegistry } from '../src/host/registry';
import { ensureTestNativeChat } from './native-chat-test-helpers';
import { withTempDroneDataDir } from './test-helpers';

const drone = (id: string, runtime = 'container') => ({
  id,
  name: id,
  group: null,
  runtime,
  repoPath: '/repo',
  status: 'running',
  chats: ['default'],
});
const remote: ChatWorkspaceTarget = {
  id: 'remote:server:folder',
  kind: 'remote',
  deviceId: 'server',
  deviceName: 'Server',
  workspaceId: 'folder',
  name: 'Project',
  read: true,
  write: false,
  execute: false,
};
function mesh(overrides: Partial<WorkspaceAccessMesh> = {}): WorkspaceAccessMesh {
  return {
    workspaceAccessDevices: async () => ({
      self: { id: 'home', name: 'Laptop' },
      devices: [{ id: 'server', name: 'Server' }],
    }),
    listWorkspaceAccessTargets: async () => [remote],
    legacyWorkspaceAccessTargets: async () => [],
    ...overrides,
  };
}

describe('chat workspace access', () => {
  test('groups host drones by directory, lists registered repos, and preserves defaults and permissions', async () => {
    await withTempDroneDataDir('workspace-host-repos-', async () => {
      let drones = [drone('owner', 'host'), drone('same-repo', 'host'), drone('container')];
      const writes: string[] = [];
      let discoveryFails = false;
      const callbacks = {
        listDrones: async () => drones,
        listHostWorkspaces: async () => {
          if (discoveryFails) throw new Error('repository catalog unavailable');
          return buildHostWorkspaces(drones, ['/repo', '/standalone']);
        },
        writeDroneFile: async ({ droneId }: { droneId: string }) => {
          writes.push(droneId);
          return { path: 'a' } as any;
        },
      };
      const assistant = new HubAssistantService(callbacks);
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: 'owner' });
      const service = createChatWorkspaceAccessService(assistant, mesh());
      const initial = await service.catalog(chatId);
      expect(initial.workspaces.map((item) => item.id)).toEqual([
        hostWorkspaceId('/repo'),
        hostWorkspaceId('/standalone'),
        'drone:container',
      ]);
      expect(initial.defaults.defaultTargetId).toBe(hostWorkspaceId('/repo'));
      expect(initial.access.targets).toHaveLength(1);
      expect(initial.access.targets[0]).toMatchObject({
        kind: 'host',
        read: true,
        write: true,
        execute: false,
      });
      const standalone = initial.workspaces.find(
        (item) => item.id === hostWorkspaceId('/standalone'),
      )!;
      const saved = await service.save(
        chatId,
        {
          targets: [standalone],
          defaultTargetId: standalone.id,
        },
        initial.revision,
      );
      await assistant.executeDroneWorkspaceTool(chatId, standalone.id, {
        tool: 'write_file',
        args: { path: 'a', content: 'hello' },
      });
      expect(writes).toEqual([standalone.id]);
      await expect(
        assistant.executeDroneWorkspaceTool(chatId, hostWorkspaceId('/repo'), {
          tool: 'write_file',
          args: { path: 'a', content: 'denied' },
        }),
      ).rejects.toThrow('scope does not include');
      await expect(
        service.save(
          chatId,
          {
            targets: [{ ...standalone, execute: true }],
            defaultTargetId: standalone.id,
          },
          saved.revision,
        ),
      ).rejects.toThrow('Access is unavailable');
      drones = [drone('container')];
      const afterDeletion = await service.catalog(chatId);
      expect(afterDeletion.access.targets.map((item) => item.id)).toEqual([standalone.id]);
      expect(afterDeletion.workspaces.filter((item) => item.kind === 'host')).toHaveLength(2);
      const readOnly = await service.save(
        chatId,
        {
          targets: [{ ...standalone, write: false }],
          defaultTargetId: standalone.id,
        },
        afterDeletion.revision,
      );
      await expect(
        assistant.executeDroneWorkspaceTool(chatId, standalone.id, {
          tool: 'write_file',
          args: { path: 'a', content: 'denied' },
        }),
      ).rejects.toThrow('scope does not include');
      const reloaded = new HubAssistantService(callbacks);
      expect(
        (await createChatWorkspaceAccessService(reloaded, mesh()).catalog(chatId)).access,
      ).toEqual(readOnly.access);
      discoveryFails = true;
      expect(
        (await reloaded.threadSnapshot(chatId)).threads.some((thread) => thread.id === chatId),
      ).toBe(true);
    });
  });

  test('migrates duplicate saved host targets without changing their default directory', async () => {
    await withTempDroneDataDir('workspace-host-migration-', async () => {
      const drones = [
        drone('owner', 'host'),
        drone('same-repo', 'host'),
        { ...drone('custom', 'host'), cwd: '/custom/folder' },
      ];
      const assistant = new HubAssistantService({ listDrones: async () => drones });
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: 'owner' });
      const state = await assistant.workspaceAccessState(chatId);
      await assistant.saveWorkspaceAccess(
        chatId,
        {
          targets: drones.map((item, index) => ({
            id: `drone:${item.id}`,
            kind: 'drone',
            droneId: item.id,
            deviceId: 'home',
            deviceName: 'Laptop',
            name: item.name,
            read: index !== 1,
            write: index === 1,
            execute: false,
          })),
          defaultTargetId: 'drone:custom',
        },
        state.revision,
      );
      const catalog = await createChatWorkspaceAccessService(assistant, mesh()).catalog(chatId);
      expect(catalog.access.targets).toHaveLength(2);
      expect(
        catalog.access.targets.find((item) => item.id === hostWorkspaceId('/repo')),
      ).toMatchObject({ read: true, write: true });
      expect(catalog.access.defaultTargetId).toBe(hostWorkspaceId('/custom/folder'));
      expect(
        catalog.workspaces.find((item) => item.id === hostWorkspaceId('/custom/folder')),
      ).toMatchObject({ repository: false, path: '/custom/folder' });
    });
  });

  test('preserves the maximum selection and private artifacts across reloads', async () => {
    await withTempDroneDataDir('workspace-access-limit-', async () => {
      const drones = Array.from({ length: 100 }, (_, index) => drone(`drone-${index}`));
      const callbacks = { listDrones: async () => drones };
      const assistant = new HubAssistantService(callbacks);
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: drones[0].id });
      await assistant.ensureArtifactsWorkspaceEnabled(chatId);
      const service = createChatWorkspaceAccessService(assistant, mesh());
      const initial = await service.catalog(chatId);
      await service.save(
        chatId,
        {
          targets: initial.workspaces.filter((target) => target.kind === 'drone'),
          defaultTargetId: 'drone:drone-99',
        },
        initial.revision,
      );
      const reloaded = new HubAssistantService(callbacks);
      const saved = await createChatWorkspaceAccessService(reloaded, mesh()).catalog(chatId);
      expect(saved.access.targets).toHaveLength(100);
      expect(saved.access.defaultTargetId).toBe('drone:drone-99');
      expect(reloaded.workspaceIsEnabled(chatId, `artifacts:${chatId}`)).toBe(true);
      for (const target of saved.access.targets)
        expect(reloaded.workspaceIsEnabled(chatId, target.id)).toBe(true);
      expect(() =>
        parseChatWorkspaceAccess({
          targets: [...saved.access.targets, remote],
          defaultTargetId: remote.id,
        }),
      ).toThrow('at most 100');
      drones.push(drone('cloned-owner'));
      await reloaded.cloneNativeThread({
        sourceId: chatId,
        id: 'cloned-full',
        droneId: 'cloned-owner',
        chatName: 'default',
      });
      const cloned = await reloaded.workspaceAccessState('cloned-full');
      expect(cloned.thread.accessScope.droneIds).toContain('cloned-owner');
      expect(cloned.thread.accessScope.droneIds).not.toContain('drone-0');
      expect(reloaded.workspaceIsEnabled('cloned-full', 'artifacts:cloned-full')).toBe(true);
      expect(reloaded.workspaceIsEnabled('cloned-full', 'drone:cloned-owner')).toBe(true);
    });
  });

  test('does not perform fallible discovery after committing workspace access', async () => {
    await withTempDroneDataDir('workspace-commit-', async () => {
      let committed = false;
      const assistant = new HubAssistantService({
        listDrones: async () => {
          if (committed) throw new Error('Discovery went offline after commit');
          return [drone('owner')];
        },
      });
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: 'owner' });
      const service = createChatWorkspaceAccessService(assistant, mesh());
      const initial = await service.catalog(chatId);
      const unsubscribe = assistant.subscribeChanges((event) => {
        if (event.reason === 'workspace_access_changed') committed = true;
      });
      try {
        const saved = await service.save(
          chatId,
          { targets: [], defaultTargetId: null },
          initial.revision,
        );
        expect(committed).toBe(true);
        expect(saved.access.targets).toEqual([]);
        expect(saved.revision).not.toBe(initial.revision);
      } finally {
        unsubscribe();
      }
    });
  });

  test('preserves defaults, saves per-target grants, reloads, and rejects removed target execution', async () => {
    await withTempDroneDataDir('workspace-access-', async () => {
      await updateRegistry((registry: any) => {
        registry.drones = { owner: drone('owner'), other: drone('other') };
      });
      let writes = 0;
      const callbacks = {
        listDrones: async () => [drone('owner'), drone('other'), drone('host', 'host')],
        writeDroneFile: async () => {
          writes++;
          return {} as any;
        },
      };
      const assistant = new HubAssistantService(callbacks);
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: 'owner' });
      const service = createChatWorkspaceAccessService(assistant, mesh());
      const initial = await service.catalog(chatId);
      expect(initial.access.targets.map((target) => target.id)).toEqual(['drone:owner']);
      expect(initial.defaults.defaultTargetId).toBe('drone:owner');
      expect(initial.workspaces.some((target) => target.id === 'drone:host')).toBe(false);
      expect(
        initial.workspaces.find((target) => target.id === hostWorkspaceId('/repo'))?.execute,
      ).toBe(false);
      const other = {
        ...initial.workspaces.find((target) => target.id === 'drone:other')!,
        write: false,
        execute: false,
      };
      const result = await service.save(
        chatId,
        { targets: [other, remote], defaultTargetId: remote.id },
        initial.revision,
      );
      expect(result.access.defaultTargetId).toBe(remote.id);
      expect(() => assistant.assertWorkspaceAccessUnchanged(chatId, undefined)).toThrow(
        'Workspace access changed',
      );
      expect(() => assistant.assertWorkspaceAccessUnchanged(chatId, result.access)).not.toThrow();
      expect(await assistant.workspaceDrones(chatId)).toMatchObject([
        { id: 'other', canRead: true, canWrite: false, canExecute: false },
      ]);
      await expect(
        assistant.executeDroneWorkspaceTool(chatId, 'owner', {
          callId: 'call',
          tool: 'write_file',
          args: { path: 'a', content: 'x' },
        }),
      ).rejects.toThrow();
      await expect(
        assistant.executeDroneWorkspaceTool(chatId, 'other', {
          callId: 'call',
          tool: 'write_file',
          args: { path: 'a', content: 'x' },
        }),
      ).rejects.toThrow();
      expect(writes).toBe(0);
      const reloaded = new HubAssistantService(callbacks);
      await reloaded.ensureNativeThread({ id: chatId, droneId: 'owner', chatName: 'default' });
      expect(
        (await createChatWorkspaceAccessService(reloaded, mesh()).catalog(chatId)).access,
      ).toEqual(result.access);
      expect(await reloaded.workspaceDrones(chatId)).toHaveLength(1);
      await expect(service.save(chatId, initial.access, initial.revision)).rejects.toThrow(
        'changed elsewhere',
      );
    });
  });

  test('validates remote grants from the execution device and preserves offline removals', async () => {
    await withTempDroneDataDir('workspace-remote-', async () => {
      const assistant = new HubAssistantService({ listDrones: async () => [drone('owner')] });
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: 'owner' });
      const requestedDevices: string[] = [];
      let offline = false;
      const service = createChatWorkspaceAccessService(
        assistant,
        mesh({
          listWorkspaceAccessTargets: async (deviceId) => {
            requestedDevices.push(deviceId);
            if (offline) throw new Error('offline');
            return [remote];
          },
        }),
      );
      const initial = await service.catalog(chatId);
      await expect(
        service.save(
          chatId,
          { targets: [{ ...remote, write: true }], defaultTargetId: remote.id },
          initial.revision,
        ),
      ).rejects.toThrow('Access is unavailable');
      const saved = await service.save(
        chatId,
        { targets: [remote], defaultTargetId: remote.id },
        initial.revision,
      );
      expect(requestedDevices).toEqual(['server', 'server']);
      offline = true;
      const discovered = await service.catalog(chatId, 'server');
      expect(discovered.devices.find((device) => device.id === 'server')?.error).toBe('offline');
      expect(discovered.access.targets).toHaveLength(1);
      await expect(
        service.save(
          chatId,
          { targets: [{ ...remote, execute: true }], defaultTargetId: remote.id },
          saved.revision,
        ),
      ).rejects.toThrow();
      const removed = await service.save(
        chatId,
        { targets: [], defaultTargetId: null },
        saved.revision,
      );
      expect(removed.access.targets).toEqual([]);
      expect(await assistant.workspaceDrones(chatId)).toEqual([]);
    });
  });

  test('rejects stale simultaneous saves and edits during a running turn', async () => {
    await withTempDroneDataDir('workspace-race-', async () => {
      const assistant = new HubAssistantService({ listDrones: async () => [drone('owner')] });
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: 'owner' });
      const service = createChatWorkspaceAccessService(assistant, mesh());
      const initial = await service.catalog(chatId);
      const results = await Promise.allSettled([
        service.save(chatId, { targets: [], defaultTargetId: null }, initial.revision),
        service.save(chatId, initial.access, initial.revision),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const current = await service.catalog(chatId);
      await assistant.notifyRuntimeEvent(chatId, {
        type: 'turn_started',
        sessionId: chatId,
        turnId: 'turn',
      } as any);
      await expect(service.save(chatId, initial.access, current.revision)).rejects.toThrow(
        'Stop the agent',
      );
    });
  });

  test('cloning remaps the selected owner and default while preserving remote access', async () => {
    await withTempDroneDataDir('workspace-clone-', async () => {
      const assistant = new HubAssistantService({
        listDrones: async () => [drone('owner'), drone('clone')],
      });
      const { chatId } = await ensureTestNativeChat(assistant, { droneId: 'owner' });
      const service = createChatWorkspaceAccessService(assistant, mesh());
      const initial = await service.catalog(chatId);
      await service.save(
        chatId,
        { ...initial.access, targets: [...initial.access.targets, remote] },
        initial.revision,
      );
      await assistant.cloneNativeThread({
        sourceId: chatId,
        id: 'copy',
        droneId: 'clone',
        chatName: 'default',
      });
      const copied = await service.catalog('copy');
      expect(copied.access.defaultTargetId).toBe('drone:clone');
      expect(copied.access.targets.map((target) => target.id)).toEqual(['drone:clone', remote.id]);
    });
  });

  test('rejects malformed selections and requires an explicit selected default', () => {
    expect(() =>
      parseChatWorkspaceAccess({ targets: [remote], defaultTargetId: 'missing' }),
    ).toThrow();
    expect(() => parseChatWorkspaceAccess({ targets: [remote], defaultTargetId: null })).toThrow();
    expect(() =>
      parseChatWorkspaceAccess({ targets: [remote, remote], defaultTargetId: remote.id }),
    ).toThrow();
    expect(() =>
      parseChatWorkspaceAccess({
        targets: [{ ...remote, id: 'drone:other' }],
        defaultTargetId: 'drone:other',
      }),
    ).toThrow();
  });

  test('MCP tools cannot bypass per-workspace read, write, and command grants', () => {
    const context: any = {
      principal: {
        kind: 'chat',
        name: 'Agent',
        accessScope: { readMode: 'all', writeMode: 'all', executeMode: 'all', droneIds: [] },
        selectedDroneRefs: [],
      },
      workspaceDroneRefs: { read: ['reader'], write: ['writer'], execute: [] },
    };
    expect(() =>
      authorizeDroneHubMcpTool(context, 'rename_drones', { drones: ['reader'] }),
    ).toThrow();
    expect(() => authorizeDroneHubMcpTool(context, 'send_message', { drone: 'writer' })).toThrow();
    expect(() => authorizeDroneHubMcpTool(context, 'list_drones', {})).not.toThrow();
  });
});
