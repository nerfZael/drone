import { describe, expect, test } from 'bun:test';
import { getRelativeTimeUpdateDelayMs } from '../src/droneHub/chat/relative-time-schedule';

describe('relative time update schedule', () => {
  test('updates recent timestamps at the next second boundary', () => {
    const atMs = new Date('2026-02-10T12:00:00.000Z').getTime();

    expect(getRelativeTimeUpdateDelayMs(atMs, atMs)).toBe(1000);
    expect(getRelativeTimeUpdateDelayMs(atMs, atMs + 1234)).toBe(766);
    expect(getRelativeTimeUpdateDelayMs(atMs, atMs + 59_999)).toBe(1);
  });

  test('backs off once labels are in minutes and hours', () => {
    const atMs = new Date('2026-02-10T12:00:00.000Z').getTime();

    expect(getRelativeTimeUpdateDelayMs(atMs, atMs + 60_000)).toBe(30_000);
    expect(getRelativeTimeUpdateDelayMs(atMs, atMs + 59 * 60_000)).toBe(30_000);
    expect(getRelativeTimeUpdateDelayMs(atMs, atMs + 60 * 60_000)).toBe(60_000);
    expect(getRelativeTimeUpdateDelayMs(atMs, atMs + 24 * 60 * 60_000)).toBe(60_000);
  });

  test('waits for future timestamps and ignores invalid inputs', () => {
    const nowMs = new Date('2026-02-10T12:00:00.000Z').getTime();

    expect(getRelativeTimeUpdateDelayMs(nowMs + 5000, nowMs)).toBe(5000);
    expect(getRelativeTimeUpdateDelayMs(nowMs + 5 * 60_000, nowMs)).toBe(60_000);
    expect(getRelativeTimeUpdateDelayMs(NaN, nowMs)).toBeNull();
    expect(getRelativeTimeUpdateDelayMs(nowMs, NaN)).toBeNull();
  });
});
