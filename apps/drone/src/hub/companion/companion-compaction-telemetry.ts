import type { BlipCompactionMetrics, BlipCompactionProgress, BlipRuntimeEvent } from '@blip/protocol';

export type CompanionCompactionTelemetry = {
  background?: boolean;
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
  private active?: { trigger: CompanionCompactionTelemetry['trigger']; background?: boolean; startedAt: number; updatedAt: number; progress?: BlipCompactionProgress };

  live(now: number) {
    if (!this.active) return undefined;
    const { trigger, startedAt, updatedAt, progress } = this.active;
    const age = Math.max(0, now - updatedAt);
    return {
      trigger, background: this.active.background, status: 'running' as const, durationMs: Math.max(0, now - startedAt),
      phase: progress?.phase ?? 'preparing', lastProgressAgeMs: age,
      modelCallCount: progress?.modelCallCount ?? 0, modelResponseCount: progress?.modelResponseCount ?? 0,
      modelCallActive: progress?.modelCallActive ?? false,
      modelCallDurationMs: (progress?.modelCallDurationMs ?? 0) + (progress?.modelCallActive ? age : 0),
      modelDurationMs: (progress?.modelDurationMs ?? 0) + (progress?.modelCallActive ? age : 0),
      modelEventCount: progress?.modelEventCount ?? 0,
      ...(progress?.modelIdleMs === undefined ? {} : { modelIdleMs: progress.modelIdleMs + age }),
    };
  }

  observe(event: BlipRuntimeEvent, now: number): void {
    if (event.type === 'compaction_started') {
      this.finish('interrupted', now);
      const trigger = event.reason === 'auto' || event.reason === 'manual' || event.reason === 'context_overflow'
        ? event.reason : 'unknown';
      this.active = { trigger, background: event.background, startedAt: now, updatedAt: now };
    } else if (event.type === 'compaction_progress' && this.active) {
      const p = event.progress;
      if (!['preparing', 'credentials', 'summarizing', 'validating', 'saving'].includes(p.phase)) return;
      this.active.updatedAt = now;
      this.active.progress = {
        phase: p.phase, durationMs: nonnegative(p.durationMs),
        modelCallCount: nonnegative(p.modelCallCount), modelResponseCount: nonnegative(p.modelResponseCount),
        modelCallActive: p.modelCallActive === true, modelCallDurationMs: nonnegative(p.modelCallDurationMs),
        modelDurationMs: nonnegative(p.modelDurationMs), modelEventCount: nonnegative(p.modelEventCount),
        ...(p.modelIdleMs === undefined ? {} : { modelIdleMs: nonnegative(p.modelIdleMs) }),
      };
    } else if (event.type === 'compaction_completed' || event.type === 'compaction_skipped' ||
      event.type === 'compaction_failed') {
      const metrics = safeMetrics(event.metrics);
      this.attempts.push({
        trigger: this.active?.trigger ?? 'unknown',
        ...(event.background ? { background: true } : {}),
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
    } else if (event.type === 'session_finished' && !this.active?.background) {
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
