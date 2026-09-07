import { describe, expect, test } from 'bun:test';
import {
  createDroneChatCreator,
  type DroneChatCreationDependencies,
} from '../src/hub/chat-creation-service';
import { completedChatCheckpoint } from '../src/hub/side-chat-checkpoint';
import { partitionWorkflowChatEntries } from '../src/hub/workflows/workflow-chat-metadata';
import { readChatFromStore, upsertChatInStore } from '../src/hub/transcript-store';
import { withTempDroneDataDir } from './test-helpers';

describe('side chat checkpoints', () => {
  test('honors the checkpoint captured by the client even when a newer answer has arrived', () => {
    const source = {
      turns: [
        {
          id: 'clicked-answer',
          ok: true,
          output: 'visible when R was pressed',
          codexTurnId: 'turn-1',
        },
        {
          id: 'later-answer',
          ok: true,
          output: 'finished during the request',
          codexTurnId: 'turn-2',
        },
      ],
    };
    expect(completedChatCheckpoint(source, 'clicked-answer').turns).toHaveLength(1);
    expect(completedChatCheckpoint(source, 'clicked-answer').codexTurnId).toBe('turn-1');
    expect(() => completedChatCheckpoint(source, 'missing-answer')).toThrow('no longer available');
  });
  test('persists hidden visibility, provenance, and provider checkpoint IDs', async () => {
    await withTempDroneDataDir('side-chat-persistence-', async () => {
      await upsertChatInStore({
        droneId: 'drone',
        chatName: 'side',
        chatEntry: {
          id: 'side-id',
          visibility: 'side-chat',
          sideChatOrigin: { sourceChatName: 'main', checkpointId: 'answer-1' },
          chatForkOrigin: {
            version: 1,
            state: 'pending',
            agentId: 'codex',
            sourceSessionId: 'source',
            lastTurnId: 'turn-1',
          },
          turns: [
            {
              id: 'answer-1',
              at: '2026-09-07T10:00:00Z',
              prompt: 'hello',
              output: 'answer',
              ok: true,
              codexTurnId: 'turn-1',
            },
          ],
        },
      });
      const stored = readChatFromStore({ droneId: 'drone', chatName: 'side' }).chat as any;
      expect(stored).toMatchObject({
        visibility: 'side-chat',
        sideChatOrigin: { checkpointId: 'answer-1' },
        chatForkOrigin: { lastTurnId: 'turn-1' },
      });
      expect(stored.turns[0].codexTurnId).toBe('turn-1');
    });
  });
  test('copies an inclusive completed checkpoint without the live tail', () => {
    const source = {
      turns: [
        {
          id: 'one',
          ok: true,
          output: 'answer',
          codexTurnId: 'turn-1',
          activity: { tools: ['read'] },
        },
        { id: 'two', userOnly: true, ok: true, output: '' },
        { id: 'three', ok: false, output: 'interrupted reasoning' },
      ],
      pendingPrompts: [{ id: 'running', state: 'running' }],
    };
    const captured = completedChatCheckpoint(source);
    source.turns[0].activity!.tools.push('later');
    expect(captured).toEqual({
      checkpointId: 'one',
      codexTurnId: 'turn-1',
      turns: [
        {
          id: 'one',
          ok: true,
          output: 'answer',
          codexTurnId: 'turn-1',
          activity: { tools: ['read'] },
        },
      ],
    });
  });

  test('does not treat a queued input or failed response as a checkpoint', () => {
    expect(() =>
      completedChatCheckpoint({ turns: [{ id: 'one', ok: false, output: 'partial' }] }),
    ).toThrow('No completed');
    expect(() => completedChatCheckpoint({ pendingPrompts: [{ state: 'running' }] })).toThrow(
      'No completed',
    );
  });

  test('keeps side chats out of ordinary and workflow chat lists', () => {
    expect(
      partitionWorkflowChatEntries({
        main: {},
        task: { visibility: 'workflow' },
        side: { visibility: 'side-chat' },
      }),
    ).toEqual({ chats: ['main'], workflowChats: ['task'] });
  });

  test('allows a busy Codex source and pins both its transcript and native fork', async () => {
    const harness = creatorHarness('codex');
    const result = await harness.create();
    expect(result.chat.visibility).toBe('side-chat');
    expect(result.chat.sideChatOrigin).toEqual({
      sourceChatName: 'main',
      checkpointId: 'answer-1',
    });
    expect(result.chat.chatForkOrigin).toMatchObject({
      sourceSessionId: 'codex-source',
      lastTurnId: 'turn-1',
      lastMessageId: 'answer-1',
    });
    expect(result.chat.turns.map((turn: any) => turn.id)).toEqual(['answer-1']);
    expect(result.chat.pendingPrompts).toBeUndefined();
    expect(harness.source.pendingPrompts).toHaveLength(1);
  });

  test('rejects unsupported providers without creating a chat', async () => {
    const harness = creatorHarness('cursor');
    await expect(harness.create()).rejects.toThrow('currently supported');
    expect(harness.chats.has('side')).toBe(false);
  });

  test('rolls back a hidden chat if registry projection fails', async () => {
    const harness = creatorHarness('codex', {
      projectCanonicalChatsToRegistry: async () => {
        throw new Error('projection failed');
      },
    });
    await expect(harness.create()).rejects.toThrow('projection failed');
    expect(harness.chats.has('side')).toBe(false);
    expect(harness.chats.has('main')).toBe(true);
  });

  test('uses the captured native source even if its name now resolves to a different chat', async () => {
    const calls: any[] = [];
    const harness = creatorHarness('native', {
      getChatEntry: async ({ chatName }) => ({
        chat:
          chatName === 'main'
            ? { id: 'replacement', agent: { kind: 'builtin', id: 'codex' } }
            : { id: 'target-id' },
      }),
      cloneNativeChatSession: async (input) => {
        calls.push(input);
      },
    });
    await harness.create();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ sourceId: 'source-id', checkpointId: 'native-answer-1' });
  });

  for (const agentId of ['claude', 'opencode'] as const) {
    test(`pins a busy ${agentId} fork to its provider UUID and original session`, async () => {
      const harness = creatorHarness(agentId);
      const providerCheckpoint = {
        agentId,
        sessionId: 'original-provider-session',
        messageId: 'native-answer-id',
      };
      Object.assign(harness.source.turns[0], { providerCheckpoint });
      const result = await harness.create();
      expect(result.chat.chatForkOrigin).toMatchObject({
        agentId,
        sourceSessionId: providerCheckpoint.sessionId,
        lastMessageId: providerCheckpoint.messageId,
      });
      expect(result.chat.turns).toHaveLength(1);
      expect(result.chat.turns[0].providerCheckpoint).toEqual(providerCheckpoint);
      expect(harness.source.pendingPrompts).toHaveLength(1);
    });

    test(`rejects historical ${agentId} answers without native IDs rather than cloning the live tail`, async () => {
      const harness = creatorHarness(agentId);
      await expect(harness.create()).rejects.toThrow('no provider checkpoint ID');
      expect(harness.chats.has('side')).toBe(false);
    });

    test(`persists ${agentId} checkpoints on inherited turns`, async () => {
      await withTempDroneDataDir('provider-checkpoint-persistence-', async () => {
        const providerCheckpoint = {
          agentId,
          sessionId: 'original-session',
          messageId: 'original-message',
        };
        await upsertChatInStore({
          droneId: 'drone',
          chatName: 'side',
          chatEntry: {
            turns: [
              {
                id: 'answer',
                at: '2026-09-07T10:00:00Z',
                prompt: 'hello',
                output: 'answer',
                ok: true,
                inheritedFromClone: true,
                providerCheckpoint,
              },
            ],
          },
        });
        const stored = readChatFromStore({ droneId: 'drone', chatName: 'side' }).chat as any;
        expect(stored.turns[0].providerCheckpoint).toEqual(providerCheckpoint);
        expect(completedChatCheckpoint(stored).providerCheckpoint).toEqual(providerCheckpoint);
      });
    });
  }

  test('passes the captured native boundary and rolls back a failed fork', async () => {
    const harness = creatorHarness('native');
    await expect(harness.create()).rejects.toThrow('native failure');
    expect(harness.nativeForks).toMatchObject([{ checkpointId: 'native-answer-1' }]);
    expect(harness.chats.has('side')).toBe(false);
  });
});

