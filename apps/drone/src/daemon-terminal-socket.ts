import type http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { TerminalControls } from './terminal-control';

const WINDOW_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024;

export function installTerminalSocket(
  server: http.Server,
  token: string,
  controls: TerminalControls,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // This is an internal daemon API; browser access goes through the Hub's
    // origin checks and authentication. Never accept a token in the URL.
    if (
      url.pathname !== '/v1/terminal/connect' ||
      req.headers.authorization !== `Bearer ${token}` ||
      req.headers.origin
    ) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    const session = url.searchParams.get('session') ?? '';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(session)) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let closed = false;
      let failed = false;
      let unsubscribe = () => {};
      let release = () => {};
      let outstanding = 0;
      let queuedInput = 0;
      let queuedMessages = 0;
      let paste: Buffer[] | null = null;
      let pasteBytes = 0;
      let inputChain = Promise.resolve();
      let pump = () => {};
      const fail = (error: unknown, stale = false) => {
        if (closed || failed) return;
        failed = true;
        paste = null;
        pasteBytes = 0;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: String((error as Error)?.message ?? error),
              ...(stale ? { code: 'STALE_TERMINAL_SESSION' } : {}),
            }),
          );
          ws.close(1011, 'Terminal disconnected');
        }
      };
      const started = performance.now();
      const phases: Array<{ phase: string; ms: number }> = [];
      const acquired = controls.acquire(session);
      const initialization = acquired.then(async (handle) => {
        phases.push({ phase: 'control-attach', ms: performance.now() - started });
        release = handle.release;
        if (closed) {
          release();
          return;
        }
        const control = handle.control;
        const cols = Number(url.searchParams.get('cols'));
        const rows = Number(url.searchParams.get('rows'));
        const resizeStarted = performance.now();
        if (cols >= 2 && rows >= 1) await control.resize(cols, rows);
        phases.push({ phase: 'initial-resize', ms: performance.now() - resizeStarted });
        let offset = Number(url.searchParams.get('since'));
        const resume =
          url.searchParams.has('since') &&
          url.searchParams.get('generation') === control.generation &&
          control.replaySince(offset) !== null;
        const snapshotStarted = performance.now();
        const snapshot = resume ? null : await control.snapshot();
        phases.push({
          phase: resume ? 'resume' : 'snapshot',
          ms: performance.now() - snapshotStarted,
        });
        if (closed) return;
        if (snapshot) offset = snapshot.offset;
        ws.send(
          JSON.stringify({
            type: 'ready',
            generation: control.generation,
            offsetBytes: offset,
            flowControl: true,
            diagnostics: {
              scope: 'daemon-stream',
              phases,
              totalMs: performance.now() - started,
              cols,
              rows,
              resumed: resume,
              geometry: snapshot?.geometry,
            },
          }),
        );
        if (snapshot)
          ws.send(JSON.stringify({ type: 'snapshot', data: snapshot.data.toString('base64') }));
        pump = () => {
          if (closed || failed || ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 512 * 1024) return;
          while (outstanding < WINDOW_BYTES) {
            const bytes = control.replaySince(
              offset,
              Math.min(32 * 1024, WINDOW_BYTES - outstanding),
            );
            if (bytes === null) {
              // A slow viewer must resynchronize explicitly; never skip bytes.
              ws.close(1013, 'Terminal output exceeded replay window');
              return;
            }
            if (!bytes.length) return;
            offset += bytes.length;
            outstanding += bytes.length;
            ws.send(bytes, (error) => {
              if (error) fail(error);
            });
          }
        };
        unsubscribe = control.subscribe(pump, () =>
          fail(new Error('terminal session was interrupted or exited'), true),
        );
        pump();
      });
      void initialization.catch((error) => fail(error, true));
      ws.on('message', (raw, binary) => {
        if (closed || failed || binary) return;
        let message: any;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ack') {
          const bytes = Number(message.bytes);
          if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > outstanding) return;
          outstanding -= bytes;
          pump();
          return;
        }
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (!['input', 'paste', 'resize'].includes(message.type)) return;
        const data =
          message.type !== 'resize' && typeof message.data === 'string'
            ? Buffer.from(message.data)
            : Buffer.alloc(0);
        if (
          data.length > 128 * 1024 ||
          queuedInput + data.length > MAX_INPUT_BYTES ||
          queuedMessages >= 512
        ) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: 'Terminal input queue is full; input was not accepted.',
            }),
          );
          ws.close(1009, 'Terminal input queue is full');
          failed = true;
          return;
        }
        queuedInput += data.length;
        queuedMessages++;
        inputChain = inputChain
          .then(async () => {
            await initialization;
            if (closed || failed) return;
            const { control } = await acquired;
            if (message.type === 'paste') {
              if (message.start) {
                paste = [];
                pasteBytes = 0;
              }
              if (!paste) throw new Error('invalid terminal paste sequence');
              pasteBytes += data.length;
              if (pasteBytes > MAX_INPUT_BYTES) throw new Error('terminal paste too large');
              paste.push(data);
              if (message.end) {
                const content = Buffer.concat(paste);
                paste = null;
                pasteBytes = 0;
                await control.paste(content);
              }
            } else if (message.type === 'input') await control.input(data);
            else await control.resize(Number(message.cols), Number(message.rows));
          })
          .catch((error) => fail(error))
          .finally(() => {
            queuedInput -= data.length;
            queuedMessages--;
          });
      });
      const cleanup = () => {
        closed = true;
        unsubscribe();
        release();
      };
      ws.on('close', cleanup);
      ws.on('error', cleanup);
    });
  });
  return () => {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
