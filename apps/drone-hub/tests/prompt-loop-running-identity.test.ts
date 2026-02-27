import { describe, expect, test } from 'bun:test';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';
import type { PendingPromptLoopGroup, TranscriptRenderBlock } from '../src/droneHub/app/prompt-loop-groups';
import { resolveRunningPromptLoopIdentity } from '../src/droneHub/app/prompt-loop-running-identity';

function transcriptRun(opts: {
  id: string;
  at: string;
  jobKey?: string;
  automationId?: string;
}): TranscriptItem {
  return {
    turn: 1,
    at: opts.at,
    completedAt: opts.at,
    id: opts.id,
    prompt: 'p',
    session: 's',
    logPath: '/tmp/log',
    ok: true,
    output: 'ok',
    automation: {
      kind: 'prompt-loop',
      ...(opts.jobKey ? { jobKey: opts.jobKey } : {}),
      ...(opts.automationId ? { automationId: opts.automationId } : {}),
    },
  };
}

function pendingRun(opts: {
  id: string;
  at: string;
  jobKey?: string;
  automationId?: string;
}): PendingPrompt {
  return {
    id: opts.id,
    at: opts.at,
    updatedAt: opts.at,
    prompt: 'p',
    state: 'queued',
    automation: {
      kind: 'prompt-loop',
      ...(opts.jobKey ? { jobKey: opts.jobKey } : {}),
      ...(opts.automationId ? { automationId: opts.automationId } : {}),
    },
  };
}

describe('resolveRunningPromptLoopIdentity', () => {
  test('prefers exact job identity when available', () => {
    const blocks: TranscriptRenderBlock[] = [
      {
        kind: 'prompt-loop-group',
        key: 'k1',
        identity: 'job:abc',
        runs: [transcriptRun({ id: 'r1', at: '2026-02-27T10:00:00.000Z', jobKey: 'abc', automationId: 'loop' })],
      },
    ];
    const out = resolveRunningPromptLoopIdentity({
      job: {
        running: true,
        jobKey: 'abc',
        automationId: 'loop',
        startedAt: '2026-02-27T10:00:10.000Z',
      },
      transcriptRenderBlocks: blocks,
      pendingPromptLoopGroups: [],
    });
    expect(out).toBe('job:abc');
  });

  test('matches by automation id when exact job identity is unavailable but candidate is recent', () => {
    const blocks: TranscriptRenderBlock[] = [
      {
        kind: 'prompt-loop-group',
        key: 'k1',
        identity: 'fallback:loop',
        runs: [transcriptRun({ id: 'r1', at: '2026-02-27T10:00:30.000Z', automationId: 'loop' })],
      },
    ];
    const out = resolveRunningPromptLoopIdentity({
      job: {
        running: true,
        jobKey: 'new-job',
        automationId: 'loop',
        startedAt: '2026-02-27T10:01:00.000Z',
      },
      transcriptRenderBlocks: blocks,
      pendingPromptLoopGroups: [],
    });
    expect(out).toBe('fallback:loop');
  });

  test('does not bind to stale historical groups for a new run', () => {
    const blocks: TranscriptRenderBlock[] = [
      {
        kind: 'prompt-loop-group',
        key: 'k1',
        identity: 'fallback:old-loop',
        runs: [transcriptRun({ id: 'r1', at: '2026-02-27T08:00:00.000Z', automationId: 'loop' })],
      },
    ];
    const out = resolveRunningPromptLoopIdentity({
      job: {
        running: true,
        jobKey: 'fresh-job',
        automationId: 'loop',
        startedAt: '2026-02-27T10:00:00.000Z',
      },
      transcriptRenderBlocks: blocks,
      pendingPromptLoopGroups: [],
    });
    expect(out).toBe('');
  });

  test('can still fall back to latest candidate when run start time is unavailable', () => {
    const pendingGroups: PendingPromptLoopGroup[] = [
      {
        key: 'p1',
        identity: 'fallback:pending-loop',
        pendingRuns: [pendingRun({ id: 'p-run', at: '2026-02-27T10:00:00.000Z', automationId: 'loop' })],
      },
    ];
    const out = resolveRunningPromptLoopIdentity({
      job: {
        running: true,
        jobKey: 'missing-start',
        automationId: 'loop',
        startedAt: null,
        updatedAt: null,
      },
      transcriptRenderBlocks: [],
      pendingPromptLoopGroups: pendingGroups,
    });
    expect(out).toBe('fallback:pending-loop');
  });
});
