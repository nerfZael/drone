import { describe, expect, test } from 'bun:test';
import {
  mobileAssistantComposerCollapsesOnBack,
  mobileAssistantComposerExpanded,
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

  test('collapses to one line while the Companion sheet is open unless typing or recording', () => {
    const base = { focused: false, value: 'Draft written by Companion', hasAttachments: true, voiceActive: false, voiceError: '', collapsedByCompanion: true };
    expect(mobileAssistantComposerExpanded(base)).toBe(false);
    expect(mobileAssistantComposerExpanded({ ...base, focused: true })).toBe(true);
    expect(mobileAssistantComposerExpanded({ ...base, voiceActive: true })).toBe(true);
    expect(mobileAssistantComposerExpanded({ ...base, voiceError: 'Microphone unavailable' })).toBe(true);
    expect(mobileAssistantComposerExpanded({ ...base, collapsedByCompanion: false })).toBe(true);
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
});
