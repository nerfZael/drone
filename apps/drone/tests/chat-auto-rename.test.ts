import { describe, expect, test } from 'bun:test';

import { buildAutoRenamedChatCandidate, isGeneratedChatName } from '../src/hub/chat-auto-rename';

describe('chat auto rename', () => {
  test('only recognizes untouched generated chat names', () => {
    expect(isGeneratedChatName('chat-2')).toBe(true);
    expect(isGeneratedChatName('chat-42')).toBe(true);
    expect(isGeneratedChatName('Untitled 1')).toBe(true);
    expect(isGeneratedChatName('Untitled 42')).toBe(true);
    expect(isGeneratedChatName('default')).toBe(false);
    expect(isGeneratedChatName('chat-0')).toBe(true);
    expect(isGeneratedChatName('Chat-2')).toBe(false);
    expect(isGeneratedChatName('untitled 2')).toBe(false);
    expect(isGeneratedChatName('chat-2-notes')).toBe(false);
    expect(isGeneratedChatName('my-chat-2')).toBe(false);
  });

  test('builds bounded conflict candidates', () => {
    expect(buildAutoRenamedChatCandidate('Fix login', 1)).toBe('Fix login');
    expect(buildAutoRenamedChatCandidate('Fix login', 2)).toBe('Fix login (2)');
    expect(buildAutoRenamedChatCandidate('a'.repeat(80), 12)).toHaveLength(64);
    expect(buildAutoRenamedChatCandidate('a'.repeat(80), 12)).toEndWith(' (12)');
  });
});
