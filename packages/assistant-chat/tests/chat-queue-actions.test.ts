import { describe, expect, test } from 'bun:test';
import {
  allocateUntitledChatName,
  isSendInNewChatQueueAction,
  resolveChatQueueActionPresentation,
} from '../src/chat-queue-actions';

describe('chat queue actions', () => {
  test('recognizes send-in-new-chat actions', () => {
    expect(
      isSendInNewChatQueueAction({
        type: 'send-in-new-chat',
        sourceChatName: 'default',
      }),
    ).toBe(true);
    expect(isSendInNewChatQueueAction({ type: 'send-in-new-chat' })).toBe(false);
    expect(isSendInNewChatQueueAction({ type: 'prompt' })).toBe(false);
  });

  test('derives platform-neutral action presentation', () => {
    const action = { type: 'send-in-new-chat', sourceChatName: 'default' } as const;
    expect(resolveChatQueueActionPresentation(action, 'queued')).toEqual({
      kind: 'send-in-new-chat',
      state: 'queued',
      label: 'New chat queued',
      queuedDescription: 'Runs after earlier work finishes',
      canCancel: true,
      canExecuteNow: true,
      countsAsAgentRun: false,
    });
    expect(resolveChatQueueActionPresentation(action, 'sending')).toMatchObject({
      state: 'running',
      label: 'Creating new chat',
      canExecuteNow: false,
      countsAsAgentRun: false,
    });
    expect(resolveChatQueueActionPresentation(undefined, 'queued')).toBeNull();
  });

  test('allocates the first available untitled chat name case-insensitively', () => {
    expect(allocateUntitledChatName(['default', 'Untitled 1', 'untitled 3'])).toBe('Untitled 2');
  });
});
