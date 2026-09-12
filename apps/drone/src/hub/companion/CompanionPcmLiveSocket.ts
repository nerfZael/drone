import { WebSocket } from 'ws';

type Dependencies = {
  connect(url: string, apiKey: string): WebSocket;
  credentials(): Promise<{ apiKey: string | null }>;
  enabled(): Promise<{ enabled: boolean }>;
  backend(): Promise<{ model: string; provider: string }>;
};

/** Primary Live audio connection. The project key never leaves the Hub. */
export class CompanionPcmLiveSocket {
  private upstream?: WebSocket;
  private closed = false;
  private starting = false;
  private ready = false;
  private lastPing = Date.now();
  private timeout?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private closeTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly send: (event: unknown) => void,
    private readonly deps: Dependencies, private readonly instructions: string) {}

  handle(message: { type?: string; event?: unknown }): void {
    if (message.type === 'live_close') { this.close(); return; }
    if (this.closed) return;
    if (message.type === 'live_ping') { this.lastPing = Date.now(); return; }
    if (message.type === 'live_start' && !this.starting) {
      this.starting = true;
      this.timeout = setTimeout(() => this.fail('Live voice took too long to connect.'), 40_000);
      this.timeout.unref?.();
      void this.start().catch((error) => this.fail(error instanceof Error ? error.message : 'Live voice could not start.'));
    }
    if (message.type !== 'live_event' || !this.ready || this.upstream?.readyState !== WebSocket.OPEN) return;
    const event = message.event as Record<string, unknown> | undefined;
    if (!event || typeof event !== 'object') return;
    let outgoing: Record<string, unknown>;
    if (event.type === 'session.input_audio.append') {
      // Up to 500 ms per chunk, canonical base64, complete PCM16 samples only.
      const audio = event.audio;
      if (typeof audio !== 'string' || !audio.length || audio.length > 32_000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio)) return;
      const bytes = Buffer.from(audio, 'base64');
      if (bytes.length % 2 || bytes.toString('base64') !== audio) return;
      outgoing = { type: event.type, audio };
    } else {
      if (!['session.commentary.append', 'session.thinking.append', 'session.instructions.append'].includes(String(event.type))) return;
      if (typeof event.content !== 'string' || !event.content.trim() || Buffer.byteLength(event.content, 'utf8') > 400) return;
      if (event.delegation_id !== null && typeof event.delegation_id !== 'string') return;
      outgoing = { type: event.type, content: event.content, delegation_id: event.delegation_id,
        event_id: typeof event.event_id === 'string' ? event.event_id.slice(0, 200) : undefined };
    }
    if (this.upstream.bufferedAmount > 2_000_000) { this.fail('Live audio connection is too slow. Start again.'); return; }
    try { this.upstream.send(JSON.stringify(outgoing)); }
    catch { this.fail('Live audio connection failed.'); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    const upstream = this.upstream;
    if (!upstream) return;
    if (!this.ready || upstream.readyState !== WebSocket.OPEN) { upstream.terminate(); return; }
    this.closeTimer = setTimeout(() => upstream.terminate(), 5_000);
    this.closeTimer.unref?.();
    try { upstream.send(JSON.stringify({ type: 'session.close' })); }
    catch { upstream.terminate(); }
  }

  private fail(error: string): void {
    if (this.closed) return;
    this.send({ type: 'live_error', error });
    this.close();
  }

  private async start(): Promise<void> {
    const [setting, credential, backend] = await Promise.all([this.deps.enabled(), this.deps.credentials(), this.deps.backend()]);
    if (this.closed) return;
    if (!setting.enabled) throw new Error('Enable Live voice before starting a conversation.');
    if (!credential.apiKey) throw new Error('Configure an OpenAI API key in Settings to use Live voice.');
    const upstream = this.deps.connect('wss://api.openai.com/v1/live/sessions', credential.apiKey);
    this.upstream = upstream;
    upstream.on('open', () => {
      if (this.closed) { upstream.terminate(); return; }
      try {
        upstream.send(JSON.stringify({ type: 'session.start', session: {
          model: 'gpt-live-1', delegation: { type: 'client' }, store: false,
          instructions: this.instructions, audio: { format: { type: 'audio/pcm', rate: 24_000 } },
        } }));
      } catch { this.fail('Live audio connection failed.'); }
    });
    upstream.on('message', (raw) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return;
      if (event.type === 'session.closed') {
        clearTimeout(this.closeTimer);
        clearTimeout(this.timeout);
        clearInterval(this.heartbeat);
        this.closed = true;
        this.send({ type: 'live_closed' });
        upstream.close();
        return;
      }
      if (this.closed) return;
      if (event.type === 'session.started' && !this.ready) {
        this.ready = true;
        clearTimeout(this.timeout);
        this.lastPing = Date.now();
        this.heartbeat = setInterval(() => { if (Date.now() - this.lastPing > 45_000) this.close(); }, 15_000);
        this.heartbeat.unref?.();
        this.send({ type: 'live_ready', transport: 'pcm', backendModel: backend.model });
      } else if (['session.input_transcript.delta', 'session.output_transcript.delta',
        'session.delegation.created', 'session.output_audio.delta', 'error'].includes(String(event.type))) {
        this.send({ type: 'live_event', event });
      }
    });
    upstream.on('error', () => this.fail('Live voice connection failed. Start a new conversation.'));
    upstream.on('close', () => {
      clearTimeout(this.closeTimer);
      this.fail('Live voice disconnected. Start a new conversation.');
    });
  }
}
