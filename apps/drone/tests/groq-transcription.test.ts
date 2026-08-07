import { afterEach, describe, expect, test } from 'bun:test';
import { transcribeAudioWithGroq } from '../src/hub/groq-transcription';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GROQ transcription', () => {
  test('selects quality and forwards language and recent transcript context', async () => {
    let form: FormData | null = null;
    globalThis.fetch = (async (_input, init) => {
      form = init?.body as FormData;
      return Response.json({ text: 'Nastavi s implementacijom.' });
    }) as typeof fetch;

    const result = await transcribeAudioWithGroq({
      audio: Buffer.from([1, 2, 3, 4]),
      apiKey: 'groq-test',
      mimeType: 'audio/wav',
      quality: 'accurate',
      language: 'hr',
      prompt: 'Prethodna potvrđena uputa.',
    });

    expect(result).toEqual({
      text: 'Nastavi s implementacijom.',
      model: 'whisper-large-v3',
    });
    expect(form?.get('model')).toBe('whisper-large-v3');
    expect(form?.get('language')).toBe('hr');
    expect(form?.get('prompt')).toBe('Prethodna potvrđena uputa.');
    expect(form?.get('file')).toBeInstanceOf(Blob);
  });
});
