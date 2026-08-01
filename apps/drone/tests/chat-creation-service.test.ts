import { describe, expect, test } from 'bun:test';
import { createDroneChatCreator } from '../src/hub/chat-creation-service';

describe('queued chat creation', () => {
  test('reuses its owned chat on retry and selects native setup from the creation mode', async () => {
    const chats = new Map<string, any>([
      ['default', { id: 'source-native', agent: { kind: 'native' }, model: 'gpt-test' }],
    ]);
    const configurationCopyCalls: any[] = [];
    const clonedNativeCalls: any[] = [];
    let projectionCalls = 0;
    const createDroneChat = createDroneChatCreator({
      buildNewChatEntry: ({ createdAt, sourceChatEntry }) => ({
        ...(sourceChatEntry ?? {}),
        id: sourceChatEntry ? 'target-native' : 'generated-native',
        createdAt,
      }),
      cloneNativeChatSession: async (input) => void clonedNativeCalls.push(input),
      copyNativeChatConfiguration: async (input) => void configurationCopyCalls.push(input),
      createChatInStore: async ({ chatName, copyFromChatName, createEntry }) => {
        if (chats.has(chatName)) throw new Error(`chat already exists: ${chatName}`);
        const created = createEntry(copyFromChatName ? chats.get(copyFromChatName) : null);
        chats.set(chatName, created);
        return { chat: created, chats: [...chats.keys()] };
      },
      getChatEntry: async ({ chatName }) => ({ chat: chats.get(chatName) }),
      importDroneChatsFromRegistry: async () => {},
      inferChatAgent: (chat) => chat.agent ?? { kind: 'builtin' },
      listChatsFromStore: () => ({ chats: [...chats.keys()] }),
      nowIso: () => '2026-08-01T10:00:00.000Z',
      projectCanonicalChatsToRegistry: async () => void (projectionCalls += 1),
      readChatFromStore: ({ chatName }) => ({
        available: true,
        chat: chats.get(chatName) ?? null,
      }),
    });
    const input = {
      droneId: 'alpha',
      droneEntry: {},
      chatName: 'Untitled 1',
      creationMode: 'copy-config' as const,
      sourceChatName: 'default',
      queuedOrigin: {
        sourceChatName: 'default',
        sourceChatId: 'source-native',
        actionId: 'review-action',
      },
    };

    expect((await createDroneChat(input)).created).toBe(true);
    expect((await createDroneChat(input)).created).toBe(false);
    expect(configurationCopyCalls).toHaveLength(2);
    expect(clonedNativeCalls).toHaveLength(0);
    expect(projectionCalls).toBe(2);
    expect(chats.get('Untitled 1')).toMatchObject({
      queuedChatOrigin: {
        sourceChatName: 'default',
        sourceChatId: 'source-native',
        actionId: 'review-action',
      },
    });

    chats.set('renamed-source', chats.get('default'));
    expect(
      (
        await createDroneChat({
          ...input,
          sourceChatName: 'renamed-source',
          queuedOrigin: {
            sourceChatName: 'renamed-source',
            sourceChatId: 'source-native',
            actionId: 'review-action',
          },
        })
      ).created,
    ).toBe(false);
    expect(chats.has('Untitled 2')).toBe(false);

    expect(
      (
        await createDroneChat({
          droneId: 'alpha',
          droneEntry: {},
          chatName: 'History clone',
          creationMode: 'clone-history',
          sourceChatName: 'default',
        })
      ).created,
    ).toBe(true);
    expect(clonedNativeCalls).toHaveLength(1);
    expect(configurationCopyCalls).toHaveLength(3);

    await expect(
      createDroneChat({
        droneId: 'alpha',
        droneEntry: {},
        chatName: 'Invalid empty chat',
        creationMode: 'empty',
        sourceChatName: 'default',
      }),
    ).rejects.toThrow('empty chat creation cannot specify a source chat');

    await expect(
      createDroneChat({
        droneId: 'alpha',
        droneEntry: {},
        chatName: 'Missing source',
        creationMode: 'copy-config',
      }),
    ).rejects.toThrow('copy-config chat creation requires a source chat');

    await expect(
      createDroneChat({
        droneId: 'alpha',
        droneEntry: {},
        chatName: 'Invalid mode',
        creationMode: 'copy-everything',
        sourceChatName: 'default',
      } as any),
    ).rejects.toThrow('unsupported chat creation mode');

    await expect(
      createDroneChat({
        ...input,
        queuedOrigin: {
          sourceChatName: 'another-source',
          sourceChatId: 'another-source-id',
          actionId: 'review-action',
        },
      }),
    ).rejects.toThrow('chat already exists');

    await expect(
      createDroneChat({
        ...input,
        queuedOrigin: {
          sourceChatName: 'default',
          sourceChatId: 'source-native',
          actionId: 'different-action',
        },
      }),
    ).rejects.toThrow('chat already exists');
  });
});
