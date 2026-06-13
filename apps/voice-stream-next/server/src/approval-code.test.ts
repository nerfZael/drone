import { describe, expect, test } from 'bun:test';

import { ApprovalCodeRecognizer, approvalCodeFromText } from './approval-code.js';

describe('ApprovalCodeRecognizer', () => {
  test('requires the exact approval code phrase before collecting digits', () => {
    const recognizer = new ApprovalCodeRecognizer();

    expect(recognizer.accept('approval one two three four', 0)).toEqual({ type: 'none' });
    expect(recognizer.accept('code one two three four', 0)).toEqual({ type: 'none' });
    expect(recognizer.accept('approval code', 0)).toEqual({ type: 'collecting', partialCode: '' });
  });

  test('collects digits across recognizer updates and completes after stable timeout', () => {
    const recognizer = new ApprovalCodeRecognizer();

    expect(recognizer.accept('approval code one two', 0)).toEqual({ type: 'collecting', partialCode: '12' });
    expect(recognizer.accept('approval code one two three four', 200)).toEqual({ type: 'collecting', partialCode: '1234' });
    expect(recognizer.flush(1_099)).toEqual({ type: 'none' });
    expect(recognizer.flush(1_100)).toEqual({ type: 'completed', code: '1234' });
  });

  test('understands digit aliases and caps at eight digits', () => {
    const recognizer = new ApprovalCodeRecognizer();

    expect(recognizer.accept('approval code oh won too tree for five six seven eight nine', 0)).toEqual({
      type: 'completed',
      code: '01234567',
    });
  });

  test('cancels incomplete code collection after timeout', () => {
    const recognizer = new ApprovalCodeRecognizer();

    expect(recognizer.accept('approval code one two', 0)).toEqual({ type: 'collecting', partialCode: '12' });
    expect(recognizer.flush(5_000)).toEqual({ type: 'cancelled' });
  });

  test('honors custom trigger phrase and digit timing settings', () => {
    const recognizer = new ApprovalCodeRecognizer({
      triggerPhrase: 'access code',
      minDigits: 3,
      maxDigits: 6,
      stableMs: 400,
      collectTimeoutMs: 2_000,
      duplicateCooldownMs: 1_000,
    });

    expect(recognizer.accept('access code one two three', 0)).toEqual({ type: 'collecting', partialCode: '123' });
    expect(recognizer.flush(399)).toEqual({ type: 'none' });
    expect(recognizer.flush(400)).toEqual({ type: 'completed', code: '123' });
  });

  test('suppresses duplicate completed codes during cooldown', () => {
    const recognizer = new ApprovalCodeRecognizer();

    expect(recognizer.accept('approval code one two three four', 0)).toEqual({ type: 'collecting', partialCode: '1234' });
    expect(recognizer.flush(900)).toEqual({ type: 'completed', code: '1234' });
    expect(recognizer.accept('approval code one two three four', 1_000)).toEqual({ type: 'collecting', partialCode: '1234' });
    expect(recognizer.flush(1_900)).toEqual({ type: 'none' });
    expect(recognizer.accept('approval code one two three four', 5_000)).toEqual({ type: 'collecting', partialCode: '1234' });
    expect(recognizer.flush(5_900)).toEqual({ type: 'completed', code: '1234' });
  });
});

describe('approvalCodeFromText', () => {
  test('extracts complete codes from a single utterance', () => {
    expect(approvalCodeFromText('approval code one two three four')).toBe('1234');
    expect(approvalCodeFromText('approval code one two')).toBeNull();
  });
});
