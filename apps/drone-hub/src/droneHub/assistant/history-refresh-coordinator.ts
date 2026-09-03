export type HistoryRefreshOptions = {
  quiet?: boolean;
  preserveContextUsage?: boolean;
};

export type HistoryRefreshCoordinator = {
  refresh: (options?: HistoryRefreshOptions) => Promise<void>;
};

export function createHistoryRefreshCoordinator(
  run: (options: HistoryRefreshOptions) => Promise<void>,
): HistoryRefreshCoordinator {
  let pending: HistoryRefreshOptions | null = null;
  let active: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    let firstError: unknown = null;
    while (pending) {
      const options = pending;
      pending = null;
      try {
        await run(options);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  };

  const refresh = (options: HistoryRefreshOptions = {}): Promise<void> => {
    pending = pending ? mergeRefreshOptions(pending, options) : options;
    if (!active) {
      active = drain().finally(() => {
        active = null;
      });
    }
    return active;
  };

  return { refresh };
}

function mergeRefreshOptions(
  current: HistoryRefreshOptions,
  incoming: HistoryRefreshOptions,
): HistoryRefreshOptions {
  return {
    quiet: current.quiet === true && incoming.quiet === true,
    preserveContextUsage:
      current.preserveContextUsage === true && incoming.preserveContextUsage === true,
  };
}
