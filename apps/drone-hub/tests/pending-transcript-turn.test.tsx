import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PendingTranscriptTurn } from '../src/droneHub/chat/PendingTranscriptTurn';
import type { PendingPrompt } from '../src/droneHub/types';

function pendingPrompt(patch: Partial<PendingPrompt> = {}): PendingPrompt {
  const at = new Date(Date.now() - 65_000).toISOString();
  return {
    id: 'pending-1',
    at,
    startedAt: at,
    prompt: 'Inspect the repository',
    state: 'sent',
    ...patch,
  };
}

describe('external pending transcript turn', () => {
  test('shows sent prompts normally with elapsed working state and the live plan below', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          agentPlan: {
            source: 'codex',
            updatedAt: new Date().toISOString(),
            items: [{ id: 'step-1', text: 'Read repository instructions', status: 'in_progress' }],
          },
        })}
        showRoleIcons={false}
      />,
    );

    expect(html).toContain('Inspect the repository');
    expect(html).toMatch(/Working for 1m \d+s/);
    expect(html).toContain('text-[var(--muted)]');
    expect(html).toContain('border-b border-[var(--border-subtle)]');
    expect(html).not.toContain('border-t border-[var(--border-subtle)]');
    expect(html).toContain('min-h-9');
    expect(html).not.toContain('h-1.5 w-1.5 animate-pulse');
    expect(html).toContain('Read repository instructions');
    expect(html).toContain('Plan');
    expect(html).not.toContain('ml-6');
    expect(html).not.toContain('>Pending<');
    expect(html).not.toContain('Waiting…');
    expect(html.match(/1m ago/g)).toHaveLength(1);
  });

  test('keeps the queued badge only while the prompt has not been sent', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({ state: 'queued' })}
        showRoleIcons={false}
        onCancelQueued={() => {}}
      />,
    );

    expect(html).toContain('Queued');
    expect(html).toContain('Inspect the repository');
    expect(html).toContain('aria-label="Queued, waiting to send"');
    expect(html).toContain('aria-label="Cancel queued prompt"');
    expect(html).toContain('>Cancel</button>');
    expect(html).not.toContain('border-t border-[var(--user-border)]');
    expect(html).not.toContain('group-hover/pending-turn');
    expect(html).not.toContain('Working for');
    expect(html).not.toContain('animate-pulse-dot');
  });

  test('renders queued new-chat actions with Create now and cancel controls', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'queued',
          action: { type: 'send-in-new-chat', sourceChatName: 'default' },
        })}
        onCreateNewChatNow={() => {}}
        onCancelQueued={() => {}}
      />,
    );

    expect(html).toContain('>New chat</span>');
    expect(html).toContain('border-b-0');
    expect(html).toContain('bg-[color-mix(in_srgb,var(--accent)_11%,var(--user-bubble))]');
    expect(html).toContain('-mb-px flex justify-end"><span');
    expect(html).toContain('rounded-tr-none');
    expect(html).toContain('Waiting to create a fresh chat');
    expect(html).toContain('>Create now</button>');
    expect(html).toContain('aria-keyshortcuts="Enter Escape"');
    expect(html).toContain('aria-label="Cancel queued new chat"');
    expect(html).not.toContain('Working for');
  });

  test('keeps an attached new-chat tab singular when role icons are visible', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'queued',
          action: { type: 'send-in-new-chat', sourceChatName: 'default' },
        })}
        showRoleIcons
        onCreateNewChatNow={() => {}}
      />,
    );

    expect(html.match(/>New chat<\/span>/g)).toHaveLength(1);
    expect(html.match(/>You<\/span>/g)).toHaveLength(1);
    expect(html).toContain('-mb-px flex items-end justify-between');
  });

  test('shows the failure reason when a queued new-chat action terminates', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'failed',
          error: '\u001b[31mCould not initialize the target agent\u001b[0m',
          action: { type: 'send-in-new-chat', sourceChatName: 'default' },
        })}
      />,
    );

    expect(html).toContain('New chat failed');
    expect(html).toContain('Could not initialize the target agent');
    expect(html).not.toContain('\u001b[31m');
    expect(html).not.toContain('Working for');
  });

  test('shows a spinner while a queued new chat is being created', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'queued',
          action: { type: 'send-in-new-chat', sourceChatName: 'default' },
        })}
        createNewChatBusy
      />,
    );

    expect(html).toContain('Creating a new chat');
    expect(html).toContain('animate-spin');
    expect(html).toContain('role="status"');
    expect(html).toContain('max-w-[var(--chat-prose-max)]');
    expect(html).not.toContain('Working for');
    expect(html).not.toContain('Waiting to create a fresh chat');
    expect(html).not.toContain('>Create now</button>');
  });

  test('shows creation activity when the queue runner claims a new-chat action', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'sending',
          action: { type: 'send-in-new-chat', sourceChatName: 'default' },
        })}
      />,
    );

    expect(html).toContain('Creating a new chat');
    expect(html).toContain('animate-spin');
    expect(html).not.toContain('Waiting to create a fresh chat');
  });

  test('keeps the live total elapsed after a queued start without showing the split', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          at: new Date(Date.now() - 3_600_000).toISOString(),
          startedAt: new Date(Date.now() - 65_000).toISOString(),
        })}
      />,
    );

    expect(html).toMatch(/Working for 1h 0m \d+s/);
    expect(html).not.toContain('Started in');
  });

  test('does not count submission age before the daemon reports an execution start', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          at: new Date(Date.now() - 3_600_000).toISOString(),
          startedAt: undefined,
        })}
      />,
    );

    expect(html).toContain('Working for 0s');
    expect(html).not.toContain('Working for 1h');
  });

  test('shows live external reasoning and an in-progress tool call', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          at: new Date(Date.now() - 3_600_000).toISOString(),
          startedAt: new Date(Date.now() - 65_000).toISOString(),
          agentPlan: {
            source: 'opencode',
            updatedAt: new Date().toISOString(),
            items: [{ id: 'step-1', text: 'Inspect activity output', status: 'in_progress' }],
          },
          activity: {
            version: 1,
            source: 'opencode',
            updatedAt: new Date().toISOString(),
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: 'Checking the current state.' }],
              },
              {
                role: 'assistant',
                content: [
                  {
                    type: 'toolCall',
                    id: 'tool-1',
                    name: 'read',
                    arguments: { path: 'README.md' },
                  },
                ],
              },
            ],
          },
        })}
        showRoleIcons={false}
      />,
    );

    expect(html).toContain('data-agent-run-activity="opencode"');
    expect(html).toContain('data-agent-run-details="true"');
    expect(html).toContain('data-agent-run-plan="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Collapse run details"');
    expect(html).toMatch(/Started in 58m \d+s · agent 1m \d+s/);
    expect(html).toContain('grid grid-cols-2 items-start gap-2');
    expect(html).toContain('border-l border-[var(--border-subtle)] px-3');
    expect(html).toContain('dh-agent-activity-scrollbar');
    expect(html).toContain('max-h-72');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('overscroll-contain');
    expect(html).toContain('opacity-[0.82]');
    expect(html).toContain('hover:opacity-100');
    expect(html).toContain('Checking the current state.');
    expect(html).toContain('data-tool-status="pending"');
    expect(html).toContain('Inspect activity output');
    expect(html).not.toContain('Show plan');
    expect(html.indexOf('Checking the current state.')).toBeLessThan(
      html.indexOf('Inspect activity output'),
    );
    const planColumnClass = html.match(/data-agent-run-plan="true" class="([^"]+)"/)?.[1] ?? '';
    expect(planColumnClass).not.toContain('border-l');
    expect(planColumnClass).not.toContain('pl-4');
    expect(html.match(/Working for/g)).toHaveLength(1);
  });

  test('keeps the working summary visible before the first activity item arrives', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: new Date().toISOString(),
            messages: [],
          },
        })}
      />,
    );

    expect(html).toContain('data-agent-run-activity="codex"');
    expect(html).toContain('Working for');
  });

  test('expands the latest external user prompt by default', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          prompt: Array.from({ length: 45 }, (_, index) => `Prompt line ${index + 1}`).join('\n'),
        })}
        autoExpandPrompt
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Prompt line 45');
  });

  test('presents a stopped run separately from the delivered user message', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'failed',
          error: 'Stopped by user.',
          updatedAt: new Date().toISOString(),
        })}
      />,
    );

    expect(html).toContain('Inspect the repository');
    expect(html).toContain('Run stopped');
    expect(html).toContain('Stopped by you.');
    expect(html).not.toContain('>Stopped</span>');
    expect(html).not.toContain('text-[var(--red)]');
  });

  test('presents an exhausted reconnect as an interruption with preserved progress', () => {
    const error = [
      'Reconnecting... 2/5',
      'Reconnecting... 5/5',
      'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses) (exit 1)',
    ].join('\n');
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'failed',
          error,
          updatedAt: new Date().toISOString(),
          activity: {
            version: 1,
            source: 'codex',
            updatedAt: new Date().toISOString(),
            messages: [],
          },
          fileChanges: {
            version: 2,
            capturedAt: new Date().toISOString(),
            counts: { changed: 1, additions: 3, deletions: 1 },
            workspaces: [],
          },
        })}
      />,
    );

    expect(html).toContain('>Interrupted</span>');
    expect(html).toContain('data-agent-run-failure="connection"');
    expect(html).toContain('Connection interrupted');
    expect(html).toContain('The run stopped after 5 automatic reconnect attempts.');
    expect(html).toContain('Completed steps and any file changes are preserved.');
    expect(html).toContain('Technical details');
    expect(html).toContain('Changed files');
    expect(html).not.toContain('>Failed</span>');
    expect(html).not.toContain('dh-markdown--error');
  });

  test('explains manual recovery and offers queue skipping for a blocked interruption', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          state: 'failed',
          error: 'stream disconnected before completion',
          queueInterruption: {
            state: 'blocked',
            at: '2026-08-11T09:00:00.000Z',
          },
        })}
        onResolveInterruption={() => {}}
      />,
    );

    expect(html).toContain('Queued and steering prompts are paused');
    expect(html).toContain('Send a message when you’re ready to continue.');
    expect(html).not.toContain('>Continue</button>');
    expect(html).toContain('>Skip and run queued</button>');
    expect(html).not.toContain('>Cancel queued</button>');
  });
});
