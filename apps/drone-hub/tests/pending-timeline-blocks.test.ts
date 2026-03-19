import { describe, expect, test } from 'bun:test';
import type { PendingPrompt } from '../src/droneHub/types';
import type { PendingPromptLoopGroup } from '../src/droneHub/app/prompt-loop-groups';
import { buildPendingTimelineBlocks } from '../src/droneHub/app/pending-timeline-blocks';
import type { PromptAutomationJobSnapshot, PromptAutomationQueuedSnapshot } from '../src/droneHub/app/use-prompt-automation-state';

function pendingRun(at: string): PendingPrompt {
  return {
    id: `pending:${at}`,
    at,
    updatedAt: at,
    prompt: 'p',
    state: 'queued',
    automation: {
      kind: 'prompt-loop',
      jobKey: 'job-1',
      automationId: 'refactor',
    },
  };
}

function runningJob(startedAt: string): PromptAutomationJobSnapshot {
  return {
    status: 'running',
    running: true,
    jobKey: 'job-1',
    automationId: 'refactor',
    automationLabel: 'Refactor',
    runsTotal: 3,
    runsCompleted: 0,
    startedAt,
    updatedAt: startedAt,
    lastPromptId: null,
    error: null,
  };
}

function queuedAutomation(enqueuedAt: string): PromptAutomationQueuedSnapshot {
  return {
    queueId: 'queue-1',
    automationId: 'review',
    automationLabel: 'Review',
    runsTotal: 3,
    enqueuedAt,
  };
}

describe('buildPendingTimelineBlocks', () => {
  test('keeps queued automation after the running prompt-loop group', () => {
    const pendingOnlyPromptLoopGroups: PendingPromptLoopGroup[] = [
      {
        key: 'group-1',
        identity: 'job:job-1',
        pendingRuns: [pendingRun('2026-03-19T12:03:00.000Z')],
      },
    ];

    const out = buildPendingTimelineBlocks({
      pendingOnlyPromptLoopGroups,
      pendingPlainPrompts: [],
      queuedAutomationItems: [queuedAutomation('2026-03-19T12:02:00.000Z')],
      promptAutomationJob: runningJob('2026-03-19T12:03:00.000Z'),
      runningAutomationIdentity: 'job:job-1',
      runningAutomationHasRenderedGroup: true,
      runningAutomationJobKey: 'job-1',
    });

    expect(out.map((item) => item.kind)).toEqual(['prompt-loop-group', 'queued-automation']);
  });

  test('keeps queued automation after the standalone running automation card', () => {
    const out = buildPendingTimelineBlocks({
      pendingOnlyPromptLoopGroups: [],
      pendingPlainPrompts: [],
      queuedAutomationItems: [queuedAutomation('2026-03-19T12:02:00.000Z')],
      promptAutomationJob: runningJob('2026-03-19T12:03:00.000Z'),
      runningAutomationIdentity: '',
      runningAutomationHasRenderedGroup: false,
      runningAutomationJobKey: 'job-1',
    });

    expect(out.map((item) => item.kind)).toEqual(['running-automation', 'queued-automation']);
  });
});
