// Upload snapshots off the terminal's input/render path. Idle terminals do not
// generate traffic; frequent input measurements share a 30-second batch.
export class TerminalTelemetryReporter {
  private timer?: ReturnType<typeof setTimeout>;
  private due = Infinity;
  private dirty = false;
  private sending = false;
  private closed = false;
  private pagehide = () => this.flush('pagehide');

  constructor(private report: () => Record<string, unknown>) {
    if (typeof window !== 'undefined') window.addEventListener?.('pagehide', this.pagehide);
  }

  schedule(delay = 1000) {
    if (this.closed) return;
    this.dirty = true;
    const due = performance.now() + delay;
    if (due >= this.due) return;
    clearTimeout(this.timer);
    this.due = due;
    this.timer = setTimeout(() => this.flush(), delay);
  }

  private flush(reason: 'checkpoint' | 'pagehide' | 'closed' = 'checkpoint') {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.due = Infinity;
    if (!this.dirty || (this.sending && reason === 'checkpoint')) return;
    this.dirty = false;
    this.sending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void (async () => {
      try {
        await fetch('/api/telemetry/terminal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...this.report(), reason, reportedAt: new Date().toISOString() }),
          keepalive: true,
          signal: controller.signal,
        });
      } catch {
        // Telemetry delivery must never affect the terminal or surface UI errors.
      } finally {
        clearTimeout(timeout);
        this.sending = false;
        if (this.dirty && !this.closed && !this.timer) this.schedule();
      }
    })();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.dirty = true;
    if (typeof window !== 'undefined') window.removeEventListener?.('pagehide', this.pagehide);
    this.flush('closed');
  }
}
