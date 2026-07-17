import { describe, expect, test } from 'bun:test';
import {
  chatConfigResolutionState,
  chatInfoForSelection,
} from '../src/droneHub/app/chat-selection-model';
import { visiblePendingPromptsForAgent } from '../src/droneHub/app/use-chat-runtime-orchestration';

const drone = {
  id: 'drone-native',
  name: 'capabilities-and-tools',
  chats: ['default'],
} as any;

describe('native chat selection state', () => {
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

  test('stops showing a loading skeleton when chat metadata finishes without a result', () => {
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
});
