import { describe, expect, test } from 'bun:test';
import {
  buildChatTimelineItems,
  groupedPendingPresentationItem,
  groupChatTimelineItems,
  mergeChatTranscriptTimeline,
} from '../src/droneHub/app/chat-timeline-items';
import type { ChatQuestionRequest } from '@drone/assistant-chat';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';

function turn(turnNumber: number, at: string): TranscriptItem {
  return {
    turn: turnNumber,
    at,
    prompt: `turn ${turnNumber}`,
    session: 'chat-default',
    logPath: '/tmp/chat.log',
    ok: true,
    output: 'done',
  };
}

function pending(
  id: string,
  at: string,
  state: PendingPrompt['state'],
  updatedAt?: string,
): PendingPrompt {
  return { id, at, prompt: id, state, ...(updatedAt ? { updatedAt } : {}) };
}

describe('chat timeline items', () => {
  test('places resolved questionnaires where they occurred instead of after the transcript', () => {
    const groups = groupChatTimelineItems(
      buildChatTimelineItems(
        [turn(1, '2026-01-01T10:00:00.000Z'), turn(2, '2026-01-01T10:03:00.000Z')],
        [],
      ),
    );
    const request: ChatQuestionRequest = {
      id: 'questions-1',
      droneId: 'drone-1',
      chatName: 'default',
      chatId: 'chat-1',
      toolName: 'ask_questions',
      questions: [],
      createdAt: '2026-01-01T10:01:00.000Z',
      updatedAt: '2026-01-01T10:02:00.000Z',
      status: 'submitted',
      result: { status: 'submitted', requestId: 'questions-1', responses: [] },
    };

    expect(
      mergeChatTranscriptTimeline(groups, [request]).map((entry) =>
        entry.kind === 'group'
          ? `turn:${entry.group.primary.item.turn}`
          : `question:${entry.request.id}`,
      ),
    ).toEqual(['turn:1', 'question:questions-1', 'turn:2']);
  });

  test('uses creation time while a questionnaire is still pending', () => {
    const groups = groupChatTimelineItems(
      buildChatTimelineItems(
        [turn(1, '2026-01-01T10:00:00.000Z'), turn(2, '2026-01-01T10:03:00.000Z')],
        [],
      ),
    );
    const request: ChatQuestionRequest = {
      id: 'questions-1',
      droneId: 'drone-1',
      chatName: 'default',
      chatId: 'chat-1',
      toolName: 'ask_questions',
      questions: [],
      createdAt: '2026-01-01T10:01:00.000Z',
      updatedAt: '2026-01-01T10:04:00.000Z',
      status: 'pending',
    };

    expect(
      mergeChatTranscriptTimeline(groups, [request]).map((entry) =>
        entry.kind === 'group' ? `turn:${entry.group.primary.item.turn}` : 'question',
      ),
    ).toEqual(['turn:1', 'question', 'turn:2']);
  });

  test('merges ordinary pending prompts with completed turns chronologically', () => {
    const items = buildChatTimelineItems(
      [turn(1, '2026-01-01T10:00:00.000Z'), turn(2, '2026-01-01T10:02:00.000Z')],
      [pending('between', '2026-01-01T10:01:00.000Z', 'failed')],
    );

    expect(
      items.map((item) =>
        item.kind === 'turn' ? `turn:${item.item.turn}` : `pending:${item.item.id}`,
      ),
    ).toEqual(['turn:1', 'pending:between', 'turn:2']);
  });

  test('keeps user messages in submission order while an older startup prompt is still queued', () => {
    const items = buildChatTimelineItems(
      [],
      [
        pending('review', '2026-07-29T17:26:20.768Z', 'sent', '2026-07-29T17:35:03.335Z'),
        pending('initial-task', '2026-07-29T17:25:33.880Z', 'queued'),
      ],
    );

    expect(items.map((item) => item.item.id)).toEqual(['initial-task', 'review']);
  });

  test('orders active prompts by submission time rather than status update time', () => {
    const items = buildChatTimelineItems(
      [],
      [
        pending('first', '2026-01-01T10:00:00.000Z', 'sent', '2026-01-01T10:03:00.000Z'),
        pending('second', '2026-01-01T10:01:00.000Z', 'sending', '2026-01-01T10:02:00.000Z'),
      ],
    );

    expect(items.map((item) => item.item.id)).toEqual(['first', 'second']);
  });

  test('keeps an active prompt ahead of a later submitted completed turn', () => {
    const active = pending(
      'active',
      '2026-01-01T10:00:00.000Z',
      'sent',
      '2026-01-01T10:03:00.000Z',
    );
    const items = buildChatTimelineItems([turn(2, '2026-01-01T10:01:00.000Z')], [active]);

    expect(
      items.map((item) =>
        item.kind === 'turn' ? `turn:${item.item.turn}` : `pending:${item.item.id}`,
      ),
    ).toEqual(['pending:active', 'turn:2']);
  });

  test('preserves input order when timestamps match', () => {
    const at = '2026-01-01T10:00:00.000Z';
    const items = buildChatTimelineItems(
      [turn(1, at), turn(2, at)],
      [pending('same-time', at, 'failed')],
    );

    expect(
      items.map((item) =>
        item.kind === 'turn' ? `turn:${item.item.turn}` : `pending:${item.item.id}`,
      ),
    ).toEqual(['turn:1', 'turn:2', 'pending:same-time']);
  });

  test('groups an active ASAP steering prompt into the prompt it is steering', () => {
    const items = buildChatTimelineItems(
      [],
      [
        { ...pending('original', '2026-01-01T10:00:00.000Z', 'sending'), deliveryMode: 'queue' },
        { ...pending('steer', '2026-01-01T10:01:00.000Z', 'sending'), deliveryMode: 'asap' },
      ],
    );

    const groups = groupChatTimelineItems(items);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.item.id).toBe('original');
    expect(groups[0]?.followUps.map((entry) => entry.item.id)).toEqual(['steer']);
  });

  test('groups ASAP into the active turn even when queued work sits between them', () => {
    const items = buildChatTimelineItems(
      [],
      [
        pending('active', '2026-01-01T10:00:00.000Z', 'sending'),
        pending('queued', '2026-01-01T10:01:00.000Z', 'queued'),
        {
          ...pending('steer', '2026-01-01T10:02:00.000Z', 'sending'),
          deliveryMode: 'asap',
        },
      ],
    );

    const groups = groupChatTimelineItems(items);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.primary.item.id).toBe('active');
    expect(groups[0]?.followUps.map((entry) => entry.item.id)).toEqual(['steer']);
    expect(groups[1]?.primary.item.id).toBe('queued');
  });

  test('groups a historical user-only ASAP entry but not an independently answered turn', () => {
    const original = {
      ...turn(1, '2026-01-01T10:00:00.000Z'),
      completedAt: '2026-01-01T10:02:00.000Z',
    };
    const steering = {
      ...turn(2, '2026-01-01T10:01:00.000Z'),
      userOnly: true,
    };
    const independent = {
      ...turn(3, '2026-01-01T10:03:00.000Z'),
      deliveryMode: 'asap' as const,
    };

    const groups = groupChatTimelineItems(
      buildChatTimelineItems([original, steering, independent], []),
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.followUps.map((entry) => entry.item.id)).toEqual([steering.id]);
    expect(groups[1]?.primary.item.id).toBe(independent.id);
  });

  test('keeps queued and failed ASAP prompts standalone so their controls stay visible', () => {
    const items = buildChatTimelineItems(
      [],
      [
        pending('original', '2026-01-01T10:00:00.000Z', 'sending'),
        { ...pending('queued', '2026-01-01T10:01:00.000Z', 'queued'), deliveryMode: 'asap' },
        { ...pending('failed', '2026-01-01T10:02:00.000Z', 'failed'), deliveryMode: 'asap' },
      ],
    );

    expect(groupChatTimelineItems(items)).toHaveLength(3);
  });

  test('uses the richest grouped live activity without replacing the original prompt timing', () => {
    const base = {
      ...pending('original', '2026-01-01T10:00:00.000Z', 'sending'),
      startedAt: '2026-01-01T10:00:05.000Z',
      activity: {
        version: 1 as const,
        source: 'codex' as const,
        updatedAt: '2026-01-01T10:00:10.000Z',
        messages: [],
      },
    };
    const steer = {
      ...pending('steer', '2026-01-01T10:01:00.000Z', 'sending'),
      deliveryMode: 'asap' as const,
      startedAt: '2026-01-01T10:01:01.000Z',
      activity: {
        version: 1 as const,
        source: 'codex' as const,
        updatedAt: '2026-01-01T10:01:10.000Z',
        messages: [
          {
            role: 'assistant' as const,
            content: [{ type: 'toolCall', id: 'read', name: 'read_file', arguments: {} }],
          },
        ],
      },
    };
    const [group] = groupChatTimelineItems(buildChatTimelineItems([], [base, steer]));

    const presentation = groupedPendingPresentationItem(group!);

    expect(presentation?.id).toBe('original');
    expect(presentation?.prompt).toBe('original');
    expect(presentation?.startedAt).toBe(base.startedAt);
    expect(presentation?.activity).toBe(steer.activity);
  });

  test('does not hide steering messages inside specialized subscription-event bubbles', () => {
    const event = {
      ...turn(1, '2026-01-01T10:00:00.000Z'),
      prompt: '[event notification] repository changed',
      completedAt: '2026-01-01T10:02:00.000Z',
    };
    const steering = {
      ...turn(2, '2026-01-01T10:01:00.000Z'),
      userOnly: true,
      deliveryMode: 'asap' as const,
    };

    expect(groupChatTimelineItems(buildChatTimelineItems([event, steering], []))).toHaveLength(2);
  });
});
