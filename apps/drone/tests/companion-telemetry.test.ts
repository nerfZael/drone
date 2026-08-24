import { describe, expect, test } from 'bun:test';

import {
  CompanionTelemetryService,
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
