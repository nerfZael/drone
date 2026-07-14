import { describe, expect, test } from 'bun:test';
import { nextAssistantThreadTitle } from '../src/local-assistant/next-assistant-thread-title';

describe('new assistant thread titles', () => {
  test('uses plain sequential Thread names without renaming legacy threads', () => {
    expect(nextAssistantThreadTitle([{ title: 'Phone thread 1' }])).toBe('Thread 1');
    expect(nextAssistantThreadTitle([{ title: 'Thread 1' }, { title: 'Phone thread 2' }])).toBe(
      'Thread 2',
    );
    expect(nextAssistantThreadTitle([{ title: 'Thread 1' }, { title: 'Thread 3' }])).toBe(
      'Thread 2',
    );
  });
});
