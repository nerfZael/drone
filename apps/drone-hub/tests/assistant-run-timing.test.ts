import { describe, expect, test } from 'bun:test';

import {
  directAssistantRunTiming,
  renderItemsFromMessages,
} from '../src/droneHub/assistant/assistant-message-model';

describe('native assistant run timing', () => {
  test('pairs a direct assistant reply with its user prompt', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Hello', timestamp: 1_000 },
      { role: 'assistant', content: 'Hi', timestamp: 66_000 },
    ]);

    expect(directAssistantRunTiming(items, 0)).toEqual({
      startedAt: 1_000,
      endedAt: 66_000,
    });
  });

  test('leaves tool-backed runs to the tool activity summary', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Inspect this', timestamp: 1_000 },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} },
        ],
        timestamp: 2_000,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: 'Done',
        timestamp: 3_000,
      },
      { role: 'assistant', content: 'Finished', timestamp: 4_000 },
    ]);

    expect(directAssistantRunTiming(items, 0)).toBeNull();
  });
});
