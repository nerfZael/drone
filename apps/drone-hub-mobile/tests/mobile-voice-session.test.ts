import { describe, expect, test } from 'bun:test';
import {
  resolveMobileCompanionVoiceStatus,
  resolveMobileVoiceSession,
} from '../src/local-assistant/mobile-voice-session';

const idleInput = {
  recordingSession: { kind: 'idle', status: 'idle' } as const,
  recordingDurationMillis: 0,
  continuousStatus: 'idle' as const,
  continuousTargetKey: null,
  continuousDictationTargetKey: null,
  continuousPendingCount: 0,
  continuousDurationMillis: 0,
  microphoneAvailable: true,
};

describe('mobile voice session', () => {
  test('keeps a recording owner for the complete logical session', () => {
    const session = resolveMobileVoiceSession({
      ...idleInput,
      recordingSession: { kind: 'companion', status: 'transcribing' },
      recordingDurationMillis: 1_500,
    });

    expect(session).toEqual({
      kind: 'companion',
      status: 'transcribing',
      durationMillis: 1_500,
      microphoneAvailable: true,
    });
    expect(resolveMobileCompanionVoiceStatus('idle', session)).toBe('transcribing');
  });

  test('does not turn another recording into Companion activity', () => {
    const session = resolveMobileVoiceSession({
      ...idleInput,
      recordingSession: { kind: 'single-shot', status: 'recording' },
    });

    expect(session.kind).toBe('single-shot');
    expect(resolveMobileCompanionVoiceStatus('idle', session)).toBe('idle');
  });

  test('publishes the global dictation recorder through the shared snapshot', () => {
    const session = resolveMobileVoiceSession({
      ...idleInput,
      recordingSession: { kind: 'dictation', status: 'recording' },
      recordingDurationMillis: 2_500,
      microphoneAvailable: false,
    });

    expect(session).toEqual({
      kind: 'dictation',
      status: 'recording',
      durationMillis: 2_500,
      microphoneAvailable: false,
    });
    expect(resolveMobileCompanionVoiceStatus('idle', session)).toBe('idle');
  });

  test('normalizes paused and unexpectedly stopped Companion recordings', () => {
    const paused = resolveMobileVoiceSession({
      ...idleInput,
      recordingSession: { kind: 'companion', status: 'paused' },
    });
    const stopped = resolveMobileVoiceSession({
      ...idleInput,
      recordingSession: { kind: 'companion', status: 'stopped' },
    });

    expect(resolveMobileCompanionVoiceStatus('idle', paused)).toBe('recording');
    expect(resolveMobileCompanionVoiceStatus('idle', stopped)).toBe('transcribing');
  });

  test('describes continuous mode and target in the shared snapshot', () => {
    expect(
      resolveMobileVoiceSession({
        ...idleInput,
        continuousStatus: 'listening',
        continuousTargetKey: 'drone-a:chat-a',
        continuousDictationTargetKey: 'drone-a:chat-a',
        continuousPendingCount: 2,
        continuousDurationMillis: 750,
        microphoneAvailable: false,
      }),
    ).toEqual({
      kind: 'continuous',
      mode: 'dictation',
      status: 'listening',
      targetKey: 'drone-a:chat-a',
      pendingCount: 2,
      durationMillis: 750,
      microphoneAvailable: false,
    });
  });

  test('keeps physical cleanup separate from logical ownership', () => {
    expect(resolveMobileVoiceSession({ ...idleInput, microphoneAvailable: false })).toEqual({
      kind: 'idle',
      status: 'idle',
      microphoneAvailable: false,
    });
  });
});
