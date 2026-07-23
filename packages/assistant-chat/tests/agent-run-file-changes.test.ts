import { describe, expect, test } from 'bun:test';

import {
  agentRunLineChangeBreakdown,
  agentRunNetLineChangeLabel,
} from '../src/agent-run-file-changes';

describe('agent run line change breakdown', () => {
  test('shows replacements separately without double-counting added or deleted lines', () => {
    expect(
      agentRunLineChangeBreakdown({
        additions: 12,
        deletions: 5,
        modified: 3,
      }),
    ).toEqual({ net: 7, added: 9, modified: 3, deleted: 2 });
  });

  test('preserves raw Git totals for older summaries without modified counts', () => {
    expect(agentRunLineChangeBreakdown({ additions: 12, deletions: 5 })).toEqual({
      net: 7,
      added: 12,
      modified: 0,
      deleted: 5,
    });
  });

  test('clamps malformed modified counts to the available replacement pairs', () => {
    expect(
      agentRunLineChangeBreakdown({
        additions: 2,
        deletions: 1,
        modified: 99,
      }),
    ).toEqual({ net: 1, added: 1, modified: 1, deleted: 0 });
  });

  test('formats positive, negative, and balanced net changes explicitly', () => {
    expect(agentRunNetLineChangeLabel(7)).toBe('+7');
    expect(agentRunNetLineChangeLabel(-7)).toBe('-7');
    expect(agentRunNetLineChangeLabel(0)).toBe('±0');
  });
});
