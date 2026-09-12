import { COMPANION_CAPABILITY, LIVE_AUDIO_TRANSPORT, type LiveAudioClientStream, type CapabilityEvent } from '@drone/device-protocol';
import { LiveAudioBuffer, type LivePcmAudio, type LivePcmCallbacks } from '@drone/assistant-chat';
import type { MobileMicrophoneCoordinator, MobileMicrophoneLease } from './mobile-microphone-coordinator';

type Options = {
  targetDeviceId: string;
  sessionId: string;
  microphoneCoordinator: MobileMicrophoneCoordinator;
  openLiveAudio(targetDeviceId: string, sessionId: string, onAudio: (audio: string) => void, onError: (error: string) => void): Promise<LiveAudioClientStream>;
  openAudio(callbacks: LivePcmCallbacks): Promise<LivePcmAudio>;
  request(deviceId: string, capability: string, operation: string, payload?: unknown): Promise<unknown>;
  subscribe(capability: string, event: string, listener: (event: CapabilityEvent) => void): () => void;
  onEvent(event: Record<string, unknown>): void;
  onReady(model: string): void;
  onCapturing?(): void;
  onError(error: string): void;
  schedule?(callback: () => void, delayMs: number): () => void;
};

export class MobileCompanionLiveConnection {
  private audio: LivePcmAudio | null = null;
  private stream: LiveAudioClientStream | null = null;
  private backendReady = false;
  private startAccepted = false;
  private backendModel = '';
  private lease: MobileMicrophoneLease | null = null;
  private closed = false;
  private ready = false;
  private capturing = false;
  private muted = false;
  private started = false;
  private outgoingEvents = Promise.resolve();
  private unsubscribe?: () => void;
  private heartbeat?: () => void;
  private timeout?: () => void;
  private pendingAudio: Promise<void> = Promise.resolve();
  private cleanup: Promise<void> = Promise.resolve();
  private readonly audioAbort = new AbortController();
  private readonly buffer: LiveAudioBuffer;

  constructor(private readonly options: Options) {
    this.buffer = new LiveAudioBuffer(async (audio) => {
      if (!this.closed) {
        if (!this.stream) throw new Error('Live audio stream unavailable');
        await this.stream.send(audio);
      }
    }, (error) => this.fail(error));
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    this.lease = this.options.microphoneCoordinator.acquire('companion');
    if (!this.lease) { this.fail('Another voice feature is using the microphone. Stop it before starting Live.'); return; }
    this.timeout = this.schedule(() => this.fail('Live voice took too long to connect. Try again.'), 40_000);
    let settled!: () => void;
    this.pendingAudio = new Promise((resolve) => { settled = resolve; });
    try {
      try {
        this.audio = await this.options.openAudio({ signal: this.audioAbort.signal, onAudio: (audio) => this.capture(audio), onError: (error) => this.fail(error) });
      } finally { settled(); }
      if (this.closed) return;
      this.audio.mute(this.muted);
      // The recorder is running and buffering from here on, so the user can start
      // talking now: announce capture before the first chunk fills, not after it.
      this.markCapturing();
      this.unsubscribe = this.options.subscribe(COMPANION_CAPABILITY.id, 'live.event', (event) => {
        if (this.closed || event.sourceDeviceId !== this.options.targetDeviceId || event.payload?.sessionId !== this.options.sessionId) return;
        const payload = event.payload;
        if (payload.type === 'live_ready' && payload.transport === 'pcm' && !this.ready) {
          this.backendReady = true;
          this.backendModel = String(payload.backendModel ?? '');
          this.becomeReady();
        } else if (payload.type === 'live_event') {
          const liveEvent = payload.event;
          if (liveEvent?.type === 'error') this.fail('Live voice reported an error. Start a new conversation.');
          else if (liveEvent?.type === 'session.output_audio.delta') return; // Audio belongs to the binary stream.
          else if (liveEvent && typeof liveEvent === 'object' && !Array.isArray(liveEvent)) this.options.onEvent(liveEvent);
        } else if (payload.type === 'live_error') this.fail(String(payload.error ?? 'Live voice failed.'));
        else if (payload.type === 'live_closed') this.fail('Live conversation ended. Start again to reconnect.');
      });
      this.stream = await this.options.openLiveAudio(this.options.targetDeviceId, this.options.sessionId,
        (audio) => { if (!this.closed) this.audio?.play(audio); }, (error) => this.fail(error));
      if (this.closed) { this.stream.close(); return; }
      const started = await this.request('live.start', { transport: 'pcm', audioTransport: LIVE_AUDIO_TRANSPORT, audioOffer: this.stream.offer }) as { audioTransport?: string; audioAnswer?: unknown };
      if (started?.audioTransport !== LIVE_AUDIO_TRANSPORT) throw new Error('Update the Hub to use Live audio streaming.');
      this.stream.accept(started.audioAnswer);
      this.startAccepted = true;
      this.becomeReady();
      if (this.closed) { void this.request('live.close').catch(() => undefined); return; }
      this.scheduleHeartbeat();
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Live voice could not start.'); }
  }

  send(event: Record<string, unknown>): void {
    this.outgoingEvents = this.outgoingEvents.then(async () => {
      if (!this.closed) await this.request('live.event', { event });
    }).catch(() => this.fail('Could not send the backend result to Live.'));
  }
  mute(muted: boolean): void { this.muted = muted; this.buffer.mute(muted); this.audio?.mute(muted); }
  close(): Promise<void> {
    if (this.closed) return this.cleanup;
    this.closed = true;
    this.buffer.close();
    this.stream?.close();
    this.audioAbort.abort();
    this.timeout?.();
    this.heartbeat?.();
    this.unsubscribe?.();
    this.audio?.mute(true);
    const release = this.audio?.release();
    this.cleanup = (this.lease?.release(async () => {
      await this.pendingAudio;
      await (release ?? this.audio?.release());
      this.audio = null;
    }) ?? Promise.resolve()).catch(() => undefined);
    if (this.started) void this.request('live.close').catch(() => undefined);
    return this.cleanup;
  }
  private schedule(callback: () => void, delayMs: number): () => void {
    if (this.options.schedule) return this.options.schedule(callback, delayMs);
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  }
  private scheduleHeartbeat(): void {
    this.heartbeat = this.schedule(() => {
      if (this.closed) return;
      void this.request('live.ping').catch(() => this.fail('Live voice lost its connection to the Hub.'));
      this.scheduleHeartbeat();
    }, 10_000);
  }
  private becomeReady(): void {
    if (this.closed || this.ready || !this.backendReady || !this.startAccepted || !this.stream) return;
    this.ready = true; this.timeout?.(); this.buffer.connect(); this.options.onReady(this.backendModel);
  }
  private request(operation: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.options.request(this.options.targetDeviceId, COMPANION_CAPABILITY.id, operation,
      { sessionId: this.options.sessionId, ...payload });
  }
  private markCapturing(): void {
    if (this.closed || this.capturing) return;
    this.capturing = true;
    this.options.onCapturing?.();
  }
  private capture(audio: string): void {
    if (this.closed) return;
    this.markCapturing();
    this.buffer.append(audio);
  }
  private fail(error: string): void { if (!this.closed) { this.close(); this.options.onError(error); } }
}
