import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { TranscriptTurn } from '../src/droneHub/chat/TranscriptTurn';

describe('completed external transcript presentation', () => {
  test('places an interactive result between tool activity and the continued answer', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 1,
          at: '2026-08-07T10:00:00.000Z',
          prompt: 'Ask before continuing.',
          session: 'codex-app-server',
          logPath: '',
          ok: true,
          output: 'Continued after the answers.',
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: '2026-08-07T10:01:00.000Z',
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'toolCall', id: 'questions-1', name: 'ask_questions', arguments: {} },
                ],
              },
              {
                role: 'toolResult',
                toolCallId: 'questions-1',
                toolName: 'ask_questions',
                content: 'answered',
              },
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'Continued after the answers.' }],
              },
            ],
          },
        }}
        messageId="questions-turn"
        interstitialContent={<div data-question-result="true">Saved answers</div>}
      />,
    );

    expect(html.indexOf('Saved answers')).toBeGreaterThan(-1);
    expect(html.indexOf('Saved answers')).toBeLessThan(html.indexOf('Continued after the answers.'));
  });

  test('renders an accepted steering input without inventing an assistant response', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 1,
          at: '2026-08-07T10:00:00.000Z',
          prompt: 'Also check the mobile path.',
          session: 'codex-app-server',
          logPath: '',
          ok: true,
          output: '',
          userOnly: true,
        }}
        messageId="codex-steering-input"
      />,
    );

    expect(html).toContain('Also check the mobile path.');
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(1);
    expect(html).not.toContain('Worked for');
    expect(html).not.toContain('role="assistant"');
  });

  test('renders an ASAP steering message inside the original user bubble', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 1,
          at: '2026-08-07T10:00:00.000Z',
          prompt: 'Start the review.',
          session: 'codex-app-server',
          logPath: '',
          ok: true,
          output: 'Review complete.',
        }}
        messageId="codex-turn"
        followUps={[
          {
            key: 'steer-1',
            at: '2026-08-07T10:01:00.000Z',
            text: 'Also inspect the mobile path.',
          },
        ]}
      />,
    );

    expect(html).toContain('data-user-message-follow-up="asap"');
    expect(html).toContain('>ASAP</span>');
    expect(html).toContain('Also inspect the mobile path.');
    expect(html.match(/max-w-\[min\(85%,var\(--chat-prose-max\)\)\]/g)).toHaveLength(1);
    expect(html).toContain('dateTime="2026-08-07T10:01:00.000Z"');
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
  });

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
    expect(html.match(/bottom-full right-0 z-10 mb-1 flex min-h-7/g)).toHaveLength(1);
    expect(html).toContain('left-0 top-full z-10 mt-1 flex min-h-7 w-full');
    expect(html).toContain('justify-end');
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
    expect(html).not.toContain('data-agent-message-actions="true"');
    expect(html).toContain('group-hover/turn:opacity-100');
    expect(html).toContain('group-focus-within/turn:opacity-100');
    expect(html).not.toContain('bottom-full left-0');
  });

  test('includes pre-agent time in the total without cluttering the summary', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 2,
          at: '2026-07-20T09:00:00.000Z',
          promptAt: '2026-07-20T09:00:00.000Z',
          startedAt: '2026-07-20T10:00:00.000Z',
          completedAt: '2026-07-20T10:01:05.000Z',
          prompt: 'Run after the queue clears.',
          session: 'external-session',
          logPath: '/tmp/external-session.log',
          ok: true,
          output: 'Done.',
        }}
        messageId="external-turn-queued"
      />,
    );

    expect(html).toContain('Completed in 1h 1m 5s');
    expect(html).not.toContain('Started in');
  });

  test('collapses completed reasoning and tool activity while keeping the final answer visible', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 2,
          at: '2026-07-20T10:00:00.000Z',
          promptAt: '2026-07-20T10:00:00.000Z',
          startedAt: '2026-07-20T10:00:01.000Z',
          completedAt: '2026-07-20T10:00:02.000Z',
          prompt: 'Inspect the file.',
          session: 'external-session',
          logPath: '/tmp/external-session.log',
          ok: true,
          output: 'The file is ready.',
          agentPlan: {
            source: 'codex',
            items: [
              { id: 'step-1', text: 'Inspect the file', status: 'completed' },
              { id: 'step-2', text: 'Report the result', status: 'completed' },
            ],
          },
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: '2026-07-20T10:00:02.000Z',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: 'I should inspect the file first.' }],
              },
              {
                role: 'assistant',
                content: [
                  {
                    type: 'toolCall',
                    id: 'tool-1',
                    name: 'read_file',
                    arguments: { path: 'README.md' },
                  },
                ],
              },
              {
                role: 'toolResult',
                toolCallId: 'tool-1',
                toolName: 'read_file',
                content: 'file contents',
              },
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'The file is ready.' }],
              },
            ],
          },
        }}
        messageId="external-turn-2"
        showRoleIcons={false}
      />,
    );

    expect(html).toContain('data-agent-run-activity="codex"');
    expect(html).toContain('Completed in 2s');
    expect(html).toContain('1 tool call');
    expect(html).not.toContain('Started in');
    expect(html).toContain('1 tool call');
    expect(html).toContain('aria-label="Expand run details"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('I should inspect the file first.');
    expect(html).not.toContain('Read file');
    expect(html).not.toContain('Show plan');
    expect(html).not.toContain('Inspect the file</span>');
    expect(html).not.toContain('data-tool-status="pending"');
    expect(html).toContain('class="mt-1 px-3"');
    expect(html.match(/The file is ready\./g)).toHaveLength(1);
  });

  test('settles missing terminal tool results without leaving a spinner visible', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 3,
          at: '2026-07-20T10:00:00.000Z',
          prompt: 'Inspect the file.',
          session: 'external-session',
          logPath: '/tmp/external-session.log',
          ok: true,
          output: 'Done.',
          activity: {
            version: 1,
            source: 'claude',
            updatedAt: '2026-07-20T10:00:02.000Z',
            messages: [
              {
                role: 'assistant',
                content: [
                  {
                    type: 'toolCall',
                    id: 'tool-1',
                    name: 'read_file',
                    arguments: { path: 'README.md' },
                  },
                ],
              },
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'Done.' }],
              },
            ],
          },
        }}
        messageId="external-turn-3"
        showRoleIcons={false}
      />,
    );

    expect(html).toContain('1 tool call');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-tool-status="pending"');
    expect(html).not.toContain('animate-spin');
  });

  test('fully expands the latest final answer outside the completed activity accordion', () => {
    const finalTail = 'The final answer tail stays visible.';
    const finalAnswer = [
      ...Array.from({ length: 45 }, (_, index) => `Final answer line ${index + 1}`),
      finalTail,
    ].join('\n');
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 4,
          at: '2026-07-20T10:00:00.000Z',
          promptAt: '2026-07-20T10:00:00.000Z',
          completedAt: '2026-07-20T10:00:03.000Z',
          prompt: 'Give me the full answer.',
          session: 'external-session',
          logPath: '/tmp/external-session.log',
          ok: true,
          output: finalAnswer,
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: '2026-07-20T10:00:03.000Z',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: 'Working through the answer.' }],
              },
              {
                role: 'assistant',
                content: [{ type: 'text', text: finalAnswer }],
              },
            ],
          },
        }}
        messageId="external-turn-latest"
        showRoleIcons={false}
        autoExpandAgentMessage
      />,
    );

    expect(html).toContain('Worked for 3s');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Working through the answer.');
    expect(html).toContain(finalTail);
    expect(html).toContain('>Collapse</button>');
    expect(html).not.toContain('Show more');
  });

  test('keeps the terminal error visible after partial activity on a failed turn', () => {
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 4,
          at: '2026-07-20T10:00:00.000Z',
          prompt: 'Inspect the file.',
          session: 'external-session',
          logPath: '/tmp/external-session.log',
          ok: false,
          output: '',
          error: 'The provider disconnected.',
          activity: {
            version: 1,
            source: 'cursor',
            updatedAt: '2026-07-20T10:00:02.000Z',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'I started inspecting the file.' }],
              },
            ],
          },
        }}
        messageId="external-turn-4"
        showRoleIcons={false}
      />,
    );

    expect(html).toContain('I started inspecting the file.');
    expect(html).toContain('The provider disconnected.');
  });

  test('keeps a completed reconnect failure compact and recoverable', () => {
    const error = [
      'Reconnecting... 1/5',
      'Reconnecting... 5/5',
      'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses) (exit 1)',
    ].join('\n');
    const html = renderToStaticMarkup(
      <TranscriptTurn
        item={{
          turn: 5,
          at: '2026-07-20T10:00:10.000Z',
          prompt: 'Finish the review.',
          session: 'external-session',
          logPath: '/tmp/external-session.log',
          ok: false,
          output: '',
          error,
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: '2026-07-20T10:00:10.000Z',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'review', name: 'read_file', arguments: {} }],
              },
              {
                role: 'toolResult',
                toolCallId: 'review',
                content: 'Reviewed',
              },
            ],
          },
        }}
        messageId="external-turn-5"
      />,
    );

    expect(html).toContain('data-agent-run-failure="connection"');
    expect(html).toContain('Connection interrupted');
    expect(html).toContain('Completed steps and any file changes are preserved.');
    expect(html).toContain('Technical details');
    expect(html).not.toContain('dh-markdown--error');
  });
});
