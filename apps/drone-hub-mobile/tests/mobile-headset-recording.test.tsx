import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import type { ReactTestRenderer } from 'react-test-renderer';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';

// Keep native recorder mocks out of other test files.
if (process.env.DRONE_HEADSET_RECORDING_CHILD !== '1') {
  test('headset recording background lifecycle', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, DRONE_HEADSET_RECORDING_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(stdout + stderr);
    expect(code).toBe(0);
  });
} else {
  const listeners = new Set<(state: string) => void>();
  const appState = { currentState: 'background', addEventListener: (_name: string, fn: (state: string) => void) => {
    listeners.add(fn); return { remove: () => listeners.delete(fn) };
  } };
  let starts = 0;
  let microphoneGranted = true;
  let permissionRequests = 0;
  let completeTranscript: (value: string) => void = () => {};
  const recorder = { uri: 'file:///recording.m4a', prepareToRecordAsync: async () => {},
    record: () => { starts++; }, pause: () => {}, stop: async () => {} };
  mock.module('react-native', () => ({ AppState: appState, Platform: { OS: 'android', Version: 36 } }));
  mock.module('expo-audio', () => ({
    RecordingPresets: { HIGH_QUALITY: { android: {} } },
    useAudioRecorder: () => recorder, useAudioRecorderState: () => ({ durationMillis: 1000 }),
    getRecordingPermissionsAsync: async () => ({ granted: microphoneGranted }),
    requestRecordingPermissionsAsync: async () => { permissionRequests++; return { granted: true }; },
    requestNotificationPermissionsAsync: async () => { permissionRequests++; return { granted: true }; },
    setAudioModeAsync: async () => {},
  }));
  mock.module('expo-file-system', () => ({ File: class { exists = true; delete() {} } }));
  mock.module('../src/local-assistant/local-assistant-settings', () => ({ readGroqApiKey: async () => 'test' }));
  mock.module('../src/local-assistant/mobile-groq-transcription', () => ({
    transcribeMobileVoiceRecording: ({ signal }: { signal: AbortSignal }) => new Promise<string>((resolve, reject) => {
      completeTranscript = resolve;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  }));
  const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
  mock.module(rendererRequire.resolve('react'), () => React);
  const { create } = await import('react-test-renderer');
  const { useMobileChatVoiceRecorder } = await import('../src/local-assistant/use-mobile-chat-voice-recorder');
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  test('armed Companion records, pauses, resumes and transcribes while locked without permission prompts', async () => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    let root!: ReactTestRenderer;
    let voice!: ReturnType<typeof useMobileChatVoiceRecorder>;
    const coordinator = new MobileMicrophoneCoordinator();
    const errors: string[] = [];
    const onError = (error: string) => { if (error) errors.push(error); };
    function Capture() { voice = useMobileChatVoiceRecorder({ microphoneCoordinator: coordinator, onError }); return null; }
    try {
      await act(async () => { root = create(<Capture />); });
      await act(async () => { expect(await voice.startRecording('companion', { backgroundServiceArmed: true })).toBe(true); });
      expect(starts).toBe(1); expect(permissionRequests).toBe(0);
      await act(async () => { voice.toggleRecordingPause('companion'); });
      expect(voice.session.status).toBe('paused');
      await act(async () => { voice.toggleRecordingPause('companion'); });
      expect(voice.session.status).toBe('recording');
      let transcript!: Promise<string>;
      await act(async () => { transcript = voice.stopRecordingForTranscript('companion'); await tick(); });
      expect(voice.session.status).toBe('transcribing');
      await act(async () => { for (const listener of listeners) listener('background'); await tick(); });
      expect(voice.session.status).toBe('transcribing');
      await act(async () => { completeTranscript('Send this'); expect(await transcript).toBe('Send this'); });
      expect(coordinator.getSnapshot()).toBeNull(); expect(errors).toEqual([]);
      // The exemption belongs to this recording, not later recordings from the UI.
      const previousStarts = starts;
      let startup!: Promise<boolean>;
      await act(async () => { startup = voice.startRecording('companion'); await tick(); });
      expect(starts).toBe(previousStarts); expect(voice.session.status).toBe('starting');
      await act(async () => {
        appState.currentState = 'active';
        for (const listener of listeners) listener('active');
        expect(await startup).toBe(true);
      });
      await act(async () => { await voice.discardRecording('companion'); });
      expect(coordinator.getSnapshot()).toBeNull();
      appState.currentState = 'background';
      microphoneGranted = false;
      const previousRequests = permissionRequests;
      const startsBeforeDenied = starts;
      await act(async () => { expect(await voice.startRecording('companion', { backgroundServiceArmed: true })).toBe(false); });
      expect(permissionRequests).toBe(previousRequests);
      expect(starts).toBe(startsBeforeDenied);
      expect(errors.at(-1)).toContain('Microphone permission');
    } finally {
      await act(async () => root?.unmount());
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    }
  });
}
