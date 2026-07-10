import type { BlipSessionTiming } from "./types.js";

type ToolCallTiming = {
  callId: string;
  tool: string;
  startedAtMs: number;
  endedAtMs?: number;
};

export class RuntimeTimingTracker {
  private readonly startedAtIso: string;
  private readonly calls = new Map<string, ToolCallTiming>();
  private readonly turns: Array<{ toolCallCount: number }> = [];
  private readonly callsByName = new Map<
    string,
    { count: number; completed: number; failed: number; sumMs: number }
  >();
  private completed = 0;
  private failed = 0;
  private callSumMs = 0;
  private longest: BlipSessionTiming["longestToolCall"];

  constructor(private readonly startedAtMs: number) {
    this.startedAtIso = new Date(startedAtMs).toISOString();
  }

  recordTurnStart(): void {
    this.turns.push({ toolCallCount: 0 });
  }

  recordToolStart(callId: string, tool: string, atMs = Date.now()): void {
    if (this.turns.length === 0) this.recordTurnStart();
    this.turns[this.turns.length - 1]!.toolCallCount += 1;
    this.calls.set(callId, { callId, tool, startedAtMs: atMs });
    const stats = this.callsByName.get(tool) ?? {
      count: 0,
      completed: 0,
      failed: 0,
      sumMs: 0,
    };
    stats.count += 1;
    this.callsByName.set(tool, stats);
  }

  recordToolEnd(callId: string, tool: string, failed: boolean, atMs = Date.now()): void {
    const existingCall = this.calls.get(callId);
    const call = existingCall ?? { callId, tool, startedAtMs: atMs };
    call.endedAtMs = atMs;
    this.calls.set(callId, call);
    const durationMs = Math.max(0, atMs - call.startedAtMs);
    this.callSumMs += durationMs;
    if (failed) this.failed += 1;
    else this.completed += 1;
    if (!this.longest || durationMs > this.longest.durationMs) {
      this.longest = { callId, tool, durationMs };
    }
    const stats = this.callsByName.get(tool) ?? {
      count: 0,
      completed: 0,
      failed: 0,
      sumMs: 0,
    };
    if (!existingCall) stats.count += 1;
    if (failed) stats.failed += 1;
    else stats.completed += 1;
    stats.sumMs += durationMs;
    this.callsByName.set(tool, stats);
  }

  finish(finishedAtMs = Date.now()): BlipSessionTiming {
    const durationMs = Math.max(0, finishedAtMs - this.startedAtMs);
    const intervals = Array.from(this.calls.values())
      .map((call) => ({ start: call.startedAtMs, end: call.endedAtMs ?? finishedAtMs }))
      .sort((left, right) => left.start - right.start);
    let wallMs = 0;
    let active: { start: number; end: number } | undefined;
    for (const interval of intervals) {
      if (!active) active = { ...interval };
      else if (interval.start <= active.end) active.end = Math.max(active.end, interval.end);
      else {
        wallMs += active.end - active.start;
        active = { ...interval };
      }
    }
    if (active) wallMs += active.end - active.start;
    const toolTurns = this.turns.filter((turn) => turn.toolCallCount > 0);
    const toolCallsByName: BlipSessionTiming["toolCallsByName"] = {};
    for (const [name, stats] of Array.from(this.callsByName.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      toolCallsByName[name] = stats;
    }
    return {
      startedAt: this.startedAtIso,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs,
      turnCount: this.turns.length,
      toolTurnCount: toolTurns.length,
      singleToolTurnCount: toolTurns.filter((turn) => turn.toolCallCount === 1).length,
      parallelToolTurnCount: toolTurns.filter((turn) => turn.toolCallCount > 1).length,
      maxToolsInTurn: toolTurns.reduce((max, turn) => Math.max(max, turn.toolCallCount), 0),
      toolCallCount: this.calls.size,
      toolCallCompletedCount: this.completed,
      toolCallFailedCount: this.failed,
      toolCallSumMs: this.callSumMs,
      toolCallWallMs: wallMs,
      nonToolWallMs: Math.max(0, durationMs - wallMs),
      ...(this.longest ? { longestToolCall: this.longest } : {}),
      toolCallsByName,
    };
  }
}
