import type { CompanionClientTelemetry } from './companion.js';

export type LivePlaybackTiming = { stage: 'scheduled' | 'started' | 'completed' | 'native_enqueued'; queueMs?: number; durationMs?: number; sampleId?: number };
export type LiveTimingFields = { delegationId?: string | null; dispatchMs?: number; eventType?: string; eventId?: string; queueMs?: number; durationMs?: number; startMs?: number; endMs?: number };
export type LiveTimingEvent = LiveTimingFields & { sessionId: string; sequence: number; stage: string; elapsedMs: number; resultSequence: number };
export const LIVE_TIMING_STAGES = [
  'session_started', 'capture_started', 'first_input_audio_sent', 'live_ready', 'session_closed', 'delegation_received',
  'backend_dispatched', 'backend_update', 'backend_result', 'backend_error', 'append_submitted', 'append_socket_sent',
  'append_relay_accepted', 'append_acknowledged', 'input_transcript', 'output_transcript',
  'first_audio_received', 'first_playback_scheduled', 'first_playback_started', 'first_playback_completed',
  'first_playback_native_enqueued', 'hub_start_received', 'hub_setup_completed', 'provider_connect_started',
  'provider_socket_open', 'provider_session_started', 'hub_append_received', 'hub_append_forwarded',
  'provider_append_acknowledged', 'provider_delegation_received', 'hub_first_input_audio',
  'hub_first_input_forwarded', 'hub_first_output_audio', 'hub_close_requested', 'provider_session_closed', 'provider_disconnected', 'hub_error',
] as const;

/** Bounded diagnostics. Separate clock domains; audio chronology never establishes which words were spoken. */
export class CompanionLiveTiming {
  readonly sessionId = `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly started: number;
  private count = 0;
  private resultSequence = 0;
  private observed = new Set<string>();
  private stopped = false;
  private pending: LiveTimingEvent[] = [];
  private sink?: (events: LiveTimingEvent[]) => Promise<unknown> | void;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  constructor(private readonly now = () => performance.now(),
    private readonly emit = (record: Record<string, unknown>) => console.info('[CompanionLiveTiming]', JSON.stringify(record))) {
    this.started = now();
    this.mark('session_started');
  }
  /** Attach only after the transport owns the session. Startup events are buffered. */
  setSink(sink: (events: LiveTimingEvent[]) => Promise<unknown> | void): void {
    this.sink = sink;
    this.flush();
  }
  mark(stage: string, fields: LiveTimingFields = {}, resultSequence = this.resultSequence): void {
    if (this.stopped || this.count >= 2_000) return;
    const event = { sessionId: this.sessionId, sequence: ++this.count, stage,
      elapsedMs: Math.round(this.now() - this.started), resultSequence, ...fields };
    try { this.emit(event); } catch { /* Diagnostics must not interrupt voice. */ }
    this.pending.push(event);
    if (this.sink && !this.timer) this.timer = setTimeout(() => this.flush(), 1_000);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.inFlight) return this.inFlight;
    if (!this.sink || !this.pending.length) return Promise.resolve();
    const sink = this.sink;
    // Defer to catch synchronous transport failures as well as rejected requests.
    this.inFlight = Promise.resolve().then(async () => {
      while (this.pending.length) {
        const batch = this.pending.splice(0, 100);
        try { await sink(batch); } catch { /* Best effort; sequence gaps expose dropped batches. */ }
      }
    }).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  /** Bound shutdown waiting: diagnostics must never keep a billable voice session alive. */
  async drain(schedule: (callback: () => void, delayMs: number) => () => void = (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs); return () => clearTimeout(timer);
  }): Promise<void> {
    let cancel: (() => void) | undefined;
    try { await Promise.race([this.flush(), new Promise<void>(resolve => { cancel = schedule(resolve, 300); })]); }
    finally { cancel?.(); }
  }
  once(stage: string, fields: LiveTimingFields = {}): void {
    if (this.observed.has(stage)) return;
    this.observed.add(stage);
    this.mark(stage, fields);
  }
  dispatch(delegationId: string, dispatchMs: number): CompanionClientTelemetry {
    this.mark('backend_dispatched', { delegationId, dispatchMs });
    return { version: 1, liveSessionId: this.sessionId, liveDelegationId: delegationId, liveDispatchMs: dispatchMs };
  }
  result(delegationId: string | null, status: 'completed' | 'error' = 'completed'): void {
    this.resultSequence++;
    this.observed.clear();
    this.mark(status === 'error' ? 'backend_error' : 'backend_result', { delegationId });
  }
  /** Only the first chunk per result is sampled; return its generation for delayed native callbacks. */
  audioReceived(): number | undefined {
    if (this.stopped || this.count >= 2_000 || this.observed.has('first_audio_received')) return undefined;
    this.once('first_audio_received');
    return this.resultSequence;
  }
  playback(event: LivePlaybackTiming): void {
    if (event.sampleId !== undefined) {
      this.mark(`first_playback_${event.stage}`, { queueMs: event.queueMs, durationMs: event.durationMs }, event.sampleId);
    } else this.once(`first_playback_${event.stage}`, { queueMs: event.queueMs, durationMs: event.durationMs });
  }
  providerEvent(event: Record<string, unknown>): void {
    const type = String(event.type);
    if (['session.thinking.appended', 'session.commentary.appended', 'session.instructions.appended'].includes(type)) {
      this.mark('append_acknowledged', { eventType: type, eventId: typeof event.client_event_id === 'string' ? event.client_event_id : undefined });
    } else if (type === 'session.input_transcript.delta' || type === 'session.output_transcript.delta') {
      this.mark(type === 'session.input_transcript.delta' ? 'input_transcript' : 'output_transcript', {
        startMs: typeof event.start_ms === 'number' ? event.start_ms : undefined,
        endMs: typeof event.end_ms === 'number' ? event.end_ms : undefined,
      });
    }
  }
  close(): void { if (this.stopped) return; this.mark('session_closed'); this.stopped = true; this.flush(); }
}
