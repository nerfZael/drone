const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
/** A session that stayed ready this long was healthy; its failure starts a fresh backoff. */
export const COMPANION_LIVE_HEALTHY_SESSION_MS = 30_000;
/** Consecutive short-lived sessions after which reconnecting stops and the error is shown. */
export const COMPANION_LIVE_MAX_RECONNECT_ATTEMPTS = 6;

/** Deterministic exponential backoff for reconnecting an interrupted Live session. */
export function companionLiveReconnectDelay(attempt: number): number {
  const exponent = Math.max(0, Math.min(30, Math.floor(attempt)));
  return Math.min(MAX_RECONNECT_DELAY_MS, FIRST_RECONNECT_DELAY_MS * (2 ** exponent));
}

/**
 * Reconnect attempts for one Live conversation. Reaching ready alone does not reset
 * the backoff: a session that keeps failing soon after ready would otherwise retry
 * every second forever.
 */
export class CompanionLiveReconnectBackoff {
  private attempts = 0;
  private readyAt: number | null = null;

  constructor(private readonly now: () => number = () => Date.now(),
    private readonly maxAttempts = COMPANION_LIVE_MAX_RECONNECT_ATTEMPTS) {}

  ready(): void { this.readyAt = this.now(); }

  /** Delay before the next attempt, or null once the conversation should give up. */
  next(): number | null {
    if (this.readyAt !== null && this.now() - this.readyAt >= COMPANION_LIVE_HEALTHY_SESSION_MS) this.attempts = 0;
    this.readyAt = null;
    if (this.attempts >= this.maxAttempts) return null;
    return companionLiveReconnectDelay(this.attempts++);
  }

  reset(): void {
    this.attempts = 0;
    this.readyAt = null;
  }
}
