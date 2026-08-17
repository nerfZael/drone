import { describe, expect, test } from 'bun:test';
import { resolveMobileCompanionVoiceStatus } from '../src/local-assistant/mobile-companion-voice-model';

describe('mobile Companion microphone ownership', () => {
  test('ignores a chat composer recording', () => {
    expect(
      resolveMobileCompanionVoiceStatus({
        companionStatus: 'idle',
        microphoneOwner: 'single-shot',
        voiceStatus: 'recording',
      }),
    ).toBe('idle');
  });

  test('reflects a recording owned by Companion', () => {
    expect(
      resolveMobileCompanionVoiceStatus({
        companionStatus: 'idle',
        microphoneOwner: 'companion',
        voiceStatus: 'recording',
      }),
    ).toBe('recording');
    expect(
      resolveMobileCompanionVoiceStatus({
        companionStatus: 'idle',
        microphoneOwner: 'companion',
        voiceStatus: 'stopped',
      }),
    ).toBe('transcribing');
  });

  test('keeps Companion transcribing after the physical microphone is released', () => {
    expect(
      resolveMobileCompanionVoiceStatus({
        companionStatus: 'idle',
        companionVoiceSessionActive: true,
        microphoneOwner: null,
        voiceStatus: 'transcribing',
      }),
    ).toBe('transcribing');
  });

  test('preserves an active Companion run when its microphone is idle', () => {
    expect(
      resolveMobileCompanionVoiceStatus({
        companionStatus: 'working',
        microphoneOwner: null,
        voiceStatus: 'idle',
      }),
    ).toBe('working');
  });
});
