import { describe, expect, test } from 'bun:test';
import {
  uploadMobileVoiceWave,
  type MobileVoiceWaveUploadRuntime,
} from '../src/local-assistant/mobile-groq-wave-upload';

function createRuntime(input?: {
  fetchError?: Error;
  response?: { ok: boolean; status: number; body: string };
}) {
  const entries: Array<[string, unknown]> = [];
  const stagedWaves: Uint8Array[] = [];
  let cleanupCount = 0;
  const stagedBody = { kind: 'native-file' };
  const form = {
    append(name: string, value: unknown) {
      entries.push([name, value]);
    },
  };
  const runtime: MobileVoiceWaveUploadRuntime = {
    stageWave(wave) {
      stagedWaves.push(wave.slice());
      return {
        body: stagedBody,
        cleanup() {
          cleanupCount += 1;
        },
      };
    },
    createFormData: () => form,
    async fetch(request) {
      expect(request.body).toBe(form);
      if (input?.fetchError) throw input.fetchError;
      const response = input?.response ?? {
        ok: true,
        status: 200,
        body: JSON.stringify({ text: 'transcribed thought' }),
      };
      return {
        ...response,
        statusText: response.ok ? 'OK' : 'Bad Request',
        async text() {
          return response.body;
        },
      };
    },
  };
  return {
    runtime,
    entries,
    stagedWaves,
    stagedBody,
    cleanupCount: () => cleanupCount,
  };
}

describe('mobile continuous voice WAV upload', () => {
  test('stages the exact WAV and submits all transcription fields', async () => {
    const fixture = createRuntime();
    const wave = Uint8Array.from({ length: 48 }, (_, index) => index);

    const transcript = await uploadMobileVoiceWave(
      {
        wave,
        apiKey: ' secret ',
        settings: { quality: 'accurate', language: 'en' },
        prompt: ' prior context ',
      },
      fixture.runtime,
    );

    expect(transcript).toBe('transcribed thought');
    expect(fixture.stagedWaves).toEqual([wave]);
    expect(fixture.entries).toEqual([
      ['file', fixture.stagedBody],
      ['model', 'whisper-large-v3'],
      ['response_format', 'json'],
      ['temperature', '0'],
      ['language', 'en'],
      ['prompt', 'prior context'],
    ]);
    expect(fixture.cleanupCount()).toBe(1);
  });

  test('cleans up a staged WAV after an API failure', async () => {
    const fixture = createRuntime({
      response: {
        ok: false,
        status: 429,
        body: JSON.stringify({ error: { message: 'Rate limited' } }),
      },
    });

    await expect(
      uploadMobileVoiceWave(
        {
          wave: new Uint8Array(45),
          apiKey: 'secret',
          settings: { quality: 'fast', language: '' },
        },
        fixture.runtime,
      ),
    ).rejects.toThrow('Rate limited');
    expect(fixture.cleanupCount()).toBe(1);
  });

  test('bounds long transcript context before calling Groq', async () => {
    const fixture = createRuntime();

    await uploadMobileVoiceWave(
      {
        wave: new Uint8Array(45),
        apiKey: 'secret',
        settings: { quality: 'fast', language: '' },
        prompt: `${'obsolete '.repeat(150)}newest context`,
      },
      fixture.runtime,
    );

    const prompt = String(
      fixture.entries.find(([name]) => name === 'prompt')?.[1] ?? '',
    );
    expect(Array.from(prompt).length).toBeLessThanOrEqual(896);
    expect(prompt.endsWith('newest context')).toBe(true);
  });

  test('cleans up a staged WAV when an upload is aborted', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const fixture = createRuntime({ fetchError: abortError });
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadMobileVoiceWave(
        {
          wave: new Uint8Array(45),
          apiKey: 'secret',
          settings: { quality: 'fast', language: '' },
          signal: controller.signal,
        },
        fixture.runtime,
      ),
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(fixture.cleanupCount()).toBe(1);
  });
});
