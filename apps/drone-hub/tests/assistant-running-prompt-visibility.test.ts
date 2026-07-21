import { describe, expect, test } from 'bun:test';

import { assistantPromptHasVisibleUserMessage } from '../src/droneHub/assistant/assistant-message-model';
import { resolveAssistantStartupPromptPresentation } from '../src/droneHub/assistant/assistant-startup-prompt';
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

  test('keeps the startup prompt sent and working while native state still calls it queued', () => {
    const presentation = resolveAssistantStartupPromptPresentation({
      startupPrompt: { prompt: prompt.prompt, at: prompt.createdAt },
      messages: [],
      queuedPrompts: [{ ...prompt, status: 'queued' }],
    });

    expect(presentation.showOptimistic).toBe(true);
    expect(presentation.reconciled).toBe(false);
    expect(presentation.matchingQueuedPrompt?.id).toBe(prompt.id);
  });

  test('reconciles the optimistic startup prompt only after its canonical user message appears', () => {
    const messages: AssistantMessage[] = [
      {
        role: 'user',
        content: prompt.prompt,
        timestamp: Date.parse('2026-07-17T20:55:45.000Z'),
      },
    ];
    const presentation = resolveAssistantStartupPromptPresentation({
      startupPrompt: { prompt: prompt.prompt, at: prompt.createdAt },
      messages,
      queuedPrompts: [{ ...prompt, status: 'running' }],
    });

    expect(presentation.showOptimistic).toBe(false);
    expect(presentation.reconciled).toBe(true);
    expect(presentation.canonicalVisible).toBe(true);
  });

  test('ignores an older failed queue item when the same prompt is submitted again', () => {
    const presentation = resolveAssistantStartupPromptPresentation({
      startupPrompt: { prompt: prompt.prompt, at: prompt.createdAt },
      messages: [],
      queuedPrompts: [
        {
          ...prompt,
          id: 'older-failed-prompt',
          createdAt: '2026-07-17T20:45:00.000Z',
          status: 'failed',
        },
        { ...prompt, id: 'current-prompt', status: 'queued' },
      ],
    });

    expect(presentation.showOptimistic).toBe(true);
    expect(presentation.reconciled).toBe(false);
    expect(presentation.matchingQueuedPrompt?.id).toBe('current-prompt');
  });
});
