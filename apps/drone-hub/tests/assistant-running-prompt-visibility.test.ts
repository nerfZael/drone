import { describe, expect, test } from 'bun:test';

import { assistantPromptHasVisibleUserMessage } from '../src/droneHub/assistant/assistant-message-model';
import type { AssistantMessage, AssistantQueuedPrompt } from '../src/droneHub/assistant/assistant-types';

const prompt: AssistantQueuedPrompt = {
  id: 'startup-prompt',
  prompt: 'What tools do you have?',
  promptImages: [],
  imageCount: 0,
  createdAt: '2026-07-17T20:55:44.565Z',
  status: 'running',
  error: null,
};

describe('native running prompt visibility', () => {
  test('keeps a running prompt visible after reload when history has no user message', () => {
    expect(assistantPromptHasVisibleUserMessage([], prompt)).toBe(false);
  });

  test('hides the fallback row once the matching user message is persisted', () => {
    const messages: AssistantMessage[] = [
      {
        role: 'user',
        content: 'What tools do you have?',
        timestamp: Date.parse('2026-07-17T20:55:45.000Z'),
      },
    ];
    expect(assistantPromptHasVisibleUserMessage(messages, prompt)).toBe(true);
  });

  test('does not match an older identical message from a previous turn', () => {
    const messages: AssistantMessage[] = [
      {
        role: 'user',
        content: 'What tools do you have?',
        timestamp: Date.parse('2026-07-17T20:45:00.000Z'),
      },
    ];
    expect(assistantPromptHasVisibleUserMessage(messages, prompt)).toBe(false);
  });
});
