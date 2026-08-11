import { describe, expect, test } from 'bun:test';
import {
  mergeDraftWithContinuousDictation,
  restoreContinuousDictationLines,
} from '../src/droneHub/chat/continuous-dictation-draft';

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

describe('restoreContinuousDictationLines', () => {
  test('restores concurrent failed submissions in their original order', () => {
    const first = [{ id: 'first', text: 'First thought', order: 0 }];
    const second = [{ id: 'second', text: 'Second thought', order: 1 }];

    const afterFirstFailure = restoreContinuousDictationLines([], first);
    const afterSecondFailure = restoreContinuousDictationLines(afterFirstFailure, second);

    expect(afterSecondFailure.map((line) => line.text)).toEqual([
      'First thought',
      'Second thought',
    ]);
  });

  test('does not duplicate a line that is already present', () => {
    const line = { id: 'thought', text: 'One thought', order: 0 };
    expect(restoreContinuousDictationLines([line], [line])).toEqual([line]);
  });
});
