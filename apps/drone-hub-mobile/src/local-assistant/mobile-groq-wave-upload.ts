import { normalizeGroqTranscriptionPrompt } from '@drone/assistant-chat';
import {
  MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES,
  MOBILE_GROQ_TRANSCRIPTION_MODEL,
  resolveMobileGroqTranscriptionResponse,
} from './mobile-voice-transcription-model';
import type { MobileVoiceInputSettings } from './mobile-voice-input-settings';

export type MobileVoiceWaveTranscriptionInput = {
  wave: Uint8Array;
  apiKey: string;
  settings: Pick<MobileVoiceInputSettings, 'quality' | 'language'>;
  prompt?: string | null;
  signal?: AbortSignal;
};

export type MobileVoiceWaveUploadRuntime = {
  stageWave(wave: Uint8Array): {
    body: unknown;
    cleanup(): void;
  };
  createFormData(): {
    append(name: string, value: unknown): void;
  };
  fetch(input: { authorization: string; body: unknown; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    text(): Promise<string>;
  }>;
};

export async function uploadMobileVoiceWave(
  input: MobileVoiceWaveTranscriptionInput,
  runtime: MobileVoiceWaveUploadRuntime,
): Promise<string> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error('GROQ API key is not configured on this phone.');
  if (input.wave.length <= 44) throw new Error('The voice recording is empty.');
  if (input.wave.length > MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES) {
    throw new Error('The voice recording exceeds GROQ’s 25 MB upload limit.');
  }

  const staged = runtime.stageWave(input.wave);
  try {
    const form = runtime.createFormData();
    form.append('file', staged.body);
    form.append(
      'model',
      input.settings.quality === 'accurate' ? 'whisper-large-v3' : MOBILE_GROQ_TRANSCRIPTION_MODEL,
    );
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (input.settings.language) form.append('language', input.settings.language);
    const prompt = normalizeGroqTranscriptionPrompt(input.prompt);
    if (prompt) form.append('prompt', prompt);
    const response = await runtime.fetch({
      authorization: `Bearer ${apiKey}`,
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
    staged.cleanup();
  }
}
