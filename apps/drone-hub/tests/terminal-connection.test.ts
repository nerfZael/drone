import { afterEach, beforeEach, expect, test } from 'bun:test';
import { TerminalConnection } from '../src/droneHub/terminal/terminal-connection';
import { terminalOpenRequests } from '../src/droneHub/terminal/terminal-open-request';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  onmessage?: (event: { data: any }) => void;
  onclose?: () => void;
  constructor(readonly url: URL) {
    Socket.instances.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.());
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
let target: { droneId: string; cwd: string; sessionName: string };
let connection: TerminalConnection | undefined;
let saved: Map<string, PropertyDescriptor | undefined>;
let requests: Array<{ url: string; init?: RequestInit }>;
let request: (url: string, init?: RequestInit) => Promise<Response>;
let writes: Array<string | Uint8Array>;
let pendingWrites: Array<() => void>;
let holdWrites: boolean;
const drain = () => {
  while (pendingWrites.length) pendingWrites.shift()!();
};
const create = () =>
  (connection = new TerminalConnection(target, {
    write(data, done) {
      writes.push(data);
      if (holdWrites) pendingWrites.push(() => done?.());
      else done?.();
    },
    reset() {
      writes.push('[reset]');
    },
  }));

beforeEach(() => {
  saved = new Map(
    ['window', 'document', 'WebSocket', 'fetch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  target = { droneId: crypto.randomUUID(), cwd: '/tmp', sessionName: 'drone-hub-shell' };
  requests = [];
  writes = [];
  pendingWrites = [];
  holdWrites = false;
  Socket.instances = [];
  request = async () => json({ sessionName: target.sessionName, transport: 'terminal-control-v1' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { location: { href: 'http://localhost/' } } },
    document: { configurable: true, value: { visibilityState: 'visible' } },
    WebSocket: { configurable: true, writable: true, value: Socket },
    fetch: {
      configurable: true,
      value: (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return request(url, init);
      },
    },
  });
});
afterEach(() => {
  connection?.dispose();
  connection = undefined;
  drain();
  terminalOpenRequests.invalidate(target);
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('manual retries drain rendered output and only the latest retry reconnects', async () => {
  create();
  await tick();
  const original = Socket.instances[0];
  original.receive({ type: 'ready', generation: 'first', offsetBytes: 4 });
  original.receive(null); // Ignore malformed protocol messages without crashing the viewer.
  holdWrites = true;
  original.onmessage?.({ data: new TextEncoder().encode('ab').buffer });
  connection!.retry();
  connection!.retry();
  await tick();
  expect(Socket.instances).toHaveLength(1);
  drain();
  await tick();
  expect(Socket.instances).toHaveLength(2);
  expect(Socket.instances[1].url.searchParams.get('since')).toBe('6');
  expect(requests).toHaveLength(2);
});

test('closing waits for superseded session creation and ignores stale open results', async () => {
  const resolves: Array<(response: Response) => void> = [];
  let deletes = 0;
  request = async (url, init) => {
    if (init?.method === 'DELETE') {
      deletes++;
      return json({ ok: true });
    }
    return await new Promise((resolve) => resolves.push(resolve));
  };
  create();
  connection!.retry();
  await tick();
  expect(resolves).toHaveLength(2);
  resolves[1](json({ sessionName: target.sessionName }));
  await tick();
  expect(Socket.instances).toHaveLength(1);
  const closing = connection!.closeSession();
  await tick();
  expect(deletes).toBe(0);
  resolves[0](json({ sessionName: target.sessionName }));
  await closing;
  expect(deletes).toBe(1);
  expect(Socket.instances).toHaveLength(1);
});

test('a late HTTP poll cannot reset the screen or cursor after WebSocket recovery', async () => {
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  let resolvePoll!: (response: Response) => void;
  request = async (url) =>
    url.includes('/output?')
      ? await new Promise((resolve) => {
          resolvePoll = resolve;
        })
      : json({ sessionName: target.sessionName });
  create();
  await tick();
  const poll = requests.find((entry) => entry.url.includes('/output?'))!;
  expect(poll).toBeDefined();
  Object.defineProperty(globalThis, 'WebSocket', { value: Socket });
  connection!.retry();
  await tick();
  const socket = Socket.instances[0];
  socket.receive({ type: 'ready', generation: 'new', offsetBytes: 42 });
  expect(poll.init?.signal?.aborted).toBe(true);
  resolvePoll(json({ text: 'stale HTTP screen', offsetBytes: 999 }));
  await tick();
  expect(writes).not.toContain('stale HTTP screen');
  expect(writes).not.toContain('[reset]');
  connection!.retry();
  await tick();
  expect(Socket.instances[1].url.searchParams.get('since')).toBe('42');
});

test('closing an already absent session succeeds without reconnecting', async () => {
  request = async (_url, init) =>
    init?.method === 'DELETE'
      ? new Response(JSON.stringify({ error: 'session not found' }), { status: 404 })
      : json({ sessionName: target.sessionName });
  create();
  await tick();
  await connection!.closeSession();
  await tick();
  expect(Socket.instances).toHaveLength(1);
});

test('automatically uploads startup stages and sampled input timings without terminal contents', async () => {
  request = async () =>
    json({
      sessionName: target.sessionName,
      diagnostics: {
        runtime: 'container',
        path: 'recovery',
        fallback: 'daemon-unsupported',
        phases: [{ phase: 'container-lock-and-readiness', ms: 3000 }],
        totalMs: 3100,
      },
    });
  create();
  await tick();
  const socket = Socket.instances[0];
  socket.receive({
    type: 'diagnostic',
    phase: 'hub-legacy-fallback',
    ms: 20,
    reason: 'daemon-http-404',
  });
  socket.receive({
    type: 'ready',
    offsetBytes: 0,
    diagnostics: {
      scope: 'hub-stream',
      exactSnapshot: true,
      geometry: { cols: 80, rows: 24, cursorX: 8, cursorY: 0 },
      phases: [{ phase: 'legacy-snapshot', ms: 40 }],
    },
  });
  connection!.send('PRIVATE_INPUT_SENTINEL');
  socket.receive({ type: 'output', text: 'PRIVATE_OUTPUT_SENTINEL', offsetBytes: 23 });
  for (let i = 0; i < 500; i++) connection!.send('x');
  const report = connection!.diagnostics();
  expect(report.transport).toBe('legacy');
  expect(report.startup).toMatchObject({ fallback: 'daemon-unsupported' });
  expect(report.stream).toMatchObject({ exactSnapshot: true, geometry: { cursorY: 0 } });
  expect(report.events.some((event) => event.phase === 'open-request-wait')).toBe(true);
  expect(report.events.some((event) => event.phase === 'hub-legacy-fallback')).toBe(true);
  expect(report.events.length).toBeLessThan(20);
  expect(JSON.stringify(report)).not.toContain('PRIVATE_INPUT_SENTINEL');
  expect(JSON.stringify(report)).not.toContain('PRIVATE_OUTPUT_SENTINEL');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const uploads = requests.filter((request) => request.url === '/api/telemetry/terminal');
  expect(uploads).toHaveLength(1);
  const uploaded = JSON.parse(String(uploads[0].init?.body));
  expect(uploaded.traceId).toBe(connection!.traceId);
  expect(uploaded.connecting).toBe(false);
  expect(uploaded.startup.fallback).toBe('daemon-unsupported');
  expect(uploaded.events.some((event: any) => event.phase === 'output-after-input')).toBe(true);
  expect(JSON.stringify(uploaded)).not.toContain('PRIVATE_INPUT_SENTINEL');
  expect(JSON.stringify(uploaded)).not.toContain('PRIVATE_OUTPUT_SENTINEL');
});

test('failed terminal opens upload timings without including the error response contents', async () => {
  request = async (url) => {
    if (url === '/api/telemetry/terminal') return json({ ok: true });
    throw new Error('PRIVATE_ERROR_RESPONSE');
  };
  create();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const uploads = requests.filter((request) => request.url === '/api/telemetry/terminal');
  expect(uploads).toHaveLength(1);
  const uploaded = JSON.parse(String(uploads[0].init?.body));
  expect(uploaded.failed).toBe(true);
  expect(uploaded.connecting).toBe(false);
  expect(uploaded.events.some((event: any) => event.phase === 'open-request-failed')).toBe(true);
  expect(JSON.stringify(uploaded)).not.toContain('PRIVATE_ERROR_RESPONSE');
});
