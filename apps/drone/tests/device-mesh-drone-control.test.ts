import { describe, expect, test } from 'bun:test';
import { MESH_CHAT_PAYLOAD_BYTES } from '@drone/device-protocol';
import {
  createDroneControlCapability,
  deviceMeshDroneSummary,
} from '../src/hub/device-mesh/drone-control-capability';
import { autoRenameCreatedDroneFromPrompt } from '../src/hub/device-mesh/auto-rename-created-drone';
import {
  SidebarCommandService,
  type SidebarCommandOperations,
} from '../src/hub/sidebar-command-service';

function sidebarOperations(
  overrides: Partial<SidebarCommandOperations> = {},
): SidebarCommandOperations {
  return {
    setDroneParent: async (droneId, parentId) => ({ ok: true, id: droneId, parentId }),
    setDroneGroup: async (droneIds, group) => ({
      ok: true,
      group,
      moved: droneIds.map((id) => ({ id, group })),
      rejected: [],
    }),
    renameGroup: async ({ repoPath, groupRef, newName }) => ({
      ok: true,
      repoPath,
      oldName: groupRef,
      newName,
      renamed: true,
    }),
    readUiPreferences: async () => ({
      version: null,
      uiPreferences: {},
    }),
    writeUiPreferences: async ({ uiPreferences }) => ({
      version: 1,
      uiPreferences,
    }),
    ...overrides,
  };
}

