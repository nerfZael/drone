import { describe, expect, test } from 'bun:test';
import { isStoppedRunError, stoppedRunDetail } from '../src';

describe('run stop presentation', () => {
  test('recognizes the canonical stopped outcomes without treating ordinary failures as stops', () => {
    expect(isStoppedRunError('Stopped by user.')).toBe(true);
    expect(isStoppedRunError('Stopped before submission.')).toBe(true);
    expect(isStoppedRunError('Stopped because the drone was restarted.')).toBe(true);
    expect(isStoppedRunError('Assistant run was stopped')).toBe(true);
    expect(isStoppedRunError('Agent process stopped unexpectedly')).toBe(false);
  });

  test('uses message-safe stopped copy', () => {
    expect(stoppedRunDetail('Stopped by user.')).toBe('Stopped by you.');
    expect(stoppedRunDetail('Stopped before submission.')).toBe('Stopped before it was sent.');
  });
});
