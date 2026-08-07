import { describe, expect, test } from 'bun:test';
import { resolveMobileContinuousVoiceNativeAction } from '../src/local-assistant/mobile-continuous-voice-lifecycle';

describe('mobile continuous voice native lifecycle', () => {
  test('checkpoints active speech when the microphone is interrupted', () => {
    expect(resolveMobileContinuousVoiceNativeAction('listening', 'interrupted')).toBe(
      'checkpoint-and-recover',
    );
    expect(resolveMobileContinuousVoiceNativeAction('speech', 'interrupted')).toBe(
      'checkpoint-and-recover',
    );
    expect(resolveMobileContinuousVoiceNativeAction('thought-pause', 'interrupted')).toBe(
      'checkpoint-and-recover',
    );
  });

  test('does not let interruption events undo a pause or stop', () => {
    expect(resolveMobileContinuousVoiceNativeAction('paused', 'interrupted')).toBe('ignore');
    expect(resolveMobileContinuousVoiceNativeAction('stopping', 'interrupted')).toBe('ignore');
    expect(resolveMobileContinuousVoiceNativeAction('idle', 'started')).toBe('ignore');
  });

  test('returns to listening only after native capture has restarted', () => {
    expect(resolveMobileContinuousVoiceNativeAction('recovering', 'started')).toBe('resume');
  });

  test('honors the Android foreground notification stop action', () => {
    expect(resolveMobileContinuousVoiceNativeAction('listening', 'system-control')).toBe('finish');
    expect(resolveMobileContinuousVoiceNativeAction('stopping', 'system-control')).toBe('ignore');
  });
});
