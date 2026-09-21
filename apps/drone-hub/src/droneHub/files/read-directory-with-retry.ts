/** Retry only transient read failures; permission/missing-path errors are final. */
export async function readDirectoryWithRetry<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  onRetry?: (attempt: number) => void,
  options: { timeoutMs?: number; delayMs?: number; pausedTimeoutMs?: number } = {},
): Promise<T> {
  let pausedSince: number | undefined;
  let transientFailures = 0;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('Directory request deadline exceeded', 'TimeoutError')); }, options.timeoutMs ?? 12_000);
    try {
      return await read(controller.signal);
    } catch (error) {
      signal.throwIfAborted();
      const status = (error as { status?: number })?.status;
      const message = String((error as { message?: string })?.message ?? '');
      // Docker pauses the source while committing a clone snapshot. The Hub
      // currently wraps that Docker 409 in a 500 response. Wait for Docker to
      // resume it; unpausing here would interrupt the snapshot's consistency.
      const paused = [409, 500].includes(status ?? 0) && /\bcontainer\b[^\n]*\bis paused\b/i.test(message);
      if (paused) {
        pausedSince ??= Date.now();
        if (Date.now() - pausedSince >= (options.pausedTimeoutMs ?? 120_000)) {
          throw new Error('Files are unavailable because the drone is still paused. Retry when cloning finishes or resume the drone.');
        }
      } else {
        const transient = timedOut || error instanceof TypeError || [408, 429, 502, 503, 504].includes(status ?? 0);
        if (!transient || transientFailures++ >= 1) {
          if (timedOut) throw Object.assign(new Error('Files request timed out. Retry to reconnect.'), { name: 'TimeoutError' });
          throw error;
        }
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
    onRetry?.(attempt + 1);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, options.delayMs ?? 500);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
    });
  }
}
