import { describe, expect, test } from 'bun:test';
import { suggestChatCopyName, suggestNextDroneChatName } from '../src/droneHub/app/helpers';

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

describe('suggestChatCopyName', () => {
  test('names a clone after its source', () => {
    expect(suggestChatCopyName('plan', ['default', 'plan'])).toBe('plan - Copy');
  });

  test('counts up past existing copies, whichever case they were typed in', () => {
    expect(suggestChatCopyName('plan', ['plan', 'plan - copy'])).toBe('plan - Copy 2');
    expect(suggestChatCopyName('plan', ['plan', 'plan - Copy', 'plan - Copy 2'])).toBe('plan - Copy 3');
  });

  test('a copy of a copy counts from the original instead of stacking suffixes', () => {
    expect(suggestChatCopyName('plan - Copy', ['plan', 'plan - Copy'])).toBe('plan - Copy 2');
    expect(suggestChatCopyName('plan - Copy 2', ['plan', 'plan - Copy', 'plan - Copy 2'])).toBe('plan - Copy 3');
  });

  test('keeps the name within the Hub limit', () => {
    const long = 'x'.repeat(70);
    const name = suggestChatCopyName(long, []);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.endsWith(' - Copy')).toBe(true);
  });
});
