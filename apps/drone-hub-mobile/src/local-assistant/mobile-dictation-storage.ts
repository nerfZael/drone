import AsyncStorage from '@react-native-async-storage/async-storage';

export const MOBILE_DICTATION_MAX_CHARS = 300_000;

const MOBILE_DICTATION_STORAGE_KEY = 'droneHub.mobileDictation.v1';

export type PersistedMobileDictationState = {
  open: boolean;
  text: string;
};

export function normalizeMobileDictationText(value: unknown): string {
  return String(value ?? '').slice(0, MOBILE_DICTATION_MAX_CHARS);
}

export async function readMobileDictationState(): Promise<PersistedMobileDictationState> {
  try {
    const raw = await AsyncStorage.getItem(MOBILE_DICTATION_STORAGE_KEY);
    if (!raw) return { open: false, text: '' };
    const value = JSON.parse(raw) as { open?: unknown; text?: unknown };
    return {
      open: value?.open === true,
      text: normalizeMobileDictationText(typeof value?.text === 'string' ? value.text : ''),
    };
  } catch {
    return { open: false, text: '' };
  }
}

export async function writeMobileDictationState(
  state: PersistedMobileDictationState,
): Promise<void> {
  const normalized = {
    open: state.open === true,
    text: normalizeMobileDictationText(state.text),
  };
  try {
    if (!normalized.open && !normalized.text) {
      await AsyncStorage.removeItem(MOBILE_DICTATION_STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(MOBILE_DICTATION_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Persistence is best-effort; the in-memory draft remains usable.
  }
}
