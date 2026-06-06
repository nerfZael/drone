const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export function getRelativeTimeUpdateDelayMs(atMs: number, nowMs: number): number | null {
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return null;

  const diffMs = nowMs - atMs;
  if (diffMs < 0) return Math.min(Math.max(1, atMs - nowMs), MINUTE_MS);
  if (diffMs < MINUTE_MS) return Math.max(1, SECOND_MS - (diffMs % SECOND_MS));
  if (diffMs < HOUR_MS) return 30 * SECOND_MS;
  return MINUTE_MS;
}
