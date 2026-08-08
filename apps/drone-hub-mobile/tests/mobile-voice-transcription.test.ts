import { describe, expect, test } from 'bun:test';
import {
  formatMobileVoiceDuration,
  isUnexpectedMobileVoiceRecordingCompletion,
  mergeMobileDraftWithVoiceTranscript,
  mobileVoiceRecordActionDisabled,
  mobileVoiceStatusLabel,
  resolveMobileVoiceRecorderEvent,
  resolveMobileVoiceTranscriptDraft,
  resolveMobileGroqTranscriptionResponse,
  shouldCancelMobileVoiceWhenInactive,
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
    expect(
      resolveMobileVoiceRecorderEvent({
        activeUri: null,
        eventUri: 'file:///previous.m4a',
        failed: true,
        ignoreFailureWithoutActiveUri: true,
      }),
    ).toEqual({ uri: null, handleFailure: false });
  });

  test('allows recording while a running chat accepts queued prompts', () => {
    expect(
      mobileVoiceRecordActionDisabled({
        editable: true,
        sending: false,
        running: true,
        queueWhileRunning: true,
        microphoneAvailable: true,
      }),
    ).toBe(false);
    expect(
      mobileVoiceRecordActionDisabled({
        editable: true,
        sending: false,
        running: true,
        queueWhileRunning: false,
        microphoneAvailable: true,
      }),
    ).toBe(true);
  });

  test('disables normal recording while continuous voice owns the microphone', () => {
    expect(
      mobileVoiceRecordActionDisabled({
        editable: true,
        sending: false,
        running: false,
        queueWhileRunning: true,
        microphoneAvailable: false,
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

  test('consumes the internal draft when a recording is transcribed and sent directly', () => {
    const first = resolveMobileVoiceTranscriptDraft({
      draft: '',
      transcript: 'first recording',
      action: 'send',
    });
    const second = resolveMobileVoiceTranscriptDraft({
      draft: first.nextDraft,
      transcript: 'second recording',
      action: 'send',
    });

    expect(first).toEqual({ message: 'first recording', nextDraft: '' });
    expect(second).toEqual({ message: 'second recording', nextDraft: '' });
  });

  test('keeps the transcript in the draft when recording is stopped without sending', () => {
    expect(
      resolveMobileVoiceTranscriptDraft({
        draft: 'first recording',
        transcript: 'second recording',
        action: 'append',
      }),
    ).toEqual({
      message: 'first recording second recording',
      nextDraft: 'first recording second recording',
    });
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
    expect(mobileVoiceStatusLabel('stopped')).toBe('Recording stopped');
    expect(mobileVoiceStatusLabel('transcribing')).toBe('Transcribing…');
  });

  test('preserves a recording stopped from the Android foreground notification', () => {
    expect(
      isUnexpectedMobileVoiceRecordingCompletion({
        status: 'recording',
        activeUri: 'file:///recording.m4a',
        eventUri: 'file:///recording.m4a',
        finished: true,
        failed: false,
        stopPending: false,
      }),
    ).toBe(true);
    expect(
      isUnexpectedMobileVoiceRecordingCompletion({
        status: 'recording',
        activeUri: 'file:///recording.m4a',
        eventUri: 'file:///recording.m4a',
        finished: true,
        failed: false,
        stopPending: true,
      }),
    ).toBe(false);
    expect(
      isUnexpectedMobileVoiceRecordingCompletion({
        status: 'recording',
        activeUri: 'file:///recording.m4a',
        eventUri: 'file:///previous.m4a',
        finished: true,
        failed: false,
        stopPending: false,
      }),
    ).toBe(false);
  });

  test('keeps recordings through screen lock but cancels foreground transcription', () => {
    expect(shouldCancelMobileVoiceWhenInactive('idle')).toBe(false);
    expect(shouldCancelMobileVoiceWhenInactive('starting')).toBe(false);
    expect(shouldCancelMobileVoiceWhenInactive('recording')).toBe(false);
    expect(shouldCancelMobileVoiceWhenInactive('paused')).toBe(false);
    expect(shouldCancelMobileVoiceWhenInactive('stopped')).toBe(false);
    expect(shouldCancelMobileVoiceWhenInactive('transcribing')).toBe(true);
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
