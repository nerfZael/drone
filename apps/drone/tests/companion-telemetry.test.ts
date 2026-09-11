import { describe, expect, test } from 'bun:test';

import {
  CompanionTelemetryService,
  CompanionRunTelemetry,
  type CompanionRunTelemetryRecord,
} from '../src/hub/companion/companion-telemetry';

function record(
  messageId: string,
  durationMs: number,
  patch: Partial<CompanionRunTelemetryRecord> = {},
): CompanionRunTelemetryRecord {
  return {
    version: 1,
    messageId,
    runId: 'run-1',
    transport: 'websocket',
    status: 'completed',
    startedAt: '2026-08-16T10:00:00.000Z',
    finishedAt: '2026-08-16T10:00:01.000Z',
    durationMs,
    queueWaitMs: 5,
    coldStart: false,
    phases: { agentRunMs: durationMs - 10, replyReadMs: 10 },
    ...patch,
  };
}

describe('Companion telemetry', () => {
  test('marks a warm session as cold when its runtime configuration is rebuilt', async () => {
    const telemetry = new CompanionTelemetryService();
    const run = telemetry.begin({
      messageId: 'reconfigured-message',
      runId: 'reconfigured-run',
      transport: 'websocket',
      coldStart: false,
    });
    run.markColdStart();
    await run.finish('completed');

    expect(telemetry.list()[0]).toMatchObject({
      messageId: 'reconfigured-message',
      coldStart: true,
    });
  });

  test('uses the Blip terminal status captured by the raw event tap', async () => {
    const telemetry = new CompanionTelemetryService();
    const run = telemetry.begin({
      messageId: 'cancelled-message',
      runId: 'cancelled-run',
      transport: 'websocket',
      coldStart: true,
    });
    run.markAgentRunStarted();
    run.observe({
      version: 1,
      eventId: 'event-1',
      type: 'turn_started',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: new Date().toISOString(),
    });
    run.observe({
      version: 1,
      eventId: 'event-2',
      type: 'assistant_delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: new Date().toISOString(),
      text: 'not retained',
    });
    run.observe({
      version: 1,
      eventId: 'event-3',
      type: 'session_finished',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: new Date().toISOString(),
      status: 'cancelled',
      changedFiles: [],
      durationMs: 1,
    });
    await run.finish('completed');

    const [saved] = telemetry.list();
    expect(saved).toMatchObject({
      messageId: 'cancelled-message',
      status: 'cancelled',
      sessionId: 'session-1',
      turnId: 'turn-1',
      failureCategory: 'cancelled',
      modelTiming: { firstOutputKind: 'text' },
    });
    expect(JSON.stringify(saved)).not.toContain('not retained');
  });

  test('correlates transcription and reports latency distributions without content', async () => {
    const logs: Array<Record<string, unknown>> = [];
    const telemetry = new CompanionTelemetryService({
      log: (_level, _message, meta) => logs.push(meta ?? {}),
    });
    telemetry.recordTranscription('message-1', {
      durationMs: 250,
      audioBytes: 4_096,
      model: 'whisper-test',
      status: 'completed',
      phases: { groqMs: 230, readBodyMs: 20 },
    });
    await telemetry.record(
      record('message-1', 100, {
        modelTiming: {
          timeToFirstOutputMs: 40,
          firstOutputKind: 'text',
          blip: {
            startedAt: '2026-08-16T10:00:00.000Z',
            finishedAt: '2026-08-16T10:00:00.100Z',
            durationMs: 100,
            turnCount: 1,
            toolTurnCount: 1,
            singleToolTurnCount: 1,
            parallelToolTurnCount: 0,
            maxToolsInTurn: 1,
            toolCallCount: 1,
            toolCallCompletedCount: 1,
            toolCallFailedCount: 0,
            toolCallSumMs: 30,
            toolCallWallMs: 30,
            nonToolWallMs: 70,
            toolCallsByName: {
              list_drones: { count: 1, completed: 1, failed: 0, sumMs: 30 },
            },
          },
        },
      }),
    );
    await telemetry.record(record('message-2', 300, { transport: 'device_mesh' }));

    const report = telemetry.report();
    expect(report.sampleSize).toBe(2);
    expect(report.total).toMatchObject({ p50Ms: 100, p95Ms: 300, maxMs: 300 });
    expect(report.transcription).toMatchObject({ count: 1, p50Ms: 250 });
    expect(report.timeToFirstOutput).toMatchObject({ count: 1, p50Ms: 40 });
    expect(report.tools.list_drones).toMatchObject({ count: 1, averageMs: 30 });
    expect(report.transportCounts).toEqual({ websocket: 1, device_mesh: 1 });
    expect(report.breakdowns.byTransport.websocket.total).toMatchObject({ p50Ms: 100 });
    expect(report.breakdowns.byTransport.device_mesh.total).toMatchObject({ p50Ms: 300 });
    expect(JSON.stringify({ report, logs })).not.toContain('prompt');
    expect(JSON.stringify({ report, logs })).not.toContain('private spoken content');
  });
});


