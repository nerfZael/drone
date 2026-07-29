import { describe, expect, test } from 'bun:test';
import {
  chatNamesForConfigSelection,
  chatConfigResolutionState,
  chatInfoForSelection,
} from '../src/droneHub/app/chat-selection-model';
import {
  chatHasInFlightPrompt,
  localQueuedPromptStateWhileFlushing,
  shouldFlushLocalQueuedPrompts,
  visiblePendingPromptsForAgent,
} from '../src/droneHub/app/use-chat-runtime-orchestration';

const drone = {
  id: 'drone-native',
  name: 'capabilities-and-tools',
  chats: ['default'],
} as any;

describe('native chat selection state', () => {
  test('keeps an in-flight send scoped to its originating drone chat', () => {
    const inFlightByChat = {
      'drone-a::default': 1,
    };

    expect(chatHasInFlightPrompt(inFlightByChat, 'drone-a', 'default')).toBe(true);
    expect(chatHasInFlightPrompt(inFlightByChat, 'drone-b', 'default')).toBe(false);
    expect(chatHasInFlightPrompt(inFlightByChat, 'drone-a', 'review')).toBe(false);
  });

  test('allows hidden workflow chats to load their runtime metadata', () => {
    expect(
      chatNamesForConfigSelection({
        chats: ['default'],
        workflowChats: ['workflow-run-planner', 'workflow-run-analyst'],
      }),
    ).toEqual(['default', 'workflow-run-analyst', 'workflow-run-planner']);
  });

  test('does not reuse chat metadata from the previously selected drone', () => {
    const previousChat = {
      name: 'another-drone',
      chat: 'default',
      agent: { kind: 'builtin', id: 'cursor' },
    } as any;
    expect(
      chatInfoForSelection(
        previousChat,
        'previous-drone\u0000default',
        drone.id,
        'default',
      ),
    ).toBeNull();
  });

  test('uses matching native chat metadata immediately when available', () => {
    const nativeChat = {
      name: 'capabilities-and-tools',
      chat: 'default',
      agent: { kind: 'native' },
    } as any;
    expect(
      chatInfoForSelection(nativeChat, `${drone.id}\u0000default`, drone.id, 'default'),
    ).toBe(nativeChat);
  });

  test('keeps current metadata valid when the drone display name changes', () => {
    const currentChat = {
      name: 'old-display-name',
      chat: 'default',
      agent: { kind: 'native' },
    } as any;
    expect(
      chatInfoForSelection(currentChat, `${drone.id}\u0000default`, drone.id, 'default'),
    ).toBe(currentChat);
  });

  test('stops showing a loading state when chat metadata finishes without a result', () => {
    expect(
      chatConfigResolutionState({
        currentChatIsDraft: false,
        hasChats: true,
        metadataAvailable: false,
        loading: true,
      }),
    ).toBe('loading');
    expect(
      chatConfigResolutionState({
        currentChatIsDraft: false,
        hasChats: true,
        metadataAvailable: false,
        loading: false,
      }),
    ).toBe('unavailable');
  });

  test('does not turn completed native prompts into generic typing state', () => {
    const sentPrompt = {
      id: 'prompt-1',
      prompt: 'hello',
      state: 'sent',
      at: '2026-07-17T20:56:08.000Z',
    } as any;
    expect(
      visiblePendingPromptsForAgent({
        agentKind: null,
        chatUiMode: 'transcript',
        pendingPrompts: [sentPrompt],
        transcripts: [],
      }),
    ).toEqual([]);
    expect(
      visiblePendingPromptsForAgent({
        agentKind: 'native',
        chatUiMode: 'transcript',
        pendingPrompts: [sentPrompt],
        transcripts: [],
      }),
    ).toEqual([]);
    expect(
      visiblePendingPromptsForAgent({
        agentKind: 'builtin',
        chatUiMode: 'transcript',
        pendingPrompts: [sentPrompt],
        transcripts: [],
      }),
    ).toEqual([sentPrompt]);
  });

  test('keeps queued native prompts visible while the chat is still a draft', () => {
    const queuedPrompt = {
      id: 'queued-draft-prompt',
      prompt: 'Please keep this for later',
      state: 'queued',
      at: '2026-07-22T08:00:00.000Z',
    } as any;

    expect(
      visiblePendingPromptsForAgent({
        agentKind: 'native',
        chatUiMode: 'transcript',
        isDraftChat: true,
        pendingPrompts: [queuedPrompt],
        transcripts: [],
      }),
    ).toEqual([queuedPrompt]);
    expect(
      visiblePendingPromptsForAgent({
        agentKind: null,
        chatUiMode: 'transcript',
        isDraftChat: true,
        pendingPrompts: [queuedPrompt],
        transcripts: [],
      }),
    ).toEqual([queuedPrompt]);
  });

  test('does not duplicate a stopped pending row once its transcript turn exists', () => {
    const stoppedPrompt = {
      id: 'stopped-prompt',
      prompt: 'Please change this',
      state: 'failed',
      error: 'Stopped by user.',
      at: '2026-07-22T08:00:00.000Z',
    } as any;

    expect(
      visiblePendingPromptsForAgent({
        agentKind: 'builtin',
        chatUiMode: 'transcript',
        pendingPrompts: [stoppedPrompt],
        transcripts: [{ id: 'stopped-prompt' } as any],
      }),
    ).toEqual([]);
  });

  test('persists every locally queued draft prompt without starting provisioning queues early', () => {
    expect(shouldFlushLocalQueuedPrompts({ draft: true, hubPhase: 'draft' })).toBe(true);
    expect(shouldFlushLocalQueuedPrompts({ draft: false, hubPhase: 'draft' })).toBe(true);
    expect(shouldFlushLocalQueuedPrompts({ draft: false, hubPhase: 'starting' })).toBe(false);
    expect(shouldFlushLocalQueuedPrompts({ draft: false, hubPhase: 'seeding' })).toBe(false);
    expect(shouldFlushLocalQueuedPrompts({ draft: false, hubPhase: 'ready' })).toBe(true);
    expect(shouldFlushLocalQueuedPrompts({ draft: false, hubPhase: 'error' })).toBe(false);
  });

  test('does not present draft persistence as active agent work', () => {
    expect(localQueuedPromptStateWhileFlushing({ draft: true, hubPhase: 'draft' })).toBe('queued');
    expect(localQueuedPromptStateWhileFlushing({ draft: false, hubPhase: 'draft' })).toBe('queued');
    expect(localQueuedPromptStateWhileFlushing({ draft: false, hubPhase: 'ready' })).toBe('sending');
  });
});
