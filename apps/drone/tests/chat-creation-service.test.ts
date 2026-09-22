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
      deleteChatFromStore: async ({ chatName }) => chats.delete(chatName),
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

  test('clones builtin history, cuts running sources at a checkpoint, and rejects custom agents', async () => {
    const chats = new Map<string, any>([
      [
        'default',
        {
          id: 'source-chat',
          agent: { kind: 'builtin', id: 'claude' },
          claudeSessionId: 'source-session',
          turns: [{ id: 'completed-prompt', prompt: 'hello', output: 'hi' }],
          pendingPrompts: [{ id: 'completed-prompt', state: 'sent' }],
        },
      ],
    ]);
    let failNativeClone = false;
    let nativeCheckpointError: string | null = null;
    const createDroneChat = createDroneChatCreator({
      captureNativeChatCheckpoint: async () => {
        if (nativeCheckpointError) throw new Error(nativeCheckpointError);
        return 'native-answer-1';
      },
      buildNewChatEntry: ({ createdAt, sourceChatEntry }) => ({
        id: 'new-chat',
        createdAt,
        agent: sourceChatEntry?.agent ?? { kind: 'native' },
      }),
      cloneNativeChatSession: async () => {
        if (failNativeClone) throw new Error('native fork failed');
      },
      copyNativeChatConfiguration: async () => {},
      createChatInStore: async ({ chatName, copyFromChatName, createEntry }) => {
        const created = createEntry(copyFromChatName ? chats.get(copyFromChatName) : null);
        chats.set(chatName, created);
        return { chat: created, chats: [...chats.keys()] };
      },
      deleteChatFromStore: async ({ chatName }) => chats.delete(chatName),
      getChatEntry: async ({ chatName }) => ({ chat: chats.get(chatName) }),
      importDroneChatsFromRegistry: async () => {},
      inferChatAgent: (chat) => chat.agent,
      listChatsFromStore: () => ({ chats: [...chats.keys()] }),
      nowIso: () => '2026-08-01T10:00:00.000Z',
      projectCanonicalChatsToRegistry: async () => {},
      readChatFromStore: ({ chatName }) => ({ available: true, chat: chats.get(chatName) ?? null }),
    });

    await createDroneChat({
      droneId: 'alpha',
      droneEntry: {},
      chatName: 'Forked',
      creationMode: 'clone-history',
      sourceChatName: 'default',
    });
    expect(chats.get('Forked')).toMatchObject({
      turns: [{ id: 'completed-prompt', inheritedFromClone: true }],
      chatForkOrigin: {
        agentId: 'claude',
        sourceSessionId: 'source-session',
        state: 'pending',
      },
    });

    chats.get('default').pendingPrompts = [
      { id: 'completed-prompt', state: 'queued' },
      { id: '', state: 'sending' },
    ];
    await createDroneChat({
      droneId: 'alpha',
      droneEntry: {},
      chatName: 'Forked with stale rows',
      creationMode: 'clone-history',
      sourceChatName: 'default',
    });
    expect(chats.has('Forked with stale rows')).toBe(true);

    expect(chats.get('Forked').cloneOrigin).toEqual({
      sourceChatName: 'default',
      sourceChatId: 'source-chat',
    });
    expect(chats.get('Forked').visibility).toBeUndefined();

    // An idle clone also ends at the last completed answer, leaving a failed tail behind.
    chats.get('default').turns = [
      {
        id: 'answer-1',
        ok: true,
        prompt: 'hello',
        output: 'hi',
        providerCheckpoint: { agentId: 'claude', sessionId: 'source-session', messageId: 'message-1' },
      },
      { id: 'failed-tail', ok: false, prompt: 'deploy it', error: 'crashed' },
    ];
    await createDroneChat({
      droneId: 'alpha',
      droneEntry: {},
      chatName: 'Idle cut',
      creationMode: 'clone-history',
      sourceChatName: 'default',
    });
    expect(chats.get('Idle cut').turns.map((turn: any) => turn.id)).toEqual(['answer-1']);
    expect(chats.get('Idle cut').visibility).toBeUndefined();
    expect(chats.get('Idle cut').cloneOrigin).toMatchObject({ checkpointId: 'answer-1' });

    // Where no checkpoint is possible, an idle chat is still cloned, whole.
    chats.set('idle-other-agent', {
      id: 'idle-other-chat',
      agent: { kind: 'builtin', id: 'gemini' },
      turns: [
        { id: 'answer-1', ok: true, prompt: 'hello', output: 'hi' },
        { id: 'failed-tail', ok: false, prompt: 'deploy it', error: 'crashed' },
      ],
    });
    await createDroneChat({
      droneId: 'alpha',
      droneEntry: {},
      chatName: 'Idle whole',
      creationMode: 'clone-history',
      sourceChatName: 'idle-other-agent',
    });
    expect(chats.get('Idle whole').turns.map((turn: any) => turn.id)).toEqual(['answer-1', 'failed-tail']);
    expect(chats.get('Idle whole').cloneOrigin).toEqual({
      sourceChatName: 'idle-other-agent',
      sourceChatId: 'idle-other-chat',
    });

    // A running source is cloned at its last completed answer and still lands in the sidebar.
    chats.get('default').turns = [
      {
        id: 'answer-1',
        ok: true,
        prompt: 'hello',
        output: 'hi',
        providerCheckpoint: { agentId: 'claude', sessionId: 'source-session', messageId: 'message-1' },
      },
      { id: 'in-flight', prompt: 'still working' },
    ];
    chats.get('default').pendingPrompts.push({ id: 'active-prompt', state: 'queued' });
    await createDroneChat({
      droneId: 'alpha',
      droneEntry: {},
      chatName: 'Busy fork',
      creationMode: 'clone-history',
      sourceChatName: 'default',
    });
    expect(chats.get('Busy fork').turns.map((turn: any) => turn.id)).toEqual(['answer-1']);
    expect(chats.get('Busy fork').visibility).toBeUndefined();
    expect(chats.get('Busy fork').sideChatOrigin).toBeUndefined();
    expect(chats.get('Busy fork').cloneOrigin).toEqual({
      sourceChatName: 'default',
      sourceChatId: 'source-chat',
      checkpointId: 'answer-1',
    });

    // The same request as a side chat differs only in where it shows up.
    await createDroneChat({
      droneId: 'alpha',
      droneEntry: {},
      chatName: 'Busy side',
      creationMode: 'clone-history',
      sourceChatName: 'default',
      sideChat: true,
    });
    expect(chats.get('Busy side').turns).toEqual(chats.get('Busy fork').turns);
    expect(chats.get('Busy side').visibility).toBe('side-chat');
    expect(chats.get('Busy side').cloneOrigin).toEqual(chats.get('Busy fork').cloneOrigin);

    chats.set('other-agent', {
      id: 'other-chat',
      agent: { kind: 'builtin', id: 'gemini' },
      turns: [{ id: 'answer-1', ok: true, prompt: 'hello', output: 'hi' }],
      pendingPrompts: [{ id: 'active-prompt', state: 'queued' }],
    });
    await expect(
      createDroneChat({
        droneId: 'alpha',
        droneEntry: {},
        chatName: 'Busy unsupported',
        creationMode: 'clone-history',
        sourceChatName: 'other-agent',
      }),
    ).rejects.toThrow('Stop this chat before cloning it');
    expect(chats.has('Busy unsupported')).toBe(false);

    chats.set('custom', { id: 'custom-chat', agent: { kind: 'custom', id: 'custom' } });
    await expect(
      createDroneChat({
        droneId: 'alpha',
        droneEntry: {},
        chatName: 'Custom fork',
        creationMode: 'clone-history',
        sourceChatName: 'custom',
      }),
    ).rejects.toThrow('not supported for custom agents');
    expect(chats.has('Custom fork')).toBe(false);

    // An idle native clone takes the checkpoint when there is one, copies whole
    // when there is no completed answer, and surfaces a broken runtime.
    chats.set('native', { id: 'native-source', agent: { kind: 'native' }, turns: [] });
    await createDroneChat({ droneId: 'alpha', droneEntry: {}, chatName: 'Native cut', creationMode: 'clone-history', sourceChatName: 'native' });
    expect(chats.get('Native cut').cloneOrigin).toMatchObject({ checkpointId: 'native-answer-1' });
    nativeCheckpointError = 'No completed assistant answer to branch from yet';
    await createDroneChat({ droneId: 'alpha', droneEntry: {}, chatName: 'Native whole', creationMode: 'clone-history', sourceChatName: 'native' });
    expect(chats.get('Native whole').cloneOrigin).toEqual({ sourceChatName: 'native', sourceChatId: 'native-source' });
    nativeCheckpointError = 'assistant runtime is not running';
    await expect(
      createDroneChat({ droneId: 'alpha', droneEntry: {}, chatName: 'Native broken', creationMode: 'clone-history', sourceChatName: 'native' }),
    ).rejects.toThrow('assistant runtime is not running');
    expect(chats.has('Native broken')).toBe(false);
    nativeCheckpointError = null;

    failNativeClone = true;
    await expect(
      createDroneChat({
        droneId: 'alpha',
        droneEntry: {},
        chatName: 'Failed native fork',
        creationMode: 'clone-history',
        sourceChatName: 'native',
      }),
    ).rejects.toThrow('native fork failed');
    expect(chats.has('Failed native fork')).toBe(false);
  });
});
