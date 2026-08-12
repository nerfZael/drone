import type { ChangeRequestDomainEvent } from './change-request-events';
import type { ChangeRequestRepository } from './change-request-repository';

type ChangeRequestEventObserver = (event: ChangeRequestDomainEvent) => void;

export type ChangeRequestEventDispatcherDependencies = {
  repository: ChangeRequestRepository;
  hydrate?: (event: ChangeRequestDomainEvent) => Promise<ChangeRequestDomainEvent>;
  deliver: (event: ChangeRequestDomainEvent) => Promise<void>;
  now: () => string;
  retryDelayMs?: number;
  log: (level: 'info' | 'warn', message: string, details?: Record<string, unknown>) => void;
};

/**
 * Drains the transactional outbox immediately after local commits. A one-shot
 * retry timer handles transient delivery failures; there is no periodic native
 * change-request poller.
 */
export class ChangeRequestEventDispatcher {
  private readonly observers = new Set<ChangeRequestEventObserver>();
  private drainPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private notifyTimer: NodeJS.Timeout | null = null;
  private notifiedDuringDrain = false;
  private lastDrainFailed = false;
  private stopped = false;

  constructor(private readonly deps: ChangeRequestEventDispatcherDependencies) {}

  start(): void {
    this.stopped = false;
    this.deps.repository.setOutboxAvailableHandler(() => this.scheduleNotify());
    this.notify();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.deps.repository.setOutboxAvailableHandler(null);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.retryTimer = null;
    this.notifyTimer = null;
    await this.drainPromise;
    this.observers.clear();
  }

  subscribe(observer: ChangeRequestEventObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  notify(): void {
    if (this.stopped) return;
    if (this.drainPromise) {
      this.notifiedDuringDrain = true;
      return;
    }
    this.notifiedDuringDrain = false;
    this.lastDrainFailed = false;
    this.drainPromise = this.drain()
      .catch((error) => {
        this.lastDrainFailed = true;
        this.deps.log('warn', 'change request event dispatcher failed', {
          error: errorMessage(error),
        });
      })
      .finally(() => {
        this.drainPromise = null;
        if (this.lastDrainFailed && !this.stopped) {
          this.scheduleRetry();
        } else if (this.notifiedDuringDrain && !this.stopped) {
          queueMicrotask(() => this.notify());
        } else if (!this.stopped && this.hasPendingEvents()) {
          this.scheduleRetry();
        }
      });
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const events = this.deps.repository.listPendingEvents();
      if (events.length === 0) return;
      for (const event of events) {
        if (this.stopped) return;
        try {
          const hydratedEvent = await this.hydrate(event);
          await this.deps.deliver(hydratedEvent);
          for (const observer of this.observers) {
            try {
              observer(hydratedEvent);
            } catch (error) {
              this.deps.log('warn', 'change request event observer failed', {
                eventId: event.id,
                requestNumber: event.requestNumber,
                error: errorMessage(error),
              });
            }
          }
          await this.deps.repository.markEventDispatched(event.id);
        } catch (error) {
          this.lastDrainFailed = true;
          await this.deps.repository.markEventFailed(
            event.id,
            errorMessage(error),
            this.deps.now(),
          );
          this.deps.log('warn', 'change request event delivery failed', {
            eventId: event.id,
            requestNumber: event.requestNumber,
            stateVersion: event.stateVersion,
            attemptCount: event.attemptCount + 1,
            error: errorMessage(error),
          });
          return;
        }
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.notify();
    }, this.deps.retryDelayMs ?? 5_000);
    this.retryTimer.unref?.();
  }

  private scheduleNotify(): void {
    if (this.notifyTimer || this.stopped) return;
    // Coalesce the several repository writes that can make up one public
    // operation. Every write is still recoverable through the outbox if the
    // process exits before this next-turn dispatch runs.
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, 0);
    this.notifyTimer.unref?.();
  }

  private async hydrate(event: ChangeRequestDomainEvent): Promise<ChangeRequestDomainEvent> {
    if (!this.deps.hydrate) return event;
    try {
      return await this.deps.hydrate(event);
    } catch (error) {
      this.deps.log('warn', 'change request event hydration failed', {
        eventId: event.id,
        requestNumber: event.requestNumber,
        error: errorMessage(error),
      });
      return event;
    }
  }

  private hasPendingEvents(): boolean {
    try {
      return this.deps.repository.listPendingEvents(1).length > 0;
    } catch (error) {
      this.deps.log('warn', 'change request event recovery check failed', {
        error: errorMessage(error),
      });
      return true;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
