export type GroupChatScrollAnchor = {
  scrollHeight: number;
  scrollTop: number;
};

export type GroupChatOlderLoadCoordinator = {
  dispose: () => void;
  isLoading: () => boolean;
  request: (regularLoadBusy: boolean) => 'active' | 'queued' | 'started';
  startQueuedAfterRegularLoad: (stillAvailable: boolean) => boolean;
  waitForIdle: () => Promise<void>;
};

export function createGroupChatOlderLoadCoordinator(options: {
  load: () => Promise<void>;
  onError: (error: unknown) => void;
  onLoadingChange: (loading: boolean) => void;
  resumePolling: () => void;
}): GroupChatOlderLoadCoordinator {
  let active: Promise<void> | null = null;
  let queued = false;
  let disposed = false;

  const start = () => {
    options.onLoadingChange(true);
    active = options
      .load()
      .catch((error) => {
        if (!disposed) options.onError(error);
      })
      .finally(() => {
        active = null;
        if (disposed) return;
        options.onLoadingChange(false);
        options.resumePolling();
      });
  };

  return {
    dispose() {
      disposed = true;
      queued = false;
    },
    isLoading() {
      return active !== null;
    },
    request(regularLoadBusy) {
      if (active) return 'active';
      if (regularLoadBusy) {
        queued = true;
        return 'queued';
      }
      start();
      return 'started';
    },
    startQueuedAfterRegularLoad(stillAvailable) {
      if (!queued || active || disposed) return false;
      queued = false;
      if (!stillAvailable) return false;
      start();
      return true;
    },
    async waitForIdle() {
      await active;
    },
  };
}

export function groupChatTailHasOlder(
  transcriptTotal: number | null,
  loadedCount: number,
  tailLimit: number,
): boolean {
  if (transcriptTotal != null) return transcriptTotal > loadedCount;
  return loadedCount >= tailLimit;
}

export function groupChatScrollTopAfterPrepend(
  anchor: GroupChatScrollAnchor,
  nextScrollHeight: number,
): number {
  return anchor.scrollTop + Math.max(0, nextScrollHeight - anchor.scrollHeight);
}
