import { WebSocket } from 'ws';
import { resolveEffectiveProviderApiKeySettings } from '../hub-settings';
import { readCompanionSettings } from './companion-config';
import { readCompanionLiveSettings } from './companion-live-settings';

type LiveMessage = { type?: string; sdp?: unknown; event?: unknown };
type Dependencies = {
  fetch: typeof fetch;
  connect(url: string, apiKey: string): WebSocket;
  credentials(): Promise<{ apiKey: string | null }>;
  enabled(): Promise<{ enabled: boolean }>;
  backend(): Promise<{ model: string; provider: string }>;
};

/** One authenticated browser socket owns one Live session and its cleanup sideband. */
export class CompanionLiveSocket {
  private upstream: WebSocket | null = null;
  private starting = false;
  private finalized = false;
  private hangupRequested = false;
  private hangupSession: (() => Promise<Response>) | undefined;
  private closed = false;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastPing = Date.now();
  private readonly deps: Dependencies;

  constructor(private readonly send: (message: unknown) => void, dependencies?: Partial<Dependencies>) {
    this.deps = {
      fetch: globalThis.fetch,
      connect: (url, apiKey) => new WebSocket(url, {
        headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 15_000,
      }),
      credentials: () => resolveEffectiveProviderApiKeySettings('openai'),
      enabled: readCompanionLiveSettings,
      backend: readCompanionSettings,
      ...dependencies,
    };
  }

