import { describe, expect, test } from 'bun:test';
import { clonedAssistantThreadTitle } from '../src/local-assistant/cloned-assistant-thread-title';

describe('cloned assistant thread title', () => {
  test('uses a copy suffix and avoids existing titles', () => {
    expect(clonedAssistantThreadTitle('Plan', [])).toBe('Plan (copy)');
    expect(
      clonedAssistantThreadTitle('Plan', [{ title: 'Plan (copy)' }, { title: 'Plan (copy 2)' }]),
    ).toBe('Plan (copy 3)');
  });

  test('keeps generated titles within the stored title limit', () => {
    expect(clonedAssistantThreadTitle('x'.repeat(200), []).length).toBeLessThanOrEqual(160);
  });
});
