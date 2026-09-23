import { afterEach, describe, expect, test } from 'bun:test';
import { transcribeAudioWithGroq } from '../src/hub/groq-transcription';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GROQ transcription', () => {
  test('keeps the HTTP status when the provider only returns a generic error', async () => {
    globalThis.fetch = (async () => Response.json({ error: { message: 'Internal Server Error' } }, { status: 500, statusText: 'Internal Server Error', headers: { 'x-request-id': 'req-123' } })) as typeof fetch;
    await expect(transcribeAudioWithGroq({ audio: Buffer.from([1]), apiKey: 'groq-test' }))
      .rejects.toThrow('GROQ transcription failed (HTTP 500 Internal Server Error): The provider returned no further details. [request ID: req-123]');
  });

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

  test('bounds long transcript context before calling Groq', async () => {
    let form: FormData | null = null;
    globalThis.fetch = (async (_input, init) => {
      form = init?.body as FormData;
      return Response.json({ text: 'Newest thought.' });
    }) as typeof fetch;

    await transcribeAudioWithGroq({
      audio: Buffer.from([1, 2, 3, 4]),
      apiKey: 'groq-test',
      prompt: `${'obsolete '.repeat(150)}newest context`,
    });

    const prompt = String(form?.get('prompt') ?? '');
    expect(Array.from(prompt).length).toBeLessThanOrEqual(896);
    expect(prompt.endsWith('newest context')).toBe(true);
  });
});
