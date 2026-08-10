export type ManagedLoopOptions = {
  intervalMs?: number | (() => number);
  runOnStart?: boolean;
  run: () => Promise<void>;
  onError?: (error: unknown) => void;
};

export class ManagedLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDueAt = 0;
  private inFlight: Promise<void> | null = null;
  private rerunRequested = false;
  private stopped = true;

  constructor(private readonly options: ManagedLoopOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (this.options.runOnStart !== false) this.wake();
    else this.scheduleInterval();
  }

  wake(delayMs = 0): void {
    if (this.stopped) return;
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }
    this.schedule(Math.max(0, Math.floor(delayMs)));
  }

  async runNow(): Promise<void> {
    if (this.stopped) return;
    this.clearTimer();
    if (this.inFlight) {
      this.rerunRequested = true;
      await this.inFlight;
      return;
    }

    const operation = Promise.resolve()
      .then(() => this.options.run())
      .catch((error) => {
        try {
          this.options.onError?.(error);
        } catch {
          // Error reporting must not stop future runs.
        }
      })
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
        if (this.stopped) return;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.schedule(0);
        } else {
          this.scheduleInterval();
        }
      });
    this.inFlight = operation;
    await operation;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.rerunRequested = false;
    this.clearTimer();
    await this.inFlight?.catch(() => {});
  }

  private scheduleInterval(): void {
    const raw =
      typeof this.options.intervalMs === 'function'
        ? this.options.intervalMs()
        : this.options.intervalMs;
    if (raw === undefined || !Number.isFinite(raw)) return;
    this.schedule(Math.max(1, Math.floor(raw)));
  }

  private schedule(delayMs: number): void {
    const dueAt = Date.now() + delayMs;
    if (this.timer && this.timerDueAt <= dueAt) return;
    this.clearTimer();
    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDueAt = 0;
      void this.runNow();
    }, delayMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerDueAt = 0;
  }
}
