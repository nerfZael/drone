/**
 * The new-terminal button lives in the dock header, outside the terminal pane's React tree,
 * while the pane owns how a session is created. The header asks; the mounted pane answers.
 */
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function requestKey(droneId: string, paneKey: string): string {
  return `${droneId}\u0000${paneKey}`;
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
  return () => {
    forKey.delete(listener);
    if (forKey.size === 0) listeners.delete(key);
  };
}
