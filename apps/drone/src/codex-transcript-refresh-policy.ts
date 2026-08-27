export const CODEX_TRANSCRIPT_REFRESH_MIN_INTERVAL_MS = 500;

export function codexTranscriptRefreshDue(opts: {
  events: unknown[];
  lastRefreshAtMs: number | undefined;
  nowMs: number;
  minIntervalMs?: number;
}): boolean {
  const terminalEvent = opts.events.some((event) => {
    const type = String((event as any)?.type ?? '');
    return type === 'turn.completed' || type === 'error';
  });
  if (terminalEvent || opts.lastRefreshAtMs === undefined) return true;
  const minIntervalMs = Math.max(
    0,
    Math.floor(opts.minIntervalMs ?? CODEX_TRANSCRIPT_REFRESH_MIN_INTERVAL_MS),
  );
  return opts.nowMs - opts.lastRefreshAtMs >= minIntervalMs;
}
