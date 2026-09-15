import type { CompanionClientTelemetry } from './companion.js';

export type LivePlaybackTiming = { stage: 'scheduled' | 'completed' | 'native_enqueued'; queueMs?: number; durationMs?: number };
type Fields = { delegationId?: string | null; dispatchMs?: number; eventType?: string; queueMs?: number; durationMs?: number };

/** Bounded, content-free diagnostics. Audio observations imply chronology, not which words Live spoke. */
export class CompanionLiveTiming {
  readonly sessionId = `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly started: number;
  private count = 0;
  private resultSequence = 0;
  private observed = new Set<string>();
  private stopped = false;
  constructor(private readonly now = () => performance.now(),
    private readonly emit = (record: Record<string, unknown>) => console.info('[CompanionLiveTiming]', JSON.stringify(record))) {
    this.started = now();
    this.mark('session_started');
  }
  mark(stage: string, fields: Fields = {}): void {
    if (this.stopped || this.count >= 2_000) return;
    this.count++;
    try { this.emit({ sessionId: this.sessionId, stage, elapsedMs: Math.round(this.now() - this.started), resultSequence: this.resultSequence, ...fields }); }
    catch { /* Diagnostics must not interrupt voice. */ }
  }
  once(stage: string, fields: Fields = {}): void {
    if (this.observed.has(stage)) return;
    this.observed.add(stage);
    this.mark(stage, fields);
  }
  dispatch(delegationId: string, dispatchMs: number): CompanionClientTelemetry {
    this.mark('backend_dispatched', { delegationId, dispatchMs });
    return { version: 1, liveSessionId: this.sessionId, liveDelegationId: delegationId, liveDispatchMs: dispatchMs };
  }
  result(delegationId: string | null): void {
    this.resultSequence++;
    this.observed.clear();
    this.mark('backend_result', { delegationId });
  }
  audioReceived(): void { this.once('first_audio_received'); }
  playback(event: LivePlaybackTiming): void {
    this.once(`first_playback_${event.stage}`, { queueMs: event.queueMs, durationMs: event.durationMs });
  }
  close(): void { this.mark('session_closed'); this.stopped = true; }
}
