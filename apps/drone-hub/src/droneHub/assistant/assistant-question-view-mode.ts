import { useSyncExternalStore } from 'react';
import { profileStorageKey } from '../../profile-storage';

export type AssistantQuestionViewMode = 'all' | 'single';

export const ASSISTANT_QUESTION_VIEW_MODE_STORAGE_KEY = profileStorageKey(
  'droneHub.assistantQuestions.viewMode',
);

const DEFAULT_VIEW_MODE: AssistantQuestionViewMode = 'single';
const listeners = new Set<() => void>();
let fallbackViewMode: AssistantQuestionViewMode = DEFAULT_VIEW_MODE;
let storageSubscriberCount = 0;

function isViewMode(value: unknown): value is AssistantQuestionViewMode {
  return value === 'all' || value === 'single';
}

export function getAssistantQuestionViewMode(): AssistantQuestionViewMode {
  if (typeof localStorage === 'undefined') return fallbackViewMode;
  try {
    const stored = localStorage.getItem(ASSISTANT_QUESTION_VIEW_MODE_STORAGE_KEY);
    return isViewMode(stored) ? stored : fallbackViewMode;
  } catch {
    return fallbackViewMode;
  }
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function handleStorageChange(event: StorageEvent): void {
  if (event.key !== ASSISTANT_QUESTION_VIEW_MODE_STORAGE_KEY) return;
  if (isViewMode(event.newValue)) fallbackViewMode = event.newValue;
  emitChange();
}

export function setAssistantQuestionViewMode(mode: AssistantQuestionViewMode): void {
  fallbackViewMode = mode;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(ASSISTANT_QUESTION_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Questionnaire navigation remains usable when storage is unavailable.
    }
  }
  emitChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  storageSubscriberCount += 1;
  if (storageSubscriberCount === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageChange);
  }
  return () => {
    listeners.delete(listener);
    storageSubscriberCount = Math.max(0, storageSubscriberCount - 1);
    if (storageSubscriberCount === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageChange);
    }
  };
}

export function useAssistantQuestionViewMode(): AssistantQuestionViewMode {
  return useSyncExternalStore(
    subscribe,
    getAssistantQuestionViewMode,
    getAssistantQuestionViewMode,
  );
}
