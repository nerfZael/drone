import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import {
  MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES,
  MOBILE_GROQ_TRANSCRIPTION_MODEL,
  resolveMobileGroqTranscriptionResponse,
} from './mobile-voice-transcription-model';
import type { MobileVoiceInputSettings } from './mobile-voice-input-settings';
import { uploadMobileVoiceWave } from './mobile-groq-wave-upload';

const MOBILE_GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function transcribeMobileVoiceRecording(input: {
  uri: string;
  apiKey: string;
  signal?: AbortSignal;
  deleteFile?: boolean;
}): Promise<string> {
  const file = new File(input.uri);
  try {
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new Error('GROQ API key is not configured on this phone.');
    if (!file.exists || !file.size) throw new Error('The voice recording is empty.');
    if (file.size > MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES) {
      throw new Error('The voice recording exceeds GROQ’s 25 MB upload limit.');
    }
    const form = new FormData();
    // Expo File is a runtime Blob; Bun's workspace types add server-only methods to global Blob.
    form.append('file', file as unknown as Blob);
    form.append('model', MOBILE_GROQ_TRANSCRIPTION_MODEL);
    const response = await fetch(MOBILE_GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: input.signal,
    });
    return resolveMobileGroqTranscriptionResponse({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    });
  } finally {
    if (input.deleteFile !== false && file.exists) {
      try {
        file.delete();
      } catch {
        // The cache may already have removed the recording.
      }
    }
  }
}

export async function transcribeMobileVoiceWave(input: {
  wave: Uint8Array;
  apiKey: string;
  settings: Pick<MobileVoiceInputSettings, 'quality' | 'language'>;
  prompt?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  return uploadMobileVoiceWave(input, {
    stageWave(wave) {
      // React Native cannot construct a Blob from ArrayBuffer/ArrayBufferView
      // values. Expo File is a native Blob, so stage the generated WAV in cache.
      const file = new File(
        Paths.cache,
        `continuous-voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.wav`,
      );
      const cleanup = () => {
        if (!file.exists) return;
        try {
          file.delete();
        } catch {
          // The cache may already have removed the staged upload.
        }
      };
      try {
        file.create({ overwrite: true });
        file.write(wave);
        return { body: file as unknown as Blob, cleanup };
      } catch {
        cleanup();
        throw new Error('The continuous voice recording could not be staged for upload.');
      }
    },
    createFormData: () => new FormData(),
    fetch: async ({ authorization, body, signal }) =>
      fetch(MOBILE_GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: { Authorization: authorization },
        body: body as FormData,
        signal,
      }),
  });
}
