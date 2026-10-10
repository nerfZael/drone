import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExplorerWorkspaceChoice } from './mobile-workspaces';

const STORAGE_KEY = 'droneHubMobile.explorerWorkspaceByDrone.v1';
const listeners = new Set<() => void>();
let choices: Record<string, ExplorerWorkspaceChoice> = {};
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      const parsed = JSON.parse(raw ?? '{}');
      if (parsed && typeof parsed === 'object') {
        // A choice made before storage answered wins over the stored one.
        const stored = Object.fromEntries(Object.entries(parsed).filter(([, value]: [string, any]) =>
          value && typeof value.id === 'string' && typeof value.browseId === 'string' && typeof value.name === 'string' &&
          (value.kind === 'folder' || value.kind === 'drone'))) as Record<string, ExplorerWorkspaceChoice>;
        choices = { ...stored, ...choices };
        for (const listener of listeners) listener();
      }
    })
    .catch(() => undefined);
  return loaded;
}

const keyFor = (targetId: string, droneId: string) => `${targetId}\u0000${droneId}`;

/** Points a drone's Files page at another workspace, or back at the drone's own (null). Kept on this phone. */
export function setMobileExplorerWorkspace(targetId: string, droneId: string, choice: ExplorerWorkspaceChoice | null): void {
  if (!targetId || !droneId) return;
  const key = keyFor(targetId, droneId);
  if (JSON.stringify(choices[key] ?? null) === JSON.stringify(choice)) return;
  const next = { ...choices };
  if (choice) next[key] = choice;
  else delete next[key];
  choices = next;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(choices)).catch(() => undefined);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
};

/** The workspace a drone's Files page shows instead of the drone's own files, or null. */
export function useMobileExplorerWorkspace(targetId: string, droneId: string | null | undefined): ExplorerWorkspaceChoice | null {
  const key = droneId ? keyFor(targetId, droneId) : '';
  return React.useSyncExternalStore(subscribe, () => (key ? choices[key] ?? null : null));
}
