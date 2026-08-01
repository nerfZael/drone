import { describe, expect, test } from 'bun:test';

import { createSendInNewChatActionRuntime } from '../src/hub/chat-queue-action-runtime';
import type { PendingPrompt } from '../src/hub/drone-pending-prompts';

describe('send-in-new-chat action runtime', () => {
  test('decides immediate execution from work durably sequenced before the action', async () => {
    const pending: PendingPrompt[] = [
      {
        id: 'prior-prompt',
        at: '2026-08-01T10:00:00.000Z',
        prompt: 'Finish the implementation',
        state: 'sent',
      },
    ];
    let actionPersisted = false;
    let claimCalls = 0;
    const runtime = createSendInNewChatActionRuntime({
      normalizeDroneIdentity: (value: string) => value,
      normalizeChatName: (value: string) => value,
      isSafePromptId: () => true,
      normalizeSubmittedAtIso: () => '2026-08-01T10:01:00.000Z',
      getChatEntry: async () => ({ d: { name: 'alpha' }, chat: { id: 'source-chat-id' } }),
      readPendingPrompt: ({ id }: any) => pending.find((item) => item.id === id) ?? null,
      readPendingPrompts: async () => (actionPersisted ? pending : []),
      pushPendingPrompt: async ({ pending: action }: any) => {
        pending.push(action);
        actionPersisted = true;
      },
      hasPendingWork: (_chat: any, prior: PendingPrompt[]) =>
        prior.some((item) => item.id === 'prior-prompt'),
      claimQueuedPendingPromptForSending: async () => {
        claimCalls += 1;
        return true;
      },
      enqueuePendingPromptPump: () => {},
    } as any);

    const result = await runtime.createOrEnqueue({
      id: 'review-action',
      droneId: 'alpha',
      chatName: 'default',
      prompt: 'Review the finished work',
    });

    expect(result).toEqual({ kind: 'accepted', id: 'review-action', pendingState: 'queued' });
    expect(actionPersisted).toBe(true);
    expect(claimCalls).toBe(0);
  });

  test('resolves a completed action to its auto-renamed owned target', async () => {
    const completed: PendingPrompt = {
      id: 'review-action',
      at: '2026-08-01T10:00:00.000Z',
      prompt: 'Review the finished work',
      state: 'sent',
      action: {
        type: 'send-in-new-chat',
        sourceChatName: 'default',
        sourceChatId: 'source-chat-id',
        targetChatName: 'Untitled 1',
      },
    };
    const updates: any[] = [];
    const runtime = createSendInNewChatActionRuntime({
      normalizeDroneIdentity: (value: string) => value,
      normalizeChatName: (value: string) => value,
      isSafePromptId: () => true,
      readPendingPrompt: () => completed,
      claimQueuedPendingPromptForPromotion: async () => null,
      listChatsFromStore: () => ({ chats: ['default', 'Review finished work'] }),
      readChatFromStore: ({ chatName }: any) => ({
        available: true,
        chat:
          chatName === 'Review finished work'
            ? {
                queuedChatOrigin: {
                  sourceChatName: 'default',
                  sourceChatId: 'source-chat-id',
                  actionId: 'review-action',
                },
              }
            : { id: 'source-chat-id' },
      }),
      updatePendingPrompt: async (input: any) => void updates.push(input),
    } as any);

    expect(
      await runtime.createOrEnqueue({
        id: 'review-action',
        droneId: 'alpha',
        chatName: 'default',
        prompt: 'Review the finished work',
      }),
    ).toEqual({
      kind: 'accepted',
      id: 'review-action',
      pendingState: 'sent',
      targetChatName: 'Review finished work',
    });

    expect(
      await runtime.promote({
        droneId: 'alpha',
        chatName: 'default',
        actionId: 'review-action',
      }),
    ).toEqual({ kind: 'created', targetChatName: 'Review finished work' });
    expect(updates).toContainEqual(
      expect.objectContaining({
        patch: {
          action: expect.objectContaining({ targetChatName: 'Review finished work' }),
        },
      }),
    );
  });

  test('creates a configuration-only chat and resumes a failed target prompt idempotently', async () => {
    const sourceAction: PendingPrompt = {
      id: 'review-action',
      at: '2026-08-01T10:00:00.000Z',
      prompt: 'Review the finished work',
      state: 'sending',
      attachments: [],
      action: {
        type: 'send-in-new-chat',
        sourceChatName: 'default',
        sourceChatId: 'source-chat-id',
      },
    };
    const targetPrompt: PendingPrompt = {
      id: 'retained-target-prompt',
      at: sourceAction.at,
      prompt: sourceAction.prompt,
      state: 'failed',
      error: 'interrupted',
    };
    const chats = new Map<string, any>([
      ['default', { id: 'source-chat-id' }],
      [
        'Untitled 1',
        {
          id: 'target-chat-id',
          createdAt: sourceAction.at,
          queuedChatOrigin: {
            sourceChatName: 'default',
            sourceChatId: 'source-chat-id',
            actionId: sourceAction.id,
          },
        },
      ],
    ]);
    const createChatCalls: any[] = [];
    const submitCalls: any[] = [];
    const updates: any[] = [];

    const runtime = createSendInNewChatActionRuntime({
      loadRegistry: async () => ({ drones: { alpha: { name: 'alpha' } } }),
      listChatsFromStore: () => ({ chats: [...chats.keys()] }),
      readChatFromStore: ({ chatName }: any) => ({
        available: true,
        chat: chats.get(chatName) ?? null,
      }),
      updatePendingPrompt: async (input: any) => {
        updates.push(input);
        if (input.chatName === 'default') Object.assign(sourceAction, input.patch);
      },
      createDroneChat: async (input: any) => {
        createChatCalls.push(input);
        return { chat: chats.get(input.chatName), chats: [...chats.keys()], created: false };
      },
      readPendingPrompt: ({ chatName }: any) =>
        chatName === 'Untitled 1' ? { ...targetPrompt } : sourceAction,
      createOrEnqueuePrompt: async (input: any) => {
        submitCalls.push(input);
        return { kind: 'enqueued', id: input.id, pendingState: 'queued' };
      },
      normalizeChatImageAttachmentRefs: () => [],
      autoRenameGeneratedChatFromFirstPrompt: async () => {},
      enqueuePendingPromptPump: () => {},
    } as any);

    const result = await runtime.executeClaimed({
      droneId: 'alpha',
      sourceChatName: 'default',
      pending: sourceAction,
    });

    expect(result).toEqual({ targetChatName: 'Untitled 1' });
    expect(createChatCalls).toHaveLength(1);
    expect(createChatCalls[0]).toMatchObject({
      creationMode: 'copy-config',
      sourceChatName: 'default',
      queuedOrigin: {
        sourceChatId: 'source-chat-id',
        actionId: 'review-action',
      },
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        chatName: 'Untitled 1',
        patch: { state: 'queued', error: '' },
      }),
    );
    expect(submitCalls).toHaveLength(1);
    expect(submitCalls[0]).toMatchObject({
      droneId: 'alpha',
      chatName: 'Untitled 1',
      prompt: sourceAction.prompt,
      deliveryMode: 'asap',
    });
    expect(submitCalls[0].id).toMatch(/^new-chat-[a-f0-9]{24}$/);
    expect(sourceAction.state).toBe('sent');
    expect(sourceAction.action).toMatchObject({ targetChatName: 'Untitled 1' });
  });
});
