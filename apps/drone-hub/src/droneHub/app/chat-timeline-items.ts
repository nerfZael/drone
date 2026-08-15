import { isEventNotificationPrompt } from '@drone/assistant-chat';
import type { PendingPrompt, TranscriptItem } from '../types';
import { parseIsoMs } from './selected-drone-workspace-utils';

export type ChatTimelineItem =
  | { kind: 'turn'; item: TranscriptItem }
  | { kind: 'pending'; item: PendingPrompt };

export type ChatTimelineGroup = {
  primary: ChatTimelineItem;
  followUps: ChatTimelineItem[];
};

type SortableChatTimelineItem = ChatTimelineItem & {
  order: number;
  sortMs: number;
};

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
    if (a.sortMs !== b.sortMs) return a.sortMs - b.sortMs;
    return a.order - b.order;
  });

  return items.map(({ order: _order, sortMs: _sortMs, ...item }) => item);
}

function isActivePending(item: ChatTimelineItem): boolean {
  return (
    item.kind === 'pending' &&
    item.item.state !== 'queued' &&
    item.item.state !== 'failed' &&
    !item.item.action
  );
}

function isAsapFollowUpCandidate(candidate: ChatTimelineItem): boolean {
  if (candidate.kind === 'turn') {
    return candidate.item.userOnly === true && candidate.item.deliveryMode !== 'queue';
  }
  return (
    candidate.item.deliveryMode === 'asap' &&
    candidate.item.state !== 'queued' &&
    candidate.item.state !== 'failed' &&
    !candidate.item.action
  );
}

function isSameTurnAsapFollowUp(candidate: ChatTimelineItem, primary: ChatTimelineItem): boolean {
  if (!isAsapFollowUpCandidate(candidate)) return false;
  if (isEventNotificationPrompt(primary.item.prompt)) return false;
  if (isActivePending(primary)) return true;
  if (primary.kind !== 'turn' || primary.item.userOnly === true) return false;

  const followUpAt = parseIsoMs(
    candidate.kind === 'turn' ? candidate.item.promptAt ?? candidate.item.at : candidate.item.at,
  );
  const primaryCompletedAt = parseIsoMs(primary.item.completedAt);
  return followUpAt > 0 && primaryCompletedAt >= followUpAt;
}

function activityMessageCount(item: PendingPrompt): number {
  return Array.isArray(item.activity?.messages) ? item.activity.messages.length : -1;
}

/** Use the richest live run projection while retaining the original prompt identity and timing. */
export function groupedPendingPresentationItem(group: ChatTimelineGroup): PendingPrompt | null {
  if (group.primary.kind !== 'pending') return null;
  const primary = group.primary.item;
  let activity = primary.activity;
  let activityCount = activityMessageCount(primary);
  let agentPlan = primary.agentPlan;
  let fileChanges = primary.fileChanges;

  for (const entry of group.followUps) {
    if (entry.kind !== 'pending') continue;
    const candidateCount = activityMessageCount(entry.item);
    if (candidateCount >= 0 && candidateCount >= activityCount) {
      activity = entry.item.activity;
      activityCount = candidateCount;
    }
    agentPlan = entry.item.agentPlan ?? agentPlan;
    fileChanges = entry.item.fileChanges ?? fileChanges;
  }

  if (
    activity === primary.activity &&
    agentPlan === primary.agentPlan &&
    fileChanges === primary.fileChanges
  ) {
    return primary;
  }
  return {
    ...primary,
    ...(activity ? { activity } : {}),
    ...(agentPlan ? { agentPlan } : {}),
    ...(fileChanges ? { fileChanges } : {}),
  };
}

/**
 * Keep same-turn steering as one conversational turn. An ASAP prompt that is
 * still queued, failed, or produced its own assistant response remains a
 * standalone item so its state and controls are never hidden.
 */
export function groupChatTimelineItems(items: readonly ChatTimelineItem[]): ChatTimelineGroup[] {
  const groups: ChatTimelineGroup[] = [];
  for (const item of items) {
    let owner: ChatTimelineGroup | undefined;
    if (isAsapFollowUpCandidate(item)) {
      for (let index = groups.length - 1; index >= 0; index -= 1) {
        if (!isSameTurnAsapFollowUp(item, groups[index]!.primary)) continue;
        owner = groups[index];
        break;
      }
    }
    if (owner) {
      owner.followUps.push(item);
      continue;
    }
    groups.push({ primary: item, followUps: [] });
  }
  return groups;
}
