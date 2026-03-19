import type { PendingPrompt } from '../types';
import type { PendingPromptLoopGroup } from './prompt-loop-groups';
import { parseIsoMs } from './selected-drone-workspace-utils';
import type {
  PromptAutomationJobSnapshot,
  PromptAutomationQueuedSnapshot,
} from './use-prompt-automation-state';

export type PendingTimelineBlock =
  | { kind: 'prompt-loop-group'; key: string; identity: string; pendingRuns: PendingPrompt[]; sortMs: number; order: number }
  | { kind: 'pending-prompt'; key: string; item: PendingPrompt; sortMs: number; order: number }
  | { kind: 'queued-automation'; key: string; queueId: string; sortMs: number; order: number }
  | { kind: 'running-automation'; key: string; sortMs: number; order: number };

type PendingTimelineItem = PendingTimelineBlock & {
  timelineRole: 'other' | 'running-automation' | 'queued-automation';
};

function comparePendingTimelineItems(a: PendingTimelineItem, b: PendingTimelineItem): number {
  if (a.timelineRole === 'running-automation' && b.timelineRole === 'queued-automation') return -1;
  if (a.timelineRole === 'queued-automation' && b.timelineRole === 'running-automation') return 1;
  if (a.sortMs !== b.sortMs) return a.sortMs - b.sortMs;
  return a.order - b.order;
}

export function buildPendingTimelineBlocks(opts: {
  pendingOnlyPromptLoopGroups: PendingPromptLoopGroup[];
  pendingPlainPrompts: PendingPrompt[];
  queuedAutomationItems: PromptAutomationQueuedSnapshot[];
  promptAutomationJob: PromptAutomationJobSnapshot | null;
  runningAutomationIdentity: string;
  runningAutomationHasRenderedGroup: boolean;
  runningAutomationJobKey: string;
}): PendingTimelineBlock[] {
  const items: PendingTimelineItem[] = [];
  let order = 0;

  for (const group of opts.pendingOnlyPromptLoopGroups) {
    const sortMs = group.pendingRuns.reduce((min, run) => {
      const ms = parseIsoMs(run.updatedAt ?? run.at);
      return ms < min ? ms : min;
    }, Number.MAX_SAFE_INTEGER);
    items.push({
      kind: 'prompt-loop-group',
      key: `pending-loop:${group.key}`,
      identity: group.identity,
      pendingRuns: group.pendingRuns,
      sortMs,
      order: order++,
      timelineRole:
        opts.runningAutomationIdentity && group.identity === opts.runningAutomationIdentity
          ? 'running-automation'
          : 'other',
    });
  }

  for (const item of opts.pendingPlainPrompts) {
    items.push({
      kind: 'pending-prompt',
      key: `pending-prompt:${item.id}`,
      item,
      sortMs: parseIsoMs(item.updatedAt ?? item.at),
      order: order++,
      timelineRole: 'other',
    });
  }

  for (const queued of opts.queuedAutomationItems) {
    const queueId = String(queued.queueId ?? '').trim();
    if (!queueId) continue;
    items.push({
      kind: 'queued-automation',
      key: `queued-automation:${queueId}`,
      queueId,
      sortMs: parseIsoMs(queued.enqueuedAt),
      order: order++,
      timelineRole: 'queued-automation',
    });
  }

  if (opts.promptAutomationJob?.running && !opts.runningAutomationHasRenderedGroup) {
    items.push({
      kind: 'running-automation',
      key: `running-automation:${opts.runningAutomationJobKey || String(opts.promptAutomationJob.automationId ?? 'active')}`,
      sortMs: parseIsoMs(opts.promptAutomationJob.startedAt ?? opts.promptAutomationJob.updatedAt),
      order: order++,
      timelineRole: 'running-automation',
    });
  }

  items.sort(comparePendingTimelineItems);
  return items.map(({ timelineRole: _timelineRole, ...item }) => item);
}
