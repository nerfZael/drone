import { describe, expect, test } from 'bun:test';

import { readChatReconciliationEntry } from '../src/hub/chat-reconciliation-read';

describe('chat reconciliation reads', () => {
  test('loads metadata and only pending-related turns', () => {
    const rowReads: any[] = [];
    const entry = readChatReconciliationEntry(
      { droneId: 'drone-1', chatName: 'default' },
      {
        readChatMetadataFromStore: () => ({
          available: true,
          chat: { agent: 'codex', model: 'gpt-5' },
        }),
        readChatRowsFromStore: (opts) => {
          rowReads.push(opts);
          return {
            available: true,
            pending: [{ id: 'pending-1' }],
            pendingTurns: [{ id: 'pending-1', output: 'done' }],
          };
        },
      },
    );

    expect(rowReads).toEqual([
      {
        droneId: 'drone-1',
        chatName: 'default',
        indexes: [],
        includePending: true,
      },
    ]);
    expect(entry).toEqual({
      agent: 'codex',
      model: 'gpt-5',
      pendingPrompts: [{ id: 'pending-1' }],
      turns: [{ id: 'pending-1', output: 'done' }],
    });
  });

  test('does not reconcile against an unavailable row snapshot', () => {
    expect(
      readChatReconciliationEntry(
        { droneId: 'drone-1', chatName: 'default' },
        {
          readChatMetadataFromStore: () => ({ available: true, chat: { agent: 'codex' } }),
          readChatRowsFromStore: () => ({ available: false }),
        },
      ),
    ).toBeNull();
  });
});
