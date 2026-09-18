export type CompanionTranscriptItem = { id: string; text: string; sent: number; final: boolean };
export type CompanionTranscriptMarkerKind = 'sent' | 'skipped' | 'cancelled';
export type CompanionTranscriptMarker = { itemId: string; offset: number; silenceMs: number; kind: CompanionTranscriptMarkerKind };
export type CompanionTranscriptHistory = {
  items: CompanionTranscriptItem[];
  delegations: string[];
  lastTranscriptAt?: number;
  markers?: CompanionTranscriptMarker[];
};
export const createCompanionTranscriptHistory = (): CompanionTranscriptHistory => ({ items: [], delegations: [] });

export type CompanionTranscriptSnapshot = {
  items: CompanionTranscriptItem[];
  /** Unsent speech across items, newline-joined. */
  pending: string;
  /** Recent delegated transcripts, for context only. */
  context: string;
  silenceMs: number;
  lastTranscriptAt?: number;
};

const MARKER_LABEL: Record<CompanionTranscriptMarkerKind, string> = { sent: 'Sent to backend agent', skipped: 'Skipped: not for the assistant', cancelled: 'Cancelled running work' };

/** Retains all speech. Decisions advance a cursor per item; they never delete text. */
export class CompanionReflexTranscript {
  constructor(
    readonly history: CompanionTranscriptHistory = createCompanionTranscriptHistory(),
    private readonly onChange?: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  get transcript(): string { return this.history.items.map(item => item.text).join('\n'); }
  get pending(): string { return this.history.items.map(item => item.text.slice(item.sent)).filter(Boolean).join('\n'); }
  get silenceMs(): number { return this.history.lastTranscriptAt === undefined ? 0 : Math.max(0, this.now() - this.history.lastTranscriptAt); }
  get displayTranscript(): string {
    return this.history.items.map(item => {
      let cursor = 0;
      let text = '';
      for (const marker of this.history.markers ?? []) {
        if (marker.itemId !== item.id) continue;
        const offset = Math.min(item.text.length, Math.max(cursor, marker.offset));
        text += item.text.slice(cursor, offset) + `\n[Silence: ${(marker.silenceMs / 1000).toFixed(2)} s]\n[${MARKER_LABEL[marker.kind]}]\n`;
        cursor = offset;
      }
      return text + item.text.slice(cursor);
    }).join('\n');
  }

  register(id: string, previousId?: string | null): void {
    const before = this.history.items.map(item => item.id).join('\n');
    let item = this.history.items.find(item => item.id === id);
    if (!item) { item = { id, text: '', sent: 0, final: false }; this.history.items.push(item); }
    if (previousId && previousId !== id) {
      this.register(previousId);
      const items = this.history.items;
      items.splice(items.indexOf(item), 1);
      items.splice(items.findIndex(previous => previous.id === previousId) + 1, 0, item);
      if (before !== items.map(item => item.id).join('\n')) this.onChange?.();
    }
  }

  append(delta: string, id: string): void {
    if (!delta) return;
    this.register(id);
    const item = this.history.items.find(item => item.id === id)!;
    if (item.final) return;
    item.text += delta;
    this.history.lastTranscriptAt = this.now();
    this.onChange?.();
  }

  complete(text: string, id: string): void {
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
    if (item.text !== text) this.history.lastTranscriptAt = this.now();
    item.text = text;
    item.final = true;
    this.onChange?.();
  }

  snapshot(): CompanionTranscriptSnapshot | null {
    const items = this.history.items.map(item => ({ ...item }));
    const pending = items.map(item => item.text.slice(item.sent)).filter(Boolean).join('\n');
    if (!pending.trim()) return null;
    const lastTranscriptAt = this.history.lastTranscriptAt;
    return { items, pending, context: this.history.delegations.slice(-5).join('\n\n').slice(-16_000),
      silenceMs: lastTranscriptAt === undefined ? 0 : Math.max(0, this.now() - lastTranscriptAt), lastTranscriptAt };
  }

  /** Appended text is safe; rewritten or reordered text the evaluator read, or speech resuming during silence, needs a fresh decision. */
  stillValid(snapshot: CompanionTranscriptSnapshot): boolean {
    if (snapshot.silenceMs >= 50 && this.history.lastTranscriptAt !== snapshot.lastTranscriptAt) return false;
    const oldIds = new Set(snapshot.items.map(item => item.id));
    const reordered = this.history.items.filter(item => oldIds.has(item.id)).some((item, index) => item.id !== snapshot.items[index]?.id);
    return !reordered && snapshot.items.every(old => this.history.items.find(item => item.id === old.id)?.text.startsWith(old.text));
  }

  /** Move the cursor past everything the evaluator read. Later-arriving words stay pending. */
  advance(snapshot: CompanionTranscriptSnapshot, kind: CompanionTranscriptMarkerKind): void {
    for (const old of snapshot.items) {
      const item = this.history.items.find(item => item.id === old.id);
      if (item) item.sent = Math.max(item.sent, old.text.length);
    }
    if (kind === 'sent') this.history.delegations.push(snapshot.pending);
    const consumed = snapshot.items.filter(item => item.text.slice(item.sent).length > 0);
    const last = consumed[consumed.length - 1];
    if (last) (this.history.markers ??= []).push({ itemId: last.id, offset: last.text.length, silenceMs: snapshot.silenceMs, kind });
    this.onChange?.();
  }
}
