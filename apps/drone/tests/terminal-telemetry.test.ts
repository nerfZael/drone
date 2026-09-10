import { expect, test } from 'bun:test';
import { HubRouter } from '../src/hub/hub-router';
import { registerOperationalRoutes } from '../src/hub/routes/operational-routes';
import { normalizeTerminalTelemetry } from '../src/hub/terminal-telemetry';

function fixture() {
  return {
    version: 1,
    traceId: 'trace-1',
    droneId: 'drone-1',
    sessionName: 'drone-hub-shell',
    transport: 'persistent',
    connecting: false,
    failed: false,
    elapsedMs: 3600,
    reason: 'checkpoint',
    reportedAt: '2026-09-10T12:58:03.935Z',
    dimensions: { cols: 92, rows: 49 },
    startup: {
      runtime: 'container',
      path: 'daemon',
      totalMs: 1683,
      phases: [{ phase: 'load-environment', ms: 1627 }],
      daemon: { totalMs: 22, phases: [{ phase: 'session-create', ms: 13 }] },
    },
    stream: {
      scope: 'daemon-stream',
      phases: [{ phase: 'snapshot', ms: 1 }],
      geometry: { cols: 92, rows: 49, cursorX: 34, cursorY: 0, alternate: false },
    },
    events: [
      {
        phase: 'ready',
        ms: 3596,
        at: '2026-09-10T12:58:03.930Z',
        detail: { transport: 'persistent' },
      },
    ],
  };
}

test('terminal telemetry strips commands, output, credentials and unknown nested fields', () => {
  const raw: any = fixture();
  raw.token = raw.command = raw.output = 'SECRET';
  raw.startup.environment = { KEY: 'SECRET' };
  raw.startup.daemon.token = 'SECRET';
  raw.events[0].detail.data = 'SECRET';
  raw.stream.geometry.text = 'SECRET';
  const report = normalizeTerminalTelemetry(raw);
  expect(report).toEqual(fixture());
  expect(JSON.stringify(report)).not.toContain('SECRET');
});

test('terminal telemetry bounds payloads and rejects invalid durations or identifiers', () => {
  for (const override of [
    { version: 2 },
    { traceId: 'line\nbreak' },
    { elapsedMs: Infinity },
    { events: Array(97).fill(fixture().events[0]) },
    { events: [{ ...fixture().events[0], ms: -1 }] },
  ])
    expect(normalizeTerminalTelemetry({ ...fixture(), ...override })).toBeNull();
});

test('terminal telemetry route logs complete JSON and acknowledges success without registry reads', async () => {
  const logs: Array<{ level: string; message: string }> = [];
  const responses: Array<{ status: number; body: any }> = [];
  const body = fixture();
  body.events = Array.from({ length: 96 }, (_, i) => ({
    ...body.events[0],
    phase: 'first-output-processed',
    ms: i,
  }));
  const router = new HubRouter(
    (_, status, body) => responses.push({ status, body }),
    async () => body,
  );
  registerOperationalRoutes(router, {
    hubLog: (level: string, message: string) => logs.push({ level, message }),
  } as any);
  const request = () =>
    router.handle(
      { method: 'POST', headers: {} } as any,
      {} as any,
      new URL('http://hub.test/api/telemetry/terminal'),
    );
  expect(await request()).toBe(true);
  expect(responses[0]).toEqual({ status: 202, body: { ok: true } });
  expect(logs[0].level).toBe('info');
  expect(logs[0].message.length).toBeGreaterThan(10_000);
  expect(JSON.parse(logs[0].message.slice('terminal timing '.length))).toEqual(body);
  body.failed = true;
  await request();
  expect(logs[1].level).toBe('warn');
  body.version = 2;
  await request();
  expect(responses[2].status).toBe(400);
  expect(logs).toHaveLength(2);
});
