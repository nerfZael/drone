import { describe, expect, test } from 'bun:test';
import { compactRepeatedToolItems, renderItemsFromMessages } from '../src';

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

  test('groups consecutive repeated tool calls into one activity item', () => {
    const items = renderItemsFromMessages([
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: 'a' } },
          { type: 'toolCall', id: 'call_2', name: 'read_file', arguments: { path: 'b' } },
          { type: 'toolCall', id: 'call_3', name: 'read_file', arguments: { path: 'c' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call_1', toolName: 'read_file', content: 'a' },
      { role: 'toolResult', toolCallId: 'call_2', toolName: 'read_file', content: 'b' },
      { role: 'toolResult', toolCallId: 'call_3', toolName: 'read_file', content: 'c' },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'toolGroup', items: [{}, {}, {}] });
  });

  test('regroups repeated calls after a non-rendering message is removed', () => {
    const items = renderItemsFromMessages([
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_1', name: 'list_files', arguments: { path: '.' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call_1', toolName: 'list_files', content: 'first' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should inspect the other folders.' },
          { type: 'toolCall', id: 'call_2', name: 'list_files', arguments: { path: 'a' } },
          { type: 'toolCall', id: 'call_3', name: 'list_files', arguments: { path: 'b' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call_2', toolName: 'list_files', content: 'second' },
      { role: 'toolResult', toolCallId: 'call_3', toolName: 'list_files', content: 'third' },
    ]);

    expect(items.map((item) => item.type)).toEqual(['tool', 'message', 'toolGroup']);
    const visibleItems = compactRepeatedToolItems(
      items.filter((item) => item.type !== 'message'),
    );
    expect(visibleItems).toHaveLength(1);
    expect(visibleItems[0]).toMatchObject({ type: 'toolGroup', items: [{}, {}, {}] });
  });
});
