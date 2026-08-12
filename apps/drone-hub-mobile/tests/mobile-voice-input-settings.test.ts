import { describe, expect, test } from 'bun:test';
import {
  mobileVoiceInputSilenceMillis,
  normalizeMobileVoiceInputSettings,
} from '../src/local-assistant/mobile-voice-input-settings';

describe('mobile voice input settings', () => {
  test('normalizes corrupt settings to safe defaults', () => {
    expect(normalizeMobileVoiceInputSettings({ customSilenceMillis: 50, language: 'not valid' })).toEqual({
      endThoughtPreset: 'balanced',
      customSilenceMillis: 2_500,
      noiseHandling: 'auto',
      language: null,
      quality: 'fast',
      confirmationFeedback: false,
    });
  });

  test('resolves presets and preserves valid custom settings', () => {
    const settings = normalizeMobileVoiceInputSettings({
      endThoughtPreset: 'custom',
      customSilenceMillis: 3_250,
      noiseHandling: 'noisy',
      language: 'hr-HR',
      quality: 'accurate',
      confirmationFeedback: true,
    });
    expect(mobileVoiceInputSilenceMillis(settings)).toBe(3_250);
    expect(settings.language).toBe('hr-HR');
  });

  test('allows a custom pause down to 250 milliseconds', () => {
    expect(
      normalizeMobileVoiceInputSettings({
        endThoughtPreset: 'custom',
        customSilenceMillis: 250,
      }).customSilenceMillis,
    ).toBe(250);
    expect(
      normalizeMobileVoiceInputSettings({
        endThoughtPreset: 'custom',
        customSilenceMillis: 249,
      }).customSilenceMillis,
    ).toBe(2_500);
  });
});
