import { COMPANION_CAPABILITY, type CapabilityEvent } from '@drone/device-protocol';
import { LiveAudioBuffer, type LivePcmAudio, type LivePcmCallbacks } from '@drone/assistant-chat';
import type { MobileMicrophoneCoordinator, MobileMicrophoneLease } from './mobile-microphone-coordinator';

type Options = {
  targetDeviceId: string;
  sessionId: string;
  microphoneCoordinator: MobileMicrophoneCoordinator;
  openAudio(callbacks: LivePcmCallbacks): Promise<LivePcmAudio>;
  request(deviceId: string, capability: string, operation: string, payload?: unknown): Promise<unknown>;
  subscribe(capability: string, event: string, listener: (event: CapabilityEvent) => void): () => void;
  onEvent(event: Record<string, unknown>): void;
  onReady(model: string): void;
  onCapturing?(): void;
  onError(error: string): void;
};

export class MobileCompanionLiveConnection {
  private audio: LivePcmAudio | null = null;
  private lease: MobileMicrophoneLease | null = null;
  private closed = false;
  private ready = false;
  private capturing = false;
  private muted = false;
  private started = false;
  private outgoingEvents = Promise.resolve();
  private unsubscribe?: () => void;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private pendingAudio: Promise<void> = Promise.resolve();
  private readonly audioAbort = new AbortController();
  private readonly buffer: LiveAudioBuffer;

  constructor(private readonly options: Options) {
    this.buffer = new LiveAudioBuffer(async (audio) => {
      if (!this.closed) await this.request('live.event', { event: { type: 'session.input_audio.append', audio } });
    }, (error) => this.fail(error));
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    this.lease = this.options.microphoneCoordinator.acquire('companion');
    if (!this.lease) { this.fail('Another voice feature is using the microphone. Stop it before starting Live.'); return; }
    this.timeout = setTimeout(() => this.fail('Live voice took too long to connect. Try again.'), 40_000);
    let settled!: () => void;
    this.pendingAudio = new Promise((resolve) => { settled = resolve; });
    try {
      try {
        this.audio = await this.options.openAudio({ signal: this.audioAbort.signal, onAudio: (audio) => this.capture(audio), onError: (error) => this.fail(error) });
      } finally { settled(); }
      if (this.closed) return;
      this.audio.mute(this.muted);
      this.unsubscribe = this.options.subscribe(COMPANION_CAPABILITY.id, 'live.event', (event) => {
        if (this.closed || event.sourceDeviceId !== this.options.targetDeviceId || event.payload?.sessionId !== this.options.sessionId) return;
        const payload = event.payload;
        if (payload.type === 'live_ready' && payload.transport === 'pcm' && !this.ready) {
          this.ready = true;
          clearTimeout(this.timeout);
          this.buffer.connect();
          this.options.onReady(String(payload.backendModel ?? ''));
        } else if (payload.type === 'live_event') {
          const liveEvent = payload.event;
          if (liveEvent?.type === 'error') this.fail('Live voice reported an error. Start a new conversation.');
          else if (liveEvent?.type === 'session.output_audio.delta' && typeof liveEvent.delta === 'string') this.audio?.play(liveEvent.delta);
          else if (liveEvent && typeof liveEvent === 'object' && !Array.isArray(liveEvent)) this.options.onEvent(liveEvent);
        } else if (payload.type === 'live_error') this.fail(String(payload.error ?? 'Live voice failed.'));
        else if (payload.type === 'live_closed') this.fail('Live conversation ended. Start again to reconnect.');
      });
      await this.request('live.start', { transport: 'pcm' });
      if (this.closed) { void this.request('live.close').catch(() => undefined); return; }
      this.heartbeat = setInterval(() => {
        void this.request('live.ping').catch(() => this.fail('Live voice lost its connection to the Hub.'));
      }, 10_000);
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Live voice could not start.'); }
  }

  send(event: Record<string, unknown>): void {
    this.outgoingEvents = this.outgoingEvents.then(async () => {
      if (!this.closed) await this.request('live.event', { event });
    }).catch(() => this.fail('Could not send the backend result to Live.'));
  }
  mute(muted: boolean): void { this.muted = muted; this.buffer.mute(muted); this.audio?.mute(muted); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.close();
    this.audioAbort.abort();
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    this.unsubscribe?.();
    this.audio?.mute(true);
    const release = this.audio?.release();
    void this.lease?.release(async () => {
      await this.pendingAudio;
      await (release ?? this.audio?.release());
      this.audio = null;
    }).catch(() => undefined);
    if (this.started) void this.request('live.close').catch(() => undefined);
  }
  private request(operation: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.options.request(this.options.targetDeviceId, COMPANION_CAPABILITY.id, operation,
      { sessionId: this.options.sessionId, ...payload });
  }
  private capture(audio: string): void {
    if (this.closed) return;
    if (!this.capturing) { this.capturing = true; this.options.onCapturing?.(); }
    this.buffer.append(audio);
  }
  private fail(error: string): void { if (!this.closed) { this.close(); this.options.onError(error); } }
}
