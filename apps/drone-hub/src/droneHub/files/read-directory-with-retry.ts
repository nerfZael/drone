/** Retry only transient read failures; permission/missing-path errors are final. */
export async function readDirectoryWithRetry<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  onRetry?: (attempt: number) => void,
  options: { timeoutMs?: number; delayMs?: number } = {},
): Promise<T> {
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
      const transient = timedOut || error instanceof TypeError || [408, 429, 502, 503, 504].includes(status ?? 0);
      if (!transient || attempt >= 1) {
        if (timedOut) throw Object.assign(new Error('Files request timed out. Retry to reconnect.'), { name: 'TimeoutError' });
        throw error;
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
