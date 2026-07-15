import { describe, expect, test } from 'bun:test';
import {
  mergeMobileDraftWithVoiceTranscript,
  mobileVoiceStatusLabel,
  resolveMobileGroqTranscriptionResponse,
} from '../src/local-assistant/mobile-voice-transcription-model';

describe('mobile voice transcription', () => {
  test('appends a transcript to an existing draft like the desktop composer', () => {
    expect(mergeMobileDraftWithVoiceTranscript('', '  hello world  ')).toBe('hello world');
    expect(mergeMobileDraftWithVoiceTranscript('typed draft  ', 'voice text')).toBe(
      'typed draft\nvoice text',
    );
    expect(mergeMobileDraftWithVoiceTranscript('typed draft', '   ')).toBe('typed draft');
  });

  test('uses the desktop recording state labels', () => {
    expect(mobileVoiceStatusLabel('starting')).toBe('Starting…');
    expect(mobileVoiceStatusLabel('recording')).toBe('Recording');
    expect(mobileVoiceStatusLabel('paused')).toBe('Paused');
    expect(mobileVoiceStatusLabel('transcribing')).toBe('Transcribing…');
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
