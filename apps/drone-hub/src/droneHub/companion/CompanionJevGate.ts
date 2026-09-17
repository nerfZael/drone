export type JevDecision = 'send' | 'wait';
type TranscriptItem = { id: string; text: string; sent: number; final: boolean };
export type JevTranscriptHistory = { items: TranscriptItem[]; delegations: string[]; lastTranscriptAt?: number;
  sendMarkers?: Array<{ itemId: string; offset: number; silenceMs: number }> };
export const createJevTranscriptHistory = (): JevTranscriptHistory => ({ items: [], delegations: [] });
export const JEV_EVALUATION_INTERVAL_MS = 250;

/** Retains all speech. Decisions advance a sent cursor; they never delete text. */
export class CompanionJevGate {
  private stopped = false;
  private paused = false;
  private evaluating = false;
  private revision = 0;
  private evaluatedRevision = -1;
  private lastStarted = -Infinity;
  private intervalMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  readonly abort = new AbortController();
  readonly history: JevTranscriptHistory;

  constructor(private readonly options: {
    evaluate(transcript: string, context: string, signal: AbortSignal, silenceMs: number): Promise<JevDecision>;
    send(transcript: string, signal: AbortSignal): Promise<void>;
    report(transcript: string, decision: JevDecision): void;
    onError?(message: string): void;
    onChange?(): void;
    history?: JevTranscriptHistory;
    intervalMs?: number;
  }) { this.history = options.history ?? createJevTranscriptHistory(); this.intervalMs = options.intervalMs ?? JEV_EVALUATION_INTERVAL_MS; }

  get transcript() { return this.history.items.map(item => item.text).join('\n'); }
  get silenceMs() { return this.history.lastTranscriptAt === undefined ? 0 : Math.max(0, Date.now() - this.history.lastTranscriptAt); }
  get displayTranscript() {
    return this.history.items.map(item => {
      let cursor = 0;
      let text = '';
      for (const marker of this.history.sendMarkers ?? []) {
        if (marker.itemId !== item.id) continue;
        const offset = Math.min(item.text.length, Math.max(cursor, marker.offset));
        text += item.text.slice(cursor, offset) + `\n[Silence: ${(marker.silenceMs / 1000).toFixed(2)} s]\n[Sent to backend agent]\n`;
        cursor = offset;
      }
      return text + item.text.slice(cursor);
    }).join('\n');
  }
  get pending() { return this.history.items.map(item => item.text.slice(item.sent)).filter(Boolean).join('\n'); }
  get busy() { return this.evaluating; }

  register(id: string, previousId?: string | null): void {
    const before = this.history.items.map(item => item.id).join('\n');
    let item = this.history.items.find(item => item.id === id);
    if (!item) { item = { id, text: '', sent: 0, final: false }; this.history.items.push(item); }
    if (previousId && previousId !== id) {
      this.register(previousId);
      const items = this.history.items;
      items.splice(items.indexOf(item), 1);
      items.splice(items.findIndex(previous => previous.id === previousId) + 1, 0, item);
      if (before !== items.map(item => item.id).join('\n')) this.changed();
    }
  }

  append(delta: string, id: string): void {
    if (this.stopped || !delta) return;
    this.register(id);
    const item = this.history.items.find(item => item.id === id)!;
    if (item.final) return;
    item.text += delta;
    this.history.lastTranscriptAt = Date.now();
    this.changed();
  }

