import { spawnSync } from 'node:child_process';
import { normalizeWavChunkSizes, pcm16ToWav } from './wav.js';

export type RuntimeTranscriptionSegment = {
  startMs: number;
  endMs: number;
  text: string;
  avgLogprob: number | null;
  compressionRatio: number | null;
  noSpeechProb: number | null;
};

export type RuntimeResult = {
  text: string;
  provider: 'groq' | 'fallback';
  credentialSource: GroqCredentialSource | null;
  model: string | null;
  audioDurationMs: number;
  billableAudioDurationMs?: number | null;
  audioFormat?: 'wav' | 'flac' | null;
  uploadBytes?: number | null;
  segments?: RuntimeTranscriptionSegment[];
};

export type GroqCredentialSource = 'platform_groq_key' | 'user_groq_key';

const GROQ_TRANSCRIPTION_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TTS_DEFAULT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
const GROQ_TRANSCRIPTION_DEFAULT_MODEL = 'whisper-large-v3-turbo';
const GROQ_TTS_DEFAULT_MODEL = 'canopylabs/orpheus-v1-english';
const GROQ_TTS_DEFAULT_VOICE = 'austin';

export class AudioUploadTooLargeError extends Error {
  readonly bytes: number;
  readonly maxBytes: number;
  readonly format: string;

  constructor(bytes: number, maxBytes: number, format: string) {
    super(`Audio upload too large: ${bytes} bytes exceeds ${maxBytes} byte limit`);
    this.name = 'AudioUploadTooLargeError';
    this.bytes = bytes;
    this.maxBytes = maxBytes;
    this.format = format;
  }
}

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

function encodePcm16ToFlac(pcm: Uint8Array): Uint8Array | null {
  const ffmpegPath = process.env.VOICE_STREAM_NEXT_FFMPEG_PATH?.trim() || process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const wav = pcm16ToWav(pcm);
  const result = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-map', '0:a:0', '-c:a', 'flac', '-f', 'flac', 'pipe:1'],
    {
      input: Buffer.from(wav),
      maxBuffer: Math.max(wav.byteLength * 2, 16 * 1024 * 1024),
    },
  );
  if (result.error || result.status !== 0 || result.stdout.byteLength === 0) return null;
  return new Uint8Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength).slice();
}

function transcriptionAudioUpload(
  pcm: Uint8Array,
  options: { preferFlac?: boolean; maxUploadBytes?: number } = {},
): { bytes: Uint8Array; format: 'wav' | 'flac'; mimeType: string; fileName: string } {
  const wav = pcm16ToWav(pcm);
  const maxUploadBytes = options.maxUploadBytes;
  const flac = options.preferFlac ? encodePcm16ToFlac(pcm) : null;
  const candidates = [
    flac ? { bytes: flac, format: 'flac' as const, mimeType: 'audio/flac', fileName: 'voice-stream.flac' } : null,
    { bytes: wav, format: 'wav' as const, mimeType: 'audio/wav', fileName: 'voice-stream.wav' },
  ].filter((candidate): candidate is { bytes: Uint8Array; format: 'wav' | 'flac'; mimeType: string; fileName: string } => candidate != null);

  const underLimit = maxUploadBytes == null ? candidates[0] : candidates.find((candidate) => candidate.bytes.byteLength <= maxUploadBytes);
  if (underLimit) return underLimit;
  const smallest = candidates.reduce((best, candidate) => candidate.bytes.byteLength < best.bytes.byteLength ? candidate : best);
  throw new AudioUploadTooLargeError(smallest.bytes.byteLength, maxUploadBytes ?? 0, smallest.format);
}

function parseRuntimeSegments(body: any): RuntimeTranscriptionSegment[] {
  if (!Array.isArray(body?.segments)) return [];
  return body.segments
    .map((segment: any) => ({
      startMs: Math.max(0, Math.round(Number(segment?.start ?? 0) * 1000)),
      endMs: Math.max(0, Math.round(Number(segment?.end ?? 0) * 1000)),
      text: String(segment?.text ?? '').trim(),
      avgLogprob: Number.isFinite(Number(segment?.avg_logprob)) ? Number(segment.avg_logprob) : null,
      compressionRatio: Number.isFinite(Number(segment?.compression_ratio)) ? Number(segment.compression_ratio) : null,
      noSpeechProb: Number.isFinite(Number(segment?.no_speech_prob)) ? Number(segment.no_speech_prob) : null,
    }))
    .filter((segment: RuntimeTranscriptionSegment) => segment.text || segment.endMs > segment.startMs);
}

export async function transcribePcm16(
  pcm: Uint8Array,
  options: {
    apiKey?: string | null;
    credentialSource?: GroqCredentialSource;
    prompt?: string | null;
    responseFormat?: 'json' | 'verbose_json';
    timestampGranularities?: Array<'segment' | 'word'>;
    preferFlac?: boolean;
    maxUploadBytes?: number;
  } = {},
): Promise<RuntimeResult> {
  const testTranscript = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
  if (testTranscript != null) {
    return {
      provider: 'fallback',
      credentialSource: null,
      model: null,
      audioDurationMs: pcmDurationMs(pcm.byteLength),
      billableAudioDurationMs: 0,
      text: testTranscript.trim(),
      audioFormat: null,
      uploadBytes: null,
      segments: [],
    };
  }
  const credential = groqSpeechCredential(options);
  if (!credential) {
    return {
      provider: 'fallback',
      credentialSource: null,
      model: null,
      audioDurationMs: pcmDurationMs(pcm.byteLength),
      billableAudioDurationMs: 0,
      text: '',
      audioFormat: null,
      uploadBytes: null,
      segments: [],
    };
  }
  if (pcm.byteLength < 1600) {
    return {
      provider: 'fallback',
      credentialSource: null,
      model: null,
      audioDurationMs: pcmDurationMs(pcm.byteLength),
      billableAudioDurationMs: 0,
      text: '',
      audioFormat: null,
      uploadBytes: null,
      segments: [],
    };
  }

  const model = groqSttModel();
  const upload = transcriptionAudioUpload(pcm, {
    preferFlac: options.preferFlac,
    maxUploadBytes: options.maxUploadBytes,
  });
  const audioBody = upload.bytes.buffer.slice(upload.bytes.byteOffset, upload.bytes.byteOffset + upload.bytes.byteLength) as ArrayBuffer;
  const responseFormat = options.responseFormat ?? 'json';
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([audioBody], { type: upload.mimeType }), upload.fileName);
  form.append('response_format', responseFormat);
  form.append('temperature', '0');
  for (const granularity of options.timestampGranularities ?? []) {
    form.append('timestamp_granularities[]', granularity);
  }
  const prompt = options.prompt?.trim();
  if (prompt) form.append('prompt', prompt);

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
    billableAudioDurationMs: pcmDurationMs(pcm.byteLength),
    text: String(body.text ?? '').trim(),
    audioFormat: upload.format,
    uploadBytes: upload.bytes.byteLength,
    segments: responseFormat === 'verbose_json' ? parseRuntimeSegments(body) : [],
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
