import { getUsageJournal, type PendingUsageWatch, type UsageJournal } from './UsageJournal';
import { getUsageStore, type UsageStore } from './UsageStore';
import { recordExternalUsage } from './recordExternalUsage';

type Options = {
  lookup: (watch: PendingUsageWatch, signal: AbortSignal) => Promise<any>;
  journal?: () => UsageJournal;
  store?: () => UsageStore;
  onError?: (error: unknown) => void;
};

/** Watches belong to executions, so removing a chat cannot stop usage recovery. */
export class UsageRecoveryService {
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private pending?: Promise<void>;
  private readonly journal: () => UsageJournal;
  private readonly store: () => UsageStore;

  constructor(private readonly options: Options) {
    this.journal = options.journal ?? getUsageJournal;
    this.store = options.store ?? getUsageStore;
  }

  start(): void {
    if (this.controller) return;
    // Persist the boundary first: older native events delivered later must also be interrupted.
    this.store().beginRecovery();
    this.controller = new AbortController();
    this.schedule(0);
  }

  async stop(): Promise<void> {
    if (!this.controller) return;
    clearTimeout(this.timer);
    this.controller?.abort();
    await this.pending;
    this.controller = undefined;
    try { this.journal().drain(this.store()); } catch (error) { this.options.onError?.(error); }
  }

  async recoverOnce(signal: AbortSignal): Promise<void> {
    const journal = this.journal();
    try { journal.drain(this.store()); } catch (error) { this.options.onError?.(error); }
    const watches = journal.due();
    // Bound daemon traffic and avoid one unavailable drone blocking all recovery work.
    for (let offset = 0; offset < watches.length && !signal.aborted; offset += 4) {
      await Promise.all(watches.slice(offset, offset + 4).map(async (watch) => {
        try {
          const job = await this.options.lookup(watch, signal);
          if (!job) throw new Error('Prompt usage is not yet available from the daemon');
          if (signal.aborted) return;
          recordExternalUsage({ ...watch, job }, journal, this.store());
          journal.retry(watch, job.exitStatusSource === 'missing-exit-file'
            ? new Error('Awaiting durable exit evidence') : undefined);
        } catch (error) {
          if (!signal.aborted) journal.retry(watch, error);
        }
      }));
    }
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      const signal = this.controller!.signal;
      this.pending = this.recoverOnce(signal).catch((error) => this.options.onError?.(error)).finally(() => {
        this.pending = undefined;
        if (!signal.aborted) this.schedule(5000);
      });
    }, delay);
    this.timer.unref();
  }
}
