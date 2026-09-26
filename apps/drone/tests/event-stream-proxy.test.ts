import { expect, test } from 'bun:test';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { proxyDroneHubEventStream } from '../src/hub/event-stream-proxy';

const listen = (server: http.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

test('event streams reach the client through the proxy at once, whatever the size of the first event', async () => {
  const seen: string[] = [];
  const api = http.createServer((req, res) => {
    seen.push(String(req.headers.authorization));
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    res.flushHeaders();
    // Sizes around and above 16 KB are where Bun's HTTP client held the first chunk back.
    res.write(`event: state\ndata: ${'x'.repeat(Number(new URL(req.url!, 'http://x').searchParams.get('n')))}\n\n`);
  });
  const apiPort = await listen(api);
  const ui = http.createServer((req, res) => proxyDroneHubEventStream({ req, res, apiHost: '127.0.0.1', apiPort, apiToken: 'secret' }));
  const uiPort = await listen(ui);
  try {
    for (const n of [100, 16_300, 16_400, 40_000, 200_000]) {
      // Read with a plain socket: a Bun HTTP client here could hit the very stall the proxy avoids.
      const received = await new Promise<string>((resolve, reject) => {
        let text = '';
        const socket = net.connect(uiPort, '127.0.0.1', () => socket.write(`GET /api/entity/stream?n=${n} HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\n\r\n`));
        const timer = setTimeout(() => { socket.destroy(); reject(new Error(`stalled at ${text.length} bytes for n=${n}`)); }, 2000);
        socket.on('data', d => { text += d.toString('latin1'); if (text.includes('x'.repeat(Math.min(n, 100)) + '\n\n') && text.length > n) { clearTimeout(timer); socket.destroy(); resolve(text); } });
      });
      expect(received).toMatch(/^HTTP\/1\.1 200/);
      expect(received.toLowerCase()).toContain('content-type: text/event-stream');
    }
    expect(seen.every(a => a === 'Bearer secret')).toBe(true);
  } finally {
    api.close();
    ui.close();
  }
});
