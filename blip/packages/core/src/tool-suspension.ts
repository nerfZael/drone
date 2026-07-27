import type { BlipToolSuspension, BlipToolSuspensionStatus, TranscriptEntry } from './types.js';

const TERMINAL_STATUSES = new Set<BlipToolSuspensionStatus>(['completed', 'denied', 'failed']);

export function toolSuspensionsFromTranscript(entries: TranscriptEntry[]): BlipToolSuspension[] {
  const latest = new Map<string, BlipToolSuspension>();
  for (const entry of entries) {
    if (entry.type !== 'tool_suspension') continue;
    latest.set(entry.suspension.id, entry.suspension);
  }
  return Array.from(latest.values()).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function isTerminalToolSuspension(status: BlipToolSuspensionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
