import { describe, expect, test } from 'bun:test';
import {
  normalizeVoiceInputSilenceMillis,
  VOICE_INPUT_SILENCE_MILLIS_MAX,
  VOICE_INPUT_SILENCE_MILLIS_MIN,
} from '../src/droneHub/chat/voice-input-silence';

describe('voice input silence settings', () => {
  test('accepts pauses down to 250 milliseconds', () => {
    expect(VOICE_INPUT_SILENCE_MILLIS_MIN).toBe(250);
    expect(normalizeVoiceInputSilenceMillis(250, 2_500)).toBe(250);
    expect(normalizeVoiceInputSilenceMillis(249, 2_500)).toBe(2_500);
  });

  test('rejects invalid and out-of-range values', () => {
    expect(normalizeVoiceInputSilenceMillis(VOICE_INPUT_SILENCE_MILLIS_MAX, 2_500)).toBe(10_000);
    expect(normalizeVoiceInputSilenceMillis(10_001, 2_500)).toBe(2_500);
    expect(normalizeVoiceInputSilenceMillis('invalid', 2_500)).toBe(2_500);
  });
});
