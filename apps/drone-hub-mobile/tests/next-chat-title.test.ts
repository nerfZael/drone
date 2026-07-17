import { describe, expect, test } from 'bun:test';
import { nextChatTitle } from '../src/local-assistant/next-chat-title';

describe('new built-in chat titles', () => {
  test('uses plain sequential Chat names', () => {
    expect(nextChatTitle([{ title: 'Phone thread 1' }])).toBe('Chat 1');
    expect(nextChatTitle([{ title: 'Chat 1' }, { title: 'Phone thread 2' }])).toBe(
      'Chat 2',
    );
    expect(nextChatTitle([{ title: 'Chat 1' }, { title: 'Chat 3' }])).toBe(
      'Chat 2',
    );
  });
});
