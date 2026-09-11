import { expect, test } from 'bun:test';
import { HubRouter } from '../src/hub/hub-router';
import { registerOperationalRoutes } from '../src/hub/routes/operational-routes';

test('request telemetry validates records before logging and does not retain paths or error text', async () => {
  const logs: any[] = [];
  const responses: any[] = [];
  let body: any = { version: 1, requestId: 'client-1', operation: 'files.list', method: 'GET', startedAt: '2026-09-11T21:34:00.000Z', durationMs: 12000, outcome: 'timeout', path: '/secret', error: 'secret' };
  const router = new HubRouter((_, status, body) => responses.push({ status, body }), async () => body);
  registerOperationalRoutes(router, { hubLog: (level: string, message: string, meta: unknown) => logs.push({ level, message, meta }) } as any);
  const request = () => router.handle({ method: 'POST', headers: {} } as any, {} as any, new URL('http://hub.test/api/telemetry/request'));
  await request();
  expect(responses[0].status).toBe(202);
  expect(logs[0].level).toBe('warn');
  expect(logs[0].message).toBe('client request timing');
  expect(JSON.stringify(logs)).not.toContain('secret');
  body = { ...body, outcome: 'completed' };
  await request(); expect(logs[1].level).toBe('info');
  body = { ...body, durationMs: -1 };
  await request(); expect(responses[2].status).toBe(400); expect(logs).toHaveLength(2);
});
