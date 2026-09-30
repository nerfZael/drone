import { agentRunActivityHasResponse, pendingPromptIsWaiting, type ChatQuestionRequest } from '@drone/assistant-chat';
import type { PendingPrompt, TranscriptItem } from '../types';
import { parseIsoMs } from './selected-drone-workspace-utils';

export type ChatTimelineItem =
  | { kind: 'turn'; item: TranscriptItem }
  | { kind: 'pending'; item: PendingPrompt };

export type ChatTimelineGroup = {
  primary: ChatTimelineItem;
  followUps: ChatTimelineItem[];
};

/** A pending run or user-only steering message does not supersede the last answer. */
export function latestCompletedAgentTurnGroupIndex(groups: readonly ChatTimelineGroup[]): number {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const entry = groups[index]!.primary;
    if (entry.kind !== 'turn' || entry.item.userOnly || entry.item.silentCompletion) continue;
    if (entry.item.output.trim() || agentRunActivityHasResponse(entry.item.activity)) return index;
  }
  return -1;
}

export type ChatTranscriptTimelineEntry =
  | { kind: 'group'; group: ChatTimelineGroup; groupIndex: number }
  | { kind: 'question'; request: ChatQuestionRequest };

type SortableChatTimelineItem = ChatTimelineItem & {
  order: number;
  sortMs: number;
};

function timelineSortMs(item: ChatTimelineItem): number {
  if (item.kind === 'turn') return parseIsoMs(item.item.promptAt ?? item.item.at);
  return parseIsoMs(item.item.at);
}

function questionTimelineSortMs(request: ChatQuestionRequest): number {
  return parseIsoMs(request.status === 'pending' ? request.createdAt : request.updatedAt);
}

/** Merge questionnaire events into transcript history at the time visible to the user. */
export function mergeChatTranscriptTimeline(
  groups: readonly ChatTimelineGroup[],
  questionRequests: readonly ChatQuestionRequest[],
): ChatTranscriptTimelineEntry[] {
  const entries: Array<ChatTranscriptTimelineEntry & { order: number; sortMs: number }> = [
    ...groups.map((group, groupIndex) => ({
      kind: 'group' as const,
      group,
      groupIndex,
      order: groupIndex,
      sortMs: timelineSortMs(group.primary),
    })),
    ...questionRequests.map((request, index) => ({
      kind: 'question' as const,
      request,
      order: groups.length + index,
      sortMs: questionTimelineSortMs(request),
    })),
  ];

  entries.sort((left, right) => {
    if (left.sortMs !== right.sortMs) return left.sortMs - right.sortMs;
    return left.order - right.order;
  });

  return entries.map(({ order: _order, sortMs: _sortMs, ...entry }) => entry);
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
    !pendingPromptIsWaiting(item.item) &&
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
    !pendingPromptIsWaiting(candidate.item) &&
    candidate.item.state !== 'failed' &&
    !candidate.item.action
  );
}

function isSameTurnAsapFollowUp(candidate: ChatTimelineItem, primary: ChatTimelineItem): boolean {
  if (!isAsapFollowUpCandidate(candidate)) return false;
  if (candidate.item.runId || primary.item.runId) return false;
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

/** Keep confirmed run membership stable across streaming, completion and reloads. */
function sharedRunGroup(members: readonly ChatTimelineItem[]): ChatTimelineGroup {
  const original = members[0]!;
  const response = [...members].reverse().find((entry) => entry.kind === 'turn' && !entry.item.userOnly)
    ?? members.find((entry) => entry.kind === 'pending' && entry.item.state === 'failed')
    ?? members.find((entry) => entry.kind === 'pending')
    ?? original;
  // Keep response identity for activity loading, checkpoints and actions, but anchor
  // the conversation to its original request. Raw message records remain untouched.
  const item = {
    ...response.item,
    at: original.item.at,
    promptAt: original.kind === 'turn' ? original.item.promptAt ?? original.item.at : original.item.at,
    prompt: original.item.prompt,
    attachments: original.item.attachments,
    deliveryMode: original.item.deliveryMode,
    startedAt: response.item.runStartedAt ?? original.item.runStartedAt ?? original.item.startedAt,
  };
  return {
    primary: { ...response, item } as ChatTimelineItem,
    followUps: members.slice(1),
  };
}

function confirmedRunId(entry: ChatTimelineItem): string | undefined {
  if (entry.kind === 'pending' && (pendingPromptIsWaiting(entry.item) || entry.item.action)) return;
  return entry.item.runId;
}

export function groupChatTimelineItems(items: readonly ChatTimelineItem[]): ChatTimelineGroup[] {
  const runs = new Map<string, ChatTimelineItem[]>();
  for (const item of items) {
    const runId = confirmedRunId(item);
    if (runId) {
      const members = runs.get(runId) ?? [];
      members.push(item);
      runs.set(runId, members);
    }
  }
  const groups: ChatTimelineGroup[] = [];
  const emittedRuns = new Set<string>();
  for (const item of items) {
    const runId = confirmedRunId(item);
    if (runId) {
      if (!emittedRuns.has(runId)) groups.push(sharedRunGroup(runs.get(runId)!));
      emittedRuns.add(runId);
      continue;
    }
    // Compatibility for history written before shared run identity was persisted.
    let owner: ChatTimelineGroup | undefined;
    if (isAsapFollowUpCandidate(item)) {
      for (let index = groups.length - 1; index >= 0; index -= 1) {
        if (!isSameTurnAsapFollowUp(item, groups[index]!.primary)) continue;
        owner = groups[index];
        break;
      }
    }
    if (owner) owner.followUps.push(item);
    else groups.push({ primary: item, followUps: [] });
  }
  return groups;
}
