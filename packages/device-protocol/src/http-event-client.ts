/** The device-network wire version is independent of persisted membership and capability versions. */
export const DEVICE_HTTP_PROTOCOL = 2;
export const DEVICE_HTTP_PATH = '/api/device-mesh/v2/session';
export const DEVICE_HTTP_MAX_JSON_BYTES = 8 * 1024 * 1024;

export async function readBoundedHttpText(
  response: Response,
  limit = DEVICE_HTTP_MAX_JSON_BYTES,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error('Device response is too large');
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Incremental SSE parsing, including CRLF split across reads and bounded incomplete events. */
export class DeviceEventParser {
  private buffer = '';
  constructor(private readonly dispatch: (data: string, id?: string) => void) {}

  push(text: string): void {
    this.buffer += text;
    if (this.buffer.length > DEVICE_HTTP_MAX_JSON_BYTES)
      throw new Error('Device event is too large');
    for (;;) {
      const separator = /\r?\n\r?\n/.exec(this.buffer);
      if (!separator) return;
      const block = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      const id = block
        .split(/\r?\n/)
        .find((line) => line.startsWith('id:'))
        ?.slice(3)
        .trim();
      if (data) this.dispatch(data, id);
    }
  }
}

/** One SSE subscription and authenticated HTTP requests. No WebSocket or downgrade path. */
export class DeviceHttpEventClient {
  static readonly OPEN = 1;
  readyState = 0;
  bufferedAmount = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly lifetime = new AbortController();
  private token = '';
  private readonly url: string;
  lastEventId: string;
  get signal(): AbortSignal {
    return this.lifetime.signal;
  }

  constructor(
    endpoint: string,
    deviceId: string,
    private readonly fetcher: typeof fetch = fetch,
    lastEventId = '',
  ) {
    this.lastEventId = lastEventId;
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      throw new Error('Device endpoint must use HTTPS');
    }
    url.pathname = DEVICE_HTTP_PATH;
    url.search = `deviceId=${encodeURIComponent(deviceId)}`;
    url.hash = '';
    this.url = url.toString();
    // Let the owner install lifecycle handlers before starting network I/O.
    void Promise.resolve().then(() => this.listen());
  }

  private async listen(): Promise<void> {
    try {
      const response = await this.fetcher(this.url, {
        headers: {
          accept: 'text/event-stream',
          'x-device-protocol': String(DEVICE_HTTP_PROTOCOL),
          ...(this.lastEventId ? { 'last-event-id': this.lastEventId } : {}),
        },
        signal: this.lifetime.signal,
        redirect: 'error',
      });
      if (response.status === 404 || response.status === 426)
        throw new Error('Remote DroneHub needs an update');
      if (!response.ok || !response.body)
        throw new Error(`Device event stream failed (${response.status})`);
      this.token = response.headers.get('x-device-session') ?? '';
      if (!this.token) throw new Error('Device session was not issued');
      this.readyState = DeviceHttpEventClient.OPEN;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new DeviceEventParser((data, id) => {
        if (id && !/[\r\n\0]/.test(id)) this.lastEventId = id;
        this.onmessage?.({ data });
      });
      try {
        while (!this.lifetime.signal.aborted) {
          const { value, done } = await reader.read();
          if (value) parser.push(decoder.decode(value, { stream: true }));
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (!this.lifetime.signal.aborted) this.onerror?.(asError(error));
    } finally {
      this.close();
    }
  }

  send(data: string, callback?: (error?: Error) => void): void {
    if (this.readyState !== DeviceHttpEventClient.OPEN) throw new Error('Device session is closed');
    const bytes = new TextEncoder().encode(data).byteLength;
    if (
      bytes > DEVICE_HTTP_MAX_JSON_BYTES ||
      this.bufferedAmount + bytes > DEVICE_HTTP_MAX_JSON_BYTES * 2
    ) {
      throw new Error('Device HTTP request queue is full');
    }
    this.bufferedAmount += bytes;
    void this.fetcher(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: data,
      signal: this.lifetime.signal,
      redirect: 'error',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Device request failed (${response.status})`);
        if (response.status !== 204) {
          const body = await readBoundedHttpText(response);
          if (body && !this.lifetime.signal.aborted) this.onmessage?.({ data: body });
        }
        callback?.();
      })
      .catch((error) => {
        callback?.(asError(error));
        if (!this.lifetime.signal.aborted) {
          this.onerror?.(asError(error));
          this.close();
        }
      })
      .finally(() => {
        this.bufferedAmount -= bytes;
      });
  }

  async prepareResultUpload(
    requestId: string,
    sourceDeviceId: string,
    size: number,
    revision: string,
  ): Promise<any> {
    if (this.readyState !== DeviceHttpEventClient.OPEN) throw new Error('Device session is closed');
    const url = new URL(this.url);
    url.pathname += '/result-content';
    const response = await this.fetcher(url.toString(), {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, sourceDeviceId, size, revision }),
      signal: this.lifetime.signal,
    });
    if (!response.ok) throw new Error('Phone result upload was not authorized');
    return JSON.parse(await readBoundedHttpText(response, 4096));
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.lifetime.abort();
    this.token = '';
    this.onclose?.();
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
