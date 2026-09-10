import { captureLegacyTerminalSnapshot } from '../../src/hub/terminal-legacy-snapshot';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { WebSocket } from 'ws';
import { TerminalControls } from '../../src/terminal-control';
import { installTerminalSocket } from '../../src/daemon-terminal-socket';
import { createTerminalWebSocketServer } from '../../src/hub/terminal-websocket-server';

const exec = promisify(execFile);
const waitFor = async (predicate: () => boolean | Promise<boolean>, timeout = 5000) => {
  const until = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > until) throw new Error('condition timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function fixture(t: any, config = '') {
  const dir = await fs.mkdtemp('/tmp/terminal-control-test-');
  const configPath = `${dir}/tmux.conf`;
  await fs.writeFile(configPath, config);
  const args = ['-S', `${dir}/socket`, '-f', configPath];
  const tmux = (command: string[]) => exec('tmux', [...args, ...command]);
  await tmux(['new-session', '-d', '-s', 'probe', 'bash', '--noprofile', '--norc']);
  const controls = new TerminalControls(args);
  t.after(async () => {
    controls.close();
    await tmux(['kill-server']).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });
  await waitFor(async () =>
    (await tmux(['capture-pane', '-p', '-t', '=probe:^'])).stdout.includes('bash-'),
  );
  return { controls, tmux, args };
}

test(
  'persistent tmux input, snapshots, byte replay, resize and session sharing',
  { timeout: 15000 },
  async (t) => {
    const { controls, tmux } = await fixture(t);
    const first = await controls.acquire('probe');
    const second = await controls.acquire('probe');
    assert.equal(first.control, second.control);
    const control = first.control;
    await control.resize(111, 37);
    assert.equal(
      (
        await tmux(['display-message', '-p', '-t', 'probe:0.0', '#{pane_width} #{pane_height}'])
      ).stdout.trim(),
      '111 37',
    );
    const snapshot = await control.snapshot();
    assert.ok(snapshot.data.includes(Buffer.from('bash-')));
    const output: Buffer[] = [];
    const remove = control.subscribe(
      (data) => output.push(data),
      () => {},
    );
    await control.input(Buffer.from("printf '\\nSTART_€🙂_END\\n'\r"));
    await waitFor(() => Buffer.concat(output).includes(Buffer.from('\r\nSTART_€🙂_END\r\n')));
    const replay = control.replaySince(snapshot.offset)!;
    assert.deepEqual(replay, Buffer.concat(output));
    assert.deepEqual(control.replaySince(snapshot.offset + 1), replay.subarray(1));
    assert.equal(control.replaySince(control.offset + 1), null);
    assert.equal(control.replaySince(-1), null);
    // A paste must respect readline's bracketed-paste mode even when this viewer
    // attached after the prompt. Embedded tmux syntax must remain literal text.
    const pasteAt = control.offset;
    await control.paste(Buffer.from("printf '\\nPASTE_€_END\\n'"));
    await control.input(Buffer.from('\r'));
    await waitFor(() => control.replaySince(pasteAt)!.includes(Buffer.from('\r\nPASTE_€_END\r\n')));
    remove();
    first.release();
    second.release();
  },
);

test(
  'snapshots preserve the shell behind alternate screens and pending escape sequences',
  { timeout: 15000 },
  async (t) => {
    const { controls, tmux } = await fixture(t);
    const { control, release } = await controls.acquire('probe');
    await control.resize(80, 24);
    await control.input(
      Buffer.from(
        "stty -echo; printf '\\033[2J\\033[HMAIN_SCREEN'; printf '\\033[?1049h\\033[HALT_SCREEN'; sleep 30\r",
      ),
    );
    await waitFor(
      () => control.replaySince(0)?.includes(Buffer.from('h\x1b[HALT_SCREEN')) ?? false,
    );
    const snapshot = (await control.snapshot()).data.toString();
    assert.ok(/(?:H|\r\n)MAIN_SCREEN\r\n/.test(snapshot));
    assert.ok(snapshot.indexOf('MAIN_SCREEN') < snapshot.indexOf('\x1b[?1049h'));
    assert.ok(snapshot.lastIndexOf('ALT_SCREEN') > snapshot.indexOf('\x1b[?1049h'));
    await control.input(Buffer.from('\x03'));
    await tmux([
      'send-keys',
      '-t',
      'probe',
      "printf '\\033[?1049l\\033[38;2;123;'; sleep 30",
      'Enter',
    ]);
    await waitFor(() => control.replaySince(0)?.includes(Buffer.from('\x1b[38;2;123;')) ?? false);
    const partial = await control.snapshot();
    assert.ok(
      partial.data.toString().endsWith('\x1b[38;2;123;'),
      JSON.stringify(partial.data.toString()),
    );
    release();
  },
);

