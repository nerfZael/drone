import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { TranscriptTurn } from '../src/droneHub/chat/TranscriptTurn';

describe('completed external transcript presentation', () => {
  test('shares the native duration divider, readable width, and hover timestamps', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 1,
          at: '2026-07-20T10:00:00.000Z',
          promptAt: '2026-07-20T10:00:00.000Z',
          completedAt: '2026-07-20T10:01:05.000Z',
          prompt: 'Review this interface.',
          session: 'external-session',
          logPath: '/tmp/external-session.log',
          ok: true,
          output: 'The interface is ready for review.',
        }}
        parsingJobs={false}
        onCreateJobs={() => {}}
        onSpawnDroneHubTask={async () => ({ ok: true })}
        messageId="external-turn-1"
        showRoleIcons={false}
      />,
    );

    expect(html).toContain('Worked for 1m 5s');
    expect(html).not.toContain('tool call');
    expect(html).toContain('max-w-[min(85%,var(--chat-prose-max))]');
    expect(html).toContain('group-hover/message:opacity-100');
    expect(html).toContain('group-focus-within/message:opacity-100');
    expect(html).toContain('bottom-full right-0 z-10 mb-1 flex min-h-7');
    expect(html).toContain('text-[var(--chat-user-message-time)]');
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('pointer-events-auto opacity-100');
    expect(html).toContain('group-hover/turn:opacity-100');
    expect(html).toContain('group-focus-within/turn:opacity-100');
    expect(html).not.toContain('left-0 top-full mt-1 text-[var(--chat-message-time)]');
  });
});
