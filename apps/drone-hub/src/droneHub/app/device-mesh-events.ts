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

export type DeviceMeshCapabilityEvent = {
  sourceDeviceId: string;
  capability: string;
  event: string;
  payload: Record<string, any>;
};

export function dispatchDeviceMeshEventBlock(
  block: string,
  callbacks: {
    onChange: () => void;
    onCapabilityEvent?: (event: DeviceMeshCapabilityEvent) => void;
  },
): void {
  const event = block
    .split('\n')
    .find((line) => line.startsWith('event:'))
    ?.slice('event:'.length)
    .trim();
  if (event === 'change') {
    callbacks.onChange();
    return;
  }
  if (event !== 'capability' || !callbacks.onCapabilityEvent) return;
  const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) return;
  try {
    const data = JSON.parse(dataLine.slice('data:'.length).trim());
    if (
      typeof data?.sourceDeviceId === 'string' &&
      typeof data?.capability === 'string' &&
      typeof data?.event === 'string' &&
      data?.payload &&
      typeof data.payload === 'object' &&
      !Array.isArray(data.payload)
    ) {
      callbacks.onCapabilityEvent(data as DeviceMeshCapabilityEvent);
    }
  } catch {
    // Ignore malformed advisory events; fallback polling still reconciles state.
  }
}

/**
 * Subscribes with fetch instead of EventSource so direct-API authentication can
 * continue adding its bearer header. The connection is idle until mesh state changes.
 */
export function subscribeDeviceMeshChanges(
  onChange: () => void,
  options: {
    onCapabilityEvent?: (event: DeviceMeshCapabilityEvent) => void;
    onConnectionChange?: (connected: boolean) => void;
  } = {},
): () => void {
  const lifecycle = new AbortController();
  let request: AbortController | null = null;

  void (async () => {
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    let connected = false;
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
        if (!connected) {
          connected = true;
          options.onConnectionChange?.(true);
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
            dispatchDeviceMeshEventBlock(buffer.slice(0, boundary), {
              onChange,
              onCapabilityEvent: options.onCapabilityEvent,
            });
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
          }
          if (done) break;
        }
      } catch (error) {
        if (lifecycle.signal.aborted) break;
        if ((error as { name?: string })?.name === 'AbortError') break;
      } finally {
        if (connected) {
          connected = false;
          options.onConnectionChange?.(false);
        }
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
