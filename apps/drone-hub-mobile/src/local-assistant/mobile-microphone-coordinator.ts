export type MobileMicrophoneOwner = 'single-shot' | 'continuous';

export type MobileMicrophoneLease = {
  readonly owner: MobileMicrophoneOwner;
  isCurrent(): boolean;
  release(cleanup?: () => void | Promise<void>): Promise<void>;
};

type ActiveLease = {
  id: number;
  owner: MobileMicrophoneOwner;
  releasePromise: Promise<void> | null;
};

/**
 * Arbitrates the process-wide microphone and keeps it owned until asynchronous
 * native cleanup has completed. A lease token prevents stale sessions from
 * releasing a newer owner.
 */
export class MobileMicrophoneCoordinator {
  private activeLease: ActiveLease | null = null;
  private nextLeaseId = 1;
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = (): MobileMicrophoneOwner | null => this.activeLease?.owner ?? null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  acquire(owner: MobileMicrophoneOwner): MobileMicrophoneLease | null {
    if (this.activeLease) return null;
    const activeLease: ActiveLease = {
      id: this.nextLeaseId++,
      owner,
      releasePromise: null,
    };
    this.activeLease = activeLease;
    this.emitChange();
    return {
      owner,
      isCurrent: () => this.activeLease?.id === activeLease.id,
      release: (cleanup) => this.release(activeLease, cleanup),
    };
  }

  private release(lease: ActiveLease, cleanup?: () => void | Promise<void>): Promise<void> {
    if (this.activeLease?.id !== lease.id) return Promise.resolve();
    if (lease.releasePromise) return lease.releasePromise;
    const releasePromise = (async () => {
      try {
        await cleanup?.();
      } finally {
        if (this.activeLease?.id === lease.id) {
          this.activeLease = null;
          this.emitChange();
        }
      }
    })();
    lease.releasePromise = releasePromise;
    return releasePromise;
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }
}
