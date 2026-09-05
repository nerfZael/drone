import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  markHubChatRouteEntry,
  observeHubHttpRequest,
  retainHubRequestTiming,
  startHubStallMonitor,
} from '../../src/hub/hub-performance-diagnostics';

function fixture() {
  const req = {
    url: '/api/drones/id/chats/default/state?token=secret',
    method: 'GET',
  } as http.IncomingMessage;
  const res = new http.ServerResponse(req);
  const logs: any[] = [];
  observeHubHttpRequest(req, res, (_level, message, meta) => logs.push({ message, ...meta }));
  return { req, res, logs };
}

test('retains fast chat requests, route boundaries, IDs, and existing timing headers', () => {
  const { req, res, logs } = fixture();
  markHubChatRouteEntry(req);
  res.setHeader('server-timing', 'rows;dur=4');
  res.writeHead(200);
  res.emit('finish');
  res.emit('close');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].requestId, res.getHeader('x-drone-request-id'));
  assert.equal(logs[0].pathname, '/api/drones/id/chats/default/state');
  assert.equal(logs[0].outcome, 'finished');
  assert.ok(logs[0].entryToHeadersMs >= logs[0].entryToRouteMs);
  assert.match(
    String(res.getHeader('server-timing')),
    /rows;dur=4, hub_entry_to_headers;dur=.*hub_entry_to_route/,
  );
  assert.ok(!JSON.stringify(logs).includes('secret'));
});

test('preserves explicit writeHead timing headers in both supported forms', () => {
  for (const headers of [{ 'Server-Timing': 'rows;dur=7' }, ['Server-Timing', 'rows;dur=7']]) {
    const { res } = fixture();
    res.writeHead(200, 'OK', headers);
    // Node serializes explicit writeHead headers without necessarily caching them.
    assert.match(String((res as any)._header), /rows;dur=7, hub_entry_to_headers;dur=/);
  }
});

test('reports an aborted chat once even without headers', () => {
  const { res, logs } = fixture();
  res.emit('close');
  res.emit('finish');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].outcome, 'closed');
  assert.equal(logs[0].entryToHeadersMs, undefined);
});

test('does not mistake a chat event stream lifetime for request latency', () => {
  const { res, logs } = fixture();
  res.setHeader('content-type', 'text/event-stream');
  res.writeHead(200);
  res.emit('finish');
  assert.equal(logs.length, 0);
});

test('retains fast mesh chat replies but excludes explicit SSE headers', () => {
  const req = { url: '/api/device-mesh/v2/session', method: 'POST' } as http.IncomingMessage;
  const logs: any[] = [];
  const res = new http.ServerResponse(req);
  observeHubHttpRequest(req, res, (_level, _message, meta) => logs.push(meta));
  retainHubRequestTiming(res);
  res.writeHead(200);
  res.emit('finish');
  assert.equal(logs.length, 1);
  const stream = new http.ServerResponse(req);
  observeHubHttpRequest(req, stream, (_level, _message, meta) => logs.push(meta));
  retainHubRequestTiming(stream);
  stream.writeHead(200, { 'content-type': 'text/event-stream' });
  stream.emit('finish');
  assert.equal(logs.length, 1);
});

test('stall monitor records real event-loop blocking and stops cleanly', async () => {
  const logs: any[] = [];
  const stop = startHubStallMonitor((_level, _message, meta) => logs.push(meta));
  try {
    const until = performance.now() + 650;
    while (performance.now() < until) {
      /* Deliberately block the loop. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(logs.length, 1);
    assert.ok(logs[0].delayMs >= 350);
    assert.ok(logs[0].cpuUserMs > 0);
    assert.ok(logs[0].heapUsedBytes > 0);
    assert.ok(logs[0].gcOverlapMs >= 0);
  } finally {
    stop();
  }
  const count = logs.length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(logs.length, count);
});
