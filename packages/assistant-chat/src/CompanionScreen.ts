type Bounds = { width: number; height: number };
type Candidate = { id: number; markdown: string };
type Snapshot = { markdown: string; candidate: Candidate | null };

/** Session-local display transaction; only a measured, fitting candidate replaces visible content. */
export class CompanionScreen {
  private bounds: Bounds = { width: 0, height: 0 };
  private snapshot: Snapshot = { markdown: '', candidate: null };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private typography = '';
  private pending?: { resolve: (result: unknown) => void; timer: ReturnType<typeof setTimeout> };
  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  constraints() {
    return {
      ...this.bounds,
      typography: this.typography,
      maxCharacters: 8000,
      format: 'Markdown text: paragraphs, headings, lists, emphasis, inline code and links. No HTML, images, tables, fenced or indented code blocks.',
      units: 'client layout pixels',
      measurement: 'Rendered content must fit without scrolling. Height depends on wrapping and client text settings.',
    };
  }

  resize(width: number, height: number, typography = '', options?: { preserveContent?: boolean }) {
    const next = { width: Math.max(0, Math.floor(Number.isFinite(width) ? width : 0)), height: Math.max(0, Math.floor(Number.isFinite(height) ? height : 0)) };
    if (next.width === this.bounds.width && next.height === this.bounds.height && typography === this.typography) return;
    this.typography = typography;
    this.bounds = next;
    this.finish({ displayed: false, error: 'SCREEN_CHANGED', constraints: this.constraints(), retry: 'Inspect or submit again using the new dimensions.' });
    // Scrollable desktop hosts retain the accepted display while moving windows.
    // Other clients still discard content that could be clipped after resizing.
    this.update({ markdown: options?.preserveContent ? this.snapshot.markdown : '', candidate: null });
  }
  execute(args: Record<string, unknown>): Promise<unknown> | unknown {
    const action = args.action ?? 'show';
    if (action === 'inspect') return { displayed: Boolean(this.snapshot.markdown), constraints: this.constraints() };
    if (action === 'clear') { this.clear(); return { displayed: false, cleared: true, constraints: this.constraints() }; }
    const fail = (error: string) => ({ displayed: false, error, constraints: this.constraints() });
    if (action !== 'show') return fail('INVALID_ACTION: use inspect, show or clear');
    if (typeof args.markdown !== 'string' || !args.markdown.trim()) return fail('MARKDOWN_REQUIRED');
    if (args.markdown.length > 8000) return fail('CONTENT_LIMIT: shorten to at most 8000 characters');
    if (/<\/?[a-z!][^>]*>|!\[|^\s*(```|~~~)|^\s*\|.*\||^\s*[-:]+\s*\||^ {4}\S|^\t\S/im.test(args.markdown)) return fail('UNSUPPORTED_MARKDOWN: use the text formats in constraints');
    if (this.bounds.width <= 0 || this.bounds.height <= 0) return fail('SCREEN_UNAVAILABLE: open Companion and retry');
    if (this.pending) return fail('DISPLAY_BUSY: another display is being measured; retry');
    return new Promise((resolve) => {
      this.pending = { resolve, timer: setTimeout(() => {
        this.finish(fail('MEASUREMENT_TIMEOUT: retry when Companion is visible'));
        this.update({ ...this.snapshot, candidate: null });
      }, 5000) };
      this.update({ ...this.snapshot, candidate: { id: ++this.sequence, markdown: args.markdown as string } });
    });
  }
  measured(id: number, width: number, height: number) {
    const candidate = this.snapshot.candidate;
    if (!candidate || candidate.id !== id || !Number.isFinite(width) || !Number.isFinite(height)) return;
    const fits = width > 0 && width <= this.bounds.width && height <= this.bounds.height && height > 0;
    this.finish({
      displayed: fits,
      error: fits ? undefined : 'CONTENT_DOES_NOT_FIT',
      constraints: this.constraints(),
      measured: { width, height },
      overflow: { width: Math.max(0, width - this.bounds.width), height: Math.max(0, height - this.bounds.height) },
      retry: fits ? undefined : 'Shorten the Markdown and submit again. Previous content is unchanged.',
    });
    this.update({ markdown: fits ? candidate.markdown : this.snapshot.markdown, candidate: null });
  }
  clear() { this.finish({ displayed: false, error: 'DISPLAY_DISMISSED' }); this.update({ markdown: '', candidate: null }); }
  detach() { this.clear(); this.bounds = { width: 0, height: 0 }; }
  private finish(result: unknown) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.resolve(result);
    this.pending = undefined;
  }
  private update(snapshot: Snapshot) { this.snapshot = snapshot; for (const listener of this.listeners) listener(); }
}
