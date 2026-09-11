import type { BlipCompactionMetrics, BlipRuntimeEvent } from '@blip/protocol';

export type CompanionCompactionTelemetry = {
  trigger: 'auto' | 'manual' | 'context_overflow' | 'unknown';
  status: 'completed' | 'skipped' | 'failed' | 'cancelled' | 'interrupted';
  durationMs: number;
  tokensBefore?: number;
  tokensAfter?: number;
  fallbackUsed?: boolean;
  metrics?: BlipCompactionMetrics;
};

/** Keeps content-free attempt records; tolerates older runtimes without metrics. */
export class CompanionCompactionTelemetryCollector {
  readonly attempts: CompanionCompactionTelemetry[] = [];
  private active?: { trigger: CompanionCompactionTelemetry['trigger']; startedAt: number };

  observe(event: BlipRuntimeEvent, now: number): void {
    if (event.type === 'compaction_started') {
      this.finish('interrupted', now);
      const trigger = event.reason === 'auto' || event.reason === 'manual' || event.reason === 'context_overflow'
        ? event.reason : 'unknown';
      this.active = { trigger, startedAt: now };
    } else if (event.type === 'compaction_completed' || event.type === 'compaction_skipped' ||
      event.type === 'compaction_failed') {
      const metrics = safeMetrics(event.metrics);
      this.attempts.push({
        trigger: this.active?.trigger ?? 'unknown',
        status: event.type === 'compaction_completed' ? 'completed'
          : event.type === 'compaction_skipped' ? 'skipped'
            : event.reason === 'cancelled' ? 'cancelled' : 'failed',
        durationMs: metrics?.durationMs ?? Math.max(0, now - (this.active?.startedAt ?? now)),
        ...(metrics ? { metrics } : {}),
        ...(event.type === 'compaction_completed' ? {
          tokensBefore: nonnegative(event.tokensBefore),
          tokensAfter: nonnegative(event.tokensAfter),
          fallbackUsed: event.fallbackUsed === true,
        } : {}),
      });
      this.active = undefined;
    } else if (event.type === 'session_finished') {
      this.finish(event.status === 'cancelled' ? 'cancelled'
        : event.status === 'error' ? 'failed' : 'interrupted', now);
    }
  }

  finish(status: 'cancelled' | 'failed' | 'interrupted', now: number): void {
    if (!this.active) return;
    this.attempts.push({
      trigger: this.active.trigger, status,
      durationMs: Math.max(0, now - this.active.startedAt),
    });
    this.active = undefined;
  }
}

function safeMetrics(metrics?: BlipCompactionMetrics): BlipCompactionMetrics | undefined {
  if (!metrics) return undefined;
  return {
    durationMs: nonnegative(metrics.durationMs),
    modelDurationMs: nonnegative(metrics.modelDurationMs),
    modelCallCount: nonnegative(metrics.modelCallCount),
    modelResponseCount: nonnegative(metrics.modelResponseCount),
    incompleteModelResponseCount: nonnegative(metrics.incompleteModelResponseCount),
    usage: {
      input: nonnegative(metrics.usage?.input), output: nonnegative(metrics.usage?.output),
      cacheRead: nonnegative(metrics.usage?.cacheRead), cacheWrite: nonnegative(metrics.usage?.cacheWrite),
      totalTokens: nonnegative(metrics.usage?.totalTokens),
    },
  };
}

function nonnegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
