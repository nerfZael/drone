import { describe, expect, test } from 'bun:test';
import { messagesAfterDeletion } from '../src/local-assistant/assistant-message-deletion';
import type { LocalAssistantMessage } from '../src/local-assistant/local-assistant-types';

const messages: LocalAssistantMessage[] = ['one', 'two', 'three'].map((id, index) => ({
  id,
  createdAt: `2026-07-15T12:00:0${index}.000Z`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: id,
}));

describe('assistant message deletion', () => {
  test('deletes only the selected message', () => {
    expect(messagesAfterDeletion(messages, 'two', false)?.map((message) => message.id)).toEqual([
      'one',
      'three',
    ]);
  });

  test('deletes the selected message and every following message', () => {
    expect(messagesAfterDeletion(messages, 'two', true)?.map((message) => message.id)).toEqual([
      'one',
    ]);
  });

  test('does not change history when the selected message is stale', () => {
    expect(messagesAfterDeletion(messages, 'missing', true)).toBeNull();
  });

  test('removes tool results that depend on a deleted assistant message', () => {
    const history: LocalAssistantMessage[] = [
      messages[0]!,
      {
        ...messages[1]!,
        content: [
          { type: 'text', text: 'I checked that.' },
          { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} },
        ],
      },
      {
        id: 'result',
        createdAt: '2026-07-15T12:00:03.000Z',
        role: 'toolResult',
        content: 'contents',
        toolCallId: 'call-1',
        toolName: 'read_file',
      },
      messages[2]!,
    ];
    expect(messagesAfterDeletion(history, 'two', false)?.map((message) => message.id)).toEqual([
      'one',
      'three',
    ]);
  });
});
