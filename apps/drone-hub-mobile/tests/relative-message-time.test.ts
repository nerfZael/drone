import { describe, expect, test } from 'bun:test';
import { relativeMessageTime } from '../src/local-assistant/relative-message-time';

describe('compact relative message time', () => {
  const now = Date.parse('2026-07-14T12:00:00.000Z');

  test('uses compact lowercase units', () => {
    expect(relativeMessageTime('2026-07-14T11:59:40.000Z', now)).toBe('20s');
    expect(relativeMessageTime('2026-07-14T11:59:01.000Z', now)).toBe('59s');
    expect(relativeMessageTime('2026-07-14T11:21:00.000Z', now)).toBe('39m');
    expect(relativeMessageTime('2026-07-14T11:00:00.000Z', now)).toBe('1h');
    expect(relativeMessageTime('2026-07-12T12:00:00.000Z', now)).toBe('2d');
    expect(relativeMessageTime('2026-06-30T12:00:00.000Z', now)).toBe('2w');
  });

  test('accepts millisecond timestamps from assistant messages', () => {
    expect(relativeMessageTime(now - 42_000, now)).toBe('42s');
  });

  test('omits missing or invalid timestamps', () => {
    expect(relativeMessageTime('', now)).toBe('');
    expect(relativeMessageTime('not-a-date', now)).toBe('');
  });
});
