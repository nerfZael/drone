import { describe, expect, test } from 'bun:test';
import {
  buildSuggestedChatNameCandidate,
  isGeneratedChatName,
  isSuggestedChatRenameConflict,
  isSuggestedChatRenameRetriable,
} from '../src/droneHub/app/chat-name-suggestions';

describe('chat name suggestions', () => {
  test('recognizes only generated chat-number names', () => {
    expect(isGeneratedChatName('chat-2')).toBe(true);
    expect(isGeneratedChatName('default')).toBe(false);
    expect(isGeneratedChatName('login-chat-2')).toBe(false);
  });

  test('adds numbered suffixes for conflicts', () => {
    expect(buildSuggestedChatNameCandidate('Fix login flow', 1)).toBe('Fix login flow');
    expect(buildSuggestedChatNameCandidate('Fix login flow', 3)).toBe('Fix login flow (3)');
  });

  test('caps suggested chat names to the server max length', () => {
    const base = 'a'.repeat(80);
    const candidate = buildSuggestedChatNameCandidate(base, 12);
    expect(candidate.length).toBeLessThanOrEqual(64);
    expect(candidate.endsWith(' (12)')).toBe(true);
  });

  test('classifies conflict and retry messages', () => {
    expect(isSuggestedChatRenameConflict('chat already exists: Fix login flow')).toBe(true);
    expect(isSuggestedChatRenameConflict('cannot rename default chat')).toBe(true);
    expect(isSuggestedChatRenameRetriable('unknown chat: chat-2')).toBe(true);
    expect(isSuggestedChatRenameRetriable('Chat is unavailable.')).toBe(true);
    expect(isSuggestedChatRenameRetriable('rename failed')).toBe(false);
  });
});
