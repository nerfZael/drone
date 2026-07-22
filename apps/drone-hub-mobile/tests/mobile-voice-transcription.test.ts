import { describe, expect, test } from 'bun:test';
import {
  formatMobileVoiceDuration,
  mergeMobileDraftWithVoiceTranscript,
  mobileVoiceRecordActionDisabled,
  mobileVoiceStatusLabel,
  resolveMobileVoiceRecorderEvent,
  resolveMobileGroqTranscriptionResponse,
  shouldDiscardMobileVoiceWhenInactive,
} from '../src/local-assistant/mobile-voice-transcription-model';

describe('mobile voice transcription', () => {
  test('keeps delayed native events from replacing the active recording', () => {
    expect(
      resolveMobileVoiceRecorderEvent({
        activeUri: null,
        eventUri: 'file:///previous.m4a',
        failed: false,
      }),
    ).toEqual({ uri: null, handleFailure: false });
    expect(
      resolveMobileVoiceRecorderEvent({
        activeUri: 'file:///current.m4a',
        eventUri: 'file:///previous.m4a',
        failed: false,
      }),
    ).toEqual({ uri: 'file:///current.m4a', handleFailure: false });
    expect(
      resolveMobileVoiceRecorderEvent({
        activeUri: 'file:///current.m4a',
        eventUri: 'file:///previous.m4a',
        failed: true,
      }),
    ).toEqual({ uri: 'file:///current.m4a', handleFailure: false });
    expect(
      resolveMobileVoiceRecorderEvent({
        activeUri: 'file:///current.m4a',
        eventUri: 'file:///current.m4a',
        failed: true,
      }),
    ).toEqual({ uri: 'file:///current.m4a', handleFailure: true });
  });

  test('allows recording while a running chat accepts queued prompts', () => {
    expect(
      mobileVoiceRecordActionDisabled({
        editable: true,
        sending: false,
        running: true,
        queueWhileRunning: true,
      }),
    ).toBe(false);
    expect(
      mobileVoiceRecordActionDisabled({
        editable: true,
        sending: false,
        running: true,
        queueWhileRunning: false,
      }),
    ).toBe(true);
  });

  test('appends a transcript to an existing draft like the desktop composer', () => {
    expect(mergeMobileDraftWithVoiceTranscript('', '  hello world  ')).toBe('hello world');
    expect(mergeMobileDraftWithVoiceTranscript('typed draft  ', 'voice text')).toBe(
      'typed draft voice text',
    );
    expect(mergeMobileDraftWithVoiceTranscript('typed draft\n\n', 'voice text')).toBe(
      'typed draft voice text',
    );
    expect(
      mergeMobileDraftWithVoiceTranscript(
        mergeMobileDraftWithVoiceTranscript('typed draft', 'first segment'),
        'second segment',
      ),
    ).toBe('typed draft first segment second segment');
    expect(mergeMobileDraftWithVoiceTranscript('typed draft', '   ')).toBe('typed draft');
  });

  test('formats the elapsed recording time', () => {
    expect(formatMobileVoiceDuration(0)).toBe('0:00');
    expect(formatMobileVoiceDuration(9_999)).toBe('0:09');
    expect(formatMobileVoiceDuration(65_400)).toBe('1:05');
  });

  test('uses the desktop recording state labels', () => {
    expect(mobileVoiceStatusLabel('starting')).toBe('Starting…');
    expect(mobileVoiceStatusLabel('recording')).toBe('Recording');
    expect(mobileVoiceStatusLabel('paused')).toBe('Paused');
    expect(mobileVoiceStatusLabel('transcribing')).toBe('Transcribing…');
  });

  test('does not discard startup while Android is showing microphone permission UI', () => {
    expect(shouldDiscardMobileVoiceWhenInactive('starting')).toBe(false);
    expect(shouldDiscardMobileVoiceWhenInactive('recording')).toBe(true);
    expect(shouldDiscardMobileVoiceWhenInactive('paused')).toBe(true);
    expect(shouldDiscardMobileVoiceWhenInactive('transcribing')).toBe(true);
  });

  test('extracts a successful GROQ transcript', () => {
    expect(
      resolveMobileGroqTranscriptionResponse({
        ok: true,
        status: 200,
        body: JSON.stringify({ text: '  transcribed message  ' }),
      }),
    ).toBe('transcribed message');
  });

  test('surfaces GROQ API errors without swallowing their message', () => {
    expect(() =>
      resolveMobileGroqTranscriptionResponse({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: JSON.stringify({ error: { message: 'Invalid API key' } }),
      }),
    ).toThrow('Invalid API key');
    expect(() =>
      resolveMobileGroqTranscriptionResponse({
        ok: true,
        status: 200,
        body: JSON.stringify({ text: '' }),
      }),
    ).toThrow('No speech detected.');
  });
});
