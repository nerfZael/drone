import { afterEach, describe, expect, test } from 'bun:test';

import {
  normalizeOpenAiSpeechRequest,
  synthesizeSpeechWithOpenAi,
} from '../src/hub/openai-speech';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAI speech synthesis', () => {
  test('normalizes TTS-1 requests and rejects model-incompatible voices', () => {
    expect(normalizeOpenAiSpeechRequest({ text: ' Hello. ', model: 'tts-1' })).toEqual({
      text: 'Hello.',
      model: 'tts-1',
      voice: 'alloy',
    });
    expect(() => normalizeOpenAiSpeechRequest({ text: 'Hello.', model: 'tts-1', voice: 'marin' }))
      .toThrow('not supported by tts-1');
  });

  test('requests WAV speech from OpenAI and returns its bytes', async () => {
    let requestBody: unknown = null;
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.openai.com/v1/audio/speech');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer openai-secret');
      requestBody = JSON.parse(String(init?.body ?? ''));
      return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
    }) as typeof fetch;

    const request = normalizeOpenAiSpeechRequest({ text: 'Ready.', model: 'tts-1', voice: 'nova' });
    expect([...await synthesizeSpeechWithOpenAi({ apiKey: 'openai-secret', request })]).toEqual([4, 5, 6]);
    expect(requestBody).toEqual({
      model: 'tts-1',
      input: 'Ready.',
      voice: 'nova',
      response_format: 'wav',
    });
  });
});
