import type { PendingTimelineBlock } from './pending-timeline-blocks';
import { transcriptTimelineSortMs, type TranscriptTimelineBlock } from './prompt-loop-groups';
import { parseIsoMs } from './selected-drone-workspace-utils';

export type ChatTimelineBlock =
  | { source: 'transcript'; block: TranscriptTimelineBlock }
  | { source: 'pending'; block: PendingTimelineBlock };

type ChatTimelineItem = ChatTimelineBlock & {
  order: number;
  sortMs: number;
  timelineRole: 'other' | 'running-automation' | 'queued-automation';
};

function chatTimelineRole(item: ChatTimelineBlock, runningAutomationIdentity: string): ChatTimelineItem['timelineRole'] {
  const block = item.block;
  if (block.kind === 'queued-automation') return 'queued-automation';
  if (block.kind === 'running-automation') return 'running-automation';
  if (block.kind === 'prompt-loop-group' && runningAutomationIdentity && block.identity === runningAutomationIdentity) {
    return 'running-automation';
  }
  return 'other';
}

function pendingPromptState(item: ChatTimelineItem): string {
  return item.block.kind === 'pending-prompt' ? String(item.block.item?.state ?? '') : '';
}

function pendingPromptSubmittedMs(item: ChatTimelineItem): number | null {
  if (item.block.kind !== 'pending-prompt') return null;
  return parseIsoMs(item.block.item?.at);
}

function isActivePendingPromptState(state: string): boolean {
  return state === 'sending' || state === 'sent';
}

function compareChatTimelineItems(a: ChatTimelineItem, b: ChatTimelineItem): number {
  if (a.timelineRole === 'running-automation' && b.timelineRole === 'queued-automation') return -1;
  if (a.timelineRole === 'queued-automation' && b.timelineRole === 'running-automation') return 1;
  const aPendingState = pendingPromptState(a);
  const bPendingState = pendingPromptState(b);
  if (isActivePendingPromptState(aPendingState) && bPendingState === 'queued') return -1;
  if (aPendingState === 'queued' && isActivePendingPromptState(bPendingState)) return 1;
  const aSubmittedMs = pendingPromptSubmittedMs(a);
  const bSubmittedMs = pendingPromptSubmittedMs(b);
  if (aSubmittedMs !== null && bSubmittedMs !== null) {
    if (aSubmittedMs !== bSubmittedMs) return aSubmittedMs - bSubmittedMs;
    return a.order - b.order;
  }
  if (a.sortMs !== b.sortMs) return a.sortMs - b.sortMs;
  return a.order - b.order;
}

export function buildChatTimelineBlocks(opts: {
  transcriptTimelineBlocks: TranscriptTimelineBlock[];
  pendingTimelineBlocks: PendingTimelineBlock[];
  runningAutomationIdentity: string;
}): ChatTimelineBlock[] {
  const items: ChatTimelineItem[] = [];
  let order = 0;

  for (const block of opts.transcriptTimelineBlocks) {
    const item: ChatTimelineBlock = { source: 'transcript', block };
    items.push({
      ...item,
      order: order++,
      sortMs: transcriptTimelineSortMs(block),
      timelineRole: chatTimelineRole(item, opts.runningAutomationIdentity),
    });
  }

  for (const block of opts.pendingTimelineBlocks) {
    const item: ChatTimelineBlock = { source: 'pending', block };
    items.push({
      ...item,
      order: order++,
      sortMs: block.sortMs,
      timelineRole: chatTimelineRole(item, opts.runningAutomationIdentity),
    });
  }

  items.sort(compareChatTimelineItems);
  return items.map(({ order: _order, sortMs: _sortMs, timelineRole: _timelineRole, ...item }) => item);
}
