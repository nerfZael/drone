import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const appConfig = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
);
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const androidManifest = readFileSync(
  new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);
const expoAudioPatch = readFileSync(
  new URL('../../../patches/expo-audio@57.0.0.patch', import.meta.url),
  'utf8',
);
const mobileGroqTranscription = readFileSync(
  new URL('../src/local-assistant/mobile-groq-transcription.ts', import.meta.url),
  'utf8',
);
const mobileVoiceRecorder = readFileSync(
  new URL('../src/local-assistant/use-mobile-chat-voice-recorder.ts', import.meta.url),
  'utf8',
);

describe('mobile background recording configuration', () => {
  test('enables background recording in the Expo Audio config plugin', () => {
    const audioPlugin = appConfig.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-audio',
    );
    expect(audioPlugin?.[1]?.enableBackgroundRecording).toBe(true);
    expect(audioPlugin?.[1]?.enableBackgroundPlayback).toBe(false);
  });

  test('keeps the checked-in Android project ready for microphone foreground service', () => {
    expect(androidManifest).toContain('android.permission.FOREGROUND_SERVICE"');
    expect(androidManifest).toContain('android.permission.FOREGROUND_SERVICE_MICROPHONE"');
    expect(androidManifest).toContain('android.permission.POST_NOTIFICATIONS"');
    expect(androidManifest).toContain(
      'android:name="expo.modules.audio.service.AudioRecordingService"',
    );
    expect(androidManifest).toContain('android:foregroundServiceType="microphone"');
  });

  test('keeps real-time PCM capture alive and reports recoverable interruptions', () => {
    expect(packageJson.expo?.autolinking?.buildFromSource).toContain('expo-audio');
    expect(expoAudioPatch).toContain('BackgroundAudioRecorder');
    expect(expoAudioPatch).toContain('stream.useForegroundService = allowsBackgroundRecording');
    expect(expoAudioPatch).toContain('reason: "interrupted"');
    expect(expoAudioPatch).toContain('scheduleRecovery()');
    expect(expoAudioPatch).toContain("reason?: 'started' | 'stopped' | 'interrupted'");
  });

  test('uploads continuous WAV data through a native file instead of an unsupported Blob part', () => {
    expect(mobileGroqTranscription).toContain('new File(');
    expect(mobileGroqTranscription).toContain('file.write(input.wave)');
    expect(mobileGroqTranscription).toContain("form.append('file', file as unknown as Blob)");
    expect(mobileGroqTranscription).not.toContain('new Blob([input.wave.buffer');
  });

  test('serializes recorder startup and coalesces Android service binding', () => {
    expect(mobileVoiceRecorder).toContain('await pendingStart?.catch');
    expect(expoAudioPatch).toContain('bindingWaiters.add(continuation)');
    expect(expoAudioPatch).toContain('startBindingTimeout()');
    expect(expoAudioPatch).not.toContain(
      '+      throw AudioRecordingServiceException("Tried binding to the recording service while the previous attempt is still ongoing.")',
    );
  });
});