function creatorHarness(agentId: string, overrides: Partial<DroneChatCreationDependencies> = {}) {
  const source = {
    id: 'source-id',
    agent: agentId === 'native' ? { kind: 'native' } : { kind: 'builtin', id: agentId },
    codexThreadId: 'codex-source',
    turns: [
      { id: 'answer-1', ok: true, output: 'answer', codexTurnId: 'turn-1' },
      { id: 'steer', ok: true, output: '', userOnly: true },
    ],
    pendingPrompts: [{ id: 'live', state: 'running' }],
  };
  const chats = new Map<string, any>([['main', source]]);
  const nativeForks: any[] = [];
  const create = createDroneChatCreator({
    buildNewChatEntry: ({ sourceChatEntry }) => ({
      id: 'target-id',
      agent: sourceChatEntry?.agent,
    }),
    captureNativeChatCheckpoint: async () => 'native-answer-1',
    cloneNativeChatSession: async (input) => {
      nativeForks.push(input);
      throw new Error('native failure');
    },
    copyNativeChatConfiguration: async () => {},
    createChatInStore: async ({ chatName, createEntry }) => {
      const chat = createEntry(source);
      chats.set(chatName, chat);
      return { chat, chats: [...chats.keys()] };
    },
    deleteChatFromStore: async ({ chatName }) => chats.delete(chatName),
    getChatEntry: async ({ chatName }) => ({ chat: chats.get(chatName) }),
    importDroneChatsFromRegistry: async () => {},
    inferChatAgent: (chat) => chat.agent,
    listChatsFromStore: () => ({ chats: [...chats.keys()] }),
    nowIso: () => '2026-09-07T10:00:00.000Z',
    projectCanonicalChatsToRegistry: async () => {},
    readChatFromStore: ({ chatName }) => ({ available: true, chat: chats.get(chatName) ?? null }),
    ...overrides,
  });
  return {
    source,
    chats,
    nativeForks,
    create: () =>
      create({
        droneId: 'drone',
        droneEntry: { busyChats: ['main'] },
        chatName: 'side',
        sourceChatName: 'main',
        creationMode: 'clone-history',
        sideChat: true,
      }),
  };
}
