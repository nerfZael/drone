import { describe, expect, test } from 'bun:test';
import { mergeDraftWithContinuousDictation } from '../src/droneHub/chat/continuous-dictation-draft';

describe('mergeDraftWithContinuousDictation', () => {
  test('uses dictation as the entire prompt when the draft is empty', () => {
    expect(mergeDraftWithContinuousDictation('', 'first thought')).toBe('first thought');
  });

  test('places dictated thoughts on new lines after an existing draft', () => {
    expect(
      mergeDraftWithContinuousDictation('Existing instructions  ', 'first thought\nsecond thought'),
    ).toBe('Existing instructions\nfirst thought\nsecond thought');
  });

  test('ignores an empty dictation value', () => {
    expect(mergeDraftWithContinuousDictation('keep this  ', '   ')).toBe('keep this  ');
  });
});
