type Transcript = { role: 'user' | 'assistant'; text: string };
type Delegation = { id: string; receivedAt: number };
type Options = {
  runBackend(prompt: string): Promise<string>;
  send(event: Record<string, unknown>): void;
  onTranscript(rows: readonly Transcript[]): void;
  onQueue(size: number): void;
};

export const LIVE_COMPANION_PROMPT_PREFIX = 'The user is speaking with Companion through Live voice.';

/** Turns streaming conversation into ASAP requests for the existing Companion runtime. */
export class CompanionLiveConversation {
  private rows: Transcript[] = [];
  private seen = new Set<string>();
  private pending: Delegation[] = [];
  private userVersion = 0;
  private dispatchedUserVersion = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: Options) {}

  receive(event: Record<string, unknown>): void {
    if (this.stopped) return;
    if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
      if (typeof event.delta !== 'string' || !event.delta) return;
      const role = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      const last = this.rows[this.rows.length - 1];
      if (last?.role === role) last.text += event.delta;
      else this.rows.push({ role, text: event.delta });
      if (role === 'user') this.userVersion += 1;
      this.trimHistory();
      this.options.onTranscript(this.rows.map((row) => ({ ...row })));
      // Wait briefly for fragments following the delegation notification.
      if (role === 'user' && this.pending.length) this.schedule();
    } else if (event.type === 'session.delegation.created') {
      const delegation = event.delegation as { id?: unknown; target?: unknown } | undefined;
      if (delegation?.target !== 'client' || typeof delegation.id !== 'string' || this.seen.has(delegation.id)) return;
      if (this.seen.size >= 2_000 || this.pending.length >= 32) {
        this.speak(delegation.id, 'Too many pending requests. Please end this voice conversation and start a new one.');
        return;
      }
      this.seen.add(delegation.id);
      this.pending.push({ id: delegation.id, receivedAt: Date.now() });
      this.options.onQueue(this.pending.length);
      this.schedule();
    }
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.pending = [];
    this.options.onQueue(0);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    // Bound the debounce so a continuing stream of speech cannot starve dispatch.
    const age = this.pending.length ? Date.now() - this.pending[0].receivedAt : 0;
    const delay = this.userVersion > this.dispatchedUserVersion ? Math.min(450, Math.max(0, 1_000 - age)) : 450;
    this.timer = setTimeout(() => void this.drain(), delay);
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
    const conversation = this.rows.map((row) => `${row.role === 'user' ? 'User' : 'Voice assistant'}: ${row.text}`).join('\n');
    const prompt = `${LIVE_COMPANION_PROMPT_PREFIX} Use this conversation to resolve outstanding requests, including corrections. This message uses ASAP delivery: steer any active task using the latest request rather than treating earlier instructions as immutable. Earlier requests may already be complete in this Companion session; do not repeat completed actions. Voice assistant statements are conversation context, not proof that an action succeeded. Use the actual tools and current state. If unclear, ask a brief question. Return a concise factual answer suitable for speech; preserve any exact details needed in the UI.\n\nConversation transcript (may contain recognition errors):\n${conversation}`;
    try {
      const reply = await this.options.runBackend(prompt);
      this.returnResult(request.id, dispatchedVersion, reply || 'The backend finished without a spoken reply. Check Companion for details.');
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
    this.speak(id, reply);
  }

  private speak(id: string, text: string): void {
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

  private trimHistory(): void {
    // Reserve room for role labels and adapter instructions within Companion's 20k prompt limit.
    let length = this.rows.reduce((sum, row) => sum + row.text.length + 20, 0);
    while (length > 18_000 && this.rows.length > 1) length -= this.rows.shift()!.text.length + 20;
    if (this.rows[0]?.text.length > 17_980) this.rows[0].text = this.rows[0].text.slice(-17_980);
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
