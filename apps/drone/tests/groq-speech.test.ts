import { afterEach, describe, expect, test } from 'bun:test';

import {
  GROQ_ARABIC_SPEECH_MODEL,
  GROQ_ENGLISH_SPEECH_MODEL,
  normalizeGroqSpeechRequest,
  synthesizeSpeechWithGroq,
} from '../src/hub/groq-speech';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GROQ speech synthesis', () => {
  test('normalizes the default voice and selects the model from the voice', () => {
    expect(normalizeGroqSpeechRequest({ text: ' Hello. ' })).toEqual({
      text: 'Hello.',
      voice: 'troy',
      model: GROQ_ENGLISH_SPEECH_MODEL,
    });
    expect(normalizeGroqSpeechRequest({ text: 'مرحبا', voice: 'noura' }).model).toBe(
      GROQ_ARABIC_SPEECH_MODEL,
    );
  });

  test('rejects empty, oversized, and unsupported speech input before calling GROQ', () => {
    expect(() => normalizeGroqSpeechRequest({ text: ' ' })).toThrow('required');
    expect(() => normalizeGroqSpeechRequest({ text: 'x'.repeat(201) })).toThrow('max 200');
    expect(() => normalizeGroqSpeechRequest({ text: 'Hello', voice: 'unknown' })).toThrow(
      'Unsupported GROQ speech voice',
    );
  });

  test('requests WAV speech from GROQ and returns its bytes', async () => {
    let requestBody: any = null;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? ''));
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      });
    }) as typeof fetch;

    const request = normalizeGroqSpeechRequest({ text: 'Ready to go.', voice: 'hannah' });
    const audio = await synthesizeSpeechWithGroq({ apiKey: 'groq-secret', request });

    expect([...audio]).toEqual([1, 2, 3]);
    expect(requestBody).toEqual({
      model: GROQ_ENGLISH_SPEECH_MODEL,
      input: 'Ready to go.',
      voice: 'hannah',
      response_format: 'wav',
    });
  });
});
