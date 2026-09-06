import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

export const MOBILE_EXPLORER_FOLDER_ICONS_STORAGE_KEY = 'droneHub.mobile.explorerFolderIcons.v1';

let currentValue = true;
let loadPromise: Promise<boolean> | null = null;
let preferenceRevision = 0;
const listeners = new Set<() => void>();

export function normalizeMobileExplorerFolderIcons(stored: unknown): boolean {
  return stored !== 'off';
}

function publish(next: boolean): void {
  if (next === currentValue) return;
  currentValue = next;
  listeners.forEach((listener) => listener());
}

export function loadMobileExplorerFolderIcons(): Promise<boolean> {
  if (loadPromise) return loadPromise;
  const revisionAtLoad = preferenceRevision;
  loadPromise = AsyncStorage.getItem(MOBILE_EXPLORER_FOLDER_ICONS_STORAGE_KEY)
    .then((stored) => {
      if (preferenceRevision === revisionAtLoad)
        publish(normalizeMobileExplorerFolderIcons(stored));
      return currentValue;
    })
    .catch(() => currentValue);
  return loadPromise;
}

export async function setMobileExplorerFolderIcons(enabled: boolean): Promise<boolean> {
  preferenceRevision += 1;
  publish(enabled);
  try {
    await AsyncStorage.setItem(MOBILE_EXPLORER_FOLDER_ICONS_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // The active preference remains useful for this session if storage is unavailable.
  }
  return enabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileExplorerFolderIcons(): boolean {
  const enabled = React.useSyncExternalStore(
    subscribe,
    () => currentValue,
    () => true,
  );
  React.useEffect(() => {
    void loadMobileExplorerFolderIcons();
  }, []);
  return enabled;
}
