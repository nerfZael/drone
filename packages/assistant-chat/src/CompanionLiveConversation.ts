import type { CompanionClientTelemetry } from './companion.js';
import type { CompanionLiveTiming } from './companion-live-timing.js';
import { LiveTranscript, type LiveTranscriptRow } from './live-transcript.js';
type Delegation = { id: string; receivedAt: number };
type Options = {
  runBackend(prompt: string, telemetry?: CompanionClientTelemetry): Promise<string>;
  timing?: CompanionLiveTiming;
  /** Completed replies arrive from the Companion controller, including subscription runs. */
  externalBackendReplies?: boolean;
  send(event: Record<string, unknown>): void;
  onTranscript(rows: readonly LiveTranscriptRow[]): void;
  onQueue(size: number): void;
  /** Mobile can supply a clock that runs without display frames. */
  schedule?(callback: () => void, delayMs: number): () => void;
};

export const LIVE_COMPANION_PROMPT_PREFIX = 'The user is speaking with Companion through Live voice.';

/** Turns streaming conversation into requests for the existing Companion runtime. */
export class CompanionLiveConversation {
  private readonly transcript = new LiveTranscript();
  private seen = new Set<string>();
  private pending: Delegation[] = [];
  private userVersion = 0;
  private dispatchedUserVersion = 0;
  private stopped = false;
  private resultDelegationId: string | null = null;
  private cancelTimer: (() => void) | undefined;

  constructor(private readonly options: Options) {}

