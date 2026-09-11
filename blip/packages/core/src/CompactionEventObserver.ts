import type { BlipCompactionMetrics, BlipRuntimeEvent } from '@blip/protocol';
import { createPortableId } from './platform.js';

/** Adds measurements to existing events without changing compaction decisions. */
export class CompactionEventObserver {
  private started?: Extract<BlipRuntimeEvent, { type: 'compaction_started' }>;
  private startedAt = 0;
  private modelStartedAt = 0;
  private metrics = emptyMetrics();

  constructor(
    private readonly sink: (event: BlipRuntimeEvent) => Promise<void>,
    private readonly now: () => number = () => performance.now(),
  ) {}

  readonly modelCall = (phase: 'started' | 'finished'): void => {
    if (!this.started) return;
    if (phase === 'started') {
      this.metrics.modelCallCount += 1;
      this.modelStartedAt = this.now();
    } else {
      this.metrics.modelDurationMs += Math.max(0, this.now() - this.modelStartedAt);
    }
  };

  readonly emit = async (event: BlipRuntimeEvent): Promise<void> => {
    if (event.type === 'compaction_started') {
      this.started = event;
      this.startedAt = this.now();
      this.metrics = emptyMetrics();
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
