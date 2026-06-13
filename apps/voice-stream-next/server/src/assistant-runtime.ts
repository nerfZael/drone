import { normalizeWavChunkSizes, pcm16ToWav } from './wav.js';

export type RuntimeResult = {
  text: string;
  provider: 'groq' | 'fallback';
  credentialSource: GroqCredentialSource | null;
  model: string | null;
  audioDurationMs: number;
};

export type GroqCredentialSource = 'platform_groq_key' | 'user_groq_key';

const GROQ_TRANSCRIPTION_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TTS_DEFAULT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
const GROQ_TRANSCRIPTION_DEFAULT_MODEL = 'whisper-large-v3-turbo';
const GROQ_TTS_DEFAULT_MODEL = 'canopylabs/orpheus-v1-english';
const GROQ_TTS_DEFAULT_VOICE = 'austin';

function groqApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROQ_API_KEY?.trim() || env.VOICE_STREAM_NEXT_GROQ_API_KEY?.trim() || '';
}

function groqSttApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROQ_STT_API_KEY?.trim() || env.VOICE_STREAM_NEXT_GROQ_STT_API_KEY?.trim() || groqApiKey(env);
}

function groqTtsApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.GROQ_TTS_API_KEY?.trim() || env.VOICE_STREAM_NEXT_GROQ_TTS_API_KEY?.trim() || groqApiKey(env);
}

function groqSttModel(): string {
  return process.env.GROQ_STT_MODEL?.trim() ||
    process.env.GROQ_TRANSCRIPTION_MODEL?.trim() ||
    process.env.VOICE_STREAM_NEXT_STT_MODEL?.trim() ||
    GROQ_TRANSCRIPTION_DEFAULT_MODEL;
}

function groqTtsEndpoint(): string {
  return process.env.GROQ_TTS_ENDPOINT?.trim() ||
    process.env.VOICE_STREAM_NEXT_GROQ_TTS_ENDPOINT?.trim() ||
    GROQ_TTS_DEFAULT_ENDPOINT;
}

function groqTtsModel(): string {
  return process.env.GROQ_TTS_MODEL?.trim() ||
    process.env.VOICE_STREAM_NEXT_TTS_MODEL?.trim() ||
    GROQ_TTS_DEFAULT_MODEL;
}

function groqTtsVoice(voice?: string): string {
  if (voice?.trim()) return voice.trim();
  return process.env.GROQ_TTS_VOICE?.trim() ||
    process.env.VOICE_STREAM_NEXT_TTS_VOICE?.trim() ||
    GROQ_TTS_DEFAULT_VOICE;
}

export function hasGroqSpeechRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(groqSttApiKey(env));
}

export function hasGroqTtsRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(groqTtsApiKey(env));
}

function groqSpeechCredential(options: { apiKey?: string | null; credentialSource?: GroqCredentialSource } = {}): { apiKey: string; credentialSource: GroqCredentialSource } | null {
  const optionKey = options.apiKey?.trim();
  if (optionKey) return { apiKey: optionKey, credentialSource: options.credentialSource ?? 'user_groq_key' };
  const platformKey = groqSttApiKey();
  return platformKey ? { apiKey: platformKey, credentialSource: 'platform_groq_key' } : null;
}

function groqTtsCredential(options: { apiKey?: string | null; credentialSource?: GroqCredentialSource } = {}): { apiKey: string; credentialSource: GroqCredentialSource } | null {
  const optionKey = options.apiKey?.trim();
  if (optionKey) return { apiKey: optionKey, credentialSource: options.credentialSource ?? 'user_groq_key' };
  const platformKey = groqTtsApiKey();
  return platformKey ? { apiKey: platformKey, credentialSource: 'platform_groq_key' } : null;
}

export async function transcribePcm16(pcm: Uint8Array, options: { apiKey?: string | null; credentialSource?: GroqCredentialSource } = {}): Promise<RuntimeResult> {
  const testTranscript = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
  if (testTranscript != null) {
    return {
      provider: 'fallback',
      credentialSource: null,
      model: null,
      audioDurationMs: pcmDurationMs(pcm.byteLength),
      text: testTranscript.trim(),
    };
  }
  const credential = groqSpeechCredential(options);
  if (!credential) {
    return {
      provider: 'fallback',
      credentialSource: null,
      model: null,
      audioDurationMs: pcmDurationMs(pcm.byteLength),
      text: '',
    };
  }
  if (pcm.byteLength < 1600) {
    return {
      provider: 'fallback',
      credentialSource: null,
      model: null,
      audioDurationMs: pcmDurationMs(pcm.byteLength),
      text: '',
    };
  }

  const model = groqSttModel();
  const wav = pcm16ToWav(pcm);
  const wavBody = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([wavBody], { type: 'audio/wav' }), 'voice-stream.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const response = await fetch(GROQ_TRANSCRIPTION_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential.apiKey}` },
    body: form,
  });
  const body = await parseProviderJsonResponse(response, 'GROQ transcription');
  return {
    provider: 'groq',
    credentialSource: credential.credentialSource,
    model,
    audioDurationMs: pcmDurationMs(pcm.byteLength),
    text: String(body.text ?? '').trim(),
  };
}

export async function synthesizeSpeech(
  text: string,
  options: { voice?: string; apiKey?: string | null; credentialSource?: GroqCredentialSource } = {},
): Promise<{ audio: Uint8Array | null; provider: 'groq' | 'fallback'; credentialSource: GroqCredentialSource | null; model: string | null; inputCharacters: number }> {
  const input = text.trim().slice(0, 4096);
  const credential = groqTtsCredential(options);
  if (!credential || !input) {
    return { audio: null, provider: 'fallback', credentialSource: null, model: null, inputCharacters: input.length };
  }
  const model = groqTtsModel();
  const response = await fetch(groqTtsEndpoint(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice: groqTtsVoice(options.voice),
      input,
      response_format: 'wav',
    }),
  });
  if (!response.ok) await parseProviderJsonResponse(response, 'GROQ TTS');
  return {
    provider: 'groq',
    credentialSource: credential.credentialSource,
    model,
    inputCharacters: input.length,
    audio: normalizeWavChunkSizes(new Uint8Array(await response.arrayBuffer())),
  };
}

function pcmDurationMs(byteLength: number): number {
  return Math.max(0, Math.round((byteLength / 2 / 16_000) * 1000));
}

async function parseProviderJsonResponse(response: Response, providerLabel: string): Promise<any> {
  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text } };
  }
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.message ?? `${providerLabel} request failed: ${response.status}`);
  }
  return body;
}
