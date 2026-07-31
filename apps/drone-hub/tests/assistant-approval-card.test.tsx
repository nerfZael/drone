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

  test('can disable approval while leaving denial available for incomplete details', () => {
    const html = renderToStaticMarkup(
      <ApprovalCard
        approval={bashApproval}
        busy={false}
        approveDisabled
        warning="Review the complete request on its home device."
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );

    expect(html).toContain('Review the complete request on its home device.');
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  test('shows canonical repository group identity for group moves', () => {
    const html = renderToStaticMarkup(
      <ApprovalCard
        approval={{
          ...bashApproval,
          id: 'approval-group',
          toolName: 'set_drone_group',
          label: 'Set drone group',
          args: {
            resolved: {
              drones: [{ id: 'drone-a', name: 'Reviewer' }],
              group: 'review',
              groupId: 'grp_repo_a',
              repoPath: '/repo/a',
            },
          },
        }}
        busy={false}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );

    expect(html).toContain('Reviewer');
    expect(html).toContain('review');
    expect(html).toContain('Group ID');
    expect(html).toContain('grp_repo_a');
    expect(html).toContain('/repo/a');
  });
});
