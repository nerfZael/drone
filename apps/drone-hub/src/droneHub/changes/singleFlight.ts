export type SingleFlightPoller = {
  start(): void;
  stop(): void;
  pollNow(): Promise<void>;
};

export function createSingleFlightPoller(opts: {
  poll: () => Promise<void>;
  intervalMs: number;
  isActive?: () => boolean;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}): SingleFlightPoller {
  const setTimer = opts.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = opts.clearTimer ?? ((timer) => clearTimeout(timer));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void pollNow().catch(() => {});
    }, opts.intervalMs);
  };

  const pollNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    if (opts.isActive && !opts.isActive()) {
      schedule();
      return Promise.resolve();
    }
    let result: Promise<void>;
    try {
      result = opts.poll();
    } catch (error) {
      result = Promise.reject(error);
    }
    inFlight = result.finally(() => {
      inFlight = null;
      schedule();
    });
    return inFlight;
  };

  return {
    start() {
      stopped = false;
      void pollNow().catch(() => {});
    },
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
    pollNow,
  };
}

export function singleFlightByKey<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = load().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}
