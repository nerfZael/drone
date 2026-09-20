import React from 'react';

/**
 * The new-terminal button lives in the dock header, outside the terminal pane's React tree,
 * while the pane owns how a session is created. The header asks; the mounted pane answers.
 * A pane only listens while it can act, which is how the header knows whether its button
 * would do anything.
 */
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const availabilityListeners = new Set<() => void>();

function requestKey(droneId: string, paneKey: string): string {
  return `${droneId}\u0000${paneKey}`;
}

function availabilityChanged(): void {
  for (const listener of availabilityListeners) listener();
}

export function requestNewTerminalSession(droneId: string, paneKey: string): void {
  for (const listener of listeners.get(requestKey(droneId, paneKey)) ?? []) listener();
}

export function onNewTerminalSessionRequest(
  droneId: string,
  paneKey: string,
  listener: Listener,
): () => void {
  const key = requestKey(droneId, paneKey);
  const forKey = listeners.get(key) ?? new Set<Listener>();
  forKey.add(listener);
  listeners.set(key, forKey);
  availabilityChanged();
  return () => {
    forKey.delete(listener);
    if (forKey.size === 0 && listeners.get(key) === forKey) listeners.delete(key);
    availabilityChanged();
  };
}

export function canRequestNewTerminalSession(droneId: string, paneKey: string): boolean {
  return listeners.has(requestKey(droneId, paneKey));
}

function subscribeAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener);
  return () => {
    availabilityListeners.delete(listener);
  };
}

/** Whether a terminal pane is mounted and ready to open a session for this request. */
export function useCanRequestNewTerminalSession(droneId: string, paneKey: string): boolean {
  const get = () => canRequestNewTerminalSession(droneId, paneKey);
  return React.useSyncExternalStore(subscribeAvailability, get, () => false);
}
