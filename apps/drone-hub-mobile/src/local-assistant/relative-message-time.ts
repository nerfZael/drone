export function relativeMessageTime(
  timestamp: string | number | null | undefined,
  nowMs = Date.now(),
): string {
  const timestampMs = messageTimestampMs(timestamp);
  if (!Number.isFinite(timestampMs)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1_000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (days < 365) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}

export function messageTimestampMs(
  timestamp: string | number | null | undefined,
): number {
  if (typeof timestamp === 'number') {
    if (!Number.isFinite(timestamp)) return Number.NaN;
    return Math.abs(timestamp) < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
  }
  return Date.parse(String(timestamp ?? '').trim());
}

export function relativeMessageTimeRefreshDelay(
  timestamp: string | number | null | undefined,
  nowMs = Date.now(),
): number | null {
  const timestampMs = messageTimestampMs(timestamp);
  if (!Number.isFinite(timestampMs)) return null;
  const elapsedMs = Math.max(0, nowMs - timestampMs);
  const elapsedSeconds = Math.floor(elapsedMs / 1_000);
  const unitMs =
    elapsedSeconds < 60
      ? 1_000
      : elapsedSeconds < 60 * 60
        ? 60_000
        : elapsedSeconds < 24 * 60 * 60
          ? 3_600_000
          : elapsedSeconds < 7 * 24 * 60 * 60
            ? 86_400_000
            : elapsedSeconds < 365 * 24 * 60 * 60
              ? 604_800_000
              : 31_536_000_000;
  return Math.max(50, unitMs - (elapsedMs % unitMs) + 20);
}
