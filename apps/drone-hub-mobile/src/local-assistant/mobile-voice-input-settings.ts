import AsyncStorage from '@react-native-async-storage/async-storage';

export type MobileVoiceInputSettings = {
  endThoughtPreset: 'quick' | 'balanced' | 'patient' | 'custom';
  customSilenceMillis: number;
  noiseHandling: 'auto' | 'quiet' | 'noisy';
  language: string | null;
  quality: 'fast' | 'accurate';
  confirmationFeedback: boolean;
};

export const DEFAULT_MOBILE_VOICE_INPUT_SETTINGS: MobileVoiceInputSettings = {
  endThoughtPreset: 'balanced',
  customSilenceMillis: 2_500,
  noiseHandling: 'auto',
  language: null,
  quality: 'fast',
  confirmationFeedback: false,
};
export const MOBILE_VOICE_INPUT_SILENCE_MILLIS_MIN = 250;
export const MOBILE_VOICE_INPUT_SILENCE_MILLIS_MAX = 10_000;

const STORAGE_KEY = 'droneHub.voiceInput.settings.v1';

export function normalizeMobileVoiceInputSettings(raw: unknown): MobileVoiceInputSettings {
  const input = raw && typeof raw === 'object' ? (raw as Partial<MobileVoiceInputSettings>) : {};
  const preset =
    input.endThoughtPreset === 'quick' ||
    input.endThoughtPreset === 'patient' ||
    input.endThoughtPreset === 'custom'
      ? input.endThoughtPreset
      : 'balanced';
  const customSilenceMillis = Number(input.customSilenceMillis);
  return {
    endThoughtPreset: preset,
    customSilenceMillis:
      Number.isFinite(customSilenceMillis) &&
      customSilenceMillis >= MOBILE_VOICE_INPUT_SILENCE_MILLIS_MIN &&
      customSilenceMillis <= MOBILE_VOICE_INPUT_SILENCE_MILLIS_MAX
        ? Math.round(customSilenceMillis)
        : 2_500,
    noiseHandling:
      input.noiseHandling === 'quiet' || input.noiseHandling === 'noisy'
        ? input.noiseHandling
        : 'auto',
    language:
      typeof input.language === 'string' &&
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.language.trim())
        ? input.language.trim()
        : null,
    quality: input.quality === 'accurate' ? 'accurate' : 'fast',
    confirmationFeedback: input.confirmationFeedback === true,
  };
}

export function mobileVoiceInputSilenceMillis(settings: MobileVoiceInputSettings): number {
  if (settings.endThoughtPreset === 'quick') return 1_500;
  if (settings.endThoughtPreset === 'patient') return 4_000;
  if (settings.endThoughtPreset === 'custom') return settings.customSilenceMillis;
  return 2_500;
}

export async function loadMobileVoiceInputSettings(): Promise<MobileVoiceInputSettings> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_MOBILE_VOICE_INPUT_SETTINGS;
  try {
    return normalizeMobileVoiceInputSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_MOBILE_VOICE_INPUT_SETTINGS;
  }
}

export async function saveMobileVoiceInputSettings(
  input: MobileVoiceInputSettings,
): Promise<MobileVoiceInputSettings> {
  const settings = normalizeMobileVoiceInputSettings(input);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings;
}
