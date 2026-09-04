import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanionProposalCard, creationDetailRows } from '../src/droneHub/companion/CompanionProposalCard';

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
    // The title lives in the footer and toggles the description, collapsed by default.
    expect(html).toContain('title="Show description"');
    expect(html).not.toContain('id="proposal-description"');
    expect(html).not.toContain('Create a draft and queue a follow-up.');
    expect(html).toContain('Create draft drone');
    expect(html).toContain('Send message');
    expect(html).toContain('↑ Step 1');
    expect(html).toContain('Reviewer');
    expect(html).toContain('/workspace/repo');
    expect(html).toContain('/workspace/repo / Ungrouped');
    expect(html).toContain('Preview full initial message and group path for Reviewer');
    expect(html).toContain('Review.');
    expect(html).toContain('Check tests.');
    expect(html).toContain('Apply proposal');
    expect(html).toContain('Discard');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('review details for Create draft drone');
    expect(html).not.toContain('>Review details</summary>');
    expect(html).toContain('text-[var(--fg)]');
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

    expect(html).toContain('Send message');
    expect(html).toContain('Send immediately');
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

  test('keeps clone semantics and explicit creation overrides behind item disclosures', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalCard
        proposal={{
          version: 1,
          title: 'Configured clones',
          operations: [
            {
              id: 'create',
              type: 'create_drone',
              name: 'Reviewer',
              prompt: 'Review the branch.',
              group: 'Backend/Payments',
              runtime: 'host',
              agent: 'native',
              provider: 'codex',
              model: 'gpt-5.3-codex',
              agentPermissionMode: 'write',
              approvalPolicy: 'none',
              repoBranchSource: 'host',
            },
            {
              id: 'clone-chat',
              type: 'clone_chat',
              droneId: '$create',
              sourceChat: 'default',
              chatName: 'review-copy',
            },
            {
              id: 'clone-drone',
              type: 'clone_drone',
              sourceDroneId: 'source-drone',
              name: 'source-copy',
            },
          ],
        }}
        defaultRepoPath="/workspace/repo"
        execution={null}
        executing={false}
        companionStatus="completed"
        onExecute={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(html).toContain('Backend/Payments');
    expect(html).toContain('aria-controls="proposal-operation-details-create"');
    expect(html).toContain('aria-controls="proposal-operation-details-clone-chat"');
    // Runtime, agent and model surface inline as pills; the rest stays behind the disclosure.
    expect(html).toContain('>Host<');
    expect(html).toContain('>Built-in<');
    expect(html).toContain('>GPT-5.3 Codex<');
    expect(html).not.toContain('>Runtime<');
    expect(html).not.toContain('>Approval policy<');
    // A later step that targets the drone created earlier links back to that step.
    expect(html).toContain('↑ Step 1');
    expect(html).toContain('Clone chat');
    expect(html).not.toContain('>Clone history from<');
    expect(html).toContain('Clone drone');
    expect(html).toContain('source-drone');
    expect(html).toContain('source-copy');
  });

  test('fills omitted creation settings from saved defaults and marks them as such', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalCard
        proposal={{
          version: 1,
          title: 'Spin up a reviewer',
          operations: [
            { id: 'create', type: 'create_drone', name: 'Reviewer', prompt: 'Review.', model: 'claude-sonnet-5' },
          ],
        }}
        defaultRepoPath="/workspace/repo"
        execution={null}
        executing={false}
        companionStatus="completed"
        resolveCreationDefaults={() => ({
          mode: 'with-chat',
          runtime: 'container',
          persistVolume: true,
          spawnAgentKey: 'builtin:claude',
          spawnModel: 'gpt-5.3-codex',
          spawnReasoning: 'high',
          spawnAgentPermissionMode: 'write',
          spawnApprovalPolicy: 'auto',
          repoBranchSource: 'host',
          repoCreateRemoteBranch: '',
        })}
        onExecute={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    // Inline pills: inherited runtime/agent, explicit model joined with the inherited reasoning.
    expect(html).toContain('>Container<');
    expect(html).toContain('>Claude Code<');
    expect(html).toContain('>claude-sonnet-5 · High<');
    expect(html).toContain('title="Agent (saved default)"');
    expect(html).not.toContain('Saved default');
  });

  test('detail rows show resolved default values and label them', () => {
    const operation = {
      id: 'create',
      type: 'create_drone' as const,
      name: 'Reviewer',
      prompt: 'Review.',
      runtime: 'host' as const,
    };
    const defaults = {
      mode: 'with-chat' as const,
      runtime: 'container' as const,
      persistVolume: true,
      spawnAgentKey: 'builtin:claude',
      spawnModel: 'gpt-5.3-codex',
      spawnReasoning: 'high',
      spawnAgentPermissionMode: 'write' as const,
      spawnApprovalPolicy: 'auto' as const,
      repoBranchSource: 'host' as const,
      repoCreateRemoteBranch: '',
    };
    const rows = creationDetailRows('/workspace/repo', operation, defaults);
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(byLabel.Runtime).toBe('Host');
    expect(byLabel.Agent).toBe('Claude Code (default)');
    expect(byLabel.Model).toBe('GPT-5.3 Codex (default)');
    expect(byLabel.Reasoning).toBe('High (default)');
    expect(byLabel['Persist volume']).toBe('On (default)');
    expect(byLabel['Approval policy']).toBe('Auto (default)');

    const unresolved = creationDetailRows('/workspace/repo', operation, null);
    expect(unresolved.find((row) => row.label === 'Agent')?.value).toBe('Saved default');
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
    expect(applyingHtml).toContain('Delete drone');
    expect(applyingHtml).toContain('Refactoring opportunities review');
    expect(applyingHtml).toContain('Security code review');
    expect(applyingHtml).not.toContain('drone-one');
    expect(applyingHtml).not.toContain('drone-two');

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

    // The Apply button carries the success state; no separate status pill duplicates it.
    expect(appliedHtml.match(/>Applied</g)).toHaveLength(1);
    expect(appliedHtml).toContain('>Applied</button>');
    expect(appliedHtml.match(/aria-label="Operation \d applied"/g)).toHaveLength(2);
    expect(appliedHtml).toContain('Refactoring opportunities review');
    expect(appliedHtml).toContain('Security code review');
  });
});
