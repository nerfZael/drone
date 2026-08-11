import { describe, expect, test } from 'bun:test';

import { NativeChatLifecycle } from '../src/hub/assistant/native-chat-lifecycle';

function snapshot(thread: { id: string; agentPermissionMode: string; approvalPolicy: string }) {
  return { threads: [{ ...thread }] } as any;
}

describe('native chat lifecycle', () => {
  test('invalidates an idle runtime only when next-turn access settings changed', async () => {
    let thread = {
      id: 'native-chat',
      agentPermissionMode: 'execute',
      approvalPolicy: 'ask',
    };
    const invalidated: string[] = [];
    const lifecycle = new NativeChatLifecycle(
      {
        threadSnapshot: async () => snapshot(thread),
        ensureNativeThread: async (input: any) => {
          thread = {
            ...thread,
            agentPermissionMode: input.agentPermissionMode ?? thread.agentPermissionMode,
            approvalPolicy: input.approvalPolicy ?? thread.approvalPolicy,
          };
          return snapshot(thread);
        },
      } as any,
      { invalidateThread: (threadId: string) => invalidated.push(threadId) } as any,
    );

    await lifecycle.ensureForPrompt({
      id: thread.id,
      droneId: 'drone',
      chatName: 'default',
      agentPermissionMode: 'execute',
      approvalPolicy: 'ask',
    });
    expect(invalidated).toEqual([]);

    await lifecycle.ensureForPrompt({
      id: thread.id,
      droneId: 'drone',
      chatName: 'default',
      agentPermissionMode: 'write',
      approvalPolicy: 'none',
    });
    expect(invalidated).toEqual(['native-chat']);
  });
});
