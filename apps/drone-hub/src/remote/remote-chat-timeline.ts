import { parseIsoTimestampMs } from '../droneHub/app/helpers';
import type { PendingPrompt, TranscriptItem } from '../droneHub/types';

export type RemoteChatTimelineItem =
  | { kind: 'transcript'; key: string; item: TranscriptItem }
  | { kind: 'pending'; key: string; item: PendingPrompt };

function pendingStateRank(state: PendingPrompt['state']): number {
  if (state === 'failed') return 4;
  if (state === 'sent') return 3;
  if (state === 'sending') return 2;
  return 1;
}

function pendingVersionMs(item: PendingPrompt): number {
  return parseIsoTimestampMs(item.updatedAt ?? item.at) ?? 0;
}

function pendingIdentity(item: PendingPrompt): string {
  const id = String(item?.id ?? '').trim();
  if (id) return `id:${id}`;
  return `fallback:${String(item?.at ?? '').trim()}:${String(item?.prompt ?? '').trim()}`;
}

function preferPendingPrompt(current: PendingPrompt, candidate: PendingPrompt): PendingPrompt {
  const currentMs = pendingVersionMs(current);
  const candidateMs = pendingVersionMs(candidate);
  if (candidateMs !== currentMs) return candidateMs > currentMs ? candidate : current;
  return pendingStateRank(candidate.state) >= pendingStateRank(current.state) ? candidate : current;
}

export function normalizeRemotePendingPrompts(
  pending: PendingPrompt[],
  transcripts: TranscriptItem[] = [],
): PendingPrompt[] {
  const transcriptIds = new Set(
    transcripts.map((item) => String(item?.id ?? '').trim()).filter(Boolean),
  );
  const byIdentity = new Map<string, PendingPrompt>();
  for (const item of pending) {
    if (!item || transcriptIds.has(String(item.id ?? '').trim())) continue;
    const identity = pendingIdentity(item);
    const current = byIdentity.get(identity);
    byIdentity.set(identity, current ? preferPendingPrompt(current, item) : item);
  }
  return Array.from(byIdentity.values()).sort((a, b) => {
    const aMs = parseIsoTimestampMs(a.at);
    const bMs = parseIsoTimestampMs(b.at);
    if (aMs != null && bMs == null) return -1;
    if (aMs == null && bMs != null) return 1;
    if (aMs != null && bMs != null && aMs !== bMs) return aMs - bMs;
    return pendingIdentity(a).localeCompare(pendingIdentity(b));
  });
}

export function buildRemoteChatTimeline(
  transcripts: TranscriptItem[],
  pending: PendingPrompt[],
): RemoteChatTimelineItem[] {
  const items: Array<RemoteChatTimelineItem & { sortMs: number | null; order: number }> = [];
  let order = 0;
  for (const item of transcripts) {
    items.push({
      kind: 'transcript',
      key: `transcript:${String(item.id ?? '').trim() || `${item.turn}:${item.at}:${order}`}`,
      item,
      sortMs: parseIsoTimestampMs(item.promptAt ?? item.at),
      order: order++,
    });
  }
  for (const item of normalizeRemotePendingPrompts(pending, transcripts)) {
    items.push({
      kind: 'pending',
      key: `pending:${pendingIdentity(item)}`,
      item,
      sortMs: parseIsoTimestampMs(item.at),
      order: order++,
    });
  }
  items.sort((a, b) => {
    if (a.sortMs != null && b.sortMs == null) return -1;
    if (a.sortMs == null && b.sortMs != null) return 1;
    if (a.sortMs != null && b.sortMs != null && a.sortMs !== b.sortMs) return a.sortMs - b.sortMs;
    return a.order - b.order;
  });
  return items.map(({ sortMs: _sortMs, order: _order, ...item }) => item);
}
