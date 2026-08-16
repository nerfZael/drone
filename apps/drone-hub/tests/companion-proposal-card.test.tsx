import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanionProposalCard } from '../src/droneHub/companion/CompanionProposalCard';

describe('Companion proposal card', () => {
  test('renders the proposal operations and review actions', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalCard
        proposal={{
          version: 1,
          title: 'Review setup',
          summary: 'Create a draft and queue a follow-up.',
          operations: [
            { id: 'create', type: 'create_drone', name: 'Reviewer', prompt: 'Review.', draft: true },
            { id: 'follow-up', type: 'send_message', droneId: '$create', message: 'Check tests.' },
          ],
        }}
        defaultRepoPath="/workspace/repo"
        execution={null}
        executing={false}
        companionStatus="completed"
        resolveDroneName={(droneId) => droneId === 'existing-drone' ? 'Existing reviewer' : null}
        onExecute={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(html).toContain('Review setup');
    expect(html).toContain('Create draft drone');
    expect(html).toContain('Message to');
    expect(html).toContain('Reviewer');
    expect(html).toContain('/workspace/repo');
    expect(html).toContain('/workspace/repo / Ungrouped');
    expect(html).toContain('Preview full initial message and group path for Reviewer');
    expect(html).toContain('Review.');
    expect(html).toContain('Check tests.');
    expect(html).toContain('Apply proposal');
    expect(html).toContain('Discard');
  });

  test('shows a compact message preview with a focusable full-message hover target', () => {
    const message = `Please approve PR #749 and confirm that the refactor is ready to merge. ${'Include the requested confirmation. '.repeat(5)}`;
    const html = renderToStaticMarkup(
      <CompanionProposalCard
        proposal={{
          version: 1,
          title: 'Send approval',
          operations: [{
            id: 'message',
            type: 'send_message',
            droneId: 'drone-uuid',
            chatName: 'default',
            message,
            delivery: 'asap',
          }],
        }}
        defaultRepoPath=""
        execution={null}
        executing={false}
        companionStatus="completed"
        resolveDroneName={() => 'Review Prompt and Shot Architecture'}
        onExecute={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(html).toContain('Message to');
    expect(html).toContain('Review Prompt and Shot Architecture');
    expect(html).toContain(message);
    expect(html).not.toContain('drone-uuid');
    expect(html).toContain('Preview full message to Review Prompt and Shot Architecture');
    expect(html).not.toContain('Show full message');
    expect(html).toContain('text-[var(--accent-fg)]');
  });

  test('shows partial execution failures and skipped work', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalCard
        proposal={{
          version: 1,
          title: 'Rename drones',
          operations: [
            { id: 'first', type: 'rename_drone', droneId: 'one', newName: 'One' },
            { id: 'second', type: 'delete_drone', droneId: 'two' },
          ],
        }}
        defaultRepoPath=""
        execution={{
          ok: false,
          operations: [
            { id: 'first', type: 'rename_drone', status: 'failed', error: 'Name already exists' },
            { id: 'second', type: 'delete_drone', status: 'skipped' },
          ],
        }}
        executing={false}
        companionStatus="completed"
        onExecute={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(html).toContain('Apply failed');
    expect(html).toContain('Name already exists');
    expect(html).toContain('Not run');
    expect(html).toContain('Discard to retry');
    expect(html).toContain('disabled');
  });

  test('uses inline progress icons and preserves snapshotted drone names', () => {
    const proposal = {
      version: 1 as const,
      title: 'Delete recent drones',
      operations: [
        { id: 'first', type: 'delete_drone' as const, droneId: 'drone-one' },
        { id: 'second', type: 'delete_drone' as const, droneId: 'drone-two' },
      ],
    };
    const applyingHtml = renderToStaticMarkup(
      <CompanionProposalCard
        proposal={proposal}
        defaultRepoPath=""
        execution={null}
        executionProgress={{
          activeOperationId: 'second',
          operations: [{ id: 'first', type: 'delete_drone', status: 'completed' }],
        }}
        executing
        companionStatus="completed"
        droneNames={{ 'drone-one': 'Refactoring opportunities review', 'drone-two': 'Security code review' }}
        resolveDroneName={() => null}
        onExecute={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(applyingHtml).toContain('Operation 1 applied');
    expect(applyingHtml).toContain('Applying operation 2');
    expect(applyingHtml).toContain('animate-spin');
    expect(applyingHtml).toContain('Delete drone Refactoring opportunities review');
    expect(applyingHtml).toContain('Delete drone Security code review');
    expect(applyingHtml).not.toContain('Delete drone drone-one');
    expect(applyingHtml).not.toContain('Delete drone drone-two');

    const appliedHtml = renderToStaticMarkup(
      <CompanionProposalCard
        proposal={proposal}
        defaultRepoPath=""
        execution={{
          ok: true,
          operations: [
            { id: 'first', type: 'delete_drone', status: 'completed' },
            { id: 'second', type: 'delete_drone', status: 'completed' },
          ],
        }}
        executing={false}
        companionStatus="completed"
        droneNames={{ 'drone-one': 'Refactoring opportunities review', 'drone-two': 'Security code review' }}
        resolveDroneName={() => null}
        onExecute={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(appliedHtml.match(/>Applied<\/div>/g)).toHaveLength(1);
    expect(appliedHtml.match(/aria-label="Operation \d applied"/g)).toHaveLength(2);
    expect(appliedHtml).toContain('Delete drone Refactoring opportunities review');
    expect(appliedHtml).toContain('Delete drone Security code review');
  });
});
