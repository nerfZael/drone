import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import {
  MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES,
  MOBILE_GROQ_TRANSCRIPTION_MODEL,
  resolveMobileGroqTranscriptionResponse,
} from './mobile-voice-transcription-model';

const MOBILE_GROQ_TRANSCRIPTION_URL =
  'https://api.groq.com/openai/v1/audio/transcriptions';

export async function transcribeMobileVoiceRecording(input: {
  uri: string;
  apiKey: string;
  signal?: AbortSignal;
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
    if (file.exists) {
      try {
        file.delete();
      } catch {
        // The cache may already have removed the recording.
      }
    }
  }
}
