import { expect, test } from 'bun:test';
import { observeRequest, RequestDiagnosticQueue } from '../src/droneHub/request-diagnostics';
import { normalizeRequestDiagnostic, type RequestDiagnostic } from '@drone/hub-model';
import { readDirectoryWithRetry } from '../src/droneHub/files/read-directory-with-retry';

const sample = (): RequestDiagnostic => ({ version: 1, requestId: 'client-1', operation: 'files.list', method: 'GET', startedAt: new Date().toISOString(), durationMs: 12_000, outcome: 'timeout' });

test('captures both timeout attempts without any active navigation, even before headers', async () => {
  const records: RequestDiagnostic[] = [];
  await expect(readDirectoryWithRetry(async (signal) => {
    const observation = observeRequest('/api/drones/id/fs/list?path=/secret', { signal }, (record) => records.push(record))!;
    try {
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    } catch (error) { observation.fail(error); throw error; }
  }, new AbortController().signal, undefined, { timeoutMs: 5, delayMs: 1 })).rejects.toThrow('Files request timed out');
  expect(records).toHaveLength(2);
  expect(new Set(records.map((record) => record.requestId)).size).toBe(2);
  expect(records.map((record) => record.outcome)).toEqual(['timeout', 'timeout']);
  expect(records.every((record) => record.headersMs === undefined && record.serverRequestId === undefined)).toBe(true);
  expect(JSON.stringify(records)).not.toContain('secret');
});

test('distinguishes navigation abort, body timeout, HTTP failure and successful settings reads', () => {
  const records: RequestDiagnostic[] = [];
  const save = (record: RequestDiagnostic) => records.push(record);
  const cancelled = new AbortController();
  const aborted = observeRequest('/api/drones/id/fs/list', { signal: cancelled.signal }, save)!;
  cancelled.abort(); aborted.fail(cancelled.signal.reason);
  const timeout = new AbortController();
  const slowBody = observeRequest('/api/settings/companion/live-voice', { signal: timeout.signal }, save)!;
  slowBody.response(new Response('', { headers: { 'x-drone-request-id': 'server-1' } }));
  timeout.abort(new DOMException('timeout', 'TimeoutError')); slowBody.fail(new DOMException('aborted', 'AbortError'));
  const failed = observeRequest('/api/companion/editor-file', { method: 'POST' }, save)!;
  failed.response(new Response('', { status: 403 })); failed.finish();
  const success = observeRequest('/api/settings/companion/live-voice', undefined, save)!;
  success.response(Response.json({ enabled: true })); success.finish(); success.fail(new Error('late'));
  expect(records.map((record) => record.outcome)).toEqual(['aborted', 'timeout', 'error', 'completed']);
  expect(records[1].serverRequestId).toBe('server-1');
  expect(records[1].headersMs).toBeGreaterThanOrEqual(0);
  expect(records[1].bodyMs).toBeUndefined();
  expect(observeRequest('/api/telemetry/request', undefined, save)).toBeNull();
});

test('validates telemetry and strips arbitrary payloads, paths, and nonfinite timings', () => {
  const normalized = normalizeRequestDiagnostic({ ...sample(), body: 'secret', url: '/secret', serverRequestId: 'bad\nvalue', headersMs: Infinity, resource: { queueMs: 3, protocol: 'h2', url: '/secret' } });
  expect(normalized).toEqual({ ...sample(), startedAt: normalized!.startedAt, resource: { queueMs: 3, protocol: 'h2' } });
  expect(normalizeRequestDiagnostic({ ...sample(), operation: '/secret' })).toBeNull();
  expect(normalizeRequestDiagnostic({ ...sample(), requestId: 'invalid\n' })).toBeNull();
  expect(normalizeRequestDiagnostic({ ...sample(), durationMs: NaN })).toBeNull();
});

test('upload queue retries failures, bounds retention and expires disconnected records', async () => {
  let now = 100;
  let online = false;
  const sent: string[] = [];
  const queue = new RequestDiagnosticQueue(async (record) => {
    if (!online) throw new Error('offline');
    sent.push(record.requestId); return true;
  }, () => now);
  for (let i = 0; i < 60; i++) queue.add({ ...sample(), requestId: `request-${i}` });
  expect(queue.size).toBe(50);
  await queue.flush(); expect(queue.size).toBe(50);
  online = true;
  await queue.flush(); expect(queue.size).toBe(0);
  expect(sent).toHaveLength(50); expect(sent[0]).toBe('request-10');
  queue.add(sample()); now += 600_000;
  await queue.flush(); expect(queue.size).toBe(0); expect(sent).toHaveLength(50);
});

test('shared JSON requests send correlation headers and preserve caller headers', async () => {
  const { requestJson } = await import('../src/droneHub/http');
  const original = globalThis.fetch;
  const ids: string[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.get('x-custom')).toBe('retained');
    ids.push(headers.get('x-drone-client-request-id')!);
    return Response.json({ ok: true, entries: [] });
  }) as typeof fetch;
  try {
    for (let i = 0; i < 2; i++) await requestJson('/api/drones/id/fs/list?path=/secret', { headers: { 'x-custom': 'retained' } });
    expect(ids.every((id) => /^[a-zA-Z0-9_-]{1,128}$/.test(id))).toBe(true);
    expect(ids[0]).not.toBe(ids[1]);
  } finally { globalThis.fetch = original; }
});
