import { describe, expect, test } from 'bun:test';

import { pendingCodexApprovalsForNeverAsk } from '../src/hub/codex-never-ask';

const approval = (id: string, promptId = 'prompt-1') => ({
  id,
  promptId,
  threadId: 'thread-1',
  turnId: 'turn-1',
  itemId: `item-${id}`,
  method: 'item/commandExecution/requestApproval' as const,
  kind: 'command_execution' as const,
  availableDecisions: ['accept' as const, 'acceptForSession' as const],
  createdAt: '2026-08-11T00:00:00.000Z',
  status: 'pending' as const,
});

describe('Codex never-ask approval selection', () => {
  test('selects every pending approval for an existing Codex turn', () => {
    expect(
      pendingCodexApprovalsForNeverAsk({
        agent: { kind: 'builtin', id: 'codex' },
        approvalPolicy: 'none',
        pendingPrompts: [
          { id: 'prompt-1', at: '', prompt: 'work', state: 'sent', approvals: [approval('a')] },
          {
            id: 'prompt-2',
            at: '',
            prompt: 'more',
            state: 'sent',
            approvals: [approval('b', 'prompt-2')],
          },
        ],
      }),
    ).toEqual([
      { promptId: 'prompt-1', approvalId: 'a', decision: 'accept' },
      { promptId: 'prompt-2', approvalId: 'b', decision: 'accept' },
    ]);
  });

  test('uses session acceptance when it is the only supported approval choice', () => {
    const sessionOnly = { ...approval('a'), availableDecisions: ['acceptForSession' as const] };
    expect(
      pendingCodexApprovalsForNeverAsk({
        agent: { kind: 'builtin', id: 'codex' },
        approvalPolicy: 'none',
        pendingPrompts: [
          { id: 'prompt-1', at: '', prompt: 'work', state: 'sent', approvals: [sessionOnly] },
        ],
      }),
    ).toEqual([{ promptId: 'prompt-1', approvalId: 'a', decision: 'acceptForSession' }]);
  });

  test('deduplicates an approval projected onto multiple messages in one Codex run', () => {
    const shared = approval('a', 'response-prompt');
    expect(
      pendingCodexApprovalsForNeverAsk({
        agent: { kind: 'builtin', id: 'codex' },
        approvalPolicy: 'none',
        pendingPrompts: [
          { id: 'queued-prompt', at: '', prompt: 'first', state: 'sent', approvals: [shared] },
          { id: 'response-prompt', at: '', prompt: 'second', state: 'sent', approvals: [shared] },
        ],
      }),
    ).toEqual([{ promptId: 'response-prompt', approvalId: 'a', decision: 'accept' }]);
  });

  test('does not auto-approve ask, auto, or non-Codex chats', () => {
    const pendingPrompts = [
      {
        id: 'prompt-1',
        at: '',
        prompt: 'work',
        state: 'sent' as const,
        approvals: [approval('a')],
      },
    ];
    expect(
      pendingCodexApprovalsForNeverAsk({
        agent: { kind: 'builtin', id: 'codex' },
        approvalPolicy: 'ask',
        pendingPrompts,
      }),
    ).toEqual([]);
    expect(
      pendingCodexApprovalsForNeverAsk({
        agent: { kind: 'builtin', id: 'codex' },
        approvalPolicy: 'auto',
        pendingPrompts,
      }),
    ).toEqual([]);
    expect(
      pendingCodexApprovalsForNeverAsk({
        agent: { kind: 'native' },
        approvalPolicy: 'none',
        pendingPrompts,
      }),
    ).toEqual([]);
  });
});
