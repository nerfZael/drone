/**
 * Groq documents Whisper prompts as supporting 224 tokens, while its request
 * validator currently exposes that budget as at most 896 characters.
 */
export const GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS = 896;

/**
 * Returns the newest provider-safe transcription context. Unicode code points
 * are counted instead of UTF-16 code units so astral characters are never split.
 */
export function normalizeGroqTranscriptionPrompt(value: unknown): string {
  const prompt = String(value ?? '').trim();
  const characters = Array.from(prompt);
  if (characters.length <= GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS) return prompt;

  const start = characters.length - GROQ_TRANSCRIPTION_PROMPT_MAX_CHARACTERS;
  let recent = characters.slice(start).join('');
  const cutThroughWord = !/\s/u.test(characters[start - 1] ?? '') &&
    !/\s/u.test(characters[start] ?? '');
  if (cutThroughWord) {
    const firstBoundary = recent.search(/\s/u);
    if (firstBoundary >= 0) recent = recent.slice(firstBoundary);
  }
  return recent.trimStart();
}
