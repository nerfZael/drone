import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompanionProposal, CompanionProposalExecutionItem } from '@drone/assistant-chat';
import { createCompanionActionReporter, type CompanionActionNotification } from '../src/droneHub/companion/companion-action-notifications';
import { CompanionActionNotifications } from '../src/droneHub/companion/CompanionActionNotifications';

const proposal: CompanionProposal = {
  version: 1,
  title: 'Start review',
  operations: [
    { id: 'create', type: 'create_drone', prompt: 'Review' },
    { id: 'send', type: 'send_message', droneId: '$create', message: 'Run tests', delivery: 'asap' },
    { id: 'rename', type: 'rename_drone', droneId: 'existing', newName: 'Reviewer' },
  ],
};

describe('Companion action notifications', () => {
  test('reports each completed action once across progress and final results, resolving created drone names', () => {
    const notifications: CompanionActionNotification[] = [];
    const report = createCompanionActionReporter(proposal, {}, (items) => notifications.push(...items));
    const created: CompanionProposalExecutionItem = { id: 'create', type: 'create_drone', status: 'completed', result: { droneId: 'new-id', droneName: 'Review bot' } };
    const sent: CompanionProposalExecutionItem = { id: 'send', type: 'send_message', status: 'completed' };
    report([]);
    expect(notifications).toHaveLength(0);
    report([created]);
    expect(notifications).toHaveLength(1);
    report([created, sent]);
    report([created, sent]);
    expect(notifications.map((item) => item.label)).toEqual(['Create drone “Review bot”', 'Send message to Review bot / default']);
    expect(new Set(notifications.map((item) => item.id)).size).toBe(2);
  });

  test('reports failed actions, omits skipped actions, and allows the same operation ids in a new execution', () => {
    const notifications: CompanionActionNotification[] = [];
    const report = createCompanionActionReporter(proposal, { existing: 'Old name' }, (items) => notifications.push(...items));
    report([
      { id: 'send', type: 'send_message', status: 'skipped' },
      { id: 'rename', type: 'rename_drone', status: 'failed', error: 'Drone unavailable' },
    ]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ label: 'Rename drone Old name to “Reviewer”', status: 'failed', error: 'Drone unavailable' });
    createCompanionActionReporter(proposal, {}, (items) => notifications.push(...items))([
      { id: 'rename', type: 'rename_drone', status: 'completed' },
    ]);
    expect(notifications).toHaveLength(2);
  });

  test('ignores file and window actions and results outside the executed proposal', () => {
    const notifications: CompanionActionNotification[] = [];
    const report = createCompanionActionReporter(proposal, {}, (items) => notifications.push(...items));
    report(['open_file', 'open_drone_chat', 'set_window_layout', 'apply_companion_proposal_patch'].map((type) => ({
      id: 'create', type, status: 'completed',
    })) as CompanionProposalExecutionItem[]);
    report([{ id: 'unrelated', type: 'create_drone', status: 'completed' }]);
    expect(notifications).toEqual([]);
  });

  test('renders accessible success and failure notifications with dismissal controls', () => {
    const html = renderToStaticMarkup(<CompanionActionNotifications notifications={[
      { id: '1', label: 'Create drone “Reviewer”', status: 'completed', createdAt: Date.now() },
      { id: '2', label: 'Send message to Reviewer', status: 'failed', error: 'Chat unavailable', createdAt: Date.now() },
    ]} onDismiss={() => {}} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Completed');
    expect(html).toContain('Failed');
    expect(html).toContain('Chat unavailable');
    expect(html).toContain('Dismiss notification:');
  });
});
