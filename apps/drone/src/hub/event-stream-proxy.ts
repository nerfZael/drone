import type http from 'node:http';
import net from 'node:net';

/** Headers that belong to one connection, not the response: never copied through. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length']);

/**
 * Proxies a server-sent event stream over a plain socket. Bun's HTTP client (fetch and node:http alike) can hold back
 * a large first chunk of a streamed response until more data arrives, which froze streams whose first event is big
 * (the entity bench's state) until the next event or keepalive. The request goes out as HTTP/1.0, so the body comes
 * back unframed and is passed through as it arrives.
 */
export function proxyDroneHubEventStream(opts: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  apiHost: string;
  apiPort: number;
  apiToken: string;
}): void {
  const url = new URL(opts.req.url ?? '/', 'http://127.0.0.1');
  const upstream = net.connect(opts.apiPort, opts.apiHost, () => {
    upstream.write(`GET ${url.pathname}${url.search} HTTP/1.0\r\nHost: ${opts.apiHost}:${opts.apiPort}\r\nAuthorization: Bearer ${opts.apiToken}\r\nAccept: text/event-stream\r\n\r\n`);
  });
  let head: Buffer | null = Buffer.alloc(0);
  upstream.on('data', (chunk: Buffer) => {
    if (!head) { opts.res.write(chunk); return; }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end < 0) return;
    const [status, ...lines] = head.subarray(0, end).toString('latin1').split('\r\n');
    opts.res.statusCode = Number(status.split(' ')[1]) || 502;
    for (const line of lines) {
      const at = line.indexOf(':');
      const key = line.slice(0, at).trim();
      if (at > 0 && !HOP_BY_HOP.has(key.toLowerCase())) opts.res.setHeader(key, line.slice(at + 1).trim());
    }
    opts.res.flushHeaders();
    const rest = head.subarray(end + 4);
    head = null;
    if (rest.length) opts.res.write(rest);
  });
  upstream.on('end', () => opts.res.end());
  upstream.on('error', (error) => {
    if (opts.res.headersSent) { opts.res.destroy(); return; }
    opts.res.statusCode = 502;
    opts.res.setHeader('content-type', 'application/json; charset=utf-8');
    opts.res.end(JSON.stringify({ ok: false, error: error.message }));
  });
  opts.req.on('close', () => upstream.destroy());
}

