import { describe, expect, test } from 'bun:test';
import type { AssistantMessage } from '@drone/assistant-chat';
import {
  buildChatTimelineItems,
  groupChatTimelineItems,
  latestCompletedAgentTurnGroupIndex,
} from '../src/droneHub/app/chat-timeline-items';
import {
  latestCompletedAssistantMessageIndex,
  renderItemsFromMessages,
} from '../src/droneHub/assistant/assistant-message-model';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';

function turn(id: number, patch: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    turn: id,
    at: `2026-09-09T10:0${id}:00.000Z`,
    prompt: `Question ${id}`,
    output: `Answer ${id}`,
    session: 'chat',
    logPath: '/tmp/chat.log',
    ok: true,
    ...patch,
  };
}

function selectedExternalAnswer(turns: TranscriptItem[], pending: PendingPrompt[] = []) {
  const groups = groupChatTimelineItems(buildChatTimelineItems(turns, pending));
  const index = latestCompletedAgentTurnGroupIndex(groups);
  return index < 0 ? null : groups[index]!.primary.item;
}

const completedNative: AssistantMessage[] = [
  { role: 'user', content: 'Question 1', timestamp: 1_000 },
  { role: 'assistant', content: 'Answer 1', timestamp: 2_000 },
  { role: 'user', content: 'Question 2', timestamp: 3_000 },
  { role: 'assistant', content: 'Answer 2', timestamp: 4_000 },
];

function selectedNativeAnswer(messages: AssistantMessage[], running = false) {
  const items = renderItemsFromMessages(messages);
  let activeUserIndex: number | undefined;
  if (running) {
    activeUserIndex = -1;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item?.type === 'message' && item.message.role === 'user') {
        activeUserIndex = index;
        break;
      }
    }
  }
  const index = latestCompletedAssistantMessageIndex(items, activeUserIndex);
  const selected = items[index];
  return selected?.type === 'message' ? selected.message.content : null;
}

describe('latest completed answer expansion in normal and floating chats', () => {
  test.each(['queued', 'sending', 'sent', 'failed'] as const)(
    'external %s prompts leave the previous completed answer expanded',
    (state) => {
      const previous = turn(2);
      expect(selectedExternalAnswer([turn(1), previous], [{
        id: 'new-prompt',
        at: '2026-09-09T10:03:00.000Z',
        prompt: 'Next question',
        state,
        activity: {
          version: 1,
          source: 'codex',
          updatedAt: '2026-09-09T10:04:00.000Z',
          messages: [{ role: 'assistant', content: 'Still working on it' }],
        },
      }])).toBe(previous);
    },
  );

  test('external user-only and silent turns do not supersede an answer', () => {
    const previous = turn(1);
    expect(selectedExternalAnswer([
      previous,
      turn(2, { userOnly: true }),
      turn(3, { silentCompletion: true }),
      turn(4, { output: '' }),
    ])).toBe(previous);
  });

  test('a new completed external answer supersedes the previous answer', () => {
    const next = turn(3, {
      output: '',
      activity: {
        version: 1,
        source: 'codex',
        updatedAt: '2026-09-09T10:04:00.000Z',
        messages: [{ role: 'assistant', content: 'Finished answer' }],
      },
    });
    expect(selectedExternalAnswer([turn(1), turn(2), next])).toBe(next);
    expect(selectedExternalAnswer([])).toBeNull();
  });

  test('sending a native prompt and streaming reasoning/tools keep the previous answer expanded', () => {
    const messages: AssistantMessage[] = [
      ...completedNative,
      { role: 'user', content: 'Next question', timestamp: 5_000 },
    ];
    expect(selectedNativeAnswer(messages)).toBe('Answer 2');
    expect(selectedNativeAnswer(messages, true)).toBe('Answer 2');
    messages.push({
      role: 'assistant',
      timestamp: 6_000,
      content: [
        { type: 'thinking', thinking: 'Investigating' },
        { type: 'toolCall', id: 'read-1', name: 'read_file', arguments: {} },
      ],
    });
    expect(selectedNativeAnswer(messages, true)).toBe('Answer 2');
    messages.push({ role: 'toolResult', toolCallId: 'read-1', content: 'File contents', timestamp: 7_000 });
    messages.push({ role: 'assistant', content: 'Draft answer', timestamp: 8_000 });
    expect(selectedNativeAnswer(messages, true)).toBe('Answer 2');
    expect(selectedNativeAnswer(messages)).toBe('Draft answer');
  });

  test('native reasoning-only and error messages do not replace the last answer', () => {
    expect(selectedNativeAnswer([
      ...completedNative,
      { role: 'user', content: 'Next question', timestamp: 5_000 },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'Investigating' }], timestamp: 6_000 },
      { role: 'assistant', content: '', errorMessage: 'Request failed', timestamp: 7_000 },
    ])).toBe('Answer 2');
  });

  test('commentary inside a failed tool run does not supersede the last visible answer', () => {
    expect(selectedNativeAnswer([
      ...completedNative,
      { role: 'user', content: 'Next question', timestamp: 5_000 },
      { role: 'assistant', content: 'I will inspect this', timestamp: 6_000 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'read-1', name: 'read_file', arguments: {} }],
        timestamp: 7_000,
      },
      { role: 'assistant', content: '', errorMessage: 'Request failed', timestamp: 8_000 },
    ])).toBe('Answer 2');
  });

  test('native history can start with an answer and a first active run has no completed answer', () => {
    expect(selectedNativeAnswer([{ role: 'assistant', content: 'Earlier answer', timestamp: 1_000 }])).toBe('Earlier answer');
    expect(selectedNativeAnswer([
      { role: 'user', content: 'First question', timestamp: 1_000 },
      { role: 'assistant', content: 'Still working', timestamp: 2_000 },
    ], true)).toBeNull();
    expect(selectedNativeAnswer([])).toBeNull();
  });
});
