import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalCard } from '../src/droneHub/assistant/AssistantWorkflowCards';

const bashApproval = {
  id: 'approval-1',
  threadId: 'thread-1',
  toolCallId: 'tool-call-1',
  toolName: 'bash',
  label: 'Execute Bash command',
  args: {
    resolved: {
      targetLabel: 'Add desktop device picker',
      command: 'git status --short',
    },
  },
  createdAt: '2026-07-21T10:00:00.000Z',
  status: 'pending' as const,
};

describe('assistant approval card', () => {
  test('renders a flat, accessible approval region with clear actions', () => {
    const html = renderToStaticMarkup(
      <ApprovalCard approval={bashApproval} busy={false} onApprove={() => {}} onDeny={() => {}} />,
    );

    expect(html).toContain('class="dh-approval"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby="assistant-approval-approval-1-title"');
    expect(html).toContain('Approval required');
    expect(html).toContain('Execute Bash command');
    expect(html).toContain('Runs on');
    expect(html).toContain('Add desktop device picker');
    expect(html).toContain('git status --short');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="dh-approval-json-link"');
    expect(html).toContain('View JSON');
    expect(html).toContain('Deny');
    expect(html).toContain('Approve');
  });

  test('marks the region busy and disables resolution actions', () => {
    const html = renderToStaticMarkup(
      <ApprovalCard approval={bashApproval} busy onApprove={() => {}} onDeny={() => {}} />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
