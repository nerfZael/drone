const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Deterministic exponential backoff for reconnecting an interrupted Live session. */
export function companionLiveReconnectDelay(attempt: number): number {
  const exponent = Math.max(0, Math.min(30, Math.floor(attempt)));
  return Math.min(MAX_RECONNECT_DELAY_MS, FIRST_RECONNECT_DELAY_MS * (2 ** exponent));
}
