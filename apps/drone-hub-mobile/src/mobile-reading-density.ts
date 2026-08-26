import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

export type MobileReadingDensity = 'default' | 'comfortable';

export const MOBILE_READING_DENSITY_STORAGE_KEY = 'droneHub.mobile.readingDensity.v1';

let currentDensity: MobileReadingDensity = 'default';
let loadPromise: Promise<MobileReadingDensity> | null = null;
let preferenceRevision = 0;
const listeners = new Set<() => void>();

export function normalizeMobileReadingDensity(value: unknown): MobileReadingDensity {
  return value === 'comfortable' ? 'comfortable' : 'default';
}

function publish(next: MobileReadingDensity): void {
  if (next === currentDensity) return;
  currentDensity = next;
  listeners.forEach((listener) => listener());
}

export function loadMobileReadingDensity(): Promise<MobileReadingDensity> {
  if (loadPromise) return loadPromise;
  const revisionAtLoad = preferenceRevision;
  loadPromise = AsyncStorage.getItem(MOBILE_READING_DENSITY_STORAGE_KEY)
    .then((stored) => {
      const next = normalizeMobileReadingDensity(stored);
      if (preferenceRevision === revisionAtLoad) publish(next);
      return currentDensity;
    })
    .catch(() => currentDensity);
  return loadPromise;
}

export async function setMobileReadingDensity(value: unknown): Promise<MobileReadingDensity> {
  const next = normalizeMobileReadingDensity(value);
  preferenceRevision += 1;
  publish(next);
  try {
    await AsyncStorage.setItem(MOBILE_READING_DENSITY_STORAGE_KEY, next);
  } catch {
    // The active preference remains useful for this session if storage is unavailable.
  }
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileReadingDensity(): MobileReadingDensity {
  const density = React.useSyncExternalStore(
    subscribe,
    () => currentDensity,
    () => 'default' as MobileReadingDensity,
  );
  React.useEffect(() => {
    void loadMobileReadingDensity();
  }, []);
  return density;
}
