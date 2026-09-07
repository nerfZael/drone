import { useSyncExternalStore } from 'react';

// Keep the click identity after the transcript completes, so slower panes can join it.
let current: { navigationId: string; droneId: string; chatName: string; started: number } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setWorkspaceNavigationContext(value: Omit<NonNullable<typeof current>, 'started'>) {
  current = { ...value, started: performance.now() };
  for (const listener of listeners) listener();
}

export function useWorkspaceNavigationId(droneId: string) {
  return useSyncExternalStore(subscribe,
    () => current?.droneId === droneId ? current.navigationId : null,
    () => null);
}

export function workspaceNavigationContext(droneId: string) {
  if (!current || current.droneId !== droneId || performance.now() - current.started > 45_000) return null;
  return { ...current, offsetMs: Math.max(0, performance.now() - current.started) };
}
