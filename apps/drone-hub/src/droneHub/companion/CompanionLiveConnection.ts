import { LiveAudioBuffer, type LivePcmAudio, type LivePcmCallbacks } from '@drone/assistant-chat';
import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import { browserMicrophoneCoordinator, type BrowserMicrophoneLease } from '../chat/browser-microphone-coordinator';
import { openBrowserLivePcmAudio } from './browser-live-pcm-audio';

type Options = {
  onEvent(event: Record<string, unknown>): void;
  onReady(model: string): void;
  onCapturing?(): void;
  onError(error: string): void;
  onPlaybackBlocked(blocked: boolean): void;
  openAudio?(callbacks: LivePcmCallbacks): Promise<LivePcmAudio>;
};

export class CompanionLiveConnection {
  private socket: WebSocket | null = null;
  private audio: LivePcmAudio | null = null;
  private lease: BrowserMicrophoneLease | null = null;
  private closed = false;
  private started = false;
  private ready = false;
  private capturing = false;
  private muted = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private pendingAudio: Promise<void> = Promise.resolve();
  private readonly audioAbort = new AbortController();
  private readonly buffer: LiveAudioBuffer;

  constructor(private readonly options: Options) {
    this.buffer = new LiveAudioBuffer(async (audio) => {
      if (this.closed) return;
      const socket = this.socket;
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 2_000_000) throw new Error('Live connection is too slow.');
      socket.send(JSON.stringify({ type: 'live_event', event: { type: 'session.input_audio.append', audio } }));
    }, (error) => this.fail(error));
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    this.lease = browserMicrophoneCoordinator.acquire('companion');
    if (!this.lease) { this.fail('Another recording is using the microphone. Stop it before starting Live voice.'); return; }
    this.timeout = setTimeout(() => this.fail('Live voice took too long to connect. Try again.'), 40_000);
    let settled!: () => void;
    this.pendingAudio = new Promise((resolve) => { settled = resolve; });
    try {
      try {
        this.audio = await (this.options.openAudio ?? ((callbacks) => openBrowserLivePcmAudio(callbacks, this.options.onPlaybackBlocked)))({
          signal: this.audioAbort.signal, onAudio: (audio) => this.capture(audio), onError: (error) => this.fail(error),
        });
      } finally { settled(); }
      if (this.closed) return;
      this.audio.mute(this.muted);
      const socket = new WebSocket(buildDirectApiWebSocketUrl('/api/companion/stream'));
      this.socket = socket;
      socket.onopen = () => {
        if (this.closed) { socket.close(); return; }
        if (!this.sendMessage({ type: 'live_start', transport: 'pcm' })) return;
        this.heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) this.sendMessage({ type: 'live_ping' });
        }, 10_000);
      };
      socket.onmessage = ({ data }) => {
        let event: Record<string, unknown>;
        try { event = JSON.parse(String(data)); } catch { return; }
        if (!event || typeof event !== 'object') return;
        if (event.type === 'live_closed') { if (this.closed) socket.close(); else this.fail('Live conversation ended. Start again.'); return; }
        if (this.closed) return;
        if (event.type === 'live_ready' && event.transport === 'pcm' && !this.ready) {
          this.ready = true;
          clearTimeout(this.timeout);
          this.buffer.connect();
          this.options.onReady(String(event.backendModel ?? ''));
        } else if (event.type === 'live_event') {
          const payload = event.event as Record<string, unknown> | undefined;
          if (payload?.type === 'error') this.fail('Live voice reported an error. Start again.');
          else if (payload?.type === 'session.output_audio.delta' && typeof payload.delta === 'string') this.audio?.play(payload.delta);
          else if (payload && typeof payload === 'object') this.options.onEvent(payload);
        } else if (event.type === 'live_error') this.fail(String(event.error ?? 'Live voice failed.'));
      };
      socket.onerror = () => this.fail('Live voice could not connect to Drone Hub.');
      socket.onclose = () => { clearTimeout(this.closeTimer); if (!this.closed) this.fail('Live voice disconnected from Drone Hub.'); };
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Live voice could not start.'); }
  }

  send(event: Record<string, unknown>): void {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN) this.sendMessage({ type: 'live_event', event });
  }
  mute(muted: boolean): void { this.muted = muted; this.buffer.mute(muted); this.audio?.mute(muted); }
  async play(): Promise<void> {
    if (this.closed) return;
    try { await this.audio?.resume(); } catch { this.options.onPlaybackBlocked(true); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.close();
    this.audioAbort.abort();
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    this.audio?.mute(true);
    const release = this.audio?.release();
    void this.pendingAudio.then(async () => {
      await (release ?? this.audio?.release());
    }).catch(() => undefined).finally(() => { this.audio = null; this.lease?.release(); this.lease = null; });
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({ type: 'live_close' }));
        this.closeTimer = setTimeout(() => this.socket?.close(), 6_000);
      } catch { this.socket.close(); }
    } else this.socket?.close();
  }
  private sendMessage(message: Record<string, unknown>): boolean {
    try { this.socket?.send(JSON.stringify(message)); return true; }
    catch { this.fail('Live voice lost its connection to Drone Hub.'); return false; }
  }
  private capture(audio: string): void {
    if (this.closed) return;
    if (!this.capturing) { this.capturing = true; this.options.onCapturing?.(); }
    this.buffer.append(audio);
  }
  private fail(error: string): void { if (!this.closed) { this.close(); this.options.onError(error); } }
}
