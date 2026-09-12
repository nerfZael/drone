import { describe, expect, test } from 'bun:test';
import type { CompanionProposal } from '@drone/assistant-chat';
import {
  mobileProposalApplyLabel,
  mobileProposalCreatedInStep,
  mobileProposalCreationDetailRows,
  mobileProposalCreationPills,
  mobileProposalDroneLabel,
  mobileProposalHeadline,
  mobileProposalLocation,
  mobileProposalOperationDetailRows,
  mobileProposalStatus,
} from '../src/local-assistant/mobile-companion-proposal-model';

const proposal: CompanionProposal = {
  version: 1,
  title: 'Set up review',
  summary: '',
  operations: [
    { id: 'new', type: 'create_drone', name: 'reviewer', prompt: 'Review the PR', repoPath: '/repos/drone', group: 'Review', agent: 'builtin:codex', model: 'gpt-5', reasoning: 'high' },
    { id: 'msg', type: 'send_message', droneId: '$new', message: 'Start with the diff', delivery: 'asap' },
    { id: 'rename', type: 'rename_drone', droneId: 'drone-1', newName: 'archive' },
  ],
};
const names = (droneId: string) => (droneId === 'drone-1' ? 'main' : null);

describe('mobile Companion proposal model', () => {
  test('headlines carry a colored action verb and named subjects like desktop', () => {
    const label = (droneId: string) => mobileProposalDroneLabel(proposal, droneId, names);
    expect(mobileProposalHeadline(proposal.operations[0]!, label)).toEqual({
      kind: 'create', action: 'Create drone', parts: [{ text: 'reviewer', name: true }],
    });
    expect(mobileProposalHeadline(proposal.operations[1]!, label)).toEqual({
      kind: 'message', action: 'Send message', parts: [{ text: ' to' }, { text: 'reviewer', name: true }].map((part, index) => index === 0 ? { text: ' to ' } : part),
    });
    expect(mobileProposalHeadline(proposal.operations[2]!, label)).toEqual({
      kind: 'rename', action: 'Rename drone', parts: [{ text: 'main', name: true }, { text: ' to ' }, { text: 'archive', name: true }],
    });
  });

  test('resolves step references and unknown drones', () => {
    const label = (droneId: string) => mobileProposalDroneLabel(proposal, droneId, names);
    for (const [sourceDroneId, expected] of [['drone-1', 'main'], ['$new', 'reviewer']]) {
      expect(mobileProposalHeadline({ id: 'clone', type: 'clone_drone', sourceDroneId: sourceDroneId!, name: 'copy' }, label).parts[0])
        .toEqual({ text: expected, name: true });
    }
    expect(mobileProposalDroneLabel(proposal, '$new', names)).toBe('reviewer');
    expect(mobileProposalDroneLabel(proposal, 'drone-1', names)).toBe('main');
    expect(mobileProposalDroneLabel(proposal, 'drone-9', names)).toBe('drone-9');
    expect(mobileProposalCreatedInStep(proposal, '$new')).toBe(1);
    expect(mobileProposalCreatedInStep(proposal, 'drone-1')).toBeNull();
  });

  test('creation steps show explicit settings as pills and inherited ones as saved defaults', () => {
    const create = proposal.operations[0] as Extract<CompanionProposal['operations'][number], { type: 'create_drone' }>;
    expect(mobileProposalLocation(create, '/fallback')).toEqual({ repository: 'drone', groupPath: 'drone / Review' });
    expect(mobileProposalCreationPills(create).map((pill) => [pill.key, pill.label, pill.tone])).toEqual([
      ['agent', 'Codex', 'accent'],
      ['model', 'GPT-5 · High', 'info'],
    ]);
    const rows = Object.fromEntries(mobileProposalCreationDetailRows(create, '/fallback').map((row) => [row.label, row.value]));
    expect(rows).toMatchObject({ Repository: 'drone', Group: 'Review', Runtime: 'Saved default', Agent: 'Codex', 'Persist volume': 'Saved default' });
    expect(rows).not.toHaveProperty('Remote branch');
    expect(mobileProposalOperationDetailRows(proposal.operations[1]!, '')).toEqual([]);
  });

  test('status and apply labels follow the execution outcome', () => {
    expect(mobileProposalStatus(null)).toBeNull();
    expect(mobileProposalStatus({ ok: true, operations: [] })).toEqual({ tone: 'success', label: 'Applied' });
    expect(mobileProposalStatus({ ok: false, operations: [{ id: 'a', type: 'create_group', status: 'completed' }, { id: 'b', type: 'create_group', status: 'failed' }] }))
      .toEqual({ tone: 'warning', label: 'Partially applied' });
    expect(mobileProposalStatus({ ok: false, operations: [{ id: 'a', type: 'create_group', status: 'failed' }] }))
      .toEqual({ tone: 'danger', label: 'Apply failed' });
    expect(mobileProposalApplyLabel(true, null)).toBe('Applying…');
    expect(mobileProposalApplyLabel(false, { ok: false, operations: [] })).toBe('Discard to retry');
    expect(mobileProposalApplyLabel(false, null)).toBe('Apply proposal');
  });
});
