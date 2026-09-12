/** Native control ticks keep Live deadlines moving when Android stops display frames.
 * JS timers remain a fallback for iOS and foreground precision. Each task fires once.
 */
export class MobileLiveClock {
  private tasks = new Set<{ due: number; fire(): void; cancel(): void }>();
  private closed = false;

  constructor(private readonly now = () => performance.now(),
    private readonly fallback = (callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    }) {}

  schedule = (callback: () => void, delayMs: number): (() => void) => {
    if (this.closed) return () => {};
    let cancelFallback = () => {};
    const task = {
      due: this.now() + delayMs,
      fire: () => {
        if (!this.tasks.delete(task)) return;
        cancelFallback();
        callback();
      },
      cancel: () => { this.tasks.delete(task); cancelFallback(); },
    };
    this.tasks.add(task);
    cancelFallback = this.fallback(task.fire, delayMs);
    return task.cancel;
  };

  tick(): void {
    const now = this.now();
    for (const task of [...this.tasks].sort((a, b) => a.due - b.due)) {
      if (task.due <= now) task.fire();
    }
  }

  close(): void {
    this.closed = true;
    for (const task of this.tasks) task.cancel();
  }
}