test(
  'daemon and Hub websocket proxy preserve bytes, resume, and respect renderer acknowledgements',
  { timeout: 20000 },
  async (t) => {
    const { controls } = await fixture(t);
    const daemon = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    const closeSocket = installTerminalSocket(daemon, 'test-token', controls);
    await new Promise<void>((r) => daemon.listen(0, '127.0.0.1', r));
    const daemonPort = (daemon.address() as any).port;
    const hub = http.createServer();
    const wss = createTerminalWebSocketServer({ isStaleSessionError: () => false });
    hub.on('upgrade', (req, socket, head) => {
      const u = new URL(req.url!, 'http://localhost');
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit('connection', ws, req, {
          droneName: 'probe',
          protocol: 2,
          sessionName: 'probe',
          client: { baseUrl: `http://127.0.0.1:${daemonPort}`, token: 'test-token' },
          generation: u.searchParams.get('generation') ?? undefined,
          since: u.searchParams.has('since') ? Number(u.searchParams.get('since')) : undefined,
          cols: 100,
          rows: 30,
          maxBytes: 200000,
        }),
      );
    });
    await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
    const port = (hub.address() as any).port;
    const sockets: WebSocket[] = [];
    t.after(async () => {
      for (const ws of sockets) ws.terminate();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      closeSocket();
      await Promise.all([
        new Promise<void>((r) => hub.close(() => r())),
        new Promise<void>((r) => daemon.close(() => r())),
      ]);
    });
    function connect(query = '') {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/${query}`);
      sockets.push(ws);
      const messages: any[] = [];
      const output: Buffer[] = [];
      let autoAck = true;
      ws.on('message', (data, binary) => {
        if (!binary) {
          messages.push(JSON.parse(data.toString()));
          return;
        }
        const bytes = Buffer.from(data as Buffer);
        output.push(bytes);
        if (autoAck) ws.send(JSON.stringify({ type: 'ack', bytes: bytes.length }));
      });
      return {
        ws,
        messages,
        output,
        pause: () => {
          autoAck = false;
        },
        resume: (bytes: number) => {
          autoAck = true;
          ws.send(JSON.stringify({ type: 'ack', bytes }));
        },
      };
    }
    const one = connect();
    await waitFor(() => one.messages.some((m) => m.type === 'snapshot'));
    const ready = one.messages.find((m) => m.type === 'ready');
    assert.ok(ready.generation);
    one.ws.send('null');
    one.ws.send(JSON.stringify({ type: 'input', data: "printf '\\nWS_€🙂_END\\n'\r" }));
    await waitFor(() => Buffer.concat(one.output).includes(Buffer.from('\r\nWS_€🙂_END\r\n')));
    one.ws.send(
      JSON.stringify({ type: 'paste', start: true, end: false, data: "printf '\\nSOCKET_" }),
    );
    one.ws.send(JSON.stringify({ type: 'paste', start: false, end: true, data: "PASTE_END\\n'" }));
    one.ws.send(JSON.stringify({ type: 'input', data: '\r' }));
    await waitFor(() =>
      Buffer.concat(one.output).includes(Buffer.from('\r\nSOCKET_PASTE_END\r\n')),
    );
    await new Promise((r) => setTimeout(r, 30));
    const offset = ready.offsetBytes + Buffer.concat(one.output).length;
    one.ws.close();
    await new Promise((r) => one.ws.once('close', r));
    const handle = await controls.acquire('probe');
    const pendingAt = handle.control.offset;
    await handle.control.input(Buffer.from("printf '\\nREPLAY_START\\n'\r"));
    await waitFor(
      () =>
        handle.control.replaySince(pendingAt)?.includes(Buffer.from('\r\nREPLAY_START\r\n')) ??
        false,
    );
    handle.release();
    const two = connect(`?generation=${ready.generation}&since=${offset}`);
    await waitFor(() => Buffer.concat(two.output).includes(Buffer.from('\r\nREPLAY_START\r\n')));
    assert.equal(
      two.messages.some((m) => m.type === 'snapshot'),
      false,
    );
    await new Promise((r) => setTimeout(r, 30));
    two.output.length = 0;
    two.pause();
    two.ws.send(
      JSON.stringify({
        type: 'input',
        data: "head -c 400000 /dev/zero | tr '\\0' X; printf '\\nFLOOD_END\\n'\r",
      }),
    );
    await waitFor(() => Buffer.concat(two.output).length === 256 * 1024);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(Buffer.concat(two.output).length, 256 * 1024);
    two.resume(256 * 1024);
    await waitFor(() => Buffer.concat(two.output).includes(Buffer.from('\r\nFLOOD_END\r\n')));
    await new Promise((r) => setTimeout(r, 50));
    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          two.ws.off('message', onOutput);
          reject(new Error('echo timed out'));
        }, 2000);
        const started = performance.now();
        const onOutput = (_data: unknown, binary: boolean) => {
          if (!binary) return;
          latencies.push(performance.now() - started);
          clearTimeout(timer);
          two.ws.off('message', onOutput);
          resolve();
        };
        two.ws.on('message', onOutput);
        two.ws.send(JSON.stringify({ type: 'input', data: 'z' }));
      });
    }
    latencies.sort((a, b) => a - b);
    t.diagnostic(
      `20 Hub-WebSocket-to-tmux-echo samples: median=${((latencies[9] + latencies[10]) / 2).toFixed(2)}ms p95=${latencies[18].toFixed(2)}ms (excludes renderer)`,
    );
    // Once a command is rejected, a queued suffix must not be applied later.
    const rejectedAt = handle.control.offset;
    two.ws.send(JSON.stringify({ type: 'resize', cols: 1, rows: 10 }));
    two.ws.send(JSON.stringify({ type: 'input', data: 'MUST_NOT_BE_SENT' }));
    await new Promise((resolve) => two.ws.once('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      handle.control.replaySince(rejectedAt)?.includes(Buffer.from('MUST_NOT_BE_SENT')),
      false,
    );
    const error = two.messages.find((m) => m.type === 'error');
    assert.match(error.error, /invalid terminal dimensions/);
    assert.equal(error.code, undefined, 'An input error must not recreate the session');
  },
);

test(
  'a maximum-size paste can queue during daemon attachment without dropping frames',
  { timeout: 10000 },
  async (t) => {
    let attached!: () => void;
    const attaching = new Promise<void>((resolve) => {
      attached = resolve;
    });
    let pasted: Buffer | undefined;
    const daemon = http.createServer();
    const close = installTerminalSocket(daemon, 'test', {
      acquire: async () => {
        await attaching;
        return {
          release() {},
          control: {
            generation: 'paste-test',
            resize: async () => {},
            snapshot: async () => ({ offset: 0, data: Buffer.alloc(0) }),
            replaySince: () => Buffer.alloc(0),
            subscribe: () => () => {},
            paste: async (bytes: Buffer) => {
              pasted = bytes;
            },
          },
        };
      },
    } as any);
    await new Promise<void>((resolve) => daemon.listen(0, '127.0.0.1', resolve));
    const ws = new WebSocket(
      `ws://127.0.0.1:${(daemon.address() as any).port}/v1/terminal/connect?session=probe&cols=80&rows=24`,
      { headers: { authorization: 'Bearer test' } },
    );
    const errors: any[] = [];
    ws.on('message', (raw, binary) => {
      if (!binary) {
        const message = JSON.parse(raw.toString());
        if (message.type === 'error') errors.push(message);
      }
    });
    t.after(async () => {
      attached();
      ws.terminate();
      close();
      await new Promise<void>((resolve) => daemon.close(() => resolve()));
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    for (let i = 0; i < 256; i++)
      ws.send(
        JSON.stringify({ type: 'paste', start: i === 0, end: i === 255, data: 'x'.repeat(4096) }),
      );
    await new Promise((resolve) => setTimeout(resolve, 30));
    attached();
    await waitFor(() => pasted !== undefined || errors.length > 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(pasted, Buffer.alloc(1024 * 1024, 'x'));
  },
);

test(
  'replay remains byte-exact across page boundaries and reports expired cursors',
  { timeout: 10000 },
  async (t) => {
    const { controls } = await fixture(t);
    const { control, release } = await controls.acquire('probe');
    const start = control.offset;
    await control.input(
      Buffer.from("head -c 2200000 /dev/zero | tr '\\0' X; printf '\\nREPLAY_END\\n'\r"),
    );
    await waitFor(() => control.offset > start + 2200000);
    assert.equal(control.replaySince(start), null);
    const retained = control.replaySince(control.offset - 100000)!;
    assert.equal(retained.length, 100000);
    assert.ok(retained.includes(Buffer.from('\r\nREPLAY_END\r\n')));
    assert.deepEqual(
      control.replaySince(control.offset - 100000, 32769),
      retained.subarray(0, 32769),
    );
    assert.equal(control.replaySince(control.offset)!.length, 0);
    release();
  },
);

test(
  'terminal attachment supports custom tmux window and pane numbering',
  { timeout: 10000 },
  async (t) => {
    const { controls } = await fixture(
      t,
      'set -g base-index 1\nset-window-option -g pane-base-index 1\n',
    );
    const { control, release } = await controls.acquire('probe');
    const snapshot = await control.snapshot();
    assert.ok(snapshot.data.includes(Buffer.from('bash-')));
    await control.input(Buffer.from("printf '\\nCUSTOM_INDEX_END\\n'\r"));
    await waitFor(
      () =>
        control.replaySince(snapshot.offset)?.includes(Buffer.from('\r\nCUSTOM_INDEX_END\r\n')) ??
        false,
    );
    release();
  },
);

test(
  'old-daemon snapshots capture exact cursor, dimensions and ANSI colors',
  { timeout: 10000 },
  async (t) => {
    const { controls, args } = await fixture(t);
    const { control, release } = await controls.acquire('probe');
    const before = control.offset;
    await control.input(
      Buffer.from("printf '\\033[2J\\033[H\\033[32mPROMPT> \\033[0m'; sleep 30\r"),
    );
    await waitFor(
      () => control.replaySince(before)?.includes(Buffer.from('\x1b[32mPROMPT> \x1b[0m')) ?? false,
    );
    const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
    const snapshot = await captureLegacyTerminalSnapshot(
      {
        droneName: 'test',
        sessionName: 'probe',
        runtime: 'container',
        cols: 90,
        rows: 50,
        client: { baseUrl: '', token: '' },
        maxBytes: 200000,
      },
      async (_command, commandArgs) => {
        const script = commandArgs[1].replace(/^tmux /, `tmux ${args.map(quote).join(' ')} `);
        return { ...(await exec('bash', ['-c', script])), code: 0 };
      },
    );
    assert.deepEqual(snapshot.geometry, {
      cols: 90,
      rows: 50,
      cursorX: 8,
      cursorY: 0,
      alternate: false,
    });
    assert.ok(snapshot.data.includes(Buffer.from('\x1b[32m')));
    assert.ok(snapshot.data.includes(Buffer.from('\x1b[1;9H')));
    release();
  },
);
