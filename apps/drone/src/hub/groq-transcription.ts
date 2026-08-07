const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export type GroqTranscriptionQuality = 'fast' | 'accurate';

export const GROQ_TRANSCRIPTION_MODELS: Record<GroqTranscriptionQuality, string> = {
  fast: 'whisper-large-v3-turbo',
  accurate: 'whisper-large-v3',
};

export const GROQ_TRANSCRIPTION_MAX_BYTES = 100 * 1024 * 1024;

function audioFilenameForMime(mimeTypeRaw: string): string {
  const mimeType = String(mimeTypeRaw ?? '').toLowerCase();
  if (mimeType.includes('webm')) return 'recording.webm';
  if (mimeType.includes('ogg')) return 'recording.ogg';
  if (mimeType.includes('mp4')) return 'recording.mp4';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'recording.mp3';
  if (mimeType.includes('wav')) return 'recording.wav';
  if (mimeType.includes('flac')) return 'recording.flac';
  if (mimeType.includes('m4a')) return 'recording.m4a';
  return 'recording.webm';
}

function groqErrorMessage(status: number, statusText: string, data: unknown): string {
  const body = data && typeof data === 'object' ? (data as any) : null;
  const nested = body?.error;
  const message =
    typeof nested?.message === 'string'
      ? nested.message
      : typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : '';
  return message.trim() || `GROQ transcription failed (${status} ${statusText})`;
}

export async function transcribeAudioWithGroq(opts: {
  audio: Buffer;
  apiKey: string;
  mimeType?: string | null;
  signal?: AbortSignal;
  quality?: GroqTranscriptionQuality;
  language?: string | null;
  prompt?: string | null;
}): Promise<{ text: string; model: string }> {
  const audio = opts.audio;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    throw new Error('Audio payload is empty.');
  }
  if (audio.length > GROQ_TRANSCRIPTION_MAX_BYTES) {
    throw new Error(`Audio payload is too large (${audio.length} bytes, max ${GROQ_TRANSCRIPTION_MAX_BYTES}).`);
  }

  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('GROQ API key is not configured.');
  const mimeType = String(opts.mimeType ?? '').trim() || 'audio/webm';
  const audioBytes = new Uint8Array(audio.length);
  audioBytes.set(audio);
  const form = new FormData();
  const quality = opts.quality === 'accurate' ? 'accurate' : 'fast';
  const model = GROQ_TRANSCRIPTION_MODELS[quality];
  form.append('file', new Blob([audioBytes], { type: mimeType }), audioFilenameForMime(mimeType));
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const language = String(opts.language ?? '').trim();
  if (language) form.append('language', language.slice(0, 35));
  const prompt = String(opts.prompt ?? '').trim();
  if (prompt) form.append('prompt', prompt.slice(-1_200));

  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const raw = await response.text();
  let data: any = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }

  if (!response.ok) {
    throw new Error(groqErrorMessage(response.status, response.statusText, data));
  }

  const text = String(data?.text ?? '').trim();
  if (!text) throw new Error('GROQ returned an empty transcription.');
  return { text, model };
}
