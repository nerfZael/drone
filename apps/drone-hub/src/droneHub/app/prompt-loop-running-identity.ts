import type { PendingPrompt, TranscriptItem } from '../types';
import type { PendingPromptLoopGroup, TranscriptRenderBlock } from './prompt-loop-groups';

type RunningPromptAutomationSnapshotLike = {
  running?: boolean;
  jobKey?: string | null;
  automationId?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
} | null | undefined;

function parseIsoMsOrZero(raw: string | null | undefined): number {
  const ms = Date.parse(String(raw ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

function transcriptGroupLatestMs(runs: TranscriptItem[]): number {
  let latest = 0;
  for (const run of runs) {
    const ms = parseIsoMsOrZero(run.completedAt ?? run.promptAt ?? run.at);
    if (ms > latest) latest = ms;
  }
  return latest;
}

function pendingGroupLatestMs(pendingRuns: PendingPrompt[]): number {
  let latest = 0;
  for (const run of pendingRuns) {
    const ms = parseIsoMsOrZero(run.updatedAt ?? run.at);
    if (ms > latest) latest = ms;
  }
  return latest;
}

function transcriptGroupHasAutomationId(runs: TranscriptItem[], automationId: string): boolean {
  for (const run of runs) {
    if (String(run.automation?.automationId ?? '').trim() === automationId) return true;
  }
  return false;
}

function pendingGroupHasAutomationId(pendingRuns: PendingPrompt[], automationId: string): boolean {
  for (const run of pendingRuns) {
    if (String(run.automation?.automationId ?? '').trim() === automationId) return true;
  }
  return false;
}

export function resolveRunningPromptLoopIdentity(opts: {
  job: RunningPromptAutomationSnapshotLike;
  transcriptRenderBlocks: TranscriptRenderBlock[];
  pendingPromptLoopGroups: PendingPromptLoopGroup[];
}): string {
  const { job, transcriptRenderBlocks, pendingPromptLoopGroups } = opts;
  if (!job?.running) return '';

  const runningAutomationJobKey = String(job.jobKey ?? '').trim();
  const runningAutomationExactIdentity = runningAutomationJobKey ? `job:${runningAutomationJobKey}` : '';
  if (runningAutomationExactIdentity) {
    for (const block of transcriptRenderBlocks) {
      if (block.kind !== 'prompt-loop-group') continue;
      if (block.identity === runningAutomationExactIdentity) return runningAutomationExactIdentity;
    }
    for (const group of pendingPromptLoopGroups) {
      if (group.identity === runningAutomationExactIdentity) return runningAutomationExactIdentity;
    }
  }

  const automationId = String(job.automationId ?? '').trim();
  if (!automationId) return '';
  const startedMs = parseIsoMsOrZero(job.startedAt ?? job.updatedAt);
  const recentFloorMs = startedMs > 0 ? Math.max(0, startedMs - 2 * 60 * 1000) : 0;
  const candidates: Array<{ identity: string; latestMs: number; order: number }> = [];
  let order = 0;

  for (const block of transcriptRenderBlocks) {
    if (block.kind !== 'prompt-loop-group') continue;
    if (!transcriptGroupHasAutomationId(block.runs, automationId)) continue;
    candidates.push({
      identity: block.identity,
      latestMs: transcriptGroupLatestMs(block.runs),
      order: order++,
    });
  }
  for (const group of pendingPromptLoopGroups) {
    if (!pendingGroupHasAutomationId(group.pendingRuns, automationId)) continue;
    candidates.push({
      identity: group.identity,
      latestMs: pendingGroupLatestMs(group.pendingRuns),
      order: order++,
    });
  }

  if (candidates.length === 0) return '';
  const recentCandidates = candidates.filter((item) => item.latestMs >= recentFloorMs);
  // If we know when the current run started, avoid binding controls to an older
  // historical group with the same automation id.
  if (startedMs > 0 && recentCandidates.length === 0) return '';
  const scoped = recentCandidates.length > 0 ? recentCandidates : candidates;
  scoped.sort((a, b) => {
    if (a.latestMs !== b.latestMs) return b.latestMs - a.latestMs;
    return b.order - a.order;
  });
  return scoped[0]?.identity ?? '';
}
