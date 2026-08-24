import type { BlipRuntimeEvent } from '@blip/core';
import type { BlipContextUsage, BlipSessionTiming } from '@blip/protocol';

import {
  applyHubDatabaseMigrations,
  type HubDatabase,
  type HubDatabaseMigration,
} from '../../host/hub-database';
import type { CompanionClientTelemetry } from '@drone/assistant-chat';

export type CompanionTelemetryTransport = 'websocket' | 'device_mesh';
export type CompanionTelemetryStatus = 'completed' | 'cancelled' | 'error';

export type CompanionTranscriptionTelemetry = {
  durationMs: number;
  audioBytes?: number;
  model?: string;
  status: 'completed' | 'error';
  phases: Record<string, number>;
};

export type CompanionRunTelemetryRecord = {
  version: 1;
  messageId: string;
  runId: string;
  transport: CompanionTelemetryTransport;
  status: CompanionTelemetryStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  queueWaitMs: number;
  coldStart: boolean;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  sessionId?: string;
  turnId?: string;
  phases: Record<string, number>;
  client?: CompanionClientTelemetry;
  transcription?: CompanionTranscriptionTelemetry;
  modelTiming?: {
    firstTurnStartedMs?: number;
    timeToFirstOutputMs?: number;
    firstOutputKind?: 'reasoning' | 'text';
    blip?: BlipSessionTiming;
    contextUsage?: BlipContextUsage;
  };
  failureCategory?: string;
};

type TelemetryLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) => void;

const MAX_STORED_RUNS = 2_000;
const MAX_RECENT_RUNS = 200;

