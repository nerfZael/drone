import { recordTerminalTiming as record } from './terminal-performance';
import { TerminalTelemetryReporter } from './terminal-telemetry';
import { requestJson } from '../http';
import { terminalOpenRequests, type ShellTerminalTarget } from './terminal-open-request';

export type TerminalSink = {
  write: (data: string | Uint8Array, done?: () => void) => void;
  reset: () => void;
};
export type TerminalConnectionState = {
  sessionName: string;
  connecting: boolean;
  error: string | null;
};
import { terminalPerformanceSamples, type TerminalTiming } from './terminal-performance';
export { terminalPerformanceSamples };

const MAX_INPUT = 1024 * 1024;
const encoder = new TextEncoder();
function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

// Independent of React: switching tabs or remounting a pane does not reopen the
// shell, lose its screen, or create a second input queue.
export class TerminalConnection {
  state: TerminalConnectionState = { sessionName: '', connecting: true, error: null };
  private listeners = new Set<(state: TerminalConnectionState) => void>();
  private ws: WebSocket | null = null;
  private disposed = false;
  private closing = false;
  private ready = false;
  private outputError: string | null = null;
  private generation = '';
  private transport = '';
  private offset: number | undefined;
  private receivedOffset = 0;
  private input: Array<{ type: 'input' | 'paste'; data: string; position: number }> = [];
  private inputBytes = 0;
  private inputBusy = false;
  private attempts = 0;
  private pollMode = false;
  private needsEnsure = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private pollBusy = false;
  private pollAbort?: AbortController;
  private cols = 80;
  private rows = 24;
  private started: number;
  private firstOutput = false;
  private lastInputAt = 0;
  private epoch = 0;
  private lifecycle = 0;
  readonly traceId = crypto.randomUUID();
  private timingEvents: TerminalTiming[] = [];
  private inputTimings: TerminalTiming[] = [];
  private lastTiming = new Map<string, number>();
  private startupDiagnostics: unknown;
  private streamDiagnostics: unknown;
  private requestId?: string;
  private socketStarted = 0;
  private actualTransport = 'connecting';
  private openPromise: Promise<void>;
  private opening = new Set<Promise<unknown>>();
  private telemetry: TerminalTelemetryReporter;

  constructor(
    readonly target: ShellTerminalTarget,
    private sink: TerminalSink,
    started = performance.now(),
  ) {
    this.started = started;
    this.telemetry = new TerminalTelemetryReporter(() => this.diagnostics());
    this.openPromise = this.open();
  }

