import type { CompanionReflexDecision, CompanionReflexWake } from '@drone/assistant-chat';

export type JevDebugEntry =
  | ({ kind: 'decision' } & CompanionReflexDecision)
  | ({ kind: 'wake'; id: string; startedAt: number } & CompanionReflexWake);

export const isActingEntry = (entry: JevDebugEntry) => entry.kind === 'wake' || (Boolean(entry.action) && entry.action !== 'wait');

// Session-only, bounded independently of the never-truncated transcript history.
export function retainJevDebugEntries(entries: JevDebugEntry[]): JevDebugEntry[] {
  let size = 0;
  // Frequent waits should not immediately evict the acting decisions being debugged.
  const prioritized = [...entries.filter(isActingEntry).slice(0, 50), ...entries.filter(entry => !isActingEntry(entry)).slice(0, 50)];
  return prioritized.filter(entry => {
    size += JSON.stringify(entry).length;
    return size <= 2_000_000;
  }).sort((left, right) => right.startedAt - left.startedAt);
}
