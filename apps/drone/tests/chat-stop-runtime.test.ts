import { expect, test } from 'bun:test';
import { createChatPromptRuntime } from '../src/hub/chat-prompt-runtime';

test('external Stop skips history reconciliation and cancels a follow-up claimed concurrently', async () => {
  const calls: string[] = [];
  const chat = { turns: [] };
  const runtime = createChatPromptRuntime({
    normalizeDroneIdentity: (id: string) => id,
    normalizeChatName: (name: string) => name,
    readChatFromStore: () => ({ available: true, chat }),
    getChatEntry: async () => ({ chat }),
    inferChatAgent: () => ({ kind: 'builtin', id: 'codex' }),
    loadRegistry: () => {
      throw new Error('Stop must not read fleet history');
    },
    ensureChatEntry: () => {
      throw new Error('Stop must not bootstrap the chat');
    },
    dronePromptGet: () => {
      throw new Error('Stop must not wait for history');
    },
    makeClient: () => ({}),
    dronePromptCancel: async (_client: unknown, id: string) => {
      calls.push(`interrupt:${id}`);
    },
    nowIso: () => new Date().toISOString(),
    isNotFoundErrorMessage: () => false,
    createDronePendingPromptStore: () => ({
      transcriptTurnIdsFromEntry: () => new Set(),
      readPendingPrompts: async () => [
        { id: 'active', state: 'sent' },
        { id: 'racing', state: 'queued' },
      ],
      cancelQueuedPendingPrompt: async () => {
        calls.push('cancel-queued');
        return { status: 'already-submitted', pendingState: 'sending' };
      },
      updatePendingPrompt: async ({ id }: any) => {
        calls.push(`stopped:${id}`);
      },
    }),
    createDroneProvisioningController: () => ({ stopProvisioning: async () => {} }),
  } as any);
  try {
    const result = await runtime.stopChatResponse({
      droneId: 'drone',
      chatName: 'default',
      droneEntry: { hostPort: 7777, token: 'test' },
    });
    expect(result.stoppedPromptIds).toEqual(['active', 'racing']);
    expect(calls).toEqual([
      'cancel-queued',
      'interrupt:active',
      'interrupt:racing',
      'stopped:active',
      'stopped:racing',
    ]);
  } finally {
    await runtime.stopPromptRuntimeBackgroundWork();
  }
});
