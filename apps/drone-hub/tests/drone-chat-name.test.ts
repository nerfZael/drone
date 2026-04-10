import { describe, expect, test } from 'bun:test';
import { suggestNextDroneChatName } from '../src/droneHub/app/helpers';

describe('suggestNextDroneChatName', () => {
  test('starts after the current chat count', () => {
    expect(suggestNextDroneChatName(['default'])).toBe('chat-2');
  });

  test('skips to the highest numbered chat name', () => {
    expect(suggestNextDroneChatName(['default', 'chat-2', 'chat-7'])).toBe('chat-8');
  });

  test('avoids collisions when the count-based name is already taken', () => {
    expect(suggestNextDroneChatName(['default', 'chat-3', 'notes'])).toBe('chat-4');
  });
});
