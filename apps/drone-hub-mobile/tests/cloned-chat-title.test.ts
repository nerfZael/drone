import { describe, expect, test } from 'bun:test';
import { clonedChatTitle } from '../src/local-assistant/cloned-chat-title';

describe('cloned built-in chat title', () => {
  test('uses a copy suffix and avoids existing titles', () => {
    expect(clonedChatTitle('Plan', [])).toBe('Plan (copy)');
    expect(
      clonedChatTitle('Plan', [{ title: 'Plan (copy)' }, { title: 'Plan (copy 2)' }]),
    ).toBe('Plan (copy 3)');
  });

  test('keeps generated titles within the stored title limit', () => {
    expect(clonedChatTitle('x'.repeat(200), []).length).toBeLessThanOrEqual(160);
  });
});