describe('device mesh drone summaries', () => {
  test('Stop dispatches without reading chat metadata and survives caller cancellation', async () => {
    const originalFetch = globalThis.fetch;
    const sent = Promise.withResolvers<void>();
    const acknowledgement = Promise.withResolvers<Response>();
    const requests: string[] = [];
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });
    const controller = new AbortController();
    globalThis.fetch = (async (input, init) => {
      requests.push(new URL(String(input)).pathname);
      expect(init?.method).toBe('POST');
      expect(requests.at(-1)).toBe('/api/drones/drone-a/chats/default/stop');
      sent.resolve();
      const response = await acknowledgement.promise;
      expect(init?.signal?.aborted).not.toBe(true);
      return response;
    }) as typeof fetch;
    try {
      const stopped = capability.invoke('chat.stop', { droneId: 'drone-a' }, {
        sourceDevice: { id: 'phone' },
        signal: controller.signal,
      } as never);
      await sent.promise;
      controller.abort();
      acknowledgement.resolve(Response.json({ stopped: true }));
      await expect(stopped).resolves.toMatchObject({ stopped: true });
      expect(requests).toHaveLength(1);
    } finally {
      acknowledgement.resolve(Response.json({ stopped: true }));
      capability.close();
      globalThis.fetch = originalFetch;
    }
  });

  test('cancels model discovery at the Hub request boundary', async () => {
    const originalFetch = globalThis.fetch;
    const started = Promise.withResolvers<AbortSignal>();
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });
    globalThis.fetch = (async (_input, init) => {
      const signal = init!.signal!;
      started.resolve(signal);
      return new Promise<Response>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    }) as typeof fetch;
    try {
      const controller = new AbortController();
      const read = capability.invoke('drones.list', { createModelAgent: 'native' }, {
        sourceDevice: { id: 'phone' },
        signal: controller.signal,
      } as never);
      void read.catch(() => undefined);
      const signal = await started.promise;
      controller.abort();
      await expect(read).rejects.toMatchObject({ name: 'AbortError' });
      expect(signal.aborted).toBe(true);
    } finally {
      capability.close();
      globalThis.fetch = originalFetch;
    }
  });

  test('cancels a stalled native history read while another drone remains readable', async () => {
    const originalFetch = globalThis.fetch;
    const historyStarted = Promise.withResolvers<AbortSignal>();
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });
    globalThis.fetch = (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/history')) {
        const signal = init!.signal!;
        historyStarted.resolve(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      if (path.endsWith('/chats')) return Response.json({ chats: ['default'] });
      if (path.endsWith('/state')) return Response.json({ agent: { kind: 'native' } });
      if (path.endsWith('/native')) return Response.json({ nativeChatId: 'thread-a' });
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const controller = new AbortController();
      const read = capability.invoke('chat.read', { droneId: 'slow-drone', chatName: 'default' }, {
        sourceDevice: { id: 'phone-1' },
        signal: controller.signal,
      } as never);
      void read.catch(() => undefined);
      const signal = await historyStarted.promise;
      const other = await capability.invoke('chats.list', { droneId: 'other-drone' });
      expect(other).toMatchObject({ chats: ['default'] });
      controller.abort();
      await expect(read).rejects.toMatchObject({ name: 'AbortError' });
      expect(signal.aborted).toBe(true);
      expect(await capability.invoke('chats.list', { droneId: 'other-drone' })).toMatchObject({
        chats: ['default'],
      });
    } finally {
      capability.close();
      globalThis.fetch = originalFetch;
    }
  });

  test('exposes proposal group mutations through drone control', async () => {
    const calls: Array<[string, unknown]> = [];
    const capability = createDroneControlCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      undefined,
      {
        hubServices: {
          groups: {
            list: async (repoPath?: string) => {
              calls.push(['list', repoPath]);
              return { ok: true, groups: [] };
            },
            create: async (input: unknown) => {
              calls.push(['create', input]);
              return { ok: true, id: 'group-one', name: 'One' };
            },
            rename: async (input: unknown) => {
              calls.push(['rename', input]);
              return { ok: true, renamed: true };
            },
            delete: async (input: unknown) => {
              calls.push(['delete', input]);
              return { ok: true, deletedGroup: true };
            },
          },
        } as any,
      },
    );

    await capability.invoke('groups.list', { repoPath: '/work/repo' });
    await capability.invoke('group.create', { name: 'One', repoPath: '/work/repo' });
    await capability.invoke('group.rename', {
      groupRef: 'group-one',
      newName: 'Two',
      repoPath: '/work/repo',
    });
    await capability.invoke('group.delete', {
      groupRef: 'group-one',
      repoPath: '/work/repo',
    });

    expect(calls[0]).toEqual(['list', '/work/repo']);
    expect(calls[1]).toEqual([
      'create',
      expect.objectContaining({ name: 'One', repoPath: '/work/repo' }),
    ]);
    expect(calls[2]).toEqual([
      'rename',
      expect.objectContaining({ groupRef: 'group-one', newName: 'Two', repoPath: '/work/repo' }),
    ]);
    expect(calls[3]).toEqual([
      'delete',
      { groupRef: 'group-one', repoPath: '/work/repo', keepVolume: false, forget: true },
    ]);
  });

  test('rejects a partially failed group deletion', async () => {
    const capability = createDroneControlCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      undefined,
      {
        hubServices: {
          groups: {
            delete: async () => ({
              ok: false,
              group: 'Review',
              repoPath: '/repo',
              removed: [],
              total: 1,
              errors: [
                {
                  id: 'drone-1',
                  name: 'Reviewer',
                  error: 'volume is busy',
                  removedRegistry: false,
                },
              ],
            }),
          },
        } as any,
      },
    );

    await expect(
      capability.invoke('group.delete', {
        groupRef: 'Review',
        repoPath: '/repo',
      }),
    ).rejects.toThrow('volume is busy');
  });

  test('preserves the sidebar hierarchy fields needed by mobile clients', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'drone_child',
        name: 'Child',
        runtime: 'container',
        group: 'Review',
        groupId: 'group-review',
        repoPath: '/work/repo',
        repoBranch: 'dvm/work',
        cwd: '/work/repo/subdir',
        fleetParentId: 'drone_parent',
        chats: ['default', 'review'],
        draftChats: { review: true, default: false },
        busyChats: ['review'],
        approvalChats: ['default'],
        lastMessageAt: '2026-07-14T10:00:00.000Z',
        statusOk: false,
        statusError: 'offline',
        draft: true,
        persistVolume: false,
      }),
    ).toMatchObject({
      id: 'drone_child',
      repoPath: '/work/repo',
      repoBranch: 'dvm/work',
      cwd: '/work/repo/subdir',
      repoAttached: true,
      fleetParentId: 'drone_parent',
      group: 'Review',
      groupId: 'group-review',
      chats: ['default', 'review'],
      draftChats: { review: true },
      busyChats: ['review'],
      approvalChats: ['default'],
      approvalRequired: true,
      lastMessageAt: '2026-07-14T10:00:00.000Z',
      statusOk: false,
      statusError: 'offline',
      draft: true,
      persistVolume: false,
    });
  });

  test('accepts registry chat maps and nested repo paths', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'drone_a',
        repoPath: '',
        repo: { path: '/nested/repo' },
        chats: { default: {}, planning: {} },
      }),
    ).toMatchObject({
      repoPath: '/nested/repo',
      chats: ['default', 'planning'],
      fleetParentId: null,
    });
  });

  test('forwards the desktop Hub phase and message used by sidebar state glyphs', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'blocked',
        hubPhase: 'error',
        hubMessage: 'Provisioning failed',
      }),
    ).toMatchObject({
      phase: 'error',
      status: 'Provisioning failed',
    });
    expect(deviceMeshDroneSummary({ id: 'draft', hubPhase: 'draft' })).toMatchObject({
      phase: 'draft',
      draft: true,
    });
  });

  test('returns timestamps and desktop sidebar ordering from drones.list', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const pathname = new URL(String(input)).pathname;
      const url = new URL(String(input));
      requestedPaths.push(`${pathname}${url.search}`);
      const body =
        pathname === '/api/drones'
          ? {
              ok: true,
              drones: [
                {
                  id: 'one',
                  name: 'One',
                  repoPath: '/work/one',
                  lastMessageAt: '2026-07-14T10:00:00.000Z',
                },
                { id: 'loose', name: 'Loose', repoPath: '' },
              ],
            }
          : pathname === '/api/repos'
            ? { ok: true, repos: [{ path: '/work/one' }, { path: '/work/empty' }] }
            : pathname === '/api/repos/branches'
              ? {
                  ok: true,
                  hostBranch: url.searchParams.get('repoPath') === '/work/one' ? 'main' : null,
                  remoteBranches:
                    url.searchParams.get('repoPath') === '/work/one'
                      ? [{ name: 'origin/main', remote: 'origin', branch: 'main' }]
                      : [],
                }
              : pathname === '/api/groups'
                ? {
                    ok: true,
                    groups: [
                      {
                        id: 'group-review',
                        name: 'Review',
                        repoPath: '/work/one',
                        parentId: null,
                        createdAt: '2026-07-13T10:00:00.000Z',
                      },
                    ],
                  }
                : pathname === '/api/settings/ui-preferences'
                  ? {
                      ok: true,
                      version: 12,
                      updatedAt: '2026-07-14T11:00:00.000Z',
                      uiPreferences: {
                        sidebarGroupOrder: ['repo:repo:/work/one'],
                        sidebarDroneOrderByGroup: { 'group:Ungrouped': ['one'] },
                        sidebarNodeOrderByParent: { root: ['drone:one'] },
                        sidebarChatOrderByDrone: { one: ['review', 'default'] },
                        sidebarChatGroupPathsByDrone: { one: ['Work'] },
                        sidebarChatGroupByChat: { 'chat:one:review': 'Work' },
                        sidebarChatNodeOrderByParent: {
                          'chat-root:one': ['chat-folder:one:Work', 'chat:one:default'],
                        },
                        pinnedDroneIds: ['one'],
                        mutedSidebarGroupIds: ['group-id:group-review'],
                        mutedDroneIds: ['one'],
                        mutedChatIds: ['chat:one:review'],
                      },
                    }
                  : {
                      ok: true,
                      deleteAction: { mode: 'permanent' },
                    };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability(
        {
          baseUrl: () => 'http://127.0.0.1:7777',
          apiToken: 'test',
        },
        undefined,
        {
          hubServices: {
            repositories: {
              list: async () => ({
                ok: true,
                repos: [{ path: '/work/one' }, { path: '/work/empty' }],
                count: 2,
              }),
            },
            groups: {
              list: async () => ({
                ok: true,
                groups: [
                  {
                    id: 'group-review',
                    name: 'Review',
                    repoPath: '/work/one',
                    parentId: null,
                    createdAt: '2026-07-13T10:00:00.000Z',
                  },
                ],
                total: 1,
              }),
            },
            settings: {
              uiPreferences: {
                read: async () => ({
                  ok: true,
                  version: 12,
                  updatedAt: '2026-07-14T11:00:00.000Z',
                  uiPreferences: {
                    sidebarGroupOrder: ['repo:repo:/work/one'],
                    sidebarDroneOrderByGroup: { 'group:Ungrouped': ['one'] },
                    sidebarNodeOrderByParent: { root: ['drone:one'] },
                    sidebarChatOrderByDrone: { one: ['review', 'default'] },
                    sidebarChatGroupPathsByDrone: { one: ['Work'] },
                    sidebarChatGroupByChat: { 'chat:one:review': 'Work' },
                    sidebarChatNodeOrderByParent: {
                      'chat-root:one': ['chat-folder:one:Work', 'chat:one:default'],
                    },
                    pinnedDroneIds: ['one'],
                    mutedSidebarGroupIds: ['group-id:group-review'],
                    mutedDroneIds: ['one'],
                    mutedChatIds: ['chat:one:review'],
                  },
                }),
              },
              readDeleteAction: async () => ({
                ok: true,
                deleteAction: { mode: 'permanent' },
              }),
            },
          } as any,
        },
      );
      await expect(
        capability.invoke('drones.list', { includeCreateOptions: true }),
      ).resolves.toMatchObject({
        schemaVersion: 7,
        drones: [{ id: 'one', lastMessageAt: '2026-07-14T10:00:00.000Z' }, { id: 'loose' }],
        repoPathByDroneId: { one: '/work/one' },
        sidebar: {
          snapshotComplete: true,
          preferenceVersion: 12,
          preferenceUpdatedAt: '2026-07-14T11:00:00.000Z',
          registeredRepoPaths: ['/work/one', '/work/empty'],
          groupCreatedAtByName: { Review: '2026-07-13T10:00:00.000Z' },
          groups: [
            {
              id: 'group-review',
              name: 'Review',
              repoPath: '/work/one',
              parentId: null,
              createdAt: '2026-07-13T10:00:00.000Z',
            },
          ],
          sidebarGroupOrder: ['repo:repo:/work/one'],
          sidebarDroneOrderByGroup: { 'group:Ungrouped': ['one'] },
          sidebarNodeOrderByParent: { root: ['drone:one'] },
          sidebarChatOrderByDrone: { one: ['review', 'default'] },
          sidebarChatGroupPathsByDrone: { one: ['Work'] },
          sidebarChatGroupByChat: { 'chat:one:review': 'Work' },
          sidebarChatNodeOrderByParent: {
            'chat-root:one': ['chat-folder:one:Work', 'chat:one:default'],
          },
          pinnedDroneIds: ['one'],
          mutedSidebarGroupIds: ['group-id:group-review'],
          mutedDroneIds: ['one'],
          mutedChatIds: ['chat:one:review'],
        },
        createOptions: {
          repos: [
            {
              path: '/work/one',
              hostBranch: null,
              remoteBranches: [],
              branchesLoaded: false,
            },
            {
              path: '/work/empty',
              hostBranch: null,
              remoteBranches: [],
              branchesLoaded: false,
            },
          ],
        },
      });
      expect(requestedPaths).not.toContain('/api/repos');
      expect(requestedPaths).not.toContain('/api/groups');
      expect(requestedPaths).not.toContain('/api/settings/ui-preferences');
      expect(requestedPaths).not.toContain('/api/settings/delete-action');
      expect(requestedPaths.some((path) => path.startsWith('/api/repos/branches'))).toBe(false);

      await expect(
        capability.invoke('drones.list', { createRepoPath: '/work/one' }),
      ).resolves.toEqual({
        schemaVersion: 6,
        createRepo: {
          path: '/work/one',
          hostBranch: 'main',
          remoteBranches: [{ name: 'origin/main', remote: 'origin', branch: 'main' }],
          branchesError: null,
          branchesLoaded: true,
          nextCursor: null,
        },
      });
      expect(requestedPaths).toContain('/api/repos/branches?repoPath=%2Fwork%2Fone');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('marks a sidebar snapshot partial when a canonical source is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/api/drones') {
        return Response.json({ ok: true, drones: [{ id: 'one', repoPath: '/work/one' }] });
      }
      if (pathname === '/api/groups') {
        return new Response('unavailable', { status: 503 });
      }
      if (pathname === '/api/repos') {
        return Response.json({ ok: true, repos: [{ path: '/work/one' }] });
      }
      if (pathname === '/api/settings/ui-preferences') {
        return Response.json({
          ok: true,
          version: 4,
          uiPreferences: { pinnedDroneIds: ['one'] },
        });
      }
      return Response.json({ ok: true, deleteAction: { mode: 'permanent' } });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });

      await expect(capability.invoke('drones.list', {})).resolves.toMatchObject({
        schemaVersion: 7,
        sidebar: {
          snapshotComplete: false,
          preferenceVersion: 4,
          registeredRepoPaths: ['/work/one'],
          groupCreatedAtByName: {},
          pinnedDroneIds: ['one'],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('applies a typed sidebar move intent to the latest Hub snapshot exactly once', async () => {
    const operations: string[] = [];
    const sidebarCommands = new SidebarCommandService(
      sidebarOperations({
        setDroneParent: async (droneId, parentId) => {
          operations.push(`parent:${droneId}:${parentId}`);
          return { ok: true, id: droneId, parentId };
        },
        setDroneGroup: async (droneIds, group) => {
          operations.push(`group:${droneIds.join(',')}:${group}`);
          return { ok: true, moved: [{ id: 'host', group }], rejected: [] };
        },
        readUiPreferences: async () => {
          operations.push('preferences:read:40');
          return {
            version: 40,
            uiPreferences: {
              theme: 'dark',
              sidebarNodeOrderByParent: {
                root: ['drone:host', 'folder:Review'],
                'folder:Review': ['drone:first', 'drone:second'],
              },
            },
          };
        },
        writeUiPreferences: async ({ uiPreferences, expectedVersion }) => {
          operations.push(`preferences:write:${expectedVersion}`);
          return { version: 41, uiPreferences };
        },
      }),
    );
    const capability = createDroneControlCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      undefined,
      { sidebarCommands },
    );
    const command = {
      mutationId: 'move-host-1',
      intent: {
        kind: 'move-into-folder',
        itemKind: 'drone',
        repoPath: '/work/repo',
        droneId: 'host',
        targetParentDroneId: 'lead',
        sourceParentId: 'root',
        sourceSiblingNodeIds: ['drone:host', 'folder:Review'],
        targetGroup: 'Review',
        targetParentId: 'folder:Review',
        targetSiblingNodeIds: ['drone:first', 'drone:second'],
        targetOverNodeId: 'drone:second',
        placement: 'before',
      },
    };
    await expect(capability.invoke('sidebar.move', command)).resolves.toMatchObject({
      ok: true,
      mutationId: 'move-host-1',
      version: 41,
    });
    await expect(capability.invoke('sidebar.move', command)).resolves.toMatchObject({
      mutationId: 'move-host-1',
    });

    expect(operations).toEqual([
      'parent:host:lead',
      'group:host:Review',
      'preferences:read:40',
      'preferences:write:40',
    ]);
  });

  test('uses a stable group reference for an empty folder move', async () => {
    const renames: unknown[] = [];
    const sidebarCommands = new SidebarCommandService(
      sidebarOperations({
        renameGroup: async (input) => {
          renames.push(input);
          return { ok: true, renamed: true };
        },
      }),
    );

    await expect(
      sidebarCommands.move({
        mutationId: 'move-empty-folder',
        intent: {
          kind: 'move-into-folder',
          itemKind: 'folder',
          repoPath: '/work/repo',
          sourceGroupId: 'group-stable-id',
          sourceGroup: 'Experiments',
          sourceNodeId: 'folder:Experiments',
          sourceParentId: 'root',
          sourceSiblingNodeIds: ['folder:Experiments', 'folder:Bug Finding'],
          targetGroup: 'Bug Finding',
          targetParentId: 'folder:Bug Finding',
          targetSiblingNodeIds: [],
          placement: 'inside',
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      stages: {
        membership: { status: 'applied' },
        layout: { status: 'applied' },
      },
      canonical: {
        group: {
          id: 'group-stable-id',
          repoPath: '/work/repo',
          name: 'Bug Finding/Experiments',
        },
        sidebar: { version: 1 },
      },
    });

    expect(renames).toEqual([
      {
        repoPath: '/work/repo',
        groupRef: 'group-stable-id',
        newName: 'Bug Finding/Experiments',
      },
    ]);
  });

  test('reports a recoverable staged result when membership succeeds but layout fails', async () => {
    let renameCount = 0;
    let layoutAvailable = false;
    const sidebarCommands = new SidebarCommandService(
      sidebarOperations({
        renameGroup: async ({ repoPath, groupRef, newName }) => {
          renameCount += 1;
          return {
            ok: true,
            id: groupRef,
            repoPath,
            oldName: 'Experiments',
            newName,
            renamed: true,
          };
        },
        readUiPreferences: async () => ({
          version: 7,
          uiPreferences: { sidebarNodeOrderByParent: { root: ['folder:Experiments'] } },
        }),
        writeUiPreferences: async ({ uiPreferences }) => {
          if (!layoutAvailable) throw new Error('preferences unavailable');
          return { version: 8, uiPreferences };
        },
      }),
    );

    const result = await sidebarCommands.move({
      mutationId: 'move-empty-folder-partial',
      intent: {
        kind: 'move-into-folder',
        itemKind: 'folder',
        repoPath: '/work/repo',
        sourceGroupId: 'group-stable-id',
        sourceGroup: 'Experiments',
        sourceNodeId: 'folder:Experiments',
        sourceParentId: 'root',
        sourceSiblingNodeIds: ['folder:Experiments', 'folder:Bug Finding'],
        targetGroup: 'Bug Finding',
        targetParentId: 'folder:Bug Finding',
        targetSiblingNodeIds: [],
        placement: 'inside',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'LAYOUT_UPDATE_FAILED',
      error: 'preferences unavailable',
      stages: {
        membership: { status: 'applied' },
        layout: { status: 'failed', error: 'preferences unavailable' },
      },
      canonical: {
        group: {
          id: 'group-stable-id',
          repoPath: '/work/repo',
          name: 'Bug Finding/Experiments',
        },
        sidebar: { version: 7 },
      },
    });
    expect(renameCount).toBe(1);

    layoutAvailable = true;
    const retry = await sidebarCommands.move({
      mutationId: 'move-empty-folder-partial-retry',
      intent: {
        kind: 'move-into-folder',
        itemKind: 'folder',
        repoPath: '/work/repo',
        sourceGroupId: 'group-stable-id',
        sourceGroup: 'Experiments',
        sourceNodeId: 'folder:Experiments',
        sourceParentId: 'root',
        sourceSiblingNodeIds: ['folder:Experiments', 'folder:Bug Finding'],
        targetGroup: 'Bug Finding',
        targetParentId: 'folder:Bug Finding',
        targetSiblingNodeIds: [],
        placement: 'inside',
      },
    });
    expect(retry).toMatchObject({
      ok: true,
      stages: {
        membership: { status: 'applied' },
        layout: { status: 'applied' },
      },
    });
    expect(renameCount).toBe(2);
  });

  test('serializes concurrent sidebar commands so each reads the prior committed revision', async () => {
    const requests: string[] = [];
    let version = 8;
    let uiPreferences: Record<string, unknown> = {
      sidebarChatOrderByDrone: { host: ['one', 'two', 'three'] },
    };
    const sidebarCommands = new SidebarCommandService(
      sidebarOperations({
        readUiPreferences: async () => {
          requests.push(`GET:${version}`);
          await Promise.resolve();
          return { version, uiPreferences };
        },
        writeUiPreferences: async ({ uiPreferences: next, expectedVersion }) => {
          requests.push(`POST:${expectedVersion}`);
          uiPreferences = next;
          version += 1;
          return { version, uiPreferences };
        },
      }),
    );
    const capability = createDroneControlCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      undefined,
      { sidebarCommands },
    );
    await Promise.all([
      capability.invoke('sidebar.move', {
        mutationId: 'chat-order-1',
        intent: {
          kind: 'chat',
          droneId: 'host',
          chatNames: ['one', 'two', 'three'],
          activeChatName: 'three',
          overChatName: 'one',
          placement: 'before',
        },
      }),
      capability.invoke('sidebar.move', {
        mutationId: 'chat-order-2',
        intent: {
          kind: 'chat',
          droneId: 'host',
          chatNames: ['three', 'one', 'two'],
          activeChatName: 'two',
          overChatName: 'one',
          placement: 'before',
        },
      }),
    ]);
    expect(requests).toEqual(['GET:8', 'POST:8', 'GET:9', 'POST:9']);
    expect(uiPreferences).toMatchObject({
      sidebarChatOrderByDrone: { host: ['three', 'two', 'one'] },
    });
  });

  test('creates the first sidebar preference record with a null expected version', async () => {
    const writes: Array<{ uiPreferences: Record<string, unknown>; expectedVersion: unknown }> = [];
    const sidebarCommands = new SidebarCommandService(
      sidebarOperations({
        writeUiPreferences: async (input) => {
          writes.push(input);
          return { version: 1, uiPreferences: input.uiPreferences };
        },
      }),
    );
    const capability = createDroneControlCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      undefined,
      { sidebarCommands },
    );
    await expect(
      capability.invoke('sidebar.move', {
        mutationId: 'first-sidebar-write',
        intent: {
          kind: 'chat',
          droneId: 'host',
          chatNames: ['default', 'review'],
          activeChatName: 'review',
          overChatName: 'default',
          placement: 'before',
        },
      }),
    ).resolves.toMatchObject({ ok: true, version: 1 });
    expect(writes).toEqual([
      {
        expectedVersion: null,
        uiPreferences: { sidebarChatOrderByDrone: { host: ['review', 'default'] } },
      },
    ]);
  });

  test('bounds lazy branch pages and rejects unregistered repository paths', async () => {
    const originalFetch = globalThis.fetch;
    let branchRequests = 0;
    const remoteBranches = Array.from({ length: 700 }, (_, index) => ({
      name: `origin/${index}-${'n'.repeat(580)}`,
      remote: 'origin',
      branch: `${index}-${'b'.repeat(580)}`,
    }));
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/repos') {
        return Response.json({ ok: true, repos: [{ path: '/work/large' }] });
      }
      if (url.pathname === '/api/repos/branches') {
        branchRequests += 1;
        return Response.json({ ok: true, hostBranch: 'main', remoteBranches });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const firstPage: any = await capability.invoke('drones.list', {
        createRepoPath: '/work/large',
      });
      expect(Buffer.byteLength(JSON.stringify(firstPage))).toBeLessThan(220 * 1024);
      expect(firstPage.createRepo.remoteBranches.length).toBeGreaterThan(0);
      expect(firstPage.createRepo.remoteBranches.length).toBeLessThan(500);
      expect(firstPage.createRepo.branchesLoaded).toBe(false);
      expect(firstPage.createRepo.nextCursor).toBeGreaterThan(0);

      const secondPage: any = await capability.invoke('drones.list', {
        createRepoPath: '/work/large',
        createRepoCursor: firstPage.createRepo.nextCursor,
      });
      expect(Buffer.byteLength(JSON.stringify(secondPage))).toBeLessThan(220 * 1024);
      expect(secondPage.createRepo.remoteBranches[0]?.name).toBe(
        remoteBranches[firstPage.createRepo.nextCursor]?.name,
      );

      await expect(
        capability.invoke('drones.list', { createRepoPath: '/work/not-registered' }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(branchRequests).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards the desktop-equivalent drone creation options', async () => {
    const originalFetch = globalThis.fetch;
    let request: { method: string; body: any } | null = null;
    globalThis.fetch = (async (_input, init) => {
      request = {
        method: String(init?.method ?? 'GET'),
        body: JSON.parse(String(init?.body ?? '{}')),
      };
      return new Response(JSON.stringify({ ok: true, id: 'created' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('drone.create.container', {
        name: 'mobile-drone',
        group: 'review',
        repoPath: '/work/drone',
        draft: true,
        persistVolume: true,
        repoBranchSource: 'remote',
        remoteBranch: 'origin/mobile',
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedModel: 'gpt-5.2-codex',
        seedReasoning: 'high',
        seedAgentPermissionMode: 'read',
        seedPrompt: 'Review the app',
        seedAttachments: [{ name: 'screen.png', mime: 'image/png', size: 3, dataBase64: 'YWJj' }],
        autoRename: true,
      });
      expect(request).toMatchObject({
        method: 'POST',
        body: {
          name: 'mobile-drone',
          group: 'review',
          repoPath: '/work/drone',
          runtime: 'container',
          draft: true,
          persistVolume: true,
          repoBranchSource: 'remote',
          remoteBranch: 'origin/mobile',
          seedAgent: { kind: 'builtin', id: 'codex' },
          seedChat: 'default',
          seedModel: 'gpt-5.2-codex',
          seedReasoning: 'high',
          seedAgentPermissionMode: 'read',
          seedPrompt: 'Review the app',
          seedAttachments: [{ name: 'screen.png', mime: 'image/png', size: 3, dataBase64: 'YWJj' }],
        },
      });
      expect((request as { body: any } | null)?.body.autoRename).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards clone settings from mobile drone creation', async () => {
    const originalFetch = globalThis.fetch;
    let request: { method: string; body: any } | null = null;
    globalThis.fetch = (async (_input, init) => {
      request = {
        method: String(init?.method ?? 'GET'),
        body: JSON.parse(String(init?.body ?? '{}')),
      };
      return Response.json({ ok: true, id: 'clone' });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('drone.create.container', {
        name: 'Source-copy',
        cloneFrom: 'source',
        cloneChats: true,
      });

      expect(request).toMatchObject({
        method: 'POST',
        body: {
          name: 'Source-copy',
          runtime: 'container',
          cloneFrom: 'source',
          cloneChats: true,
        },
      });
      await expect(
        capability.invoke('drone.create.host', {
          name: 'Unsupported-copy',
          cloneFrom: 'source',
        }),
      ).rejects.toThrow('Cloning is only supported for container runtime drones');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('resolves chunked seed attachments before creating a remote drone', async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: any = null;
    const attachmentCalls: any[] = [];
    const removeCalls: string[][] = [];
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ ok: true, id: 'created' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability(
        {
          baseUrl: () => 'http://127.0.0.1:7777',
          apiToken: 'test',
        },
        {
          attachments: async (...args: any[]) => {
            attachmentCalls.push(args);
            return [
              {
                id: 'upload-1',
                name: 'screen.png',
                mime: 'image/png',
                size: 3,
                dataBase64: 'YWJj',
              },
            ];
          },
          remove: async (ids: readonly string[]) => {
            removeCalls.push([...ids]);
          },
        } as any,
      );

      await capability.invoke(
        'drone.create.container',
        {
          seedPrompt: 'Review the image',
          seedAttachmentIds: ['upload-1'],
          seedAttachmentUploadKey: 'new-drone-upload',
        },
        { sourceDevice: { id: 'phone-1' } } as never,
      );

      expect(attachmentCalls).toEqual([['phone-1', 'new-drone-upload', 'default', ['upload-1']]]);
      expect(requestBody).toMatchObject({
        seedPrompt: 'Review the image',
        seedAttachments: [
          {
            name: 'screen.png',
            mime: 'image/png',
            size: 3,
            dataBase64: 'YWJj',
          },
        ],
      });
      expect(removeCalls).toEqual([['upload-1']]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses the in-process rename command for mobile drone renames', async () => {
    const originalFetch = globalThis.fetch;
    const renames: any[] = [];
    globalThis.fetch = (async (input) => {
      throw new Error(`unexpected loopback request: ${String(input)}`);
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability(
        {
          baseUrl: () => 'http://127.0.0.1:7777',
          apiToken: 'test',
        },
        undefined,
        {
          hubServices: {
            drones: {
              rename: async (input: any) => {
                renames.push(input);
                return {
                  ok: true,
                  id: input.droneRef,
                  oldName: 'Untitled 1',
                  newName: input.newName,
                  renamed: true,
                };
              },
            },
          } as any,
        },
      );
      await expect(
        capability.invoke('drone.rename', {
          droneId: 'drone-one',
          newName: 'Review drone',
        }),
      ).resolves.toMatchObject({ ok: true, newName: 'Review drone' });
      expect(renames).toEqual([
        {
          droneRef: 'drone-one',
          newName: 'Review drone',
          source: 'drone-hub-mobile',
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('schedules automatic naming for unnamed mobile-created drones', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string; body: any }> = [];
    const suggestions: Array<{ droneId: string; prompt: string }> = [];
    const renames: any[] = [];
    let resolveSuggestion: ((name: string) => void) | null = null;
    globalThis.fetch = (async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({
        path,
        method: String(init?.method ?? 'GET'),
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      if (path === '/api/drones') {
        return Response.json({ ok: true, id: 'created-mobile', name: 'Untitled 1' });
      }
      throw new Error(`unexpected loopback request: ${path}`);
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability(
        {
          baseUrl: () => 'http://127.0.0.1:7777',
          apiToken: 'test',
        },
        undefined,
        {
          createdDroneAutoRename: {
            suggestName: async (input) => {
              suggestions.push(input);
              return await new Promise<string>((resolve) => {
                resolveSuggestion = resolve;
              });
            },
            renameDrone: async (input) => {
              renames.push(input);
            },
          },
        },
      );
      await expect(
        capability.invoke('drone.create.container', {
          seedAgent: { kind: 'builtin', id: 'codex' },
          autoRename: true,
          autoRenamePrompt: 'Review the Android app',
        }),
      ).resolves.toMatchObject({
        id: 'created-mobile',
        autoRenameScheduled: true,
      });
      expect(requests[0]).toMatchObject({
        path: '/api/drones',
        body: {
          runtime: 'container',
        },
      });
      expect(requests[0]?.body.autoRenamePrompt).toBeUndefined();
      expect(suggestions).toEqual([
        {
          prompt: 'Review the Android app',
          droneId: 'created-mobile',
        },
      ]);

      resolveSuggestion?.('Review Android App');
      for (let attempt = 0; attempt < 10 && renames.length < 1; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(renames[0]).toMatchObject({
        droneId: 'created-mobile',
        newName: 'Review Android App',
        source: 'mobile-create-auto-rename',
        attempt: 1,
        suggestedBase: 'Review Android App',
        expectedName: 'Untitled 1',
      });
      expect(requests).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('chooses a numbered automatic name when the first suggestion is already used', async () => {
    const renameBodies: any[] = [];
    await expect(
      autoRenameCreatedDroneFromPrompt(
        {
          suggestName: async () => 'Review Android App',
          renameDrone: async (input) => {
            renameBodies.push(input);
            if (renameBodies.length === 1) {
              throw new Error('drone already exists: Review Android App');
            }
          },
        },
        'drone-1',
        'Review the Android app',
        'Untitled 1',
      ),
    ).resolves.toBe('Review Android App (2)');
    expect(renameBodies.map((body) => body.newName)).toEqual([
      'Review Android App',
      'Review Android App (2)',
    ]);
    expect(renameBodies.map((body) => body.expectedName)).toEqual(['Untitled 1', 'Untitled 1']);
  });

  test('keeps a successful create when automatic naming is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    let createBody: any = null;
    console.warn = (...args: unknown[]) => warnings.push(args);
    globalThis.fetch = (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/drones') {
        createBody = JSON.parse(String(init?.body ?? '{}'));
        return Response.json({ ok: true, id: 'created-without-name' });
      }
      return Response.json(
        { ok: false, error: 'Connect Codex or configure an OpenAI API key in Settings.' },
        { status: 412 },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability(
        {
          baseUrl: () => 'http://127.0.0.1:7777',
          apiToken: 'test',
        },
        undefined,
        {
          createdDroneAutoRename: {
            suggestName: async () => {
              throw new Error('Connect Codex or configure an OpenAI API key in Settings.');
            },
            renameDrone: async () => undefined,
          },
        },
      );
      await expect(
        capability.invoke('drone.create.host', {
          seedPrompt: 'Review the Android app',
          autoRename: true,
        }),
      ).resolves.toMatchObject({ id: 'created-without-name', autoRenameScheduled: true });
      expect(createBody).toMatchObject({
        runtime: 'host',
        seedPrompt: 'Review the Android app',
      });
      expect(createBody.autoRename).toBeUndefined();
      expect(createBody.autoRenamePrompt).toBeUndefined();
      for (let attempt = 0; attempt < 10 && warnings.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(String(warnings[0]?.[0] ?? '')).toContain('mobile-created drone auto-rename failed');
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });

  test('proxies agent-scoped create model catalogs with reasoning metadata', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          ok: true,
          models: [
            { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', reasoningLevels: ['low', 'high'] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('drones.list', {
          createModelAgent: 'codex',
          createModelRuntime: 'host',
          refreshCreateModels: true,
        }),
      ).resolves.toMatchObject({
        schemaVersion: 5,
        createModelCatalog: {
          models: [{ id: 'gpt-5.2-codex', reasoningLevels: ['low', 'high'] }],
        },
      });
      expect(requestedUrl).toBe(
        'http://127.0.0.1:7777/api/model-catalog?agent=codex&runtime=host&refresh=1',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards chat model discovery and updates', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return new Response(
        JSON.stringify(
          String(input).includes('/models')
            ? { ok: true, models: [{ id: 'gpt-5', label: 'GPT-5' }], source: 'live' }
            : { ok: true },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.models', {
          droneId: 'drone one',
          chatName: 'default',
          refresh: true,
        }),
      ).resolves.toMatchObject({
        models: [{ id: 'gpt-5', label: 'GPT-5' }],
        source: 'live',
      });
      await capability.invoke('chat.update', {
        droneId: 'drone one',
        chatName: 'default',
        model: 'gpt-5',
      });
      expect(requests.map((request) => request.url)).toEqual([
        'http://127.0.0.1:7777/api/drones/drone%20one/chats/default/models?refresh=1',
        'http://127.0.0.1:7777/api/drones/drone%20one/chats/default/config',
      ]);
      expect(requests[1]).toMatchObject({ method: 'POST', body: '{"model":"gpt-5"}' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('applies chat overrides and synchronizes a native assistant thread', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      if (url.endsWith('/native')) {
        return Response.json({ ok: true, nativeChatId: 'native-chat-1' });
      }
      if (url.endsWith('/chats/default') && String(init?.method ?? 'GET') === 'GET') {
        return Response.json({ ok: true, agent: { kind: 'native' }, chatId: 'native-chat-1' });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('chat.update', {
        droneId: 'drone-1',
        chatName: 'default',
        agent: { kind: 'native' },
        provider: 'codex',
        model: 'gpt-5.3-codex',
        reasoning: 'high',
        agentPermissionMode: 'write',
        approvalPolicy: 'none',
        syncNativeThread: true,
      });

      expect(requests).toHaveLength(4);
      expect(JSON.parse(requests[0]!.body)).toEqual({
        model: 'gpt-5.3-codex',
        agent: { kind: 'native' },
        provider: 'codex',
        reasoning: 'high',
        agentPermissionMode: 'write',
        approvalPolicy: 'none',
      });
      expect(requests[1]!.url).toEndWith('/api/drones/drone-1/chats/default');
      expect(requests[2]!.url).toEndWith('/api/drones/drone-1/chats/default/native');
      expect(requests[3]).toMatchObject({
        url: 'http://127.0.0.1:7777/api/assistant/threads/native-chat-1',
        method: 'PATCH',
      });
      expect(JSON.parse(requests[3]!.body)).toEqual({
        model: 'gpt-5.3-codex',
        provider: 'codex',
        thinkingLevel: 'high',
        agentPermissionMode: 'write',
        approvalPolicy: 'none',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards Codex approval decisions without treating them as native approvals', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('chat.approval.resolve', {
        droneId: 'drone one',
        chatName: 'review chat',
        promptId: 'prompt-1',
        approvalId: 'approval-1',
        decision: 'acceptForSession',
      });
      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/chats/review%20chat/approvals/prompt-1/approval-1/acceptForSession',
          method: 'POST',
          body: '{}',
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards an explicit interruption resolution to the selected drone chat', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return Response.json({ ok: true, status: 'skipped' });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('chat.interruption.resolve', {
        droneId: 'drone one',
        chatName: 'review chat',
        promptId: 'prompt-1',
        resolution: 'skip',
      });
      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/chats/review%20chat/pending/prompt-1/interruption',
          method: 'POST',
          body: '{"resolution":"skip"}',
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects native thread ids that do not belong to the selected chat', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
      if (url.pathname.endsWith('/native')) {
        return Response.json({ ok: true, nativeChatId: 'native-for-selected-chat' });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.update', {
          droneId: 'drone-1',
          chatName: 'default',
          nativeChatId: 'another-native-thread',
          model: 'gpt-5',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(requestedPaths).toEqual(['/api/drones/drone-1/chats/default/native']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses the Hub-selected provider catalog for native chat model choices', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/native')) {
        return Response.json({
          ok: true,
          nativeChatId: 'native-chat-1',
          threads: [
            {
              id: 'native-chat-1',
              provider: 'openai',
              model: 'gpt-5.6-sol',
              thinkingLevel: 'low',
            },
          ],
        });
      }
      if (url.pathname === '/api/model-catalog') {
        return Response.json({
          ok: true,
          provider: 'codex',
          defaultModel: {
            provider: 'codex',
            model: 'gpt-5.6-sol',
            thinkingLevel: 'medium',
          },
          models: [
            {
              provider: 'codex',
              id: 'gpt-5.6-sol',
              label: 'GPT-5.6 Sol',
              reasoningLevels: ['off', 'low', 'medium', 'high'],
              defaultReasoningLevel: 'medium',
            },
          ],
        });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.models', {
          droneId: 'drone-1',
          chatName: 'default',
          nativeChatId: 'native-chat-1',
        }),
      ).resolves.toMatchObject({
        provider: 'codex',
        model: 'gpt-5.6-sol',
        reasoning: 'medium',
        models: [{ provider: 'codex', id: 'gpt-5.6-sol' }],
      });
      expect(requestedPaths).toEqual([
        '/api/drones/drone-1/chats/default/native',
        '/api/model-catalog?agent=native',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('filters completed pending prompts outside the mobile page and forwards cancellation', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string }> = [];
    let markReadBody = '';
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, method: String(init?.method ?? 'GET') });
      if (url.endsWith('/read')) {
        markReadBody = String(init?.body ?? '');
      }
      const body = url.includes('/state?')
        ? {
            ok: true,
            pending: [
              {
                id: 'prompt-completed',
                at: '2026-07-15T11:00:00.000Z',
                prompt: 'Review the code',
                state: 'sent',
              },
              {
                id: 'prompt-2',
                at: '2026-07-15T12:00:00.000Z',
                startedAt: '2026-07-15T12:05:00.000Z',
                prompt: 'Make a PR',
                state: 'sent',
                approvals: [
                  {
                    id: 'approval-1',
                    promptId: 'prompt-2',
                    threadId: 'thread-1',
                    turnId: 'turn-1',
                    itemId: 'item-1',
                    method: 'item/commandExecution/requestApproval',
                    kind: 'command_execution',
                    command: 'bun test',
                    availableDecisions: ['accept', 'decline'],
                    createdAt: '2026-07-15T12:05:30.000Z',
                    status: 'pending',
                  },
                ],
              },
            ],
            transcripts: [
              { id: 'prompt-completed', turn: 1, prompt: 'Review the code' },
              ...Array.from({ length: 100 }, (_, index) => ({
                id: `later-${index + 1}`,
                turn: index + 2,
                prompt: `Later prompt ${index + 1}`,
              })),
            ],
            readState: {
              unread: true,
              latestAgentTurnId: 'turn-1',
              latestAgentRevision: 2,
            },
          }
        : url.endsWith('/pending/prompt-2')
          ? { ok: true, cancelled: true, promptId: 'prompt-2' }
          : url.endsWith('/read')
            ? {
                ok: true,
                readState: {
                  unread: false,
                  latestAgentTurnId: 'turn-1',
                  latestAgentRevision: 2,
                },
              }
            : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const readResult: any = await capability.invoke(
        'chat.read',
        { droneId: 'Untitled 6', chatName: 'default' },
        { sourceDevice: { id: 'phone-1' } } as never,
      );
      expect(readResult).toMatchObject({
        pending: [
          {
            id: 'prompt-2',
            prompt: 'Make a PR',
            state: 'sent',
            startedAt: '2026-07-15T12:05:00.000Z',
            approvals: [
              {
                id: 'approval-1',
                promptId: 'prompt-2',
                command: 'bun test',
                availableDecisions: ['accept', 'decline'],
                status: 'pending',
              },
            ],
          },
        ],
        readState: {
          unread: false,
          latestAgentTurnId: 'turn-1',
          latestAgentRevision: 2,
        },
      });
      expect(readResult.turns).toHaveLength(100);
      expect(readResult.turns.some((turn: any) => turn.id === 'prompt-completed')).toBe(false);
      expect(markReadBody).toBe(
        '{"latestAgentTurnId":"turn-1","latestAgentRevision":2,"updatedByDeviceId":"phone-1"}',
      );
      await expect(
        capability.invoke('chat.stop', {
          droneId: 'Untitled 6',
          chatName: 'default',
          promptId: 'prompt-2',
        }),
      ).resolves.toMatchObject({ cancelled: true, promptId: 'prompt-2' });
      expect(requests).toContainEqual({
        url: 'http://127.0.0.1:7777/api/drones/Untitled%206/chats/default/pending/prompt-2',
        method: 'DELETE',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('bounds combined history and active-run details for a busy drone', async () => {
    const originalFetch = globalThis.fetch;
    const largePlan = {
      source: 'codex',
      items: Array.from({ length: 100 }, (_, index) => ({
        id: `step-${index}`,
        text: `Plan ${index} ${'p'.repeat(1_000)}`,
        status: 'in_progress',
      })),
    };
    const largeActivity = {
      version: 1,
      source: 'codex',
      updatedAt: '2026-08-02T12:00:00.000Z',
      messages: Array.from({ length: 30 }, (_, index) => ({
        role: 'assistant',
        content: [{ type: 'thinking', thinking: `Activity ${index} ${'a'.repeat(2_000)}` }],
      })),
    };
    const largeFileChanges = {
      version: 2,
      capturedAt: '2026-08-02T12:00:00.000Z',
      counts: { changed: 100, additions: 1_000, deletions: 500 },
      workspaces: Array.from({ length: 8 }, (_, workspaceIndex) => ({
        targetId: `target-${workspaceIndex}`,
        droneId: 'busy-drone',
        label: `Workspace ${workspaceIndex}`,
        previewEntries: Array.from({ length: 48 }, (_, entryIndex) => ({
          path: `src/${workspaceIndex}/${entryIndex}-${'f'.repeat(300)}.ts`,
          status: 'modified',
          additions: 20,
          deletions: 10,
        })),
      })),
    };
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/read')) {
        return Response.json({
          ok: true,
          readState: { unread: false, latestAgentTurnId: 'turn-5', latestAgentRevision: 1 },
        });
      }
      return Response.json({
        ok: true,
        pending: Array.from({ length: 6 }, (_, index) => ({
          id: `pending-${index}`,
          at: `2026-08-02T12:${String(index).padStart(2, '0')}:00.000Z`,
          prompt: `Pending ${index} ${'q'.repeat(20_000)}`,
          state: 'sent',
          agentPlan: largePlan,
          activity: largeActivity,
          fileChanges: largeFileChanges,
        })),
        transcripts: Array.from({ length: 6 }, (_, index) => ({
          id: `turn-${index}`,
          turn: index,
          prompt: `Prompt ${index} ${'u'.repeat(30_000)}`,
          output: `Output ${index} ${'o'.repeat(30_000)}`,
          activity: largeActivity,
          agentPlan: largePlan,
          fileChanges: largeFileChanges,
        })),
        agent: { kind: 'builtin', id: 'codex' },
        readState: { unread: true, latestAgentTurnId: 'turn-5', latestAgentRevision: 1 },
      });
    }) as typeof fetch;

    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const result: any = await capability.invoke(
        'chat.read',
        { droneId: 'busy-drone', chatName: 'default' },
        { sourceDevice: { id: 'phone-1' } } as never,
      );

      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
        MESH_CHAT_PAYLOAD_BYTES,
      );
      expect(result.pending).toHaveLength(6);
      expect(result.pending[0].activityMeshTruncated).toBe(true);
      expect(result.pending.at(-1).activity).toBeDefined();
      expect(result.turns.length).toBeLessThan(6);
      expect(result.page.hasOlder).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('includes the active DroneHub MCP subscriptions in mobile chat reads', async () => {
    const originalFetch = globalThis.fetch;
    let subscriptionRequests = 0;
    let readCursorWrites = 0;
    const stateRequests: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/state')) stateRequests.push(`${url.pathname}${url.search}`);
      const body =
        url.pathname === '/api/resource-subscriptions'
          ? (() => {
              subscriptionRequests += 1;
              return { ok: true, subscriptions: [] };
            })()
          : url.pathname.endsWith('/read')
            ? (() => {
                readCursorWrites += 1;
                return { ok: true, readState: { unread: false } };
              })()
            : {
                ok: true,
                chatId: 'subscriber-chat-1',
                subscriptions: [
                  {
                    id: 'subscription-1',
                    provider: 'github',
                    resourceType: 'pull_request',
                    resourceId: 'acme/widgets#42',
                    events: ['pull_request.merged'],
                    intent: 'Continue after merge.',
                    status: 'active',
                    cursor: { private: 'internal-state' },
                    lastError: 'not for clients',
                  },
                  {
                    id: 'subscription-2',
                    provider: 'drone-hub',
                    resourceType: 'cron',
                    resourceId: 'v1:hourly',
                    resourceConfig: {
                      expression: '0 * * * *',
                      timeZone: 'UTC',
                      description: 'Every hour',
                    },
                    events: ['cron.triggered'],
                    intent: 'Check the deployment.',
                    nextEventAt: '2026-08-05T13:00:00.000Z',
                    status: 'active',
                  },
                ],
                agent: { kind: 'builtin', id: 'codex' },
                transcripts: [{ id: 'turn-1', prompt: 'hello', output: 'hi' }],
                readState: {
                  unread: false,
                  latestAgentTurnId: 'turn-1',
                  latestAgentRevision: 1,
                },
              };
      return Response.json(body);
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });

      const result: any = await capability.invoke('chat.read', {
        droneId: 'drone-1',
        chatName: 'default',
      });
      expect(result).toMatchObject({
        subscriptions: [
          {
            id: 'subscription-1',
            resourceId: 'acme/widgets#42',
            status: 'active',
          },
          {
            id: 'subscription-2',
            resourceType: 'cron',
            resourceConfig: {
              expression: '0 * * * *',
              timeZone: 'UTC',
              description: 'Every hour',
            },
            nextEventAt: '2026-08-05T13:00:00.000Z',
            status: 'active',
          },
        ],
      });
      expect(result.subscriptions[0].cursor).toBeUndefined();
      expect(result.subscriptions[0].lastError).toBeUndefined();
      expect(subscriptionRequests).toBe(0);

      await expect(
        capability.invoke('chat.read', {
          droneId: 'drone-1',
          chatName: 'default',
          turnId: 'turn-1',
          turnNumber: 1,
        }),
      ).resolves.toMatchObject({ historyKind: 'turn-content', turnId: 'turn-1' });
      expect(subscriptionRequests).toBe(0);
      expect(readCursorWrites).toBe(1);
      expect(stateRequests).toEqual([
        '/api/drones/drone-1/chats/default/state?transcript=page&limit=100&pending=all&subscriptions=1&readState=1&transcriptMeta=0',
        '/api/drones/drone-1/chats/default/state?transcript=selected&turn=1&pending=none&subscriptions=0&readState=0&transcriptMeta=0',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not download the full transcript when an exact numbered turn is stale', async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/state')) {
        return Response.json({
          ok: true,
          agent: { kind: 'builtin', id: 'codex' },
          transcripts: [{ id: 'different-turn', turn: 1 }],
          readState: { unread: false, latestAgentTurnId: null, latestAgentRevision: 0 },
        });
      }
      if (url.pathname.endsWith('/read')) {
        return Response.json({ ok: true, readState: { unread: false } });
      }
      return Response.json({
        ok: true,
        turns: [{ id: 'requested-turn', turn: 1, prompt: 'legacy content' }],
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });

      await expect(
        capability.invoke('chat.read', {
          droneId: 'drone-1',
          chatName: 'default',
          turnId: 'requested-turn',
          turnNumber: 1,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(requests.some((request) => request.endsWith('/chats/default'))).toBe(false);

      await expect(
        capability.invoke('chat.read', {
          droneId: 'drone-1',
          chatName: 'default',
          turnId: 'requested-turn',
        }),
      ).resolves.toMatchObject({ historyKind: 'turn-content', turnId: 'requested-turn' });
      expect(requests).toContain('/api/drones/drone-1/chats/default');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('keeps the legacy transcript path for custom-agent chats', async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/state')) {
        return Response.json(
          { ok: false, error: 'transcript is unavailable for custom agents' },
          { status: 410 },
        );
      }
      if (url.pathname.endsWith('/pending')) {
        return Response.json({ ok: true, pending: [] });
      }
      if (url.pathname.endsWith('/read')) {
        return Response.json({ ok: true, readState: { unread: false } });
      }
      return Response.json({
        ok: true,
        agent: { kind: 'custom', id: 'custom-test', command: 'custom-agent' },
        turns: [{ id: 'custom-turn', turn: 1, prompt: 'run it', output: 'done' }],
        readState: { unread: true, latestAgentTurnId: 'custom-turn', latestAgentRevision: 1 },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });

      await expect(
        capability.invoke('chat.read', { droneId: 'drone-1', chatName: 'default' }),
      ).resolves.toMatchObject({
        historyKind: 'turns',
        turns: [{ id: 'custom-turn', prompt: 'run it', output: 'done' }],
      });
      expect(requests).toContain('/api/drones/drone-1/chats/default');
      expect(requests).toContain('/api/drones/drone-1/chats/default/pending');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('promotes a queued new-chat action through the existing mobile chat-create grant', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return Response.json({
        ok: true,
        status: 'created',
        actionId: 'review-action',
        targetChatName: 'Untitled 2',
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.create', {
          droneId: 'drone one',
          sourceChatName: 'default',
          queuedActionId: 'review-action',
        }),
      ).resolves.toMatchObject({ targetChatName: 'Untitled 2' });
      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/chats/default/pending/review-action/create-now',
          method: 'POST',
          body: '{}',
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('only opts chat creation into copy-config when the caller requests it', async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return Response.json({ ok: true, chats: ['default', 'clone'] });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('chat.create', {
        droneId: 'drone-1',
        name: 'clone',
        copyFrom: 'default',
      });
      await capability.invoke('chat.create', {
        droneId: 'drone-1',
        name: 'settings-only',
        copyFrom: 'default',
        mode: 'copy-config',
      });

      expect(bodies).toEqual([
        { name: 'clone', copyFrom: 'default' },
        { name: 'settings-only', copyFrom: 'default', mode: 'copy-config' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('routes mobile chat rename and delete through the desktop Hub APIs', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return Response.json({ ok: true, chats: ['default'] });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('chat.rename', {
        droneId: 'drone one',
        chatName: 'review notes',
        newName: 'final review',
      });
      await capability.invoke('chat.delete', {
        droneId: 'drone one',
        chatName: 'final review',
      });
      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/chats/review%20notes/rename',
          method: 'POST',
          body: '{"newName":"final review"}',
        },
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/chats/final%20review',
          method: 'DELETE',
          body: '',
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('loads a historical file diff through the existing chat read permission', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);
      return Response.json({
        ok: true,
        diff: {
          path: 'src/a.ts',
          patch: '+new line\n',
          truncated: false,
          owner: { droneId: 'drone-1', chatName: 'default', promptId: 'prompt-1' },
        },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.read', {
          droneId: 'drone-1',
          chatName: 'default',
          diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
          diffPath: 'src/a.ts',
        }),
      ).resolves.toMatchObject({
        diff: { path: 'src/a.ts', patch: '+new line\n', truncated: false },
      });
      expect(requestedPaths).toEqual([
        '/api/agent-run-diffs/018fdce7-6e20-7d31-a78c-3f95d665cc72/file?path=src%2Fa.ts',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('validates native historical diffs without opening the native session', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        path: `${url.pathname}${url.search}`,
        method: String(init?.method ?? 'GET'),
      });
      if (url.pathname.endsWith('/native')) {
        return Response.json({ ok: true, nativeChatId: 'native-chat-1' });
      }
      return Response.json({
        ok: true,
        diff: {
          path: 'src/a.ts',
          patch: '+new line\n',
          owner: { droneId: 'drone-1', threadId: 'native-chat-1', turnId: 'turn-1' },
        },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.read', {
          droneId: 'drone-1',
          chatName: 'default',
          diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
          diffPath: 'src/a.ts',
        }),
      ).resolves.toMatchObject({ diff: { patch: '+new line\n' } });
      expect(requests).toEqual([
        {
          path: '/api/agent-run-diffs/018fdce7-6e20-7d31-a78c-3f95d665cc72/file?path=src%2Fa.ts',
          method: 'GET',
        },
        { path: '/api/drones/drone-1/chats/default/native', method: 'GET' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('bounds historical diffs to a safe mobile response size', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        diff: {
          path: 'src/large.ts',
          patch: `+${'x'.repeat(300 * 1024)}\n`,
          truncated: false,
          owner: { droneId: 'drone-1', chatName: 'default', promptId: 'prompt-1' },
        },
      })) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const result: any = await capability.invoke('chat.read', {
        droneId: 'drone-1',
        chatName: 'default',
        diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
        diffPath: 'src/large.ts',
      });

      expect(result.diff.truncated).toBe(true);
      expect(Buffer.byteLength(result.diff.patch)).toBeLessThanOrEqual(80 * 1024);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(220 * 1024);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards permission-scoped pull request reads and actions', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      const url = String(input);
      const body = url.endsWith('/merge')
        ? { ok: true, number: 596, merged: true }
        : url.endsWith('/close')
          ? { ok: true, number: 596, state: 'closed' }
          : { ok: true, github: { owner: 'nerfzael', repo: 'drone' }, pullRequests: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('repo.pull-requests.read', {
        droneId: 'drone one',
        state: 'all',
      });
      await capability.invoke('repo.pull-requests.merge', {
        droneId: 'drone one',
        pullNumber: 596,
        method: 'squash',
      });
      await capability.invoke('repo.pull-requests.close', {
        droneId: 'drone one',
        pullNumber: 596,
      });

      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/repo/pull-requests?state=all',
          method: 'GET',
          body: '',
        },
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/repo/pull-requests/596/merge',
          method: 'POST',
          body: '{"method":"squash"}',
        },
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/repo/pull-requests/596/close',
          method: 'POST',
          body: '{}',
        },
      ]);
      await expect(
        capability.invoke('repo.pull-requests.merge', {
          droneId: 'drone one',
          pullNumber: 0,
        }),
      ).rejects.toThrow('pullNumber must be a positive integer');
      await expect(
        capability.invoke('repo.pull-requests.close', {
          droneId: 'drone one',
          pullNumber: true,
        }),
      ).rejects.toThrow('pullNumber must be a positive integer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('lists, mutates, and revision-safely writes files for mobile workspaces', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return Response.json(
        url.includes('/fs/list')
          ? {
              ok: true,
              path: '/work/repo',
              entries: [{ name: 'src', path: '/work/repo/src', kind: 'directory' }],
            }
          : { ok: true, path: '/work/repo/index.ts', size: 16, revision: 'sha256:next' },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const listResult: any = await capability.invoke('files.list', {
        droneId: 'one',
        path: '/work/repo',
      });
      expect(listResult).toMatchObject({ path: '/work/repo', entries: [{ name: 'src' }] });
      await expect(
        capability.invoke('file.action', {
          droneId: 'one',
          action: 'create-file',
          targetDir: '/work/repo',
          name: 'notes.txt',
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        capability.invoke('file.action', {
          droneId: 'one',
          action: 'delete',
          path: '/work/repo/notes.txt',
        }),
      ).rejects.toThrow('unsupported mobile filesystem action');
      await expect(
        capability.invoke('file.write', {
          droneId: 'one',
          path: '/work/repo/index.ts',
          content: 'export default 1',
          expectedRevision: 'sha256:old',
        }),
      ).resolves.toMatchObject({ revision: 'sha256:next' });
      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:7777/api/drones/one/fs/list?path=%2Fwork%2Frepo',
          method: 'GET',
          body: '',
        },
        {
          url: 'http://127.0.0.1:7777/api/drones/one/fs/action',
          method: 'POST',
          body: JSON.stringify({
            action: 'create-file',
            targetDir: '/work/repo',
            name: 'notes.txt',
          }),
        },
        {
          url: 'http://127.0.0.1:7777/api/drones/one/fs/file',
          method: 'POST',
          body: JSON.stringify({
            path: '/work/repo/index.ts',
            content: 'export default 1',
            expectedRevision: 'sha256:old',
          }),
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns a large directory listing in one bounded JSON response', async () => {
    const originalFetch = globalThis.fetch;
    let listRequests = 0;
    const entries = Array.from({ length: 3_000 }, (_, index) => ({
      name: `file-${index.toString().padStart(4, '0')}-${'x'.repeat(48)}.ts`,
      path: `/work/repo/file-${index.toString().padStart(4, '0')}-${'x'.repeat(48)}.ts`,
      kind: 'file',
    }));
    globalThis.fetch = (async () => {
      listRequests += 1;
      return Response.json({ ok: true, path: '/work/repo', entries });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const context = { sourceDevice: { id: 'phone-a' }, requestId: 'request-a' } as any;
      const first: any = await capability.invoke(
        'files.list',
        {
          droneId: 'one',
          path: '/work/repo',
          contentOffset: 0,
        },
        context,
      );
      expect(first).toMatchObject({ path: '/work/repo', entries });
      expect(listRequests).toBe(1);
      expect(Buffer.byteLength(JSON.stringify(first))).toBeGreaterThan(256 * 1024);
      expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(6 * 1024 * 1024);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('prevents directory reads from publishing after owner lifecycle cleanup', async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const lifecycle of ['revokeDevice', 'disconnectDevice', 'accessChanged'] as const) {
        let blocked = true;
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const didStart = new Promise<void>((resolve) => {
          started = resolve;
        });
        globalThis.fetch = (async () => {
          if (blocked) {
            started();
            await gate;
          }
          return Response.json({
            ok: true,
            path: '/work/repo',
            entries: Array.from({ length: 3_000 }, (_, index) => ({
              name: `file-${index}-${'x'.repeat(40)}`,
              path: `/work/repo/file-${index}-${'x'.repeat(40)}`,
              kind: 'file',
            })),
          });
        }) as typeof fetch;
        const capability = createDroneControlCapability({
          baseUrl: () => 'http://127.0.0.1:7777',
          apiToken: 'test',
        });
        const context = {
          sourceDevice: { id: 'phone-a' },
          requestId: `${lifecycle}-old`,
        } as any;
        const pending = capability.invoke(
          'files.list',
          { droneId: 'one', path: '/work/repo' },
          context,
        );
        await didStart;
        await capability[lifecycle]?.('phone-a');
        blocked = false;
        release();
        await expect(pending).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });

        await expect(
          capability.invoke('files.list', { droneId: 'one', path: '/work/repo' }, {
            sourceDevice: { id: 'phone-a' },
            requestId: `${lifecycle}-new`,
          } as any),
        ).resolves.toMatchObject({ entries: expect.any(Array) });
        capability.close?.();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns text as JSON and media as a scoped HTTP download without fetching binary data', async () => {
    const originalFetch = globalThis.fetch;
    const tickets: any[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith('/fs/file')).toBe(true);
      return Response.json(
        url.searchParams.get('path')?.endsWith('.md')
          ? {
              path: '/work/repo/README.md',
              kind: 'text',
              mime: 'text/markdown',
              size: 9,
              content: '# Preview',
              revision: 'sha256:text',
            }
          : {
              path: '/work/repo/demo.mp4',
              kind: 'video',
              mime: 'video/mp4',
              size: 300000,
              revision: 'sha256:video',
            },
      );
    }) as typeof fetch;
    const capability = createDroneControlCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      undefined,
      {
        transfers: {
          prepare: (...args: any[]) => {
            tickets.push(args);
            return { url: 'https://peer/content', token: 'secret' };
          },
        } as any,
      },
    );
    try {
      expect(
        await capability.invoke('file.preview', { droneId: 'one', path: '/work/repo/README.md' }),
      ).toMatchObject({
        content: { content: '# Preview', revision: 'sha256:text' },
      });
      expect(
        await capability.invoke('file.preview', { droneId: 'one', path: '/work/repo/demo.mp4' }, {
          sourceDevice: { id: 'phone' },
        } as any),
      ).toMatchObject({
        preview: { size: 300000, revision: 'sha256:video' },
        transfer: { url: 'https://peer/content', token: 'secret' },
      });
      expect(tickets[0][0]).toBe('phone');
      expect(tickets[0][1]).toContain('revision=sha256%3Avideo');
      expect(tickets[0][2]).toBe(300000);
      await expect(
        capability.invoke('file.preview', {
          droneId: 'one',
          path: '/work/repo/demo.mp4',
          expectedRevision: 'sha256:old',
        }),
      ).rejects.toMatchObject({ code: 'FILE_REVISION_MISMATCH' });
    } finally {
      capability.close?.();
      globalThis.fetch = originalFetch;
    }
  });

  test('revalidates authoritative media metadata before reserving or downloading bytes', async () => {
    const originalFetch = globalThis.fetch;
    let initial: any;
    let authoritative: any;
    let mediaBytes = Buffer.alloc(0);
    let mediaRequests = 0;
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/fs/file')) {
        return Response.json(url.searchParams.get('revision') === '0' ? initial : authoritative);
      }
      if (url.pathname.endsWith('/fs/media')) {
        mediaRequests += 1;
        return new Response(mediaBytes, {
          headers: { 'content-type': 'video/mp4', 'content-length': String(mediaBytes.length) },
        });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    }) as typeof fetch;
    const capability = createDroneControlCapability(
      {
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      },
      undefined,
      { transfers: { prepare: () => ({ url: 'https://peer/content', token: 'secret' }) } } as any,
    );
    const base = {
      ok: true,
      path: '/work/repo/demo.mp4',
      kind: 'video',
      mime: 'video/mp4',
      mtimeMs: 1,
    };
    try {
      initial = { ...base, size: 10, revision: null };
      authoritative = { ...base, size: 32 * 1024 * 1024 + 1, revision: 'sha256:grown' };
      await expect(
        capability.invoke('file.preview', { droneId: 'one', path: base.path }),
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
      expect(mediaRequests).toBe(0);

      initial = { ...base, size: 10, revision: null };
      authoritative = { ...base, size: 4, revision: 'sha256:smaller' };
      mediaBytes = Buffer.from([1, 2, 3, 4]);
      await expect(
        capability.invoke('file.preview', { droneId: 'one', path: base.path }),
      ).resolves.toMatchObject({ preview: { size: 4, revision: 'sha256:smaller' } });
      expect(mediaRequests).toBe(0);

      initial = { ...base, size: 4, revision: null };
      authoritative = { ...base, path: '/work/repo/other.mp4', size: 4, revision: 'sha256:moved' };
      await expect(
        capability.invoke('file.preview', { droneId: 'one', path: base.path }),
      ).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_READ' });
      authoritative = { ...base, kind: 'image', size: 4, revision: 'sha256:kind' };
      await expect(
        capability.invoke('file.preview', { droneId: 'one', path: base.path }),
      ).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_READ' });

      authoritative = { ...base, size: 4, revision: 'sha256:replacement' };
      await expect(
        capability.invoke('file.preview', {
          droneId: 'one',
          path: base.path,
          expectedRevision: 'sha256:old',
        }),
      ).rejects.toMatchObject({ code: 'FILE_REVISION_MISMATCH' });
      expect(mediaRequests).toBe(0);
    } finally {
      capability.close?.();
      globalThis.fetch = originalFetch;
    }
  });

  test('does not issue media tickets after revocation, disconnect, or access changes', async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const lifecycle of ['revokeDevice', 'disconnectDevice', 'accessChanged'] as const) {
        let release!: () => void;
        let started!: () => void;
        let tickets = 0;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        globalThis.fetch = (async () => {
          started();
          await gate;
          return Response.json({
            path: '/work/video.mp4',
            kind: 'video',
            mime: 'video/mp4',
            size: 10,
            revision: 'sha256:video',
          });
        }) as typeof fetch;
        const capability = createDroneControlCapability(
          { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
          undefined,
          {
            transfers: {
              prepare: () => {
                tickets++;
                return {};
              },
            },
          } as any,
        );
        try {
          const pending = capability.invoke(
            'file.preview',
            { droneId: 'one', path: '/work/video.mp4' },
            { sourceDevice: { id: 'phone' } } as any,
          );
          const settled = pending.then(
            () => null,
            (error: unknown) => error,
          );
          await ready;
          await capability[lifecycle]?.('phone');
          release();
          expect(await settled).toBeInstanceOf(Error);
          expect(tickets).toBe(0);
        } finally {
          capability.close?.();
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('broadcasts hash changes for files watched by a mobile device', async () => {
    const originalFetch = globalThis.fetch;
    let revision = 'sha256:first';
    let mtimeMs = 100;
    const events: Array<{ payload: Record<string, any>; targetDeviceIds: string[] }> = [];
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        path: '/work/repo/live.md',
        kind: 'text',
        mime: 'text/markdown',
        size: 8,
        mtimeMs,
        revision,
      })) as typeof fetch;
    const capability = createDroneControlCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      undefined,
      {
        broadcastFileChange: (payload, targetDeviceIds) =>
          events.push({ payload, targetDeviceIds }),
      },
    );
    const context = { sourceDevice: { id: 'phone-1' }, requestId: 'request-1' } as any;
    try {
      await capability.invoke(
        'file.preview',
        {
          droneId: 'one',
          path: '/work/repo/live.md',
          watch: 'subscribe',
          watchId: 'watch-a',
        },
        context,
      );
      await capability.invoke(
        'file.preview',
        {
          droneId: 'one',
          path: '/work/repo/live.md',
          watch: 'subscribe',
          watchId: 'watch-b',
        },
        context,
      );
      await capability.invoke(
        'file.preview',
        {
          droneId: 'one',
          path: '/work/repo/live.md',
          watch: 'unsubscribe',
          watchId: 'watch-a',
        },
        context,
      );
      revision = 'sha256:second';
      mtimeMs = 200;
      await Bun.sleep(2_100);
      expect(events).toEqual([
        {
          payload: expect.objectContaining({
            droneId: 'one',
            path: '/work/repo/live.md',
            revision: 'sha256:second',
            kind: 'changed',
          }),
          targetDeviceIds: ['phone-1'],
        },
      ]);
      await capability.invoke(
        'file.preview',
        {
          droneId: 'one',
          path: '/work/repo/live.md',
          watch: 'unsubscribe',
          watchId: 'watch-b',
        },
        context,
      );
    } finally {
      await capability.close?.();
      globalThis.fetch = originalFetch;
    }
  });
});
