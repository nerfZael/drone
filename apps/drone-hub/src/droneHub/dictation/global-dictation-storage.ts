import { profileStorageKey } from '../../profile-storage';

export const GLOBAL_DICTATION_STORAGE_KEY = profileStorageKey('droneHub.globalDictation');
export const GLOBAL_DICTATION_MAX_CHARS = 300_000;

export type PersistedGlobalDictationState = {
  open: boolean;
  text: string;
};

export function normalizeGlobalDictationText(value: unknown): string {
  return String(value ?? '').slice(0, GLOBAL_DICTATION_MAX_CHARS);
}

export function readGlobalDictationState(): PersistedGlobalDictationState {
  if (typeof localStorage === 'undefined') return { open: false, text: '' };
  try {
    const raw = localStorage.getItem(GLOBAL_DICTATION_STORAGE_KEY);
    if (!raw) return { open: false, text: '' };
    const value = JSON.parse(raw) as { open?: unknown; text?: unknown };
    const text = normalizeGlobalDictationText(typeof value?.text === 'string' ? value.text : '');
    return {
      open: value?.open === true,
      text,
    };
  } catch {
    return { open: false, text: '' };
  }
}

export function writeGlobalDictationState(state: PersistedGlobalDictationState): void {
  if (typeof localStorage === 'undefined') return;
  const normalized = {
    open: state.open === true,
    text: normalizeGlobalDictationText(state.text),
  };
  try {
    if (!normalized.open && !normalized.text) {
      localStorage.removeItem(GLOBAL_DICTATION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(GLOBAL_DICTATION_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Persistence is best-effort; the in-memory draft remains usable.
  }
}
