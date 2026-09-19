import {
  OPENAI_TTS_MODELS,
  speechModelDetails,
  speechModelSupportsVoice,
  type OpenAiTtsModel,
  type OpenAiTtsVoice,
} from './speech-models';

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_SPEECH_MAX_AUDIO_BYTES = 32 * 1024 * 1024;

export type OpenAiSpeechRequest = {
  text: string;
  voice: OpenAiTtsVoice;
  model: OpenAiTtsModel;
};

export function normalizeOpenAiSpeechRequest(input: {
  text?: unknown;
  voice?: unknown;
  model?: unknown;
}): OpenAiSpeechRequest {
  const model = String(input.model ?? '').trim() as OpenAiTtsModel;
  if (!(OPENAI_TTS_MODELS as readonly string[]).includes(model)) {
    throw new Error(`Unsupported OpenAI speech model: ${model || '(missing)'}.`);
  }
  const text = String(input.text ?? '').trim();
  if (!text) throw new Error('Speech text is required.');
  const details = speechModelDetails(model);
  if (text.length > details.maxCharacters) {
    throw new Error(`Speech text is too long (${text.length} characters, max ${details.maxCharacters}).`);
  }
  const voice = String(input.voice ?? details.defaultVoice).trim().toLowerCase() as OpenAiTtsVoice;
  if (!speechModelSupportsVoice(model, voice)) {
    throw new Error(`Voice ${voice || '(missing)'} is not supported by ${model}.`);
  }
  return { text, voice, model };
}

export async function synthesizeSpeechWithOpenAi(opts: {
  apiKey: string;
  request: OpenAiSpeechRequest;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI API key is not configured.');
  const response = await fetch(OPENAI_SPEECH_URL, {
    method: 'POST',
    signal: opts.signal,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.request.model,
      input: opts.request.text,
      voice: opts.request.voice,
      response_format: 'wav',
    }),
  });
  if (!response.ok) throw new Error(await openAiSpeechError(response));
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new Error('OpenAI returned empty speech audio.');
  if (audio.length > OPENAI_SPEECH_MAX_AUDIO_BYTES) {
    throw new Error(`OpenAI speech audio is too large (${audio.length} bytes, max ${OPENAI_SPEECH_MAX_AUDIO_BYTES}).`);
  }
  return audio;
}

async function openAiSpeechError(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const data = raw ? JSON.parse(raw) : null;
    const message = typeof data?.error?.message === 'string' ? data.error.message : '';
    if (message.trim()) return message.trim();
  } catch { /* Use the bounded status fallback below. */ }
  return `OpenAI speech synthesis failed (${response.status} ${response.statusText})`;
}