  complete(text: string, id: string): void {
    if (this.stopped) return;
    this.register(id);
    const item = this.history.items.find(item => item.id === id)!;
    if (item.final) return;
    // Reconcile final wording without resending a previously delegated prefix.
    let prefix = 0;
    while (prefix < item.text.length && prefix < text.length && item.text[prefix] === text[prefix]) prefix++;
    let suffix = 0;
    while (suffix < item.text.length - prefix && suffix < text.length - prefix &&
      item.text[item.text.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
    if (item.sent > prefix) item.sent = item.sent >= item.text.length - suffix
      ? Math.max(prefix, item.sent + text.length - item.text.length)
      : text.length - suffix;
    if (item.text !== text) this.history.lastTranscriptAt = Date.now();
    item.text = text;
    item.final = true;
    this.changed();
  }

  setIntervalMs(intervalMs: number) {
    this.intervalMs = intervalMs;
    clearTimeout(this.timer); this.timer = undefined; this.schedule();
  }

  pause(paused: boolean) { this.paused = paused; if (!paused) this.retry(); }
  retry() { if (this.stopped) return; this.paused = false; this.evaluatedRevision = -1; this.schedule(); }
  stop() { this.stopped = true; clearTimeout(this.timer); this.abort.abort(); }

  private changed() {
    this.revision++; clearTimeout(this.timer); this.timer = undefined;
    this.options.onChange?.(); this.schedule();
  }
  private schedule() {
    if (this.stopped || this.paused || this.evaluating || this.timer || !this.pending.trim()) return;
    // A waiting transcript is reevaluated as its silence metadata changes. Never
    // poll an empty/sent transcript, and avoid a tight loop even in zero-delay tests.
    const interval = this.evaluatedRevision === this.revision ? Math.max(50, this.intervalMs) : this.intervalMs;
    const delay = Math.max(0, interval - (Date.now() - this.lastStarted));
    this.timer = setTimeout(() => { this.timer = undefined; void this.evaluate(); }, delay);
  }

  private async evaluate() {
    if (this.stopped || this.paused || this.evaluating) return;
    const snapshot = this.history.items.map(item => ({ ...item }));
    const transcript = snapshot.map(item => item.text.slice(item.sent)).filter(Boolean).join('\n');
    if (!transcript.trim()) return;
    const lastTranscriptAt = this.history.lastTranscriptAt ?? Date.now();
    const silenceMs = Math.max(0, Date.now() - lastTranscriptAt);
    this.evaluating = true; this.lastStarted = Date.now(); this.evaluatedRevision = this.revision;
    this.options.onChange?.();
    try {
      if (transcript.length > 120_000) throw new Error('The unsent transcript exceeds the Jev request limit. Your transcript is retained; end voice and review it before continuing.');
      // Full unsent speech plus recent earlier delegations. The retained transcript itself is never truncated.
      const context = this.history.delegations.slice(-5).join('\n\n').slice(-16_000);
      const decision = await this.options.evaluate(transcript, context, this.abort.signal, silenceMs);
      if (this.stopped || this.paused) return;
      // A decision made during silence is stale if speech resumed in flight.
      if (silenceMs >= 50 && this.history.lastTranscriptAt !== lastTranscriptAt) {
        this.evaluatedRevision = -1; return;
      }
      if (decision !== 'send' && decision !== 'wait') throw new Error('Jev returned an invalid decision.');
      // Appended text is safe; revisions to text Jev actually read require a fresh decision.
      const oldIds = new Set(snapshot.map(item => item.id));
      const reordered = this.history.items.filter(item => oldIds.has(item.id)).some((item, index) => item.id !== snapshot[index]?.id);
      if (reordered || snapshot.some(old => !this.history.items.find(item => item.id === old.id)?.text.startsWith(old.text))) {
        this.evaluatedRevision = -1; return;
      }
      if (decision === 'send') {
        await this.options.send(transcript, this.abort.signal);
        // A successful submission stays marked sent even if listening stopped during acceptance.
        for (const old of snapshot) {
          const item = this.history.items.find(item => item.id === old.id)!;
          item.sent = Math.max(item.sent, old.text.length);
        }
        this.history.delegations.push(transcript);
        const delegatedItems = snapshot.filter(item => item.text.slice(item.sent).length > 0);
        const last = delegatedItems[delegatedItems.length - 1];
        if (last) (this.history.sendMarkers ??= []).push({ itemId: last.id, offset: last.text.length, silenceMs });
      }
      this.options.report(transcript, decision);
    } catch (error) {
      if (!this.stopped) { this.paused = true; this.options.onError?.(error instanceof Error ? error.message : 'Jev evaluation failed.'); }
    } finally {
      this.evaluating = false;
      if (!this.stopped) { this.options.onChange?.(); this.schedule(); }
    }
  }
}
