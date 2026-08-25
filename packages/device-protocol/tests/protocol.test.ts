import { describe, expect, test } from 'bun:test';
import {
  canonicalJson,
  COMPANION_CAPABILITY,
  DRONE_CONTROL_CAPABILITY,
  isGranted,
  pairingClaimSigningText,
  parsePairingPayload,
  parseSidebarMoveCommandRequest,
  PROVIDER_CREDENTIALS_CAPABILITY,
  runWorkspaceCommandJob,
} from '../src';

describe('device protocol', () => {
  test('canonical JSON is stable across key order', () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: false } })).toBe(
      canonicalJson({ nested: { a: false, b: true }, z: 1 }),
    );
  });

  test('default membership only permits discovery', () => {
    expect(isGranted([], 'device-core', 1, 'devices.list')).toBe(true);
    expect(isGranted([], 'drone-control', 1, 'drones.list')).toBe(false);
    expect(isGranted([], 'provider-credentials', 1, 'openai.export')).toBe(false);
  });

  test('advertises GROQ credential export as an explicit permission', () => {
    expect(PROVIDER_CREDENTIALS_CAPABILITY.operations).toContain('groq.export');
    expect(
      isGranted(
        [
          {
            capability: 'provider-credentials',
            version: 1,
            operations: ['groq.export'],
          },
        ],
        'provider-credentials',
        1,
        'groq.export',
      ),
    ).toBe(true);
  });

  test('advertises Companion run controls as explicit permissions', () => {
    expect(COMPANION_CAPABILITY.operations).toEqual(['run.start', 'run.cancel', 'tool.result']);
    expect(isGranted([], COMPANION_CAPABILITY.id, COMPANION_CAPABILITY.version, 'run.start')).toBe(
      false,
    );
  });

  test('advertises pull request reads and writes as separate permissions', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toEqual(
      expect.arrayContaining([
        'repo.pull-requests.read',
        'repo.pull-requests.merge',
        'repo.pull-requests.close',
      ]),
    );
    expect(
      isGranted(
        [
          {
            capability: 'drone-control',
            version: 1,
            operations: ['repo.pull-requests.read'],
          },
        ],
        'drone-control',
        1,
        'repo.pull-requests.merge',
      ),
    ).toBe(false);
  });

  test('advertises file workspace operations as explicit drone permissions', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toEqual(
      expect.arrayContaining(['files.list', 'file.preview', 'file.write', 'file.action']),
    );
    expect(
      isGranted(
        [{ capability: 'drone-control', version: 1, operations: ['chat.read'] }],
        'drone-control',
        1,
        'file.preview',
      ),
    ).toBe(false);
    expect(
      isGranted(
        [{ capability: 'drone-control', version: 1, operations: ['file.preview'] }],
        'drone-control',
        1,
        'files.list',
      ),
    ).toBe(false);
    expect(
      isGranted(
        [{ capability: 'drone-control', version: 1, operations: ['file.preview'] }],
        'drone-control',
        1,
        'file.write',
      ),
    ).toBe(false);
    expect(
      isGranted(
        [{ capability: 'drone-control', version: 1, operations: ['file.write'] }],
        'drone-control',
        1,
        'file.action',
      ),
    ).toBe(false);
  });

  test('advertises drone rename as an explicit permission', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toContain('drone.rename');
  });

  test('advertises proposal group actions as separate explicit permissions', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toEqual(
      expect.arrayContaining(['groups.list', 'group.create', 'group.rename', 'group.delete']),
    );
    expect(
      isGranted(
        [{ capability: 'drone-control', version: 1, operations: ['group.create'] }],
        'drone-control',
        1,
        'group.delete',
      ),
    ).toBe(false);
  });

  test('advertises sidebar ordering as an explicit permission', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toContain('sidebar.move');
  });

  test('validates sidebar commands at the protocol boundary', () => {
    expect(
      parseSidebarMoveCommandRequest({
        mutationId: 'move-1',
        intent: {
          kind: 'chat',
          droneId: ' host ',
          chatNames: ['default', 'review', 'review'],
          activeChatName: 'review',
          overChatName: 'default',
          placement: 'before',
        },
      }),
    ).toEqual({
      mutationId: 'move-1',
      intent: {
        kind: 'chat',
        droneId: 'host',
        chatNames: ['default', 'review'],
        activeChatName: 'review',
        overChatName: 'default',
        placement: 'before',
      },
    });
    expect(
      parseSidebarMoveCommandRequest({
        mutationId: 'chat-tree-1',
        intent: {
          kind: 'chat-tree-move',
          droneId: ' host ',
          itemKind: 'chat',
          activeNodeId: 'chat:host:review',
          activeNodeIds: ['chat:host:review', 'chat:host:notes', 'chat:host:review'],
          sourcePath: null,
          sourceSiblingNodeIds: ['chat:host:review', 'chat:host:notes'],
          targetPath: ' Work ',
          targetSiblingNodeIds: [],
          placement: 'inside',
        },
      }),
    ).toEqual({
      mutationId: 'chat-tree-1',
      intent: {
        kind: 'chat-tree-move',
        droneId: 'host',
        itemKind: 'chat',
        activeNodeId: 'chat:host:review',
        activeNodeIds: ['chat:host:review', 'chat:host:notes'],
        sourcePath: null,
        sourceSiblingNodeIds: ['chat:host:review', 'chat:host:notes'],
        targetPath: 'Work',
        targetSiblingNodeIds: [],
        placement: 'inside',
      },
    });
    expect(
      parseSidebarMoveCommandRequest({
        mutationId: 'chat-group-1',
        intent: {
          kind: 'chat-group-rename',
          droneId: 'host',
          path: 'Work',
          newPath: 'Projects',
        },
      }),
    ).toMatchObject({
      intent: { kind: 'chat-group-rename', path: 'Work', newPath: 'Projects' },
    });
    expect(
      parseSidebarMoveCommandRequest({
        mutationId: 'chat-remove-1',
        intent: {
          kind: 'chat-tree-remove',
          droneId: 'host',
          nodeIds: ['chat:host:old', 'chat:host:old'],
        },
      }),
    ).toMatchObject({
      intent: { kind: 'chat-tree-remove', nodeIds: ['chat:host:old'] },
    });
    expect(() =>
      parseSidebarMoveCommandRequest({
        mutationId: 'move-2',
        intent: {
          kind: 'move-into-folder',
          itemKind: 'folder',
          repoPath: '/repo',
          sourceGroup: 'Review',
          sourceNodeId: 'folder:Review',
          sourceParentId: 'root',
          sourceSiblingNodeIds: [],
          targetGroup: null,
          targetParentId: 'folder:Review',
          targetSiblingNodeIds: [],
          placement: 'sideways',
        },
      }),
    ).toThrow('placement');
    expect(
      parseSidebarMoveCommandRequest({
        mutationId: 'move-folder-id',
        intent: {
          kind: 'move-into-folder',
          itemKind: 'folder',
          repoPath: '/repo',
          sourceGroupId: ' group-id ',
          sourceGroup: 'Review',
          sourceNodeId: 'folder:Review',
          sourceParentId: 'root',
          sourceSiblingNodeIds: ['folder:Review'],
          targetGroup: 'Done',
          targetParentId: 'folder:Done',
          targetSiblingNodeIds: [],
          placement: 'inside',
        },
      }),
    ).toMatchObject({
      intent: {
        itemKind: 'folder',
        sourceGroupId: 'group-id',
        sourceGroup: 'Review',
      },
    });
    expect(() =>
      parseSidebarMoveCommandRequest({
        mutationId: 'move-3',
        intent: {
          kind: 'move-into-folder',
          itemKind: 'drone',
          repoPath: '/repo',
          droneId: 'host',
          sourceParentId: 'root',
          sourceSiblingNodeIds: ['drone:host'],
          targetGroup: 42,
          targetParentId: 'root',
          targetSiblingNodeIds: [],
        },
      }),
    ).toThrow('targetGroup');
    expect(() =>
      parseSidebarMoveCommandRequest({
        mutationId: 'move-invalid-drone-id',
        intent: {
          kind: 'move-into-folder',
          itemKind: 'drone',
          repoPath: '/repo',
          droneId: 'host',
          droneIds: ['x'.repeat(129)],
          sourceParentId: 'root',
          sourceSiblingNodeIds: ['drone:host'],
          targetGroup: 'Review',
          targetParentId: 'folder:Review',
          targetSiblingNodeIds: [],
        },
      }),
    ).toThrow('invalid drone id');
    expect(
      parseSidebarMoveCommandRequest({
        mutationId: 'pin-1',
        intent: {
          kind: 'set-pinned',
          droneIds: [' alpha ', 'alpha', 'bravo'],
          pinned: true,
        },
      }),
    ).toEqual({
      mutationId: 'pin-1',
      intent: {
        kind: 'set-pinned',
        droneIds: ['alpha', 'bravo'],
        pinned: true,
      },
    });
    expect(
      parseSidebarMoveCommandRequest({
        mutationId: 'mute-1',
        intent: {
          kind: 'set-muted',
          targetKind: 'chat',
          targetId: ' chat:alpha:review ',
          muted: true,
        },
      }),
    ).toEqual({
      mutationId: 'mute-1',
      intent: {
        kind: 'set-muted',
        targetKind: 'chat',
        targetId: 'chat:alpha:review',
        muted: true,
      },
    });
  });

  test('advertises chat rename and delete as explicit permissions', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toEqual(
      expect.arrayContaining(['chat.rename', 'chat.delete']),
    );
  });

  test('advertises structured question resolution as an explicit chat permission', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toContain('chat.questions.resolve');
    expect(
      isGranted(
        [{ capability: 'drone-control', version: 1, operations: ['chat.read'] }],
        'drone-control',
        1,
        'chat.questions.resolve',
      ),
    ).toBe(false);
  });

  test('public pairing endpoints require a safe HTTPS origin', () => {
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'http://example.com',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'ftp://localhost:8791',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'https://example.com/private/path',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('origin');
  });

  test('pairing identity proofs canonicalize public identity and endpoint details', () => {
    const claim = {
      token: 'pairing-token',
      claimSecret: 'claim-secret',
      inviterDeviceId: 'device_desktop',
      endpoint: 'https://desktop.example.test/',
      expiresAt: '2026-07-16T18:00:00.000Z',
      device: {
        id: 'device_phone',
        name: 'Phone',
        platform: 'android' as const,
        publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      },
    };
    expect(pairingClaimSigningText(claim)).toBe(
      pairingClaimSigningText({
        ...claim,
        endpoint: 'https://desktop.example.test',
        device: {
          ...claim.device,
          publicKey: {
            ...claim.device.publicKey,
            ext: true,
            key_ops: ['verify'],
          },
          ignoredBySigningText: true,
        },
      }),
    );
  });

  test('consumes asynchronous command output until the job completes', async () => {
    let outputCall = 0;
    const updates: string[] = [];
    const result = await runWorkspaceCommandJob({
      workspaceId: 'main',
      command: 'yarn build',
      request: async (operation) => {
        if (operation === 'commands.start')
          return { jobId: 'command_1', workspaceId: 'main', status: 'running' };
        outputCall += 1;
        return {
          jobId: 'command_1',
          workspaceId: 'main',
          status: outputCall === 1 ? 'running' : 'completed',
          cursor: outputCall,
          chunks: [
            {
              cursor: outputCall - 1,
              stream: 'stdout',
              text: outputCall === 1 ? 'building\n' : 'done\n',
            },
          ],
        };
      },
      onOutput: (update) => updates.push(update.text),
    });
    expect(result.text).toBe('status: completed\n\nbuilding\ndone\n');
    expect(updates).toEqual(['building\n', 'building\ndone\n']);
  });

  test('cancels the destination command job when its caller aborts', async () => {
    const controller = new AbortController();
    const operations: string[] = [];
    await expect(
      runWorkspaceCommandJob({
        workspaceId: 'main',
        command: 'yarn build',
        signal: controller.signal,
        request: async (operation) => {
          operations.push(operation);
          if (operation === 'commands.start')
            return { jobId: 'command_2', workspaceId: 'main', status: 'running' };
          if (operation === 'commands.output') {
            controller.abort();
            throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
          }
          return { status: 'cancelled' };
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(operations).toContain('commands.cancel');
  });
});
