import { describe, expect, test } from 'bun:test';
import { draftChatInputResetKey, newDraftChatFocusKey } from '../src/droneHub/app/helpers';

describe('draft chat focus behavior', () => {
  test('changes reset key when opening another new chat with the same prompt id', () => {
    const prompt = { id: 'draft-123' };
    const first = draftChatInputResetKey({ focusKey: 'focus-a', prompt });
    const second = draftChatInputResetKey({ focusKey: 'focus-b', prompt });
    expect(first).not.toBe(second);
  });

  test('builds deterministic focus keys for a given timestamp/random seed', () => {
    const first = newDraftChatFocusKey(1_700_000_000_000, 0.111111);
    const second = newDraftChatFocusKey(1_700_000_000_000, 0.222222);
    expect(first.startsWith('draft-open-')).toBe(true);
    expect(second.startsWith('draft-open-')).toBe(true);
    expect(first).not.toBe(second);
  });
});
