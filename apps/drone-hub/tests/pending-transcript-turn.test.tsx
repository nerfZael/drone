import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PendingTranscriptTurn } from '../src/droneHub/chat/PendingTranscriptTurn';
import type { PendingPrompt } from '../src/droneHub/types';

function pendingPrompt(patch: Partial<PendingPrompt> = {}): PendingPrompt {
  return {
    id: 'pending-1',
    at: new Date(Date.now() - 65_000).toISOString(),
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

  test('shows live external reasoning and an in-progress tool call', () => {
    const html = renderToStaticMarkup(
      <PendingTranscriptTurn
        item={pendingPrompt({
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
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('border-l border-[var(--border-subtle)] px-3');
    expect(html).toContain('opacity-[0.82]');
    expect(html).toContain('hover:opacity-100');
    expect(html).toContain('Checking the current state.');
    expect(html).toContain('data-tool-status="pending"');
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
