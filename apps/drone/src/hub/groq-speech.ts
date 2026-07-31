import crypto from 'node:crypto';

const GROQ_SPEECH_URL = 'https://api.groq.com/openai/v1/audio/speech';

export const GROQ_SPEECH_MAX_CHARS = 200;
export const GROQ_SPEECH_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const GROQ_ENGLISH_SPEECH_MODEL = 'canopylabs/orpheus-v1-english';
export const GROQ_ARABIC_SPEECH_MODEL = 'canopylabs/orpheus-arabic-saudi';
export const GROQ_SPEECH_VOICES = [
  'autumn',
  'diana',
  'hannah',
  'austin',
  'daniel',
  'troy',
  'abdullah',
  'fahad',
  'sultan',
  'lulwa',
  'noura',
  'aisha',
] as const;

export type GroqSpeechVoice = (typeof GROQ_SPEECH_VOICES)[number];

export type GroqSpeechRequest = {
  text: string;
  voice: GroqSpeechVoice;
  model: typeof GROQ_ENGLISH_SPEECH_MODEL | typeof GROQ_ARABIC_SPEECH_MODEL;
};

const ARABIC_VOICES = new Set<GroqSpeechVoice>([
  'abdullah',
  'fahad',
  'sultan',
  'lulwa',
  'noura',
  'aisha',
]);

function groqErrorMessage(status: number, statusText: string, raw: string): string {
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const message =
    typeof data?.error?.message === 'string'
      ? data.error.message
      : typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : '';
  return message.trim() || `GROQ speech synthesis failed (${status} ${statusText})`;
}

export function normalizeGroqSpeechRequest(input: {
  text?: unknown;
  voice?: unknown;
}): GroqSpeechRequest {
  const text = String(input.text ?? '').trim();
  if (!text) throw new Error('Speech text is required.');
  if (text.length > GROQ_SPEECH_MAX_CHARS) {
    throw new Error(
      `Speech text is too long (${text.length} characters, max ${GROQ_SPEECH_MAX_CHARS}).`,
    );
  }

  const voiceRaw = String(input.voice ?? '')
    .trim()
    .toLowerCase();
  const voice = (voiceRaw || 'troy') as GroqSpeechVoice;
  if (!(GROQ_SPEECH_VOICES as readonly string[]).includes(voice)) {
    throw new Error(`Unsupported GROQ speech voice: ${voiceRaw}.`);
  }

  return {
    text,
    voice,
    model: ARABIC_VOICES.has(voice) ? GROQ_ARABIC_SPEECH_MODEL : GROQ_ENGLISH_SPEECH_MODEL,
  };
}

export async function synthesizeSpeechWithGroq(opts: {
  apiKey: string;
  request: GroqSpeechRequest;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('GROQ API key is not configured.');

  const response = await fetch(GROQ_SPEECH_URL, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.request.model,
      input: opts.request.text,
      voice: opts.request.voice,
      response_format: 'wav',
    }),
  });
  if (!response.ok) {
    throw new Error(groqErrorMessage(response.status, response.statusText, await response.text()));
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new Error('GROQ returned empty speech audio.');
  if (audio.length > GROQ_SPEECH_MAX_AUDIO_BYTES) {
    throw new Error(
      `GROQ speech audio is too large (${audio.length} bytes, max ${GROQ_SPEECH_MAX_AUDIO_BYTES}).`,
    );
  }
  return audio;
}

export function createSpeechJobId(): string {
  return `speech_${crypto.randomUUID()}`;
}
