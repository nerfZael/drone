import { describe, expect, test } from 'bun:test';

import {
  hasVisibleAssistantStreamingText,
  historyContainsStreamingAssistantText,
  latestActivityHasVisibleAssistantText,
  visibleAssistantStreamingMessages,
} from '../src/droneHub/assistant/assistant-streaming-state';

describe('assistant streaming state', () => {
  test('prefers the local event stream over the duplicate snapshot stream', () => {
    const messages = visibleAssistantStreamingMessages({
      persistedMessages: [{ role: 'user', content: 'Go' }],
      snapshotMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'Almost' }] }],
      localMessage: { role: 'assistant', content: [{ type: 'text', text: 'Almost done' }] },
    });

    expect(messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Almost done' }] },
    ]);
    expect(hasVisibleAssistantStreamingText(messages)).toBe(true);
  });

  test('does not count streamed reasoning as visible assistant text', () => {
    expect(
      hasVisibleAssistantStreamingText([
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'Checking' }] },
      ]),
    ).toBe(false);
  });

  test('keeps thinking hidden while streamed text hands off to durable history', () => {
    expect(
      latestActivityHasVisibleAssistantText([
        {
          type: 'message',
          key: 'final',
          sourceMessageIndex: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Finished.' }] },
        },
      ]),
    ).toBe(true);
    expect(
      latestActivityHasVisibleAssistantText([
        {
          type: 'message',
          key: 'prompt',
          sourceMessageIndex: 1,
          message: { role: 'user', content: 'Next request' },
        },
      ]),
    ).toBe(false);
  });

  test('removes the stream only after its visible text is durable in history', () => {
    const persistedMessages = [
      { role: 'assistant' as const, content: [{ type: 'thinking', thinking: 'Checking' }] },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'Finished.' }] },
    ];
    const localMessage = {
      role: 'assistant' as const,
      content: [{ type: 'text', text: 'Finished.' }],
    };

    expect(historyContainsStreamingAssistantText(persistedMessages, 'Finished.')).toBe(true);
    expect(
      visibleAssistantStreamingMessages({
        persistedMessages,
        snapshotMessages: [],
        localMessage,
      }),
    ).toEqual([]);
  });

  test('keeps streamed text visible while history is still behind', () => {
    const localMessage = {
      role: 'assistant' as const,
      content: [{ type: 'text', text: 'Finished.' }],
    };

    expect(
      visibleAssistantStreamingMessages({
        persistedMessages: [{ role: 'assistant', content: 'Earlier response' }],
        snapshotMessages: [],
        localMessage,
      }),
    ).toEqual([localMessage]);
  });
});
