import { describe, expect, test } from 'bun:test';

import {
  buildGroqTtsConfig,
  GROQ_TTS_DEFAULT_MODEL,
  GROQ_TTS_DEFAULT_VOICE,
  normalizeWavChunkSizes,
} from '../src/hub/groq-tts';

describe('Groq TTS config', () => {
  test('uses the same default model and voice as Android Voice Stream', () => {
    const config = buildGroqTtsConfig({ apiKey: 'key', env: {} as NodeJS.ProcessEnv });
    expect(config.model).toBe(GROQ_TTS_DEFAULT_MODEL);
    expect(config.voice).toBe(GROQ_TTS_DEFAULT_VOICE);
    expect(config.model).toBe('canopylabs/orpheus-v1-english');
    expect(config.voice).toBe('austin');
  });

  test('keeps explicit Groq TTS environment overrides', () => {
    const config = buildGroqTtsConfig({
      apiKey: 'key',
      env: {
        GROQ_TTS_ENDPOINT: 'https://example.test/speech',
        GROQ_TTS_MODEL: 'custom-model',
        GROQ_TTS_VOICE: 'custom-voice',
      } as NodeJS.ProcessEnv,
    });

    expect(config.endpoint).toBe('https://example.test/speech');
    expect(config.model).toBe('custom-model');
    expect(config.voice).toBe('custom-voice');
  });

  test('normalizes streaming WAV placeholder sizes', () => {
    const wav = Buffer.alloc(48);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(0xffffffff, 4);
    wav.write('WAVE', 8, 'ascii');
    wav.write('data', 12, 'ascii');
    wav.writeUInt32LE(0xffffffff, 16);

    const normalized = normalizeWavChunkSizes(wav);
    expect(normalized.readUInt32LE(4)).toBe(40);
    expect(normalized.readUInt32LE(16)).toBe(28);
  });
});
