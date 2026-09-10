import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createTerminalWebSocketServer } from '../../src/hub/terminal-websocket-server';

test(
  'older UI clients stay on JSON and newer clients fall back to older daemons before sending input',
  { timeout: 10000 },
  async (t) => {
    let upgrades = 0;
    const input: string[] = [];
    const requests: string[] = [];
    const daemon = http.createServer(async (req, res) => {
      requests.push(req.url!);
      if (req.url!.startsWith('/v1/terminal/output/stream')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: ready\ndata: {"since":0}\n\n');
        res.write('event: output\ndata: {"chunk":"\\nABCDEF","nextOffset":7}\n\n');
        req.on('close', () => res.end());
      } else if (req.url!.startsWith('/v1/terminal/output?')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({ chunk: '\x1b[32mprompt$\x1b[0m' + '\n'.repeat(24), nextOffset: 0 }),
        );
      } else {
        let body = '';
        for await (const chunk of req) body += chunk;
        input.push(JSON.parse(body).data);
        res.end('{}');
      }
    });
    daemon.on('upgrade', (_req, socket) => {
      upgrades++;
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    });
    await new Promise<void>((r) => daemon.listen(0, '127.0.0.1', r));
    const hub = http.createServer();
    const wss = createTerminalWebSocketServer({ isStaleSessionError: () => false });
    hub.on('upgrade', (req, socket, head) => {
      const protocol = req.url === '/modern' ? 2 : undefined;
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit('connection', ws, req, {
          droneName: 'test',
          sessionName: 'drone-hub-shell',
          protocol,
          client: { baseUrl: `http://127.0.0.1:${(daemon.address() as any).port}`, token: 'test' },
          maxBytes: 200000,
        }),
      );
    });
    await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
    t.after(async () => {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await Promise.all([
        new Promise<void>((r) => hub.close(() => r())),
        new Promise<void>((r) => daemon.close(() => r())),
      ]);
    });
    for (const mode of ['old', 'modern']) {
      const ws = new WebSocket(`ws://127.0.0.1:${(hub.address() as any).port}/${mode}`);
      const messages: any[] = [];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('legacy output timed out')), 3000);
        ws.on('error', reject);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'input', data: mode })));
        ws.on('message', (raw, binary) => {
          assert.equal(binary, false);
          const message = JSON.parse(raw.toString());
          messages.push(message);
          if (message.type === 'output' && message.text === '\nABCDEF') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      assert.equal(
        messages.some((m) => m.type === 'snapshot'),
        mode === 'modern',
      );
      if (mode === 'modern') {
        const snapshot = messages.find((message) => message.type === 'snapshot');
        assert.equal(Buffer.from(snapshot.data, 'base64').toString(), '\x1b[32mprompt$\x1b[0m');
      }
      ws.close();
      await new Promise((r) => ws.once('close', r));
    }
    assert.equal(upgrades, 1, 'Old clients must not attempt the binary protocol');
    assert.deepEqual(input, ['old', 'modern']);
    assert.ok(
      !requests.some((url) => /[?&]max=1(?:&|$)/.test(url)),
      'Initialization must not discard a byte',
    );
  },
);

test(
  'legacy input preserves split Unicode and stops a command after uncertain delivery',
  { timeout: 10000 },
  async (t) => {
    for (const rejectFirst of [false, true]) {
      const input: string[] = [];
      let unblock!: () => void;
      const blocked = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      const daemon = http.createServer(async (req, res) => {
        if (req.url!.startsWith('/v1/terminal/output/stream')) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('event: ready\ndata: {"since":0}\n\n');
          req.on('close', () => res.end());
        } else {
          let body = '';
          for await (const data of req) body += data;
          input.push(JSON.parse(body).data);
          if (input.length === 1) {
            await blocked;
            if (rejectFirst) res.statusCode = 500;
          }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(rejectFirst ? { error: 'uncertain delivery' } : { ok: true }));
        }
      });
      await new Promise<void>((resolve) => daemon.listen(0, '127.0.0.1', resolve));
      const hub = http.createServer();
      const wss = createTerminalWebSocketServer({ isStaleSessionError: () => false });
      hub.on('upgrade', (req, socket, head) =>
        wss.handleUpgrade(req, socket, head, (ws) =>
          wss.emit('connection', ws, req, {
            droneName: 'test',
            sessionName: 'drone-hub-shell',
            since: 0,
            client: {
              baseUrl: `http://127.0.0.1:${(daemon.address() as any).port}`,
              token: 'test',
            },
            maxBytes: 200000,
          }),
        ),
      );
      await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve));
      const ws = new WebSocket(`ws://127.0.0.1:${(hub.address() as any).port}`);
      t.after(async () => {
        unblock();
        ws.terminate();
        for (const client of wss.clients) client.terminate();
        wss.close();
        await Promise.all([
          new Promise<void>((resolve) => hub.close(() => resolve())),
          new Promise<void>((resolve) => daemon.close(() => resolve())),
        ]);
      });
      await new Promise((resolve) => ws.once('open', resolve));
      ws.send(JSON.stringify({ type: 'input', data: 'first' }));
      const waitFor = async (predicate: () => boolean) => {
        for (let i = 0; i < 200; i++) {
          if (predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error('input timed out');
      };
      await waitFor(() => input.length === 1);
      const suffix = 'x'.repeat(16383) + '🙂' + 'z'.repeat(200);
      ws.send(JSON.stringify({ type: 'input', data: suffix }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      unblock();
      if (rejectFirst) {
        await new Promise((resolve) => ws.once('close', resolve));
        assert.deepEqual(input, ['first'], 'Do not deliver a suffix after its prefix failed');
      } else {
        await waitFor(() => input.slice(1).join('').length >= suffix.length);
        assert.equal(input.slice(1).join(''), suffix);
        ws.close();
        await new Promise((resolve) => ws.once('close', resolve));
      }
    }
  },
);