test('reports compaction latency, model usage, reduction and fallback without content', async () => {
  let now = 0;
  const service = new CompanionTelemetryService();
  const run = new CompanionRunTelemetry(service, {
    messageId: 'metrics', runId: 'run', transport: 'device_mesh', coldStart: false,
  }, { epochMs: () => now, monotonicMs: () => now });
  const base = { version: 1 as const, eventId: 'event', sessionId: 'session', timestamp: new Date(0).toISOString() };
  run.observe({ ...base, type: 'compaction_started', reason: 'auto' });
  now = 100;
  run.observe({ ...base, type: 'compaction_completed', summaryId: 'private summary identifier', tokensBefore: 9000, tokensAfter: 2000,
    fallbackUsed: true, fallbackReason: 'private provider response',
    metrics: { durationMs: 95, modelDurationMs: 80, modelCallCount: 2, modelResponseCount: 1, incompleteModelResponseCount: 1,
      usage: { input: 1000, output: 200, cacheRead: 300, cacheWrite: 0, totalTokens: 1500 } },
  });
  run.observe({ ...base, type: 'compaction_started', reason: 'manual' });
  now = 120;
  run.observe({ ...base, type: 'compaction_skipped', reason: 'private failure reason' });
  run.observe({ ...base, type: 'compaction_started', reason: 'context_overflow' });
  now = 150;
  await run.finish('cancelled');
  const report = service.report();
  expect(report.compaction).toMatchObject({
    attemptCount: 3, measuredAttemptCount: 1,
    statusCounts: { completed: 1, skipped: 1, failed: 0, cancelled: 1, interrupted: 0 },
    duration: { count: 3, p50Ms: 30, p95Ms: 95 },
    modelDuration: { count: 1, p50Ms: 80 },
    modelCallCount: 2, modelResponseCount: 1, incompleteModelResponseCount: 1,
    reportedUsage: { input: 1000, output: 200, cacheRead: 300, cacheWrite: 0, totalTokens: 1500 },
    fallbackCount: 1, tokensBefore: 9000, tokensAfter: 2000,
  });
  expect(report.runs[0]?.compactions?.map((attempt) => attempt.trigger)).toEqual(['auto', 'manual', 'context_overflow']);
  expect(JSON.stringify(report)).not.toContain('private');
});

test('records a single explicit compaction failure and tolerates legacy telemetry', async () => {
  const service = new CompanionTelemetryService();
  const run = service.begin({ messageId: 'failure', runId: 'run', transport: 'websocket', coldStart: false });
  const base = { version: 1 as const, eventId: 'event', sessionId: 'session', timestamp: new Date(0).toISOString() };
  run.observe({ ...base, type: 'compaction_started', reason: 'unknown private reason' });
  run.observe({ ...base, type: 'compaction_failed', reason: 'error' });
  await run.finish('error', 'private error');
  await service.record(record('old-runtime', 10));
  const report = service.report();
  expect(report.compaction.attemptCount).toBe(1);
  expect(report.compaction.statusCounts.failed).toBe(1);
  expect(report.compaction.measuredAttemptCount).toBe(0);
  expect(report.compaction.modelDuration.count).toBe(0);
  expect(JSON.stringify(report)).not.toContain('private');
});

test('reports active compaction before run completion, heartbeats stalled calls, and stops on failure', async () => {
  let now = 0;
  const logs: Array<{ event?: string; [key: string]: unknown }> = [];
  const telemetry = new CompanionTelemetryService({ heartbeatMs: 5, log: (_level, message, meta) => {
    if (message === 'Companion compaction progress') logs.push(meta ?? {});
  } });
  const run = new CompanionRunTelemetry(telemetry, { messageId: 'live-message', runId: 'live-run', transport: 'websocket', coldStart: false }, {
    epochMs: () => Date.parse('2026-09-11T00:00:00Z') + now, monotonicMs: () => now,
  });
  const base = { version: 1 as const, sessionId: 'session', eventId: 'event', timestamp: '2026-09-11T00:00:00Z' };
  run.setModel({ provider: 'test', model: 'summary-model', thinkingLevel: 'medium' });
  try {
    run.observe({ ...base, type: 'compaction_started', reason: 'auto' });
    run.observe({ ...base, type: 'compaction_progress', progress: {
      phase: 'summarizing', durationMs: 0, modelCallCount: 2, modelResponseCount: 1,
      modelCallActive: true, modelCallDurationMs: 0, modelDurationMs: 1500,
      modelEventCount: 3, modelIdleMs: 0,
    } });
    now = 180_000;
    const report = telemetry.report();
    expect(report.runs).toHaveLength(0);
    expect(report.activeCompactions).toEqual([expect.objectContaining({
      messageId: 'live-message', model: 'summary-model', thinkingLevel: 'medium', phase: 'summarizing',
      durationMs: 180_000, modelCallCount: 2, modelCallActive: true,
      modelCallDurationMs: 180_000, modelIdleMs: 180_000, modelEventCount: 3,
    })]);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(logs.some((row) => row.event === 'heartbeat' && row.modelIdleMs === 180_000)).toBe(true);
    run.observe({ ...base, type: 'compaction_failed', reason: 'error' });
    expect(telemetry.report().activeCompactions).toEqual([]);
    expect(logs.at(-1)).toMatchObject({ event: 'compaction_failed', status: 'failed' });
    const count = logs.length;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(logs).toHaveLength(count);
  } finally { await run.finish('error'); }
});

test.each(['completed', 'cancelled', 'error'] as const)('run ending %s clears live compaction even without a terminal compaction event', async (status) => {
  const telemetry = new CompanionTelemetryService();
  const run = telemetry.begin({ messageId: status, runId: status, transport: 'websocket', coldStart: false });
  const event = { version: 1 as const, sessionId: 'session', eventId: 'event', timestamp: new Date().toISOString(), type: 'compaction_started' as const, reason: 'private unknown reason' };
  run.observe(event);
  expect(telemetry.report().activeCompactions).toHaveLength(1);
  expect(JSON.stringify(telemetry.report().activeCompactions)).not.toContain('private');
  await run.finish(status);
  expect(telemetry.report().activeCompactions).toEqual([]);
  run.observe(event);
  expect(telemetry.report().activeCompactions).toEqual([]);
});
