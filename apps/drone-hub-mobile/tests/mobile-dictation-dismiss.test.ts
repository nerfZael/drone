import { describe, expect, test } from 'bun:test';
import {
  mobileDictationDismissDistance,
  mobileDictationDismissProgress,
  mobileDictationShouldDismiss,
} from '../src/local-assistant/mobile-dictation-dismiss';

describe('mobile dictation pull-down dismissal', () => {
  test('requires most of the recorder card to be pulled down', () => {
    expect(mobileDictationDismissDistance(200)).toBeCloseTo(116);
    expect(
      mobileDictationDismissProgress({
        translationX: 4,
        translationY: 58,
        cardHeight: 200,
      }),
    ).toBeCloseTo(0.5);
    expect(
      mobileDictationShouldDismiss({
        translationX: 4,
        translationY: 116,
        cardHeight: 200,
      }),
    ).toBe(true);
  });

  test('snaps back after small, upward, or mostly horizontal drags', () => {
    const cardHeight = 200;
    expect(mobileDictationShouldDismiss({ translationX: 3, translationY: 40, cardHeight })).toBe(
      false,
    );
    expect(mobileDictationShouldDismiss({ translationX: 3, translationY: -140, cardHeight })).toBe(
      false,
    );
    expect(mobileDictationShouldDismiss({ translationX: 170, translationY: 120, cardHeight })).toBe(
      false,
    );
  });

  test('accepts only a substantial fast downward flick', () => {
    const cardHeight = 200;
    expect(
      mobileDictationShouldDismiss({
        translationX: 8,
        translationY: 54,
        velocityY: 1_200,
        cardHeight,
      }),
    ).toBe(true);
    expect(
      mobileDictationShouldDismiss({
        translationX: 8,
        translationY: 30,
        velocityY: 1_400,
        cardHeight,
      }),
    ).toBe(false);
  });
});
