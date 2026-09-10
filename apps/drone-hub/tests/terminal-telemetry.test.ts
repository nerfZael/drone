import { afterEach, beforeEach, expect, test } from 'bun:test';
import { TerminalTelemetryReporter } from '../src/droneHub/terminal/terminal-telemetry';

let saved: Map<string, PropertyDescriptor | undefined>;
let timers: Map<number, { callback: () => void; delay: number }>;
let listeners: Map<string, () => void>;
let requests: RequestInit[];
let reporter: TerminalTelemetryReporter;
let send: () => Promise<Response>;
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function fire(delay: number) {
  const timer = [...timers].find(([, timer]) => timer.delay === delay);
  expect(timer).toBeDefined();
  timers.delete(timer![0]);
  timer![1].callback();
}

beforeEach(() => {
  saved = new Map(
    ['setTimeout', 'clearTimeout', 'fetch', 'window'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  timers = new Map();
  listeners = new Map();
  requests = [];
  let nextTimer = 0;
  send = async () => new Response(null, { status: 202 });
  Object.defineProperties(globalThis, {
    setTimeout: {
      configurable: true,
      value: (callback: () => void, delay: number) => {
        timers.set(++nextTimer, { callback, delay });
        return nextTimer;
      },
    },
    clearTimeout: { configurable: true, value: (timer: number) => timers.delete(timer) },
    fetch: {
      configurable: true,
      value: (_: string, init: RequestInit) => {
        requests.push(init);
        return send();
      },
    },
    window: {
      configurable: true,
      value: {
        addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name),
      },
    },
  });
  reporter = new TerminalTelemetryReporter(() => ({ traceId: 'trace', connecting: false }));
});
afterEach(async () => {
  reporter.close();
  await settle();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('batches typing, expedites startup, and stops uploading when idle', async () => {
  for (let i = 0; i < 1000; i++) reporter.schedule(30_000);
  expect(timers.size).toBe(1);
  expect(requests).toHaveLength(0);
  reporter.schedule(250);
  expect(timers.size).toBe(1);
  fire(250);
  await settle();
  expect(requests).toHaveLength(1);
  expect(requests[0].keepalive).toBe(true);
  expect(JSON.parse(String(requests[0].body))).toMatchObject({
    traceId: 'trace',
    reason: 'checkpoint',
  });
  expect(timers.size).toBe(0);
  reporter.schedule(30_000);
  fire(30_000);
  await settle();
  expect(requests).toHaveLength(2);
  expect(timers.size).toBe(0);
});

test('slow or failed uploads do not accumulate requests or leak timers', async () => {
  let reject!: (error: Error) => void;
  send = () =>
    new Promise((_, fail) => {
      reject = fail;
    });
  reporter.schedule();
  fire(1000);
  reporter.schedule();
  fire(1000);
  expect(requests).toHaveLength(1);
  fire(5000);
  expect(requests[0].signal?.aborted).toBe(true);
  reject(new Error('offline'));
  await settle();
  send = async () => new Response(null, { status: 202 });
  fire(1000);
  await settle();
  expect(requests).toHaveLength(2);
  expect(timers.size).toBe(0);
});

test('page hiding and closing flush pending timings and closing removes listeners', async () => {
  reporter.schedule(30_000);
  listeners.get('pagehide')!();
  await settle();
  expect(JSON.parse(String(requests[0].body)).reason).toBe('pagehide');
  reporter.schedule(30_000);
  reporter.close();
  await settle();
  expect(JSON.parse(String(requests[1].body)).reason).toBe('closed');
  expect(listeners.size).toBe(0);
  expect(timers.size).toBe(0);
  reporter.schedule();
  reporter.close();
  expect(timers.size).toBe(0);
  expect(requests).toHaveLength(2);
});
