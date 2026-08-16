import { describe, expect, test } from 'bun:test';

import {
  executeCompanionProposal,
  companionProposalOperationDetails,
  companionProposalOperationLabel,
  parseCompanionProposalText,
  serializeCompanionProposal,
  validateCompanionProposal,
} from '../src/companion-proposal';

function executor(overrides: Record<string, (...args: any[]) => Promise<any>> = {}) {
  const complete = async () => ({ ok: true });
  return {
    createGroup: complete,
    deleteGroup: complete,
    renameGroup: complete,
    createDrone: async () => ({ droneId: 'created-drone', droneName: 'Created' }),
    deleteDrone: complete,
    renameDrone: complete,
    createChat: complete,
    deleteChat: complete,
    renameChat: complete,
    sendMessage: complete,
    ...overrides,
  };
}

describe('Companion proposal contract', () => {
  test('accepts ordered operations that target a newly created drone', () => {
    const proposal = validateCompanionProposal({
      version: 1,
      title: 'Create a review drone',
      summary: 'Create it as a draft and queue two tasks.',
      operations: [
        {
          id: 'create-reviewer',
          type: 'create_drone',
          name: 'Reviewer',
          prompt: 'Review the repository.',
          repoPath: '/repo',
          draft: true,
        },
        {
          id: 'follow-up',
          type: 'send_message',
          droneId: '$create-reviewer',
          message: 'Also check test coverage.',
          delivery: 'queue',
        },
      ],
    });

    expect(proposal.operations).toHaveLength(2);
    expect(parseCompanionProposalText(serializeCompanionProposal(proposal))).toEqual(proposal);
  });

  test('rejects forward and non-create drone references', () => {
    expect(() => validateCompanionProposal({
      version: 1,
      title: 'Invalid order',
      operations: [
        { id: 'message', type: 'send_message', droneId: '$later', message: 'Hello' },
        { id: 'later', type: 'create_drone', prompt: 'Start.' },
      ],
    })).toThrow('earlier create_drone');
  });

  test('rejects unknown operation fields and invalid JSON', () => {
    expect(() => validateCompanionProposal({
      version: 1,
      title: 'Unknown field',
      operations: [
        { id: 'create', type: 'create_group', name: 'Review', executeNow: true },
      ],
    })).toThrow('unknown field');
    expect(() => parseCompanionProposalText('{ invalid')).toThrow('INVALID_PROPOSAL_JSON');
  });

  test('normalizes empty optional identifiers away and preserves an explicit repositoryless scope', () => {
    const proposal = validateCompanionProposal({
      version: 1,
      title: 'Normalize optionals',
      operations: [{
        id: 'message',
        type: 'send_message',
        droneId: 'drone-1',
        chatName: '   ',
        message: 'Hello',
      }, {
        id: 'group',
        type: 'create_group',
        name: 'Inbox',
        repoPath: '   ',
      }],
    });

    expect(proposal.operations[0]).not.toHaveProperty('chatName');
    expect(proposal.operations[1]).toMatchObject({ repoPath: '' });
  });

  test('exposes exact message and captured repository details for review', () => {
    expect(companionProposalOperationDetails({
      id: 'create',
      type: 'create_drone',
      prompt: 'Review every changed file.',
    }, '/repo')).toEqual([
      { label: 'Repository', value: '/repo' },
      { label: 'Group', value: 'Ungrouped' },
      { label: 'Initial prompt', value: 'Review every changed file.' },
    ]);
  });

  test('uses a resolved drone name in operation labels', () => {
    expect(companionProposalOperationLabel({
      id: 'message',
      type: 'send_message',
      droneId: 'drone-uuid',
      message: 'Ship it.',
      delivery: 'asap',
    }, 'Review Prompt and Shot Architecture')).toBe(
      'Send message to Review Prompt and Shot Architecture / default',
    );
  });

  test('resolves created drone references before running later operations', async () => {
    const targets: string[] = [];
    const result = await executeCompanionProposal({
      version: 1,
      title: 'Create and message',
      operations: [
        { id: 'create', type: 'create_drone', prompt: 'First task', draft: true },
        { id: 'follow-up', type: 'send_message', droneId: '$create', message: 'Second task' },
      ],
    }, executor({
      sendMessage: async (operation) => {
        targets.push(operation.droneId);
        return { promptId: 'prompt-1' };
      },
    }));

    expect(targets).toEqual(['created-drone']);
    expect(result.ok).toBe(true);
    expect(result.operations.map((item) => item.status)).toEqual(['completed', 'completed']);
  });

  test('reports the active operation and completed work while executing', async () => {
    const progress: Array<{ activeOperationId: string | null; statuses: string[] }> = [];
    await executeCompanionProposal({
      version: 1,
      title: 'Delete two drones',
      operations: [
        { id: 'first', type: 'delete_drone', droneId: 'drone-1' },
        { id: 'second', type: 'delete_drone', droneId: 'drone-2' },
      ],
    }, executor(), {
      onProgress: (update) => progress.push({
        activeOperationId: update.activeOperationId,
        statuses: update.operations.map((item) => item.status),
      }),
    });

    expect(progress).toEqual([
      { activeOperationId: 'first', statuses: [] },
      { activeOperationId: null, statuses: ['completed'] },
      { activeOperationId: 'second', statuses: ['completed'] },
      { activeOperationId: null, statuses: ['completed', 'completed'] },
    ]);
  });

  test('stops after a failure and marks remaining operations skipped', async () => {
    const result = await executeCompanionProposal({
      version: 1,
      title: 'Fail safely',
      operations: [
        { id: 'rename', type: 'rename_drone', droneId: 'drone-1', newName: 'New name' },
        { id: 'delete', type: 'delete_drone', droneId: 'drone-2' },
      ],
    }, executor({
      renameDrone: async () => { throw new Error('rename conflict'); },
    }));

    expect(result.ok).toBe(false);
    expect(result.operations).toMatchObject([
      { id: 'rename', status: 'failed', error: 'rename conflict' },
      { id: 'delete', status: 'skipped' },
    ]);
  });
});