  measure(
    phase: string,
    started: number,
    detail?: Record<string, string | number | boolean | undefined>,
  ) {
    if (this.disposed) return;
    const input = phase === 'input-queue-wait' || phase === 'output-after-input';
    const now = performance.now();
    if (input && now - (this.lastTiming.get(phase) ?? -Infinity) < 1000) return;
    this.lastTiming.set(phase, now);
    const events = input ? this.inputTimings : this.timingEvents;
    events.push(
      record({ droneId: this.target.droneId, traceId: this.traceId }, phase, started, detail),
    );
    if (events.length > (input ? 32 : 64)) events.shift();
    this.telemetry.schedule(
      input ? 30_000 : phase === 'ready' || phase.endsWith('processed') ? 250 : 1000,
    );
  }
  diagnostics() {
    return {
      version: 1,
      traceId: this.traceId,
      droneId: this.target.droneId,
      sessionName: this.state.sessionName,
      requestId: this.requestId,
      transport: this.actualTransport,
      connecting: this.state.connecting,
      failed: Boolean(this.state.error),
      elapsedMs: performance.now() - this.started,
      dimensions: { cols: this.cols, rows: this.rows },
      startup: this.startupDiagnostics,
      stream: this.streamDiagnostics,
      events: [...this.timingEvents, ...this.inputTimings].sort((a, b) => a.at.localeCompare(b.at)),
    };
  }
  subscribe(listener: (state: TerminalConnectionState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(next: Partial<TerminalConnectionState>) {
    this.state = { ...this.state, ...next };
    if (next.error) this.telemetry.schedule(250);
    for (const listener of this.listeners) listener(this.state);
  }

  private async open() {
    const lifecycle = this.lifecycle;
    let request: Promise<unknown> | undefined;
    const started = performance.now();
    this.update({ connecting: true });
    try {
      if (this.needsEnsure) terminalOpenRequests.invalidate(this.target);
      const pending = terminalOpenRequests.open(this.target);
      request = pending;
      this.opening.add(pending);
      const result = await pending;
      if (this.disposed || lifecycle !== this.lifecycle) return;
      this.startupDiagnostics = result.diagnostics;
      this.requestId = result.requestId;
      this.measure('open-request-wait', started, {
        reused: result.reused,
        requestMs: result.requestMs,
        transport: result.transport,
      });
      this.needsEnsure = false;
      this.transport = result.transport ?? '';
      this.update({ sessionName: result.sessionName });
      if (!this.closing) this.connect();
    } catch (error) {
      if (!this.disposed && lifecycle === this.lifecycle) {
        this.startupDiagnostics = (error as any)?.data?.diagnostics;
        this.measure('open-request-failed', started);
      }
      if (!this.disposed && lifecycle === this.lifecycle)
        this.update({ connecting: false, error: String((error as Error).message ?? error) });
    } finally {
      if (request) this.opening.delete(request);
    }
  }

  private connect() {
    if (this.disposed || this.closing || this.pollMode) return;
    const lifecycle = this.lifecycle;
    if (typeof WebSocket === 'undefined') {
      this.startPolling();
      return;
    }
    const epoch = ++this.epoch;
    const url = new URL(
      `/api/drones/${encodeURIComponent(this.target.droneId)}/terminal/${encodeURIComponent(this.state.sessionName)}/stream`,
      window.location.href,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (this.offset != null) url.searchParams.set('since', String(this.offset));
    if (this.generation) url.searchParams.set('generation', this.generation);
    url.searchParams.set('protocol', '2');
    if (this.transport === 'legacy') url.searchParams.set('transport', 'legacy');
    url.searchParams.set('cols', String(this.cols));
    url.searchParams.set('rows', String(this.rows));
    this.socketStarted = performance.now();
    this.measure('websocket-start', this.socketStarted, { attempt: this.attempts + 1 });
    const ws = new WebSocket(url);
    ws.onopen = () => {
      if (this.ws === ws) this.measure('websocket-handshake', this.socketStarted);
    };
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.ready = false;
    this.handshakeTimer = setTimeout(() => {
      if (!this.ready) ws.close();
    }, 10_000);
    ws.onmessage = (event) => {
      if (this.disposed || this.closing || this.ws !== ws) return;
      if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        this.receivedOffset += data.length;
        const nextOffset = this.receivedOffset;
        this.write(data, () => {
          if (epoch !== this.epoch || this.disposed) return;
          this.offset = nextOffset;
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'ack', bytes: data.length }));
        });
        return;
      }
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'diagnostic') {
        if (typeof message.phase === 'string' && Number.isFinite(message.ms))
          this.measure(message.phase.slice(0, 80), performance.now() - Math.max(0, message.ms), {
            reason: String(message.reason ?? '').slice(0, 80),
          });
        return;
      }
      if (message.type === 'ready') {
        this.streamDiagnostics = message.diagnostics;
        this.actualTransport = message.generation ? 'persistent' : 'legacy';
        this.measure('stream-ready', this.socketStarted, { transport: this.actualTransport });
        clearTimeout(this.handshakeTimer);
        if (
          this.generation &&
          message.generation &&
          this.generation !== message.generation &&
          this.input.length
        ) {
          this.input = [];
          this.inputBytes = 0;
          this.update({ error: 'The terminal restarted. Queued input was not sent.' });
        }
        this.generation = String(message.generation ?? '');
        this.offset = this.receivedOffset = Number(message.offsetBytes) || 0;
        this.ready = true;
        this.attempts = 0;
        this.update({
          connecting: false,
          error: this.state.error?.includes('input was not sent') ? this.state.error : null,
        });
        if (this.generation)
          ws.send(JSON.stringify({ type: 'resize', cols: this.cols, rows: this.rows }));
        this.measure('ready', this.started, { transport: this.actualTransport });
        void this.flushInput();
      } else if (message.type === 'stream-state') {
        if (message.state === 'reconnecting') {
          this.ready = false;
          this.setOutputError('Terminal output connection interrupted. Reconnecting…');
          this.measure('output-stream-reconnecting', performance.now(), {
            reason: message.reason === 'idle-timeout' ? 'idle-timeout' : 'stream-interrupted',
          });
          this.update({ connecting: true });
        } else if (message.state === 'connected') {
          this.ready = true;
          this.clearOutputError();
          this.update({ connecting: false });
          this.measure('output-stream-connected', performance.now());
          void this.flushInput();
        }
      } else if (message.type === 'snapshot') {
        this.sink.reset();
        const snapshotStarted = performance.now();
        this.write(decodeBase64(message.data), () =>
          this.measure('snapshot-processed', snapshotStarted),
        );
      } else if (message.type === 'output') {
        // Compatibility with the Hub's older SSE bridge. Never sanitize live bytes.
        this.write(String(message.text ?? ''), () => {
          if (epoch === this.epoch) this.offset = Number(message.offsetBytes) || 0;
        });
      } else if (message.type === 'error') {
        this.update({ error: String(message.error ?? 'Terminal connection failed') });
        if (message.code === 'STALE_TERMINAL_SESSION') {
          this.needsEnsure = true;
          this.input = [];
          this.inputBytes = 0;
          this.offset = undefined;
          ws.close();
        }
      }
    };
    ws.onclose = () => {
      if (this.disposed || this.closing || this.ws !== ws) return;
      clearTimeout(this.handshakeTimer);
      this.measure('websocket-closed', this.socketStarted);
      this.ws = null;
      this.ready = false;
      if (this.input.length) {
        this.input = [];
        this.inputBytes = 0;
        this.update({ error: 'Connection lost. Queued input was not sent.' });
      }
      this.update({ connecting: true });
      const attempt = ++this.attempts;
      this.reconnectTimer = setTimeout(
        () => {
          // Drain writes before choosing the resume cursor, avoiding duplicate
          // display when the old socket closed with parser work still pending.
          this.sink.write('', () => {
            if (this.disposed || this.closing || lifecycle !== this.lifecycle) return;
            if (attempt >= 3 && !this.generation) this.startPolling();
            else if (this.needsEnsure) this.openPromise = this.open();
            else this.connect();
          });
        },
        Math.min(2200, 150 * 2 ** Math.min(attempt - 1, 4)),
      );
    };
    ws.onerror = () => {}; // close owns recovery; never retry unacknowledged input.
  }

  private setOutputError(error: string) {
    const replace = !this.state.error || this.state.error === this.outputError;
    this.outputError = error;
    if (replace) this.update({ error });
  }

  private clearOutputError() {
    if (this.outputError && this.state.error === this.outputError) this.update({ error: null });
    this.outputError = null;
  }

  private write(data: string | Uint8Array, done?: () => void) {
    this.sink.write(data, () => {
      if (!this.firstOutput) {
        this.firstOutput = true;
        this.measure('first-output-processed', this.started);
      }
      if (this.lastInputAt) {
        this.measure('output-after-input', this.lastInputAt);
        this.lastInputAt = 0;
      }
      done?.();
    });
  }

  send(data: string) {
    if (this.disposed || this.closing || !data) return;
    const bytes = encoder.encode(data).length;
    if (this.inputBytes + bytes > MAX_INPUT) {
      this.update({ error: 'Paste is too large for the terminal input queue; it was not sent.' });
      return;
    }
    const paste = data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~');
    this.input.push({
      type: paste ? 'paste' : 'input',
      data: paste ? data.slice(6, -6) : data,
      position: 0,
    });
    this.inputBytes += paste ? bytes - 12 : bytes;
    this.lastInputAt = performance.now();
    void this.flushInput();
  }

  private async flushInput() {
    if (this.disposed || this.closing || !this.ready || this.inputBusy || !this.input.length)
      return;
    const lifecycle = this.lifecycle;
    this.inputBusy = true;
    if (this.lastInputAt) this.measure('input-queue-wait', this.lastInputAt);
    try {
      while (!this.disposed && this.ready && this.input.length) {
        if (!this.pollMode && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) return;
        if (!this.pollMode && this.ws!.bufferedAmount > 128 * 1024) {
          this.flushTimer = setTimeout(() => void this.flushInput(), 4);
          return;
        }
        const item = this.input[0];
        if (item.position === item.data.length) {
          this.input.shift();
          continue;
        }
        let end = Math.min(item.position + 4096, item.data.length);
        const last = item.data.charCodeAt(end - 1);
        if (end < item.data.length && last >= 0xd800 && last <= 0xdbff) end--;
        const chunk = item.data.slice(item.position, end);
        const first = item.position === 0;
        item.position = end;
        const final = end === item.data.length;
        if (final) this.input.shift();
        this.inputBytes -= encoder.encode(chunk).length;
        if (this.pollMode) {
          const data =
            item.type === 'paste'
              ? (first ? '\x1b[200~' : '') + chunk + (final ? '\x1b[201~' : '')
              : chunk;
          await requestJson(this.path('input'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data }),
          });
          if (lifecycle !== this.lifecycle || this.closing) return;
          void this.poll();
        } else {
          const legacyPaste = item.type === 'paste' && !this.generation;
          this.ws!.send(
            JSON.stringify({
              type: legacyPaste ? 'input' : item.type,
              data: legacyPaste
                ? (first ? '\x1b[200~' : '') + chunk + (final ? '\x1b[201~' : '')
                : chunk,
              ...(item.type === 'paste' && !legacyPaste ? { start: first, end: final } : {}),
            }),
          );
        }
      }
    } catch (error) {
      if (lifecycle !== this.lifecycle || this.closing || this.disposed) return;
      this.input = [];
      this.inputBytes = 0;
      this.update({
        error: `Input delivery failed. Check the terminal before retrying: ${String((error as Error).message ?? error)}`,
      });
    } finally {
      this.inputBusy = false;
      if (lifecycle !== this.lifecycle) void this.flushInput();
    }
  }

  resize(cols: number, rows: number) {
    if (this.cols === cols && this.rows === rows) return;
    this.cols = cols;
    this.rows = rows;
    if (this.ready && this.ws?.readyState === WebSocket.OPEN && this.generation)
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
  private path(action: string) {
    return `/api/drones/${encodeURIComponent(this.target.droneId)}/terminal/${encodeURIComponent(this.state.sessionName)}/${action}`;
  }
  private startPolling() {
    if (this.disposed || this.closing) return;
    this.actualTransport = 'http-polling';
    this.measure('http-fallback', this.socketStarted || this.started, { attempts: this.attempts });
    this.pollMode = true;
    this.ready = true;
    this.update({ connecting: false });
    void this.flushInput();
    void this.poll();
  }
  private async poll() {
    if (this.disposed || this.closing || !this.pollMode || this.pollBusy) return;
    const lifecycle = this.lifecycle;
    const controller = new AbortController();
    this.pollAbort = controller;
    this.pollBusy = true;
    clearTimeout(this.pollTimer);
    let delay = 600;
    try {
      const initial = this.offset == null;
      const params = initial ? 'view=screen&tail=40' : `since=${this.offset}&maxBytes=200000`;
      const output = await requestJson<{ text: string; offsetBytes: number }>(
        `${this.path('output')}?${params}`,
        { signal: controller.signal },
      );
      if (
        this.disposed ||
        this.closing ||
        lifecycle !== this.lifecycle ||
        controller.signal.aborted
      )
        return;
      this.clearOutputError();
      this.offset = output.offsetBytes;
      if (initial) this.sink.reset();
      if (output.text) {
        this.write(
          initial
            ? output.text.replace(/(?:\r?\n[ \t]*)+$/, '').replace(/\r?\n/g, '\r\n')
            : output.text,
        );
        delay = 120;
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        this.disposed ||
        this.closing ||
        lifecycle !== this.lifecycle
      )
        return;
      this.setOutputError(String((error as Error).message ?? error));
      delay = 2000;
    } finally {
      if (this.pollAbort === controller) {
        this.pollBusy = false;
        this.pollAbort = undefined;
      }
      if (
        !controller.signal.aborted &&
        !this.disposed &&
        !this.closing &&
        this.pollMode &&
        lifecycle === this.lifecycle
      )
        this.pollTimer = setTimeout(
          () => void this.poll(),
          document.visibilityState === 'hidden' ? 2500 : delay,
        );
    }
  }

  retry() {
    if (this.disposed || this.closing) return;
    const lifecycle = ++this.lifecycle;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.ready = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.pollTimer);
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.flushTimer);
    this.pollAbort?.abort();
    this.pollAbort = undefined;
    this.pollBusy = false;
    this.pollMode = false;
    this.attempts = 0;
    this.needsEnsure = true;
    const hadInput = this.input.length > 0;
    this.input = [];
    this.inputBytes = 0;
    this.update({
      connecting: true,
      error: hadInput ? 'Reconnecting. Queued input was not sent.' : null,
    });
    // Manual retries need the same renderer barrier as automatic reconnects.
    // Keep the old epoch alive until its writes have advanced the resume cursor.
    this.openPromise = new Promise<void>((resolve) => this.sink.write('', resolve)).then(
      async () => {
        if (this.disposed || this.closing || lifecycle !== this.lifecycle) return;
        await this.open();
      },
    );
  }

  async closeSession() {
    this.closing = true;
    this.ready = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.pollTimer);
    clearTimeout(this.flushTimer);
    clearTimeout(this.handshakeTimer);
    this.pollAbort?.abort();
    this.pollMode = false;
    this.input = [];
    this.inputBytes = 0;
    this.ws?.close();
    try {
      await this.openPromise;
      await Promise.allSettled([...this.opening]);
      const session = this.state.sessionName || this.target.sessionName;
      await requestJson(
        `/api/drones/${encodeURIComponent(this.target.droneId)}/terminal/${encodeURIComponent(session)}`,
        { method: 'DELETE' },
      );
      terminalOpenRequests.invalidate(this.target);
    } catch (error) {
      if (Number((error as { status?: number })?.status) === 404) {
        terminalOpenRequests.invalidate(this.target);
        return;
      }
      this.closing = false;
      if (!this.disposed) this.retry();
      throw error;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.telemetry.close();
    this.disposed = true;
    this.lifecycle++;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.pollTimer);
    clearTimeout(this.flushTimer);
    clearTimeout(this.handshakeTimer);
    this.pollAbort?.abort();
    this.ws?.close();
    this.listeners.clear();
  }
}