const COMPANION_TELEMETRY_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'companion message telemetry',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE companion_message_telemetry (
          message_id TEXT NOT NULL PRIMARY KEY,
          run_id TEXT NOT NULL,
          transport TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          duration_ms REAL NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX companion_message_telemetry_started_at
          ON companion_message_telemetry(started_at DESC);
      `);
    },
  },
];

function roundedMs(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

function finiteDuration(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? roundedMs(number) : undefined;
}

function safeTiming(value: BlipSessionTiming | undefined): BlipSessionTiming | undefined {
  if (!value) return undefined;
  const toolCallsByName: BlipSessionTiming['toolCallsByName'] = {};
  for (const [name, stats] of Object.entries(value.toolCallsByName ?? {})) {
    toolCallsByName[name.slice(0, 160)] = {
      count: Math.max(0, Number(stats.count) || 0),
      completed: Math.max(0, Number(stats.completed) || 0),
      failed: Math.max(0, Number(stats.failed) || 0),
      sumMs: finiteDuration(stats.sumMs) ?? 0,
    };
  }
  return {
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    durationMs: finiteDuration(value.durationMs) ?? 0,
    turnCount: Math.max(0, Number(value.turnCount) || 0),
    toolTurnCount: Math.max(0, Number(value.toolTurnCount) || 0),
    singleToolTurnCount: Math.max(0, Number(value.singleToolTurnCount) || 0),
    parallelToolTurnCount: Math.max(0, Number(value.parallelToolTurnCount) || 0),
    maxToolsInTurn: Math.max(0, Number(value.maxToolsInTurn) || 0),
    toolCallCount: Math.max(0, Number(value.toolCallCount) || 0),
    toolCallCompletedCount: Math.max(0, Number(value.toolCallCompletedCount) || 0),
    toolCallFailedCount: Math.max(0, Number(value.toolCallFailedCount) || 0),
    toolCallSumMs: finiteDuration(value.toolCallSumMs) ?? 0,
    toolCallWallMs: finiteDuration(value.toolCallWallMs) ?? 0,
    nonToolWallMs: finiteDuration(value.nonToolWallMs) ?? 0,
    ...(value.longestToolCall
      ? {
          longestToolCall: {
            callId: String(value.longestToolCall.callId).slice(0, 160),
            tool: String(value.longestToolCall.tool).slice(0, 160),
            durationMs: finiteDuration(value.longestToolCall.durationMs) ?? 0,
          },
        }
      : {}),
    toolCallsByName,
  };
}

function failureCategory(error: unknown, status: CompanionTelemetryStatus): string | undefined {
  if (status === 'completed') return undefined;
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (status === 'cancelled' || /abort|cancel/.test(message)) return 'cancelled';
  if (/credential|api key|not configured/.test(message)) return 'credentials';
  if (/timed out|timeout/.test(message)) return 'timeout';
  if (/disconnect|socket|transport|offline/.test(message)) return 'transport';
  if (/browser tool/.test(message)) return 'browser_tool';
  if (/context.*overflow/.test(message)) return 'context_overflow';
  return 'runtime';
}

class CompanionTelemetryStore {
  static open(database: HubDatabase | null | undefined): CompanionTelemetryStore | null {
    if (!database) return null;
    database.read((connection) =>
      applyHubDatabaseMigrations(
        connection,
        COMPANION_TELEMETRY_MIGRATIONS,
        'companion-telemetry',
      ),
    );
    return new CompanionTelemetryStore(database);
  }

  private constructor(private readonly database: HubDatabase) {}

  async record(record: CompanionRunTelemetryRecord): Promise<void> {
    await this.database.writeTransaction('record Companion message telemetry', (connection) => {
      connection
        .prepare(
          `INSERT INTO companion_message_telemetry (
            message_id, run_id, transport, status, started_at, duration_ms, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(message_id) DO UPDATE SET
            run_id = excluded.run_id,
            transport = excluded.transport,
            status = excluded.status,
            started_at = excluded.started_at,
            duration_ms = excluded.duration_ms,
            payload_json = excluded.payload_json`,
        )
        .run(
          record.messageId,
          record.runId,
          record.transport,
          record.status,
          record.startedAt,
          record.durationMs,
          JSON.stringify(record),
          new Date().toISOString(),
        );
      connection
        .prepare(
          `DELETE FROM companion_message_telemetry
           WHERE message_id IN (
             SELECT message_id FROM companion_message_telemetry
             ORDER BY started_at DESC
             LIMIT -1 OFFSET ?
           )`,
        )
        .run(MAX_STORED_RUNS);
    });
  }

  list(limit: number): CompanionRunTelemetryRecord[] {
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          'SELECT payload_json FROM companion_message_telemetry ORDER BY started_at DESC LIMIT ?',
        )
        .all(limit) as Array<{ payload_json: string }>;
      return rows.flatMap((row) => {
        try {
          const parsed = JSON.parse(row.payload_json) as CompanionRunTelemetryRecord;
          return parsed?.version === 1 ? [parsed] : [];
        } catch {
          return [];
        }
      });
    });
  }
}

type RunClock = { epochMs(): number; monotonicMs(): number };
const systemClock: RunClock = {
  epochMs: () => Date.now(),
  monotonicMs: () => performance.now(),
};

export class CompanionRunTelemetry {
  private readonly phases = new Map<string, number>();
  private readonly startedEpochMs: number;
  private readonly startedMonotonicMs: number;
  private provider?: string;
  private model?: string;
  private thinkingLevel?: string;
  private sessionId?: string;
  private turnId?: string;
  private agentRunStartedMonotonicMs?: number;
  private firstTurnStartedMonotonicMs?: number;
  private firstOutputMonotonicMs?: number;
  private firstOutputKind?: 'reasoning' | 'text';
  private blipTiming?: BlipSessionTiming;
  private contextUsage?: BlipContextUsage;
  private blipStatus?: string;
  private coldStart: boolean;

  constructor(
    private readonly service: CompanionTelemetryService,
    private readonly input: {
      messageId: string;
      runId: string;
      transport: CompanionTelemetryTransport;
      queueWaitMs?: number;
      coldStart: boolean;
      client?: CompanionClientTelemetry;
      receivedAtEpochMs?: number;
      receivedAtMonotonicMs?: number;
    },
    private readonly clock: RunClock = systemClock,
  ) {
    this.startedEpochMs = input.receivedAtEpochMs ?? clock.epochMs();
    this.startedMonotonicMs = input.receivedAtMonotonicMs ?? clock.monotonicMs();
    this.coldStart = input.coldStart;
  }

  setModel(input: { provider: string; model: string; thinkingLevel: string }): void {
    this.provider = input.provider;
    this.model = input.model;
    this.thinkingLevel = input.thinkingLevel;
  }

  record(name: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.phases.set(name, roundedMs((this.phases.get(name) ?? 0) + durationMs));
  }

  async measure<T>(name: string, run: () => Promise<T>): Promise<T> {
    const startedAt = this.clock.monotonicMs();
    try {
      return await run();
    } finally {
      this.record(name, this.clock.monotonicMs() - startedAt);
    }
  }

  markAgentRunStarted(): void {
    this.agentRunStartedMonotonicMs = this.clock.monotonicMs();
  }

  markColdStart(): void {
    this.coldStart = true;
  }

  observe(event: BlipRuntimeEvent): void {
    this.sessionId = event.sessionId || this.sessionId;
    this.turnId = event.turnId || this.turnId;
    const now = this.clock.monotonicMs();
    if (event.type === 'turn_started' && this.firstTurnStartedMonotonicMs === undefined) {
      this.firstTurnStartedMonotonicMs = now;
      return;
    }
    if (
      (event.type === 'reasoning_delta' || event.type === 'assistant_delta') &&
      this.firstOutputMonotonicMs === undefined
    ) {
      this.firstOutputMonotonicMs = now;
      this.firstOutputKind = event.type === 'reasoning_delta' ? 'reasoning' : 'text';
      return;
    }
    if (event.type === 'session_finished') {
      this.blipStatus = event.status;
      this.blipTiming = safeTiming(event.timing);
      this.contextUsage = event.contextUsage;
    }
  }

  async finish(status: CompanionTelemetryStatus, error?: unknown): Promise<void> {
    const effectiveStatus: CompanionTelemetryStatus =
      status === 'completed' && this.blipStatus === 'cancelled'
        ? 'cancelled'
        : status === 'completed' && this.blipStatus === 'error'
          ? 'error'
          : status;
    const finishedEpochMs = this.clock.epochMs();
    const durationMs = roundedMs(this.clock.monotonicMs() - this.startedMonotonicMs);
    const firstTurnStartedMs =
      this.firstTurnStartedMonotonicMs !== undefined &&
      this.agentRunStartedMonotonicMs !== undefined
        ? roundedMs(this.firstTurnStartedMonotonicMs - this.agentRunStartedMonotonicMs)
        : undefined;
    const timeToFirstOutputMs =
      this.firstOutputMonotonicMs !== undefined && this.firstTurnStartedMonotonicMs !== undefined
        ? roundedMs(this.firstOutputMonotonicMs - this.firstTurnStartedMonotonicMs)
        : undefined;
    await this.service.record({
      version: 1,
      messageId: this.input.messageId,
      runId: this.input.runId,
      transport: this.input.transport,
      status: effectiveStatus,
      startedAt: new Date(this.startedEpochMs).toISOString(),
      finishedAt: new Date(finishedEpochMs).toISOString(),
      durationMs,
      queueWaitMs: roundedMs(this.input.queueWaitMs ?? 0),
      coldStart: this.coldStart,
      ...(this.provider ? { provider: this.provider } : {}),
      ...(this.model ? { model: this.model } : {}),
      ...(this.thinkingLevel ? { thinkingLevel: this.thinkingLevel } : {}),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.turnId ? { turnId: this.turnId } : {}),
      phases: Object.fromEntries(this.phases),
      ...(this.input.client ? { client: this.input.client } : {}),
      ...(
        firstTurnStartedMs !== undefined ||
        timeToFirstOutputMs !== undefined ||
        this.blipTiming ||
        this.contextUsage
          ? {
              modelTiming: {
                ...(firstTurnStartedMs !== undefined ? { firstTurnStartedMs } : {}),
                ...(timeToFirstOutputMs !== undefined ? { timeToFirstOutputMs } : {}),
                ...(this.firstOutputKind ? { firstOutputKind: this.firstOutputKind } : {}),
                ...(this.blipTiming ? { blip: this.blipTiming } : {}),
                ...(this.contextUsage ? { contextUsage: this.contextUsage } : {}),
              },
            }
          : {}
      ),
      ...(failureCategory(error, effectiveStatus)
        ? { failureCategory: failureCategory(error, effectiveStatus) }
        : {}),
    });
  }
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return roundedMs(sorted[index]!);
}

function distribution(values: number[]) {
  return {
    count: values.length,
    averageMs:
      values.length > 0
        ? roundedMs(values.reduce((total, value) => total + value, 0) / values.length)
        : null,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length > 0 ? roundedMs(Math.max(...values)) : null,
  };
}

export class CompanionTelemetryService {
  private readonly store: CompanionTelemetryStore | null;
  private readonly recent: CompanionRunTelemetryRecord[] = [];
  private readonly pendingTranscriptions = new Map<string, CompanionTranscriptionTelemetry>();

  constructor(input: { database?: HubDatabase | null; log?: TelemetryLog } = {}) {
    this.store = CompanionTelemetryStore.open(input.database);
    this.log = input.log;
  }

  private readonly log?: TelemetryLog;

  begin(input: ConstructorParameters<typeof CompanionRunTelemetry>[1]): CompanionRunTelemetry {
    return new CompanionRunTelemetry(this, input);
  }

  recordTranscription(messageId: string, telemetry: CompanionTranscriptionTelemetry): void {
    if (!messageId) return;
    this.pendingTranscriptions.set(messageId, telemetry);
    if (this.pendingTranscriptions.size > MAX_RECENT_RUNS) {
      const oldest = this.pendingTranscriptions.keys().next().value;
      if (oldest) this.pendingTranscriptions.delete(oldest);
    }
    this.log?.(telemetry.status === 'completed' ? 'info' : 'warn', 'Companion transcription timing', {
      messageId,
      ...telemetry,
    });
    if (telemetry.status === 'error') {
      const finishedAt = Date.now();
      void this.record({
        version: 1,
        messageId,
        runId: messageId,
        transport: 'websocket',
        status: 'error',
        startedAt: new Date(finishedAt - telemetry.durationMs).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: telemetry.durationMs,
        queueWaitMs: 0,
        coldStart: false,
        phases: Object.fromEntries(
          Object.entries(telemetry.phases).map(([name, durationMs]) => [
            `transcription.${name}`,
            durationMs,
          ]),
        ),
        transcription: telemetry,
        failureCategory: 'transcription',
      });
    }
  }

  async record(record: CompanionRunTelemetryRecord): Promise<void> {
    const transcription = this.pendingTranscriptions.get(record.messageId);
    this.pendingTranscriptions.delete(record.messageId);
    const completed = transcription ? { ...record, transcription } : record;
    this.recent.unshift(completed);
    if (this.recent.length > MAX_RECENT_RUNS) this.recent.length = MAX_RECENT_RUNS;
    try {
      await this.store?.record(completed);
    } catch (error) {
      this.log?.('warn', 'failed persisting Companion telemetry', {
        messageId: completed.messageId,
        error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
      });
    }
    this.log?.(completed.status === 'completed' ? 'info' : 'warn', 'Companion message timing', {
      ...completed,
    });
  }

  list(limit = 100): CompanionRunTelemetryRecord[] {
    const normalizedLimit = Math.max(1, Math.min(MAX_STORED_RUNS, Math.floor(limit) || 100));
    return this.store?.list(normalizedLimit) ?? this.recent.slice(0, normalizedLimit);
  }

  report(limit = 200) {
    const runs = this.list(limit);
    const grouped = (key: (run: CompanionRunTelemetryRecord) => string) => {
      const groups = new Map<string, CompanionRunTelemetryRecord[]>();
      for (const run of runs) {
        const name = key(run);
        const values = groups.get(name) ?? [];
        values.push(run);
        groups.set(name, values);
      }
      return Object.fromEntries(
        [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
          ([name, values]) => [
            name,
            {
              sampleSize: values.length,
              total: distribution(values.map((run) => run.durationMs)),
              timeToFirstOutput: distribution(
                values
                  .map((run) => run.modelTiming?.timeToFirstOutputMs)
                  .filter((value): value is number => value !== undefined),
              ),
            },
          ],
        ),
      );
    };
    const phaseNames = new Set(runs.flatMap((run) => Object.keys(run.phases)));
    const phases = Object.fromEntries(
      [...phaseNames].sort().map((name) => [
        name,
        distribution(runs.flatMap((run) => (run.phases[name] === undefined ? [] : [run.phases[name]!]))),
      ]),
    );
    const tools = new Map<string, number[]>();
    for (const run of runs) {
      for (const [name, stats] of Object.entries(run.modelTiming?.blip?.toolCallsByName ?? {})) {
        const values = tools.get(name) ?? [];
        if (stats.count > 0) values.push(stats.sumMs / stats.count);
        tools.set(name, values);
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      sampleSize: runs.length,
      statusCounts: Object.fromEntries(
        ['completed', 'cancelled', 'error'].map((status) => [
          status,
          runs.filter((run) => run.status === status).length,
        ]),
      ),
      transportCounts: Object.fromEntries(
        ['websocket', 'device_mesh'].map((transport) => [
          transport,
          runs.filter((run) => run.transport === transport).length,
        ]),
      ),
      total: distribution(runs.map((run) => run.durationMs)),
      queueWait: distribution(runs.map((run) => run.queueWaitMs)),
      transcription: distribution(
        runs.flatMap((run) =>
          run.transcription?.durationMs ?? run.client?.transcriptionMs ?? undefined,
        ).filter((value): value is number => value !== undefined),
      ),
      timeToFirstOutput: distribution(
        runs
          .map((run) => run.modelTiming?.timeToFirstOutputMs)
          .filter((value): value is number => value !== undefined),
      ),
      breakdowns: {
        byTransport: grouped((run) => run.transport),
        byProviderModel: grouped(
          (run) => `${run.provider ?? 'unknown'}/${run.model ?? 'unknown'}`,
        ),
        byColdStart: grouped((run) => (run.coldStart ? 'cold' : 'warm')),
        byStatus: grouped((run) => run.status),
      },
      phases,
      tools: Object.fromEntries([...tools.entries()].sort().map(([name, values]) => [name, distribution(values)])),
      runs,
    };
  }
}
