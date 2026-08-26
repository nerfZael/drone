const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = window.setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function dispatchEventBlock(block: string, onChange: () => void): void {
  const event = block
    .split('\n')
    .find((line) => line.startsWith('event:'))
    ?.slice('event:'.length)
    .trim();
  if (event === 'change') onChange();
}

/**
 * Subscribes with fetch instead of EventSource so direct-API authentication can
 * continue adding its bearer header. The connection is idle until mesh state changes.
 */
export function subscribeDeviceMeshChanges(onChange: () => void): () => void {
  const lifecycle = new AbortController();
  let request: AbortController | null = null;

  void (async () => {
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    while (!lifecycle.signal.aborted) {
      request = new AbortController();
      const abortRequest = () => request?.abort();
      lifecycle.signal.addEventListener('abort', abortRequest, { once: true });
      try {
        const response = await window.fetch('/api/device-mesh/events', {
          headers: { accept: 'text/event-stream' },
          cache: 'no-store',
          signal: request.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Device mesh event stream returned ${response.status}`);
        }
        reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!lifecycle.signal.aborted) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            dispatchEventBlock(buffer.slice(0, boundary), onChange);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
          }
          if (done) break;
        }
      } catch (error) {
        if (lifecycle.signal.aborted) break;
        if ((error as { name?: string })?.name === 'AbortError') break;
      } finally {
        lifecycle.signal.removeEventListener('abort', abortRequest);
        request = null;
      }
      await wait(reconnectDelay, lifecycle.signal);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    }
  })();

  return () => {
    lifecycle.abort();
    request?.abort();
  };
}
