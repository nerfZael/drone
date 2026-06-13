import { describe, expect, test } from 'bun:test';
import { normalizeWavChunkSizes, pcm16ToWav } from './wav.js';

describe('wav utilities', () => {
  test('normalizes Groq-style placeholder WAV chunk sizes', () => {
    const pcm = new Uint8Array(640);
    const wav = pcm16ToWav(pcm, 16_000, 1);
    const groqStyle = new Uint8Array(wav);
    const view = new DataView(groqStyle.buffer, groqStyle.byteOffset, groqStyle.byteLength);
    view.setUint32(4, 0xffffffff, true);
    view.setUint32(40, 0xffffffff, true);

    const normalized = normalizeWavChunkSizes(groqStyle);
    const normalizedView = new DataView(normalized.buffer, normalized.byteOffset, normalized.byteLength);
    expect(normalizedView.getUint32(4, true)).toBe(normalized.byteLength - 8);
    expect(normalizedView.getUint32(40, true)).toBe(640);
  });
});