  handle(message: LiveMessage): void {
    if (message.type === 'live_ping') { this.lastPing = Date.now(); return; }
    if (message.type === 'live_close') { this.close(); return; }
    if (message.type === 'live_start') {
      if (this.starting || this.upstream || this.closed) return;
      this.starting = true;
      void this.start(message.sdp).catch((error) => {
        if (!this.closed) this.send({ type: 'live_error', error: safeError(error) });
        this.close();
      });
      return;
    }
    if (message.type === 'live_event' && this.upstream?.readyState === WebSocket.OPEN && !this.closed) {
      const event = message.event as Record<string, unknown> | undefined;
      // The browser may provide conversation context/results, never session config or credentials.
      if (!event || !['session.commentary.append', 'session.thinking.append', 'session.instructions.append'].includes(String(event.type))) return;
      if (typeof event.content !== 'string' || !event.content.trim() || Buffer.byteLength(event.content, 'utf8') > 400) return;
      if (event.delegation_id !== null && typeof event.delegation_id !== 'string') return;
      this.upstream.send(JSON.stringify({
        type: event.type, content: event.content, delegation_id: event.delegation_id,
        event_id: typeof event.event_id === 'string' ? event.event_id.slice(0, 200) : undefined,
      }));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.requestClose();
  }

  private requestClose(): void {
    const upstream = this.upstream;
    if (!upstream || upstream.readyState !== WebSocket.OPEN) { void this.hangup(); return; }
    if (this.closeTimer) return;
    this.closeTimer = setTimeout(() => { void this.hangup(); upstream.terminate(); }, 5_000);
    try { upstream.send(JSON.stringify({ type: 'session.close' })); }
    catch { void this.hangup(); }
    this.closeTimer.unref?.();
  }

  private async hangup(): Promise<void> {
    if (this.finalized || this.hangupRequested || !this.hangupSession) return;
    this.hangupRequested = true;
    // A lost sideband must not leave an allocated, billable session running.
    try {
      const response = await this.hangupSession();
      if (!response.ok) throw new Error('Hangup failed');
    } catch {
      console.warn('[companion-live] Live session hangup failed; remote cleanup and final usage are unconfirmed.');
      this.send({ type: 'live_error', error: 'Live session cleanup could not be confirmed. Check the OpenAI project for session usage.' });
      return;
    }
    if (!this.finalized) console.warn('[companion-live] Requested HTTP hangup without a final session.closed event; final usage is unconfirmed.');
  }

  private async start(sdp: unknown): Promise<void> {
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 100_000) {
      throw new Error('A valid microphone connection offer is required.');
    }
    const [setting, credential, backend] = await Promise.all([
      this.deps.enabled(), this.deps.credentials(), this.deps.backend(),
    ]);
    if (this.closed) return;
    if (!setting.enabled) throw new Error('Enable Live voice before starting a conversation.');
    if (!credential.apiKey) throw new Error('Configure an OpenAI API key in Settings to use Live voice. Your Companion backend model can use a different provider.');
    const response = await this.deps.fetch('https://api.openai.com/v1/live/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential.apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        session: { model: 'gpt-live-1', delegation: { type: 'client' }, store: false, instructions: LIVE_INSTRUCTIONS },
        transport: { type: 'webrtc', sdp },
      }),
    });
    if (!response.ok) throw new Error(`Live voice could not start (OpenAI HTTP ${response.status}). Check API access, quota, and credentials.`);
    const result = await response.json() as { session?: { id?: string }; transport?: { sdp?: string } };
    const sessionId = result?.session?.id;
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('OpenAI returned an incomplete Live session.');
    this.hangupSession = () => this.deps.fetch(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/hangup`, {
      method: 'POST', headers: { Authorization: `Bearer ${credential.apiKey}` }, signal: AbortSignal.timeout(10_000),
    });
    if (this.closed) { await this.hangup(); return; }
    if (typeof result.transport?.sdp !== 'string' || !result.transport.sdp) throw new Error('OpenAI returned an incomplete Live session.');
    const upstream = this.deps.connect(
      `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`, credential.apiKey,
    );
    this.upstream = upstream;
    upstream.on('message', (raw) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return;
      if (event.type === 'session.closed') {
        this.finalized = true;
        clearTimeout(this.closeTimer);
        clearInterval(this.heartbeat);
        this.send({ type: 'live_closed' });
        this.closed = true;
        upstream.close();
      } else if (!this.closed && (
        event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta' ||
        event.type === 'session.delegation.created' || event.type === 'error'
      )) {
        this.send({ type: 'live_event', event });
      }
    });
    upstream.on('error', () => {
      if (!this.closed) this.send({ type: 'live_error', error: 'Live voice control connection failed. End the conversation and try again.' });
      this.close();
    });
    upstream.on('close', () => {
      clearTimeout(this.closeTimer);
      clearInterval(this.heartbeat);
      if (!this.closed) this.send({ type: 'live_error', error: 'Live voice disconnected. Start a new conversation to reconnect.' });
      this.closed = true;
      void this.hangup();
    });
    // Start client ICE/DTLS while the control socket attaches. Clients still gate
    // microphone delivery on live_ready so early delegation events cannot be lost.
    this.send({ type: 'live_answer', sdp: result.transport.sdp, backendModel: backend.model });
    upstream.once('open', () => {
      if (this.closed) { this.requestClose(); return; }
      this.lastPing = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPing > 45_000) this.close();
      }, 15_000);
      this.heartbeat.unref?.();
      this.send({ type: 'live_ready', sdp: result.transport!.sdp, backendModel: backend.model });
    });
  }
}

const LIVE_INSTRUCTIONS = `You are Companion, a calm voice assistant inside Drone Hub.
Speak briefly and naturally. The backend agent uses the user's selected model and tools.
Backchannel policy: Use moderate acknowledgments without competing with the main answer.
Interruption policy: Stop speaking when interrupted and listen. Stopping speech does not cancel backend tasks.
Delegation policy:
Backend tools: inspect the app and workspaces, search chats, edit composers and editor buffers, and prepare proposals using the configured Companion tools.
Delegate to the backend when: the user requests an app action, lookup, careful reasoning, or a correction to pending work.
Do not delegate to the backend when: greeting, clarifying an unclear request, or repeating a still-current result.
Delegate before answering questions that depend on backend work. Never invent results or claim a proposal was applied unless confirmed.
Backend follow-ups follow the user's Companion delivery setting: ASAP steers at the next processing point; Queue waits for the current request to finish. Do not promise immediate delivery. Never promise that a correction cancelled or undid an already-running action. For urgent cancellation, direct the user to Stop Companion turn.
Use short spoken summaries. Exact results and tool activity appear in the app.`;

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Live voice could not start.';
}
