import { describe, expect, test } from 'bun:test';

import { latestActivityHasVisibleAssistantText } from '../src/droneHub/assistant/assistant-streaming-state';

describe('assistant streaming state', () => {
  test('recognizes when durable history already contains the final assistant text', () => {
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
});
