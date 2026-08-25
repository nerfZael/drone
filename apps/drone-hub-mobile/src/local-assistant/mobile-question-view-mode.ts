import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

export type MobileQuestionViewMode = 'all' | 'single';

export const MOBILE_QUESTION_VIEW_MODE_STORAGE_KEY =
  '@drone/mobile-question-view-mode';

const listeners = new Set<() => void>();
let viewMode: MobileQuestionViewMode = 'single';
let hydrationStarted = false;
let localRevision = 0;

function emitChange(): void {
  for (const listener of listeners) listener();
}

function isViewMode(value: unknown): value is MobileQuestionViewMode {
  return value === 'all' || value === 'single';
}

export function getMobileQuestionViewMode(): MobileQuestionViewMode {
  return viewMode;
}

export function hydrateMobileQuestionViewMode(): void {
  if (hydrationStarted) return;
  hydrationStarted = true;
  const hydrationRevision = localRevision;
  void AsyncStorage.getItem(MOBILE_QUESTION_VIEW_MODE_STORAGE_KEY)
    .then((stored) => {
      if (hydrationRevision !== localRevision) return;
      if (!isViewMode(stored) || stored === viewMode) return;
      viewMode = stored;
      emitChange();
    })
    .catch(() => undefined);
}

export function setMobileQuestionViewMode(mode: MobileQuestionViewMode): void {
  if (mode === viewMode) return;
  localRevision += 1;
  viewMode = mode;
  emitChange();
  void AsyncStorage.setItem(MOBILE_QUESTION_VIEW_MODE_STORAGE_KEY, mode).catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileQuestionViewMode(): MobileQuestionViewMode {
  React.useEffect(hydrateMobileQuestionViewMode, []);
  return React.useSyncExternalStore(
    subscribe,
    getMobileQuestionViewMode,
    getMobileQuestionViewMode,
  );
}
