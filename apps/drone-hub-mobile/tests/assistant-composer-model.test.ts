import { describe, expect, test } from 'bun:test';
import {
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

  test('hides the assistant stop action while voice recording is active', () => {
    expect(
      mobileAssistantStopVisible({ running: true, hasStopAction: true, voiceActive: false }),
    ).toBe(true);
    expect(
      mobileAssistantStopVisible({ running: true, hasStopAction: true, voiceActive: true }),
    ).toBe(false);
  });
});
