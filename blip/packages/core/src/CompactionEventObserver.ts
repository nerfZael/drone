import type { BlipCompactionMetrics, BlipCompactionProgress, BlipRuntimeEvent } from '@blip/protocol';
import { createPortableId } from './platform.js';

/** Adds measurements to existing events without changing compaction decisions. */
export class CompactionEventObserver {
  private started?: Extract<BlipRuntimeEvent, { type: 'compaction_started' }>;
  private startedAt = 0;
  private modelStartedAt = 0;
  private metrics = emptyMetrics();
  private phase: BlipCompactionProgress['phase'] = 'preparing';
  private modelActive = false;
  private lastModelCallDurationMs = 0;
  private modelEventCount = 0;
  private lastModelEventAt?: number;
  private lastProgressAt = -Infinity;


  constructor(
    private readonly sink: (event: BlipRuntimeEvent) => Promise<void>,
    private readonly now: () => number = () => performance.now(),
  ) {}

  readonly modelCall = async (phase: 'started' | 'finished'): Promise<void> => {
    if (!this.started) return;
    if (phase === 'started') {
      this.phase = 'summarizing';
      this.metrics.modelCallCount += 1;
      this.modelStartedAt = this.now();
      this.lastModelCallDurationMs = 0;
      this.modelActive = true;
      this.modelEventCount = 0;
      this.lastModelEventAt = undefined;
    } else if (this.modelActive) {
      this.lastModelCallDurationMs = Math.max(0, this.now() - this.modelStartedAt);
      this.metrics.modelDurationMs += this.lastModelCallDurationMs;
      this.modelActive = false;
    }
    await this.progress();
  };

  readonly modelActivity = async (): Promise<void> => {
    if (!this.started || !this.modelActive) return;
    this.modelEventCount += 1;
    this.lastModelEventAt = this.now();
    if (this.modelEventCount === 1 || this.now() - this.lastProgressAt >= 5000) await this.progress();
  };

  async stage(phase: BlipCompactionProgress['phase']): Promise<void> {
    this.phase = phase;
    await this.progress();
  }

  private async progress(): Promise<void> {
    if (!this.started) return;
    const now = this.now();
    this.lastProgressAt = now;
    const modelCallDurationMs = this.modelActive ? Math.max(0, now - this.modelStartedAt) : this.lastModelCallDurationMs;
    try {
      await this.sink({
        ...this.started, type: 'compaction_progress', eventId: createPortableId(), timestamp: new Date().toISOString(),
        progress: {
          phase: this.phase, durationMs: Math.max(0, now - this.startedAt),
          modelCallCount: this.metrics.modelCallCount, modelResponseCount: this.metrics.modelResponseCount,
          modelCallActive: this.modelActive, modelCallDurationMs,
          modelDurationMs: this.metrics.modelDurationMs + (this.modelActive ? modelCallDurationMs : 0),
          modelEventCount: this.modelEventCount,
          ...(this.lastModelEventAt === undefined ? {} : { modelIdleMs: Math.max(0, now - this.lastModelEventAt) }),
        },
      });
    } catch { /* Progress reporting must not fail a compaction. */ }
  }

  readonly emit = async (event: BlipRuntimeEvent): Promise<void> => {
    if (event.type === 'compaction_started') {
      this.started = event;
      this.startedAt = this.now();
      this.metrics = emptyMetrics();
      this.phase = 'preparing';
      this.modelActive = false;
      this.lastModelCallDurationMs = 0;
      this.modelEventCount = 0;
      this.lastModelEventAt = undefined;
      this.lastProgressAt = -Infinity;
    } else if (this.started && event.type === 'usage_observed' && event.purpose === 'compaction') {
      this.metrics.modelResponseCount += 1;
      if (!event.complete) this.metrics.incompleteModelResponseCount += 1;
      for (const key of Object.keys(this.metrics.usage) as Array<keyof BlipCompactionMetrics['usage']>) {
        const value = event.usage[key];
        if (Number.isFinite(value) && value >= 0) this.metrics.usage[key] += value;
      }
    } else if (this.started && (
      event.type === 'compaction_completed' || event.type === 'compaction_skipped' ||
      event.type === 'compaction_failed'
    )) {
      event = { ...event, metrics: {
        ...this.metrics,
        durationMs: Math.max(0, this.now() - this.startedAt),
      } };
      this.started = undefined;
    }
    await this.sink(event);
    if (this.started && event.type === 'usage_observed' && event.purpose === 'compaction') await this.progress();
  };

  async fail(cancelled: boolean): Promise<void> {
    if (!this.started) return;
    await this.emit({
      ...this.started,
      eventId: createPortableId(),
      timestamp: new Date().toISOString(),
      type: 'compaction_failed',
      reason: cancelled ? 'cancelled' : 'error',
    });
  }
}

function emptyMetrics(): BlipCompactionMetrics {
  return {
    durationMs: 0, modelDurationMs: 0, modelCallCount: 0, modelResponseCount: 0,
    incompleteModelResponseCount: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  };
}
