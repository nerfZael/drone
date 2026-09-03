export type RemoteLoadOptions = {
  quiet: boolean;
};

export type RemoteLoadCoordinator = {
  request(key: string, options: RemoteLoadOptions): Promise<void>;
  reset(): void;
};

type PendingEntry = {
  active: Promise<void> | null;
  cancelled: boolean;
  pending: RemoteLoadOptions | null;
};

export function createRemoteLoadCoordinator(
  run: (key: string, options: RemoteLoadOptions) => Promise<void>,
): RemoteLoadCoordinator {
  const entries = new Map<string, PendingEntry>();

  const request = (key: string, options: RemoteLoadOptions): Promise<void> => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { active: null, cancelled: false, pending: null };
      entries.set(key, entry);
    }
    entry.pending = entry.pending ? { quiet: entry.pending.quiet && options.quiet } : options;
    if (!entry.active) {
      const current = entry;
      current.active = drain(key, current).finally(() => {
        current.active = null;
        if (entries.get(key) === current) entries.delete(key);
      });
    }
    return entry.active!;
  };

  const drain = async (key: string, entry: PendingEntry): Promise<void> => {
    let firstError: unknown = null;
    while (!entry.cancelled && entry.pending) {
      const options = entry.pending;
      entry.pending = null;
      try {
        await run(key, options);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  };

  return {
    request,
    reset() {
      for (const entry of entries.values()) {
        entry.cancelled = true;
        entry.pending = null;
      }
      entries.clear();
    },
  };
}
