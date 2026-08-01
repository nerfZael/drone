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

    expect(html).toContain('New chat queued');
    expect(html).toContain('Waiting to create a fresh chat');
    expect(html).toContain('>Create now</button>');
    expect(html).toContain('aria-label="Cancel queued new chat"');
    expect(html).not.toContain('Working for');
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

  test('counts working time from daemon execution rather than the queued timestamp', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
          at: new Date(Date.now() - 3_600_000).toISOString(),
          startedAt: new Date(Date.now() - 65_000).toISOString(),
        })}
      />,
    );

    expect(html).toMatch(/Working for 1m \d+s/);
    expect(html).not.toContain('Working for 1h');
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
});
