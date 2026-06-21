import type { DroneSummary } from '../types';

const RECENT_DRONE_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseTimestampMs(raw: string | null | undefined): number | null {
  const ms = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(ms) ? ms : null;
}

export function isDroneRecentForSidebar(
  drone: Pick<DroneSummary, 'createdAt' | 'lastMessageAt'>,
  nowMs: number,
): boolean {
  const cutoffMs = nowMs - RECENT_DRONE_WINDOW_MS;
  const createdAtMs = parseTimestampMs(drone.createdAt);
  if (createdAtMs != null && createdAtMs >= cutoffMs) return true;
  const lastMessageAtMs = parseTimestampMs(drone.lastMessageAt);
  return lastMessageAtMs != null && lastMessageAtMs >= cutoffMs;
}
