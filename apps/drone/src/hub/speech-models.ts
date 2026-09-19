import {
  GROQ_ARABIC_SPEECH_MODEL,
  GROQ_ENGLISH_SPEECH_MODEL,
  GROQ_SPEECH_VOICES,
  type GroqSpeechVoice,
} from './groq-speech';

export const OPENAI_TTS_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const;
export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

const OPENAI_LEGACY_TTS_VOICES = [
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
] as const;
const GROQ_ENGLISH_VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'] as const;
const GROQ_ARABIC_VOICES = ['abdullah', 'fahad', 'sultan', 'lulwa', 'noura', 'aisha'] as const;

export type OpenAiTtsModel = (typeof OPENAI_TTS_MODELS)[number];
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export type SpeechModel = OpenAiTtsModel | typeof GROQ_ENGLISH_SPEECH_MODEL | typeof GROQ_ARABIC_SPEECH_MODEL;
export type SpeechVoice = OpenAiTtsVoice | GroqSpeechVoice;

export const SPEECH_MODELS: ReadonlyArray<{
  id: SpeechModel;
  label: string;
  provider: 'openai' | 'groq';
  maxCharacters: number;
  defaultVoice: SpeechVoice;
  voices: readonly SpeechVoice[];
}> = [
  { id: 'tts-1', label: 'OpenAI TTS-1', provider: 'openai', maxCharacters: 4096, defaultVoice: 'alloy', voices: OPENAI_LEGACY_TTS_VOICES },
  { id: 'tts-1-hd', label: 'OpenAI TTS-1 HD', provider: 'openai', maxCharacters: 4096, defaultVoice: 'alloy', voices: OPENAI_LEGACY_TTS_VOICES },
  { id: 'gpt-4o-mini-tts', label: 'OpenAI GPT-4o Mini TTS', provider: 'openai', maxCharacters: 4096, defaultVoice: 'marin', voices: OPENAI_TTS_VOICES },
  { id: GROQ_ENGLISH_SPEECH_MODEL, label: 'Groq Orpheus English', provider: 'groq', maxCharacters: 200, defaultVoice: 'troy', voices: GROQ_ENGLISH_VOICES },
  { id: GROQ_ARABIC_SPEECH_MODEL, label: 'Groq Orpheus Saudi Arabic', provider: 'groq', maxCharacters: 200, defaultVoice: 'abdullah', voices: GROQ_ARABIC_VOICES },
];

export const SPEECH_VOICES = [...new Set(SPEECH_MODELS.flatMap((model) => model.voices))] as readonly SpeechVoice[];
export const DEFAULT_SPEECH_MODEL: SpeechModel = 'tts-1';

export function parseSpeechModel(raw: unknown): SpeechModel | null {
  const model = String(raw ?? '').trim().toLowerCase();
  return SPEECH_MODELS.some((option) => option.id === model) ? model as SpeechModel : null;
}

export function parseSpeechVoice(raw: unknown): SpeechVoice | null {
  const voice = String(raw ?? '').trim().toLowerCase();
  return (SPEECH_VOICES as readonly string[]).includes(voice) ? voice as SpeechVoice : null;
}

export function speechModelDetails(model: SpeechModel) {
  return SPEECH_MODELS.find((option) => option.id === model)!;
}

export function speechModelSupportsVoice(model: SpeechModel, voice: SpeechVoice): boolean {
  return speechModelDetails(model).voices.includes(voice);
}

export function inferLegacySpeechModel(voice: SpeechVoice): SpeechModel {
  if ((GROQ_ARABIC_VOICES as readonly SpeechVoice[]).includes(voice)) return GROQ_ARABIC_SPEECH_MODEL;
  if ((GROQ_SPEECH_VOICES as readonly SpeechVoice[]).includes(voice)) return GROQ_ENGLISH_SPEECH_MODEL;
  return DEFAULT_SPEECH_MODEL;
}
