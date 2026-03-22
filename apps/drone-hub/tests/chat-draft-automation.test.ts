import { describe, expect, test } from 'bun:test';
import {
  CHAT_DRAFT_AUTOMATION_STOP_PHRASE_DEFAULT,
  createDraftChatAutomationLaunch,
  formatDraftChatAutomationLabel,
} from '../src/droneHub/app/chat-draft-automation';

describe('chat draft automation helpers', () => {
  test('formats a compact label from the current draft prompt', () => {
    expect(formatDraftChatAutomationLabel('  Fix   flaky\n tests  ')).toBe('Repeat: Fix flaky tests');
  });

  test('falls back to a generic label for an empty prompt', () => {
    expect(formatDraftChatAutomationLabel('   ')).toBe('Repeated message');
  });

  test('creates an ad hoc automation launch with the default stop phrase and no final prompt', () => {
    const launch = createDraftChatAutomationLaunch({
      prompt: 'Ship the docs update',
      runs: 3,
      sleepAmount: 2,
      sleepUnit: 'minutes',
    });

    expect(launch.automationId.startsWith('draft-chat:')).toBe(true);
    expect(launch.automationLabel).toBe('Repeat: Ship the docs update');
    expect(launch.onFailurePrompt).toBe('');
    expect(launch.runs).toBe(3);
    expect(launch.sleepBetweenRunsSeconds).toBe(120);
    expect(launch.stopPhrase).toBe(CHAT_DRAFT_AUTOMATION_STOP_PHRASE_DEFAULT);
    expect(launch.stopPhraseCaseSensitive).toBe(false);
  });

  test('truncates long draft prompts to fit the automation label budget', () => {
    const label = formatDraftChatAutomationLabel(
      'This is a very long prompt that should be shortened before it becomes the automation label in chat history',
    );

    expect(label.startsWith('Repeat: ')).toBe(true);
    expect(label.endsWith('...')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(72);
  });
});
