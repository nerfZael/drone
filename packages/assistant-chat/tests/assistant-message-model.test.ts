import { describe, expect, test } from 'bun:test';
import { renderItemsFromMessages } from '../src';

describe('assistant message model', () => {
  test('pairs tool calls with their results on every platform', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Read the file' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect it.' },
          { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'read_file',
        content: 'hello',
      },
      { role: 'assistant', content: 'The file says hello.' },
    ]);

    expect(items.map((item) => item.type)).toEqual(['message', 'message', 'tool', 'message']);
    expect(items[2]).toMatchObject({
      type: 'tool',
      call: { id: 'call_1', name: 'read_file' },
      result: { toolCallId: 'call_1' },
    });
  });
});