  receive(event: Record<string, unknown>): void {
    if (this.stopped) return;
    if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
      if (typeof event.delta !== 'string' || !event.delta) return;
      const role = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      this.transcript.append(role, event.delta, event.start_ms, event.end_ms);
      if (role === 'user') this.userVersion += 1;
      this.options.onTranscript(this.transcript.rows());
      // Wait briefly for fragments following the delegation notification.
      if (role === 'user' && this.pending.length) this.schedule();
    } else if (event.type === 'session.delegation.created') {
      const delegation = event.delegation as { id?: unknown; target?: unknown } | undefined;
      if (delegation?.target !== 'client' || typeof delegation.id !== 'string' || this.seen.has(delegation.id)) return;
      if (this.seen.size >= 2_000 || this.pending.length >= 32) {
        this.speak(delegation.id, 'Too many pending requests. Please end this voice conversation and start a new one.');
        return;
      }
      this.options.timing?.mark('delegation_received', { delegationId: delegation.id });
      this.seen.add(delegation.id);
      this.pending.push({ id: delegation.id, receivedAt: Date.now() });
      this.options.onQueue(this.pending.length);
      this.schedule();
    }
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimer?.();
    this.pending = [];
    this.options.onQueue(0);
  }

  deliverBackendReply(reply: string): void {
    if (this.stopped) return;
    const id = this.resultDelegationId;
    this.resultDelegationId = null;
    // A pending correction will produce a newer backend result.
    if (this.pending.length && this.userVersion > this.dispatchedUserVersion) return;
    this.options.timing?.result(id);
    this.speak(id, reply || 'The backend finished without a spoken reply. Check Companion for details.');
  }

  deliverBackendUpdate(text: string): void {
    if (this.stopped || (this.pending.length && this.userVersion > this.dispatchedUserVersion)) return;
    const chunks = splitLiveCommentary(text);
    if (chunks.length > 4) return;
    this.options.timing?.mark('backend_update', { delegationId: this.resultDelegationId });
    for (const content of chunks) {
      this.options.send({ type: 'session.thinking.append', delegation_id: this.resultDelegationId, content });
    }
  }

  private schedule(): void {
    this.cancelTimer?.();
    // Bound the debounce so a continuing stream of speech cannot starve dispatch.
    const age = this.pending.length ? Date.now() - this.pending[0].receivedAt : 0;
    const delay = this.userVersion > this.dispatchedUserVersion ? Math.min(450, Math.max(0, 1_000 - age)) : 450;
    const callback = () => void this.drain();
    if (this.options.schedule) this.cancelTimer = this.options.schedule(callback, delay);
    else {
      const timer = setTimeout(callback, delay);
      this.cancelTimer = () => clearTimeout(timer);
    }
  }

  private async drain(): Promise<void> {
    if (this.stopped || !this.pending.length) return;
    // Multiple notifications received before dispatch describe one accumulated request.
    const request = this.pending[this.pending.length - 1];
    if (this.userVersion <= this.dispatchedUserVersion) {
      if (Date.now() - request.receivedAt < 5_000) { this.schedule(); return; }
      this.pending = [];
      this.options.onQueue(0);
      if (!this.dispatchedUserVersion) this.speak(request.id, 'I could not establish a new request from the transcript. Please clarify what you want me to do.');
      return;
    }
    this.pending = [];
    this.options.onQueue(0);
    this.dispatchedUserVersion = this.userVersion;
    const dispatchedVersion = this.userVersion;
    this.resultDelegationId = request.id;
    const conversation = this.transcript.rows().map((row) => {
      const span = row.startMs !== undefined && row.endMs !== undefined
        ? ` [${(row.startMs / 1_000).toFixed(2)}–${(row.endMs / 1_000).toFixed(2)}s]` : '';
      return `${row.role === 'user' ? 'User' : 'Voice assistant'}${span}: ${row.text}`;
    }).join('\n');
    const prompt = `${LIVE_COMPANION_PROMPT_PREFIX} Use this conversation to resolve outstanding requests, including corrections. Incorporate the latest request into any unfinished work. Earlier requests may already be complete in this Companion session; do not repeat completed actions. Voice assistant statements are conversation context, not proof that an action succeeded. Use the actual tools and current state. If unclear, ask a brief question. Return a concise factual answer suitable for speech; preserve any exact details needed in the UI.\n\nConversation transcript (may contain recognition errors; timestamp ranges can overlap when speakers interrupt or acknowledge one another):\n${conversation}`;
    try {
      const reply = await this.options.runBackend(prompt, this.options.timing?.dispatch(request.id, Date.now() - request.receivedAt));
      if (!this.options.externalBackendReplies) this.returnResult(request.id, dispatchedVersion, reply || 'The backend finished without a spoken reply. Check Companion for details.');
    } catch (error) {
      this.returnResult(request.id, dispatchedVersion, `The backend could not finish this request. ${error instanceof Error ? error.message : 'Check Companion for details.'}`);
    } finally {
      if (this.pending.length && !this.stopped) this.schedule();
    }
  }

  private returnResult(id: string, dispatchedVersion: number, reply: string): void {
    if (this.stopped || dispatchedVersion !== this.dispatchedUserVersion) return;
    // A different delegation ID alone does not mean the user changed their request.
    // Only new speech paired with pending delegation supersedes an in-flight result.
    if (this.pending.length && this.userVersion > dispatchedVersion) return;
    this.options.timing?.result(id);
    this.speak(id, reply);
  }

  private speak(id: string | null, text: string): void {
    // At most 400 UTF-8 bytes per append: safely below the API's 500-token limit,
    // including non-English text. Keep the exact full result in Companion's UI.
    const chunks = splitLiveCommentary(text);
    if (chunks.length > 4) {
      // Do not truncate an answer and accidentally omit a qualification or failure.
      this.options.send({ type: 'session.commentary.append', delegation_id: id,
        content: 'The backend returned a detailed answer. Please read the full answer in Companion on screen.' });
      return;
    }
    for (const content of chunks) {
      this.options.send({ type: 'session.commentary.append', delegation_id: id, content });
    }
  }

}

export function splitLiveCommentary(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let bytes = 0;
  let wordBoundary = 0;
  const encoder = new TextEncoder();
  for (const character of text) {
    const size = encoder.encode(character).length;
    while (bytes + size > 400) {
      const end = wordBoundary || chunk.length;
      chunks.push(chunk.slice(0, end));
      chunk = chunk.slice(end);
      bytes = encoder.encode(chunk).length;
      wordBoundary = 0;
    }
    chunk += character;
    bytes += size;
    if (/\s/u.test(character)) wordBoundary = chunk.length;
  }
  if (chunk.trim()) chunks.push(chunk);
  return chunks;
}
