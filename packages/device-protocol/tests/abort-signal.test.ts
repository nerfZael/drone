import { expect, test } from 'bun:test';
import { throwIfAborted } from '../src/abort-signal';

test('portable cancellation handles missing signals and old signals without prototype helpers', () => {
  expect(() => throwIfAborted()).not.toThrow();
  expect(() => throwIfAborted(null)).not.toThrow();
  expect(() => throwIfAborted({ aborted: false })).not.toThrow();
  try {
    throwIfAborted({ aborted: true });
    throw new Error('Expected cancellation');
  } catch (error: any) {
    expect(error.name).toBe('AbortError');
  }
});

test('portable cancellation preserves a supplied reason', () => {
  for (const reason of [new Error('Cancelled'), 'reason', null, 42]) {
    let caught: unknown;
    try {
      throwIfAborted({ aborted: true, reason });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
  }
});
