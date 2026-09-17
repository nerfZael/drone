import { WebSocket } from 'ws';
import { resolveEffectiveProviderApiKeySettings, resolveAiGatewayApiKeySettings } from '../hub-settings';
import { readCompanionLiveSettings } from './companion-live-settings';

type Dependencies = {
  connect(url: string, apiKey: string): WebSocket;
  credentials(): Promise<{ apiKey: string | null }>;
  gatewayCredentials(): Promise<{ apiKey: string | null }>;
  settings(): Promise<{ enabled: boolean; mode?: string }>;
};

function transcriptionError(error: unknown): string {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  // Never echo arbitrary provider messages: they can contain request data or credentials.
  let reason = 'OpenAI reported a transcription error.';
  if (value.code === 'invalid_value' || value.code === 'unknown_parameter' || value.code === 'unsupported_parameter') {
    const field = value.param === 'session.audio.input.turn_detection' ? 'turn detection'
      : value.param === 'session.audio.input.transcription.model' ? 'transcription model'
      : value.param === 'session.audio.input.transcription.delay' ? 'transcription delay' : 'session configuration';
    reason = `OpenAI rejected the ${field} setting.`;
  } else if (value.code === 'model_not_found') reason = 'The OpenAI transcription model is unavailable to this project.';
  else if (value.code === 'insufficient_quota') reason = 'The OpenAI project has insufficient quota.';
  else if (value.code === 'rate_limit_exceeded') reason = 'The OpenAI transcription rate limit was reached.';
  else if (value.code === 'invalid_api_key') reason = 'OpenAI rejected the transcription API key.';
  else if (value.code === 'server_error') reason = 'OpenAI encountered a transcription service error.';
  return `${reason} Reconnect to retry; your received transcript is retained.`;
}

/** Streaming transcription only. Jev receives text; no GPT-Live delegation runs. */
export class CompanionTranscriptionSocket {
  private upstream?: WebSocket;
  private closed = false;
  private starting = false;
  private ready = false;
  private bufferedAudioBytes = 0;
  private lastPing = Date.now();
  private timeout?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly deps: Dependencies;
  constructor(private readonly send: (event: unknown) => void, deps: Partial<Dependencies> = {}) {
    this.deps = {
      connect: (url, apiKey) => new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 15_000 }),
      credentials: () => resolveEffectiveProviderApiKeySettings('openai'),
      gatewayCredentials: resolveAiGatewayApiKeySettings,
      settings: readCompanionLiveSettings,
      ...deps,
    };
  }
  handle(message: { type?: string; event?: unknown }): void {
    if (message.type === 'live_close') { this.close(); return; }
    if (this.closed) return;
    if (message.type === 'live_ping') { this.lastPing = Date.now(); return; }
    if (message.type === 'live_start' && !this.starting) {
      this.starting = true;
      this.timeout = setTimeout(() => this.fail('Live transcription took too long to connect.'), 30_000);
      this.timeout.unref?.();
      void this.start().catch(() => this.fail('Live transcription could not start. Check the OpenAI key and model access.'));
      return;
    }
    if (message.type !== 'live_event' || !this.ready || this.upstream?.readyState !== WebSocket.OPEN) return;
    const event = message.event as { type?: string; audio?: unknown } | undefined;
    if (event?.type !== 'session.input_audio.append' || typeof event.audio !== 'string' || !event.audio.length || event.audio.length > 32_000) return;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.audio)) return;
    const bytes = Buffer.from(event.audio, 'base64');
    if (bytes.length % 2 || bytes.toString('base64') !== event.audio) return;
    if (this.upstream.bufferedAmount > 2_000_000) { this.fail('Live transcription connection is too slow.'); return; }
    try {
      this.upstream.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: event.audio }));
      this.bufferedAudioBytes += bytes.length;
      // Bound provider audio turns to ten seconds. Deltas (and Jev decisions) stream
      // before commits; this is not a silence threshold or a delegation delay.
      if (this.bufferedAudioBytes >= 24_000 * 2 * 10) {
        this.upstream.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        this.bufferedAudioBytes = 0;
      }
    }
    catch { this.fail('Live transcription connection failed.'); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timeout); clearInterval(this.heartbeat);
    if (this.upstream?.readyState === WebSocket.OPEN) this.upstream.close();
    else this.upstream?.terminate();
    this.send({ type: 'live_closed' });
  }
  private fail(error: string) { if (!this.closed) { this.send({ type: 'live_error', error }); this.close(); } }
  private async start() {
    const [settings, credential, gateway] = await Promise.all([this.deps.settings(), this.deps.credentials(), this.deps.gatewayCredentials()]);
    if (this.closed) return;
    if (!settings.enabled || settings.mode !== 'jev') { this.fail('Select Jev voice before starting transcription.'); return; }
    if (!credential.apiKey || !gateway.apiKey) { this.fail('Jev voice requires an OpenAI transcription key and an AI Gateway key in Settings.'); return; }
    const upstream = this.deps.connect('wss://api.openai.com/v1/realtime?intent=transcription', credential.apiKey);
    this.upstream = upstream;
    upstream.on('open', () => {
      if (this.closed) { upstream.terminate(); return; }
      try {
        upstream.send(JSON.stringify({ type: 'session.update', session: { type: 'transcription', audio: { input: {
          format: { type: 'audio/pcm', rate: 24_000 },
          transcription: { model: 'gpt-live-transcribe', delay: 'minimal' },
          // gpt-live-transcribe rejects server_vad. Commit bounded audio turns ourselves.
          turn_detection: null,
        } } } }));
      } catch { this.fail('Could not configure live transcription.'); }
    });
    upstream.on('message', raw => {
      if (this.closed) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (!event || typeof event !== 'object') return;
      if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
        this.fail(transcriptionError(event.error)); return;
      }
      if ((event.type === 'session.updated' || event.type === 'transcription_session.updated') && !this.ready) {
        this.ready = true; clearTimeout(this.timeout); this.lastPing = Date.now();
        this.heartbeat = setInterval(() => { if (Date.now() - this.lastPing > 45_000) this.close(); }, 15_000);
        this.heartbeat.unref?.();
        this.send({ type: 'live_ready', transport: 'pcm', backendModel: 'typesafe-ai/jev' });
      }
      if (['conversation.item.input_audio_transcription.delta', 'conversation.item.input_audio_transcription.completed', 'input_audio_buffer.committed'].includes(String(event.type))) {
        // Forward transcript fields only, never provider session configuration or credentials.
        this.send({ type: 'live_event', event: {
          type: event.type, item_id: event.item_id, previous_item_id: event.previous_item_id,
          event_id: event.event_id, delta: event.delta, transcript: event.transcript,
        } });
      }
    });
    upstream.on('error', () => this.fail('Live transcription connection failed. Reconnect to continue.'));
    upstream.on('close', () => this.fail('Live transcription disconnected. Your transcript is retained.'));
  }
}
