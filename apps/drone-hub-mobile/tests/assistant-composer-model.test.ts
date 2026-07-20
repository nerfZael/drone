import { describe, expect, test } from 'bun:test';
import { mobileAssistantComposerExpanded } from '../src/local-assistant/assistant-composer-model';

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
});
