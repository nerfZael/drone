import { describe, expect, test } from 'bun:test';
import {
  mobileAssistantComposerCollapsesOnBack,
  mobileAssistantComposerExpanded,
  mobileAssistantComposerSwipeProgress,
  mobileAssistantComposerSwipeStartsVoice,
  mobileAssistantStopVisible,
} from '../src/local-assistant/assistant-composer-model';

describe('mobile assistant composer presentation', () => {
  test('does not expand solely because an agent is working', () => {
    expect(
      mobileAssistantComposerExpanded({
        focused: false,
        value: '',
        hasAttachments: false,
        voiceActive: false,
        voiceError: '',
      }),
    ).toBe(false);
  });

  test('still expands for direct composition and voice feedback', () => {
    const base = {
      focused: false,
      value: '',
      hasAttachments: false,
      voiceActive: false,
      voiceError: '',
    };
    expect(mobileAssistantComposerExpanded({ ...base, focused: true })).toBe(true);
    expect(mobileAssistantComposerExpanded({ ...base, value: 'Queued message' })).toBe(true);
    expect(mobileAssistantComposerExpanded({ ...base, hasAttachments: true })).toBe(true);
    expect(mobileAssistantComposerExpanded({ ...base, voiceActive: true })).toBe(true);
  });

  test('hides the assistant stop action while voice recording is active', () => {
    expect(
      mobileAssistantStopVisible({ running: true, hasStopAction: true, voiceActive: false }),
    ).toBe(true);
    expect(
      mobileAssistantStopVisible({ running: true, hasStopAction: true, voiceActive: true }),
    ).toBe(false);
  });

  test('collapses an empty focused composer before Android can exit the app', () => {
    const emptyFocused = {
      focused: true,
      value: '',
      hasAttachments: false,
      voiceActive: false,
      alwaysExpanded: false,
    };
    expect(mobileAssistantComposerCollapsesOnBack(emptyFocused)).toBe(true);
    expect(mobileAssistantComposerCollapsesOnBack({ ...emptyFocused, value: 'Draft' })).toBe(false);
    expect(mobileAssistantComposerCollapsesOnBack({ ...emptyFocused, focused: false })).toBe(false);
    expect(mobileAssistantComposerCollapsesOnBack({ ...emptyFocused, alwaysExpanded: true })).toBe(
      false,
    );
  });

  test('starts voice only for a deliberate upward composer swipe', () => {
    expect(mobileAssistantComposerSwipeStartsVoice({ translationX: 24, translationY: -34 })).toBe(
      true,
    );
    expect(
      mobileAssistantComposerSwipeStartsVoice({
        translationX: 6,
        translationY: -14,
        velocityY: -700,
      }),
    ).toBe(true);
    expect(mobileAssistantComposerSwipeStartsVoice({ translationX: 8, translationY: -14 })).toBe(
      false,
    );
    expect(mobileAssistantComposerSwipeStartsVoice({ translationX: 70, translationY: -30 })).toBe(
      false,
    );
    expect(mobileAssistantComposerSwipeStartsVoice({ translationX: 8, translationY: 52 })).toBe(
      false,
    );
  });

  test('tracks swipe progress in both directions before recording is armed', () => {
    expect(mobileAssistantComposerSwipeProgress({ translationX: 4, translationY: -16 })).toBe(0.25);
    expect(mobileAssistantComposerSwipeProgress({ translationX: 4, translationY: -48 })).toBe(0.75);
    expect(mobileAssistantComposerSwipeProgress({ translationX: 4, translationY: -8 })).toBe(0.125);
    expect(mobileAssistantComposerSwipeProgress({ translationX: 4, translationY: 8 })).toBe(0);
  });
});
