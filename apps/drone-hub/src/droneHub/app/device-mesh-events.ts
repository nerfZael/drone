const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;

export type DeviceMeshEventCallbacks = {
  onChange: () => void;
  onCapabilityEvent?: (event: DeviceMeshCapabilityEvent) => void;
};

export type DeviceMeshEventRuntime = {
  fetch: typeof window.fetch;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
};

function wait(
  delayMs: number,
  signal: AbortSignal,
  runtime: DeviceMeshEventRuntime,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = runtime.setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        runtime.clearTimeout(timer);
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
  callbacks: DeviceMeshEventCallbacks,
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

export class DeviceMeshEventParser {
  private buffer = '';
  private readonly lines: string[] = [];

  constructor(private readonly callbacks: DeviceMeshEventCallbacks) {}

  push(chunk: string): void {
    this.buffer += chunk;
    this.drain(false);
  }

  finish(chunk = ''): void {
    this.buffer += chunk;
    this.drain(true);
  }

  private drain(finishing: boolean): void {
    while (this.buffer) {
      const lf = this.buffer.indexOf('\n');
      const cr = this.buffer.indexOf('\r');
      const lineEnd = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
      if (lineEnd < 0) break;
      if (!finishing && this.buffer[lineEnd] === '\r' && lineEnd === this.buffer.length - 1) {
        break;
      }
      const line = this.buffer.slice(0, lineEnd);
      const newlineLength =
        this.buffer[lineEnd] === '\r' && this.buffer[lineEnd + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(lineEnd + newlineLength);
      if (line) {
        this.lines.push(line);
      } else if (this.lines.length > 0) {
        dispatchDeviceMeshEventBlock(this.lines.join('\n'), this.callbacks);
        this.lines.length = 0;
      }
    }
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
  runtime: DeviceMeshEventRuntime = {
    fetch: window.fetch.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  },
): () => void {
  const lifecycle = new AbortController();
  let request: AbortController | null = null;

  void (async () => {
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    let connected = false;
    while (!lifecycle.signal.aborted) {
      request = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const abortRequest = () => {
        request?.abort();
        void reader?.cancel().catch(() => undefined);
      };
      lifecycle.signal.addEventListener('abort', abortRequest, { once: true });
      try {
        const response = await runtime.fetch('/api/device-mesh/events', {
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
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new DeviceMeshEventParser({
          onChange,
          onCapabilityEvent: options.onCapabilityEvent,
        });
        while (!lifecycle.signal.aborted) {
          const { done, value } = await reader.read();
          if (value) parser.push(decoder.decode(value, { stream: true }));
          if (done) {
            parser.finish(decoder.decode());
            break;
          }
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
        void reader?.cancel().catch(() => undefined);
        request = null;
      }
      await wait(reconnectDelay, lifecycle.signal, runtime);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    }
  })();

  return () => {
    lifecycle.abort();
    request?.abort();
  };
}
