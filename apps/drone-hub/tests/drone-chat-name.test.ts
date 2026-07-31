import { describe, expect, test } from 'bun:test';
import { suggestNextDroneChatName } from '../src/droneHub/app/helpers';

describe('suggestNextDroneChatName', () => {
  test('starts with the first untitled chat', () => {
    expect(suggestNextDroneChatName(['default'])).toBe('Untitled 1');
  });

  test('uses the first available untitled number', () => {
    expect(suggestNextDroneChatName(['default', 'Untitled 1', 'Untitled 3'])).toBe('Untitled 2');
  });

  test('ignores renamed and legacy generated chats', () => {
    expect(suggestNextDroneChatName(['default', 'chat-3', 'notes'])).toBe('Untitled 1');
  });
});
