import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderEventNotificationPrompt } from '@drone/assistant-chat';

import {
  buildChatTimelineItems,
  groupedPendingPresentationItem,
  groupChatTimelineItems,
} from '../src/droneHub/app/chat-timeline-items';
import { timelineUserFollowUps } from '../src/droneHub/app/chat-timeline-follow-ups';
import { PendingTranscriptTurn } from '../src/droneHub/chat/PendingTranscriptTurn';
import { TranscriptTurn } from '../src/droneHub/chat/TranscriptTurn';
import { UserChatMessage } from '../src/droneHub/chat/UserChatMessage';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';

function eventPrompt(name: string) {
  return renderEventNotificationPrompt({
    events: [
      {
        provider: 'drone-hub',
        resourceType: 'custom_event',
        resourceId: name,
        eventType: 'custom.emitted',
        summary: `Found ${name}`,
        providerContent: { finding: name },
      },
    ],
  });
}

function pending(id: string, index: number, patch: Partial<PendingPrompt> = {}): PendingPrompt {
  return {
    id,
    at: new Date(Date.now() - 65_000 + index * 1_000).toISOString(),
    startedAt: new Date(Date.now() - 64_000).toISOString(),
    prompt: eventPrompt(id),
    state: 'sending',
    deliveryMode: 'asap',
    ...patch,
  };
}

describe('ASAP event run presentation', () => {
  test('keeps all event cards and human follow-ups visible with one working timer', () => {
    const prompts = [
      pending('geometry', 0),
      pending('shadows', 1),
      pending('human', 2, {
        prompt: 'Also check textures.',
        attachments: [{ name: 'notes.md', mime: 'text/markdown', size: 20, path: '/tmp/notes.md' }],
      }),
      pending('textures', 3),
    ];
    const groups = groupChatTimelineItems(buildChatTimelineItems([], prompts));
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    const followUps = timelineUserFollowUps(group.followUps, { droneId: 'drone-1' });
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn item={groupedPendingPresentationItem(group)!} followUps={followUps} />,
    );

    expect(html.match(/Working for/g)).toHaveLength(1);
    expect(html.match(/aria-label="Show event details"/g)).toHaveLength(3);
    expect(html.match(/data-user-message-follow-up="asap"/g)).toHaveLength(3);
    expect(html).toContain('geometry');
    expect(html).toContain('shadows');
    expect(html).toContain('textures');
    expect(html).toContain('Also check textures.');
    expect(html).toContain('notes.md');
    expect(html.indexOf('shadows')).toBeLessThan(html.indexOf('Also check textures.'));
    expect(html.indexOf('Also check textures.')).toBeLessThan(html.lastIndexOf('textures'));
    expect(html).not.toContain('&lt;event');
  });

  test('uses one shared activity section when a later event owns the live output', () => {
    const prompts = [
      pending('geometry', 0),
      pending('shadows', 1, {
        activity: {
          version: 1,
          source: 'codex',
          updatedAt: new Date().toISOString(),
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'Checking shadow costs.' }] },
          ],
        },
      }),
    ];
    const [group] = groupChatTimelineItems(buildChatTimelineItems([], prompts));
    const presentation = groupedPendingPresentationItem(group!)!;
    expect(presentation.startedAt).toBe(prompts[0]!.startedAt);
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={presentation}
        followUps={timelineUserFollowUps(group!.followUps, { droneId: 'drone-1' })}
      />,
    );
    expect(html.match(/Working for/g)).toHaveLength(1);
    expect(html.match(/Checking shadow costs\./g)).toHaveLength(1);
    expect(html.match(/aria-label="Show event details"/g)).toHaveLength(2);
  });

  test('keeps an event card when the original prompt is a human message', () => {
    const [group] = groupChatTimelineItems(
      buildChatTimelineItems(
        [],
        [pending('human', 0, { prompt: 'Inspect the renderer.' }), pending('shadows', 1)],
      ),
    );
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={groupedPendingPresentationItem(group!)!}
        followUps={timelineUserFollowUps(group!.followUps, { droneId: 'drone-1' })}
      />,
    );
    expect(html).toContain('Inspect the renderer.');
    expect(html).toContain('Custom event emitted');
    expect(html.match(/aria-label="Show event details"/g)).toHaveLength(1);
    expect(html.match(/Working for/g)).toHaveLength(1);
  });

  test('preserves follow-ups when an event-started run is rendered from history', () => {
    const original: TranscriptItem = {
      turn: 1,
      at: '2026-09-09T10:00:00.000Z',
      completedAt: '2026-09-09T10:02:00.000Z',
      prompt: eventPrompt('geometry'),
      session: 'codex',
      logPath: '',
      ok: true,
      output: 'Audit complete.',
    };
    const followUp: TranscriptItem = {
      ...original,
      turn: 2,
      at: '2026-09-09T10:01:00.000Z',
      prompt: eventPrompt('shadows'),
      userOnly: true,
      deliveryMode: 'asap',
      output: '',
    };
    const [group] = groupChatTimelineItems(buildChatTimelineItems([original, followUp], []));
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={original}
        messageId="original"
        followUps={timelineUserFollowUps(group!.followUps, { droneId: 'drone-1' })}
      />,
    );
    expect(html.match(/aria-label="Show event details"/g)).toHaveLength(2);
    expect(html).toContain('Audit complete.');
    expect(html).toContain('>ASAP</span>');
    expect(html).not.toContain('Working for');
  });

  test('keeps queued and failed events separate from the running group', () => {
    const groups = groupChatTimelineItems(
      buildChatTimelineItems(
        [],
        [
          pending('geometry', 0),
          pending('queued', 1, { state: 'queued' }),
          pending('failed', 2, { state: 'failed', error: 'Delivery failed' }),
          pending('shadows', 3),
        ],
      ),
    );
    expect(groups.map((group) => group.primary.item.id)).toEqual(['geometry', 'queued', 'failed']);
    expect(groups[0]!.followUps.map((entry) => entry.item.id)).toEqual(['shadows']);
  });

  test('copying an event group includes readable event and human follow-up content', () => {
    const followUps = timelineUserFollowUps(
      [
        { kind: 'pending', item: pending('shadows', 1) },
        { kind: 'pending', item: pending('human', 2, { prompt: 'Check textures too.' }) },
      ],
      { droneId: 'drone-1' },
    );
    const message = UserChatMessage({ copyText: 'Original event', followUps });
    const copyText = message.props.hoverActions.props.text as string;
    expect(copyText).toContain('Original event');
    expect(copyText).toContain('Found shadows');
    expect(copyText).toContain('Check textures too.');
    expect(copyText).not.toContain('<event');
  });
});
