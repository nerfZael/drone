import type { PendingPrompt, TranscriptItem } from '../types';
import { parseIsoMs } from './selected-drone-workspace-utils';

export type ChatTimelineItem =
  | { kind: 'turn'; item: TranscriptItem }
  | { kind: 'pending'; item: PendingPrompt };

type SortableChatTimelineItem = ChatTimelineItem & {
  order: number;
  sortMs: number;
};

function isActivePendingPrompt(item: ChatTimelineItem): boolean {
  return item.kind === 'pending' && (item.item.state === 'sending' || item.item.state === 'sent');
}

function isQueuedPendingPrompt(item: ChatTimelineItem): boolean {
  return item.kind === 'pending' && item.item.state === 'queued';
}

function timelineSortMs(item: ChatTimelineItem): number {
  if (item.kind === 'turn') return parseIsoMs(item.item.promptAt ?? item.item.at);
  return parseIsoMs(item.item.at);
}

export function buildChatTimelineItems(
  turns: readonly TranscriptItem[],
  pendingPrompts: readonly PendingPrompt[],
): ChatTimelineItem[] {
  const items: SortableChatTimelineItem[] = [];
  let order = 0;

  for (const item of turns) {
    const timelineItem: ChatTimelineItem = { kind: 'turn', item };
    items.push({ ...timelineItem, order: order++, sortMs: timelineSortMs(timelineItem) });
  }
  for (const item of pendingPrompts) {
    const timelineItem: ChatTimelineItem = { kind: 'pending', item };
    items.push({ ...timelineItem, order: order++, sortMs: timelineSortMs(timelineItem) });
  }

  items.sort((a, b) => {
    if (a.kind === 'pending' && b.kind === 'pending') {
      if (isActivePendingPrompt(a) && isQueuedPendingPrompt(b)) return -1;
      if (isQueuedPendingPrompt(a) && isActivePendingPrompt(b)) return 1;
      const submittedDelta = parseIsoMs(a.item.at) - parseIsoMs(b.item.at);
      if (submittedDelta !== 0) return submittedDelta;
      return a.order - b.order;
    }
    if (a.sortMs !== b.sortMs) return a.sortMs - b.sortMs;
    return a.order - b.order;
  });

  return items.map(({ order: _order, sortMs: _sortMs, ...item }) => item);
}
