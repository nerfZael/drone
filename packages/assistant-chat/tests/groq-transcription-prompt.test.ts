import { describe, expect, test } from 'bun:test';
import {
  GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS,
  normalizeGroqTranscriptionPrompt,
} from '../src/groq-transcription-prompt';

describe('Groq transcription prompt', () => {
  test('keeps context that is already within the provider limit', () => {
    expect(normalizeGroqTranscriptionPrompt('  prior context  ')).toBe('prior context');
  });

  test('keeps the newest complete context within the provider limit', () => {
    const prompt = `${'old '.repeat(300)}keep this recent context`;
    const normalized = normalizeGroqTranscriptionPrompt(prompt);

    expect(Array.from(normalized).length).toBeLessThanOrEqual(
      GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS,
    );
    expect(normalized.startsWith('old ')).toBe(true);
    expect(normalized.endsWith('keep this recent context')).toBe(true);
  });

  test('counts Unicode code points without splitting surrogate pairs', () => {
    const normalized = normalizeGroqTranscriptionPrompt(
      `discard ${'😀'.repeat(GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS)}`,
    );

    expect(Array.from(normalized)).toHaveLength(GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS);
    expect(normalized).toBe('😀'.repeat(GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS));
    expect(normalized).not.toContain('\uFFFD');
  });
});
